/**
 * `list_opportunities` — the persisted opportunity feed for chat and MCP.
 *
 * Split out of `opportunity.tools.ts`: the listing is by far the largest of the
 * three opportunity tools, and it is the only one that renders cards.
 */

import { z } from "zod";

import { requestContext } from "../shared/observability/request-context.js";


import type { DefineTool } from "../shared/agent/tool.helpers.js";
import type { OpportunityToolDeps } from "./opportunity.tools.port.js";
import { success, error, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import { focusedIntentId, focusedNetworkId, focusedNetworkLabel } from "../shared/agent/tool.scope.js";
import { MINIMAL_MAIN_TEXT_MAX_CHARS, getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from "./opportunity.labels.js";
import { OpportunityPresenter, gatherPresenterContext, getSafePresentationOrSkip, narratorRemarkFromReasoning, safeFallbackSummary, stripUuids, type PresenterDatabase } from "./opportunity.presentation.js";
import { buildOpportunityPresentation } from "./opportunity.presentation.js";
import { loadNegotiationContext } from "./negotiation-context.loader.js";
import { admitOpportunityUpdate } from "./opportunity.update-admission.js";
import { opportunityOwnerActionForStatus, type OpportunityOwnerAction, type OpportunityOwnerApprovalVerdict } from "./opportunity.owner-approval.js";
import { ownerApprovalProvenanceFor } from "./opportunity.owner-provenance.js";
import { selectOpportunityFeed } from "./opportunity.feed-selection.js";


import { buildMinimalOpportunityCard, CHAT_DISPLAY_LIMIT, attachOpportunityAppLink, attachProfileLink, buildNegotiationUrl, buildProfileUrl } from "./opportunity.tools.cards.js";
import { logger, stripLeadingNarratorName } from "./opportunity.tools.cards.js";

/** Builds the `list_opportunities` tool against the host's capabilities. */
export function createListOpportunitiesTool(defineTool: DefineTool, deps: OpportunityToolDeps) {
  const { database, userDb, systemDb, graphs, cache } = deps;
  const createOpportunityPresenter =
    (deps.opportunityPresentation?.createPresenter as (() => OpportunityPresenter) | undefined) ??
    (() => new OpportunityPresenter());
  const gatherOpportunityPresenterContext =
    (deps.opportunityPresentation?.gatherPresenterContext as typeof gatherPresenterContext | undefined) ??
    gatherPresenterContext;
  const listOpportunities = defineTool({
    name: "list_opportunities",
    description:
      "Lists the authenticated user's actionable opportunities (discovered connections). Returns opportunity cards ready for display.\n\n" +
      "**What are opportunities?** Matches between users whose intents complement each other within shared networkes. " +
      "Each opportunity has a status: draft (not yet sent), pending (sent, awaiting response), accepted, rejected, or expired.\n\n" +
      "**What this returns:** Only draft and pending opportunities — the ones the user can still act on. " +
      "Accepted, rejected, and expired ones are not surfaced through this tool.\n\n" +
      "**When to use:** When the user wants to see their current matches or review what's waiting for their response.\n\n" +
      "**Returns:** Up to 3 opportunity code blocks (interactive cards) with counterpart name, match reasoning, confidence score, " +
      "and current status. Use update_opportunity to act on them (send, accept, reject).",
    querySchema: z.object({
      networkId: z
        .string()
        .optional()
        .describe("Network UUID to filter opportunities to a specific community. Get from read_networks. Defaults to the scoped network in network-scoped chats. Omit to see opportunities across all networks."),
      scopeType: z
        .enum(['intent'])
        .optional()
        .describe("Optional selected scope type. Use 'intent' to narrow listed opportunities to a selected intent."),
      scopeId: z
        .string()
        .optional()
        .describe("Selected intent UUID when scopeType is 'intent'. Ignored only when absent."),
      includeDigestMarkers: z
        .boolean()
        .optional()
        .describe("Internal scheduled-digest mode only. When true, includes hidden delivery markers so the digest send pass can confirm only edited-in opportunities."),
    }),
    handler: async ({ context, query }) => {
      const scopedNetworkId = focusedNetworkId(context) ?? context.networkId?.trim();
      const scopedIndexLabel = focusedNetworkLabel(context);

      // Strict scope enforcement: when chat is network-scoped, only allow that index
      if (
        scopedNetworkId &&
        query.networkId?.trim() &&
        query.networkId.trim() !== scopedNetworkId
      ) {
        return error(
          `This chat is scoped to ${scopedIndexLabel}. You can only list opportunities from this community.`,
        );
      }

      const effectiveIndexId =
        (scopedNetworkId || query.networkId?.trim()) ?? undefined;
      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid network ID format.");
      }

      const contextIntentId = focusedIntentId(context);
      const rawScopeId = query.scopeId?.trim() || undefined;
      if (query.scopeType === 'intent' && !rawScopeId) {
        return error("scopeId required when scopeType is intent.");
      }
      if (!query.scopeType && rawScopeId) {
        return error("scopeType=intent required when scopeId is provided.");
      }
      if (rawScopeId && !UUID_REGEX.test(rawScopeId)) {
        return error("Invalid scope ID format.");
      }
      if (contextIntentId && rawScopeId && contextIntentId !== rawScopeId) {
        return error("This chat is scoped to a different intent.");
      }
      const effectiveIntentScope = contextIntentId
        ? { scopeType: 'intent' as const, scopeId: contextIntentId }
        : query.scopeType === 'intent' && rawScopeId
          ? { scopeType: 'intent' as const, scopeId: rawScopeId }
          : {};

      const selection = await selectOpportunityFeed({
        reader: database,
        deliveryLedger: deps.deliveryLedger,
        viewerId: context.userId,
        networkId: effectiveIndexId,
        intentScope: effectiveIntentScope,
        isMcp: context.isMcp === true,
        includeDigestMarkers: query.includeDigestMarkers,
        displayLimit: CHAT_DISPLAY_LIMIT,
        warn: (message, data) => logger.warn(message, data),
      });
      const { opportunities, dedupedCount, skippedIds, redeliveryIds, fetchedCount, isDigestMode } = selection;
      const buildListDebugSteps = (): Array<{ step: string; detail?: string; data?: Record<string, unknown> }> => {
        const steps: Array<{ step: string; detail?: string; data?: Record<string, unknown> }> = [];
        if (skippedIds.length > 0) {
          steps.push({
            step: "opportunity_display_skips",
            detail: `${skippedIds.length} opportunity card(s) couldn't be displayed`,
            data: {
              skippedCount: skippedIds.length,
              totalOpportunities: fetchedCount,
              skippedOpportunityIds: skippedIds,
            },
          });
        }
        return steps;
      };
      if (!opportunities || opportunities.length === 0) {
        if (skippedIds.length > 0) {
          const listDebugSteps = buildListDebugSteps();
          return success({
            found: false,
            count: 0,
            summary: "Some opportunities couldn't be displayed",
            message:
              "I found opportunities, but couldn't render them. Please try again.",
            ...(listDebugSteps.length ? { debugSteps: listDebugSteps } : {}),
          });
        }
        // Digest mode: distinguish "everything was already shown" from "nothing
        // exists" so the brief omits the people section instead of prompting
        // the user to run discovery.
        if (isDigestMode && dedupedCount > 0) {
          return success({
            found: false,
            count: 0,
            summary: "No new opportunities to show",
            message:
              "No new opportunities today — everything actionable has already been shown recently. Omit the people section from the digest.",
          });
        }
        return success({
          found: false,
          count: 0,
          summary: "No opportunities yet",
          message:
            "You have no opportunities yet. Create or refine an approved signal with create_intent or update_intent; matches are created in the background. Use list_opportunities later to review persisted results.",
        });
      }

      // Batch-fetch profiles and users for all counterpart and introducer userIds to avoid N+1
      const counterpartUserIds = new Set<string>();
      const introducerUserIds = new Set<string>();
      for (const opp of opportunities) {
        const counterpartActor = opp.actors.find(
          (a) => a.userId !== context.userId && a.role !== "introducer",
        );
        if (counterpartActor?.userId) counterpartUserIds.add(counterpartActor.userId);
        const introducerActor = opp.actors.find(
          (a) => a.role === "introducer" && a.userId !== context.userId,
        );
        if (introducerActor?.userId) introducerUserIds.add(introducerActor.userId);
      }
      const allUserIds = [
        ...new Set([...counterpartUserIds, ...introducerUserIds]),
      ];
      const [profileResults, userResults] = await Promise.all([
        Promise.all(allUserIds.map((id) => database.getProfile(id))),
        Promise.all(allUserIds.map((id) => database.getUser(id))),
      ]);
      const profileMap = new Map<string, Awaited<ReturnType<typeof database.getProfile>>>();
      const userMap = new Map<string, Awaited<ReturnType<typeof database.getUser>>>();
      allUserIds.forEach((userId, i) => {
        const profile = profileResults[i] ?? null;
        const user = userResults[i] ?? null;
        if (profile) profileMap.set(userId, profile);
        if (user) userMap.set(userId, user);
      });

      const cardDataList: Array<Record<string, unknown> & { opportunityId: string }> = [];
      const seenOpportunityIds = new Set<string>();

      if (isDigestMode) {
        // ── Digest mode: use LLM presenter for rich, second-person card text ──
        const presenter = createOpportunityPresenter();
        const presenterDb: PresenterDatabase = database;
        const PRESENTER_CONCURRENCY = 6;

        for (let i = 0; i < opportunities.length; i += PRESENTER_CONCURRENCY) {
          const chunk = opportunities.slice(i, i + PRESENTER_CONCURRENCY);
          const chunkCards = await Promise.all(
            chunk.map(async (opp) => {
              if (seenOpportunityIds.has(opp.id)) return null;
              seenOpportunityIds.add(opp.id);
              try {
                const counterpartActor = opp.actors.find(
                  (a) => a.userId !== context.userId && a.role !== "introducer",
                );
                const counterpartUserId = counterpartActor?.userId;
                if (!counterpartUserId) return null;

                const viewerIsIntroducerHere = opp.actors.some(
                  (a) => a.role === "introducer" && a.userId === context.userId,
                );
                const secondPartyActorForHeadline = viewerIsIntroducerHere
                  ? opp.actors.find(
                      (a) =>
                        a.userId !== context.userId &&
                        a.userId !== counterpartUserId &&
                        a.role !== "introducer",
                    )
                  : undefined;

                const introducerActor = opp.actors.find(
                  (a) => a.role === "introducer" && a.userId !== context.userId,
                );
                const createdByName = opp.detection.createdByName;

                const counterpartUser = userMap.get(counterpartUserId) ?? null;
                const counterpartName =
                  profileMap.get(counterpartUserId)?.identity?.name ??
                  counterpartUser?.name ??
                  "Someone";
                const introducerName =
                  createdByName ??
                  (introducerActor
                    ? (profileMap.get(introducerActor.userId)?.identity?.name ?? null)
                    : null);
                const introducerUser = introducerActor
                  ? userMap.get(introducerActor.userId) ?? null
                  : null;

                const secondPartyUser = secondPartyActorForHeadline
                  ? userMap.get(secondPartyActorForHeadline.userId) ?? null
                  : null;
                const secondPartyNameForHeadline = secondPartyActorForHeadline
                  ? (profileMap.get(secondPartyActorForHeadline.userId)?.identity?.name ??
                    secondPartyUser?.name ??
                    undefined)
                  : undefined;

                const viewerActor = opp.actors.find((a) => a.userId === context.userId);
                const viewerRole = viewerActor?.role ?? "party";

                try {
                  // Load the negotiation context alongside presenter context so
                  // the digest copy can explain *why* the opportunity surfaced
                  // (EDG-50) — the presenter grounds `digestSummary` in concrete
                  // negotiation turns when this is present. The same context
                  // yields the conversationId for the negotiation-trace link
                  // (EDG-51).
                  const [ctx, negotiationContext] = await Promise.all([
                    gatherOpportunityPresenterContext(
                      presenterDb,
                      opp,
                      context.userId,
                      counterpartUserId,
                      effectiveIntentScope.scopeId,
                    ),
                    loadNegotiationContext(deps.negotiationDatabase, opp.id, opp.status, context.userId),
                  ]);

                  const presentation = await presenter.presentCard({
                    ...ctx,
                    opportunityStatus: opp.status,
                    ...(negotiationContext ? { negotiationContext } : {}),
                  });

                  const negotiationUrl = buildNegotiationUrl(
                    negotiationContext?.conversationId,
                    deps.frontendUrl,
                  );

                  // Build narrator chip from presenter output
                  let narratorChip: { name: string; text: string; avatar?: string | null; userId?: string };
                  const introducerIsCounterpart = introducerActor && counterpartActor && introducerActor.userId === counterpartActor.userId;
                  if (introducerActor && introducerActor.userId !== context.userId && !introducerIsCounterpart) {
                    const narratorName = introducerName?.trim() || "Someone";
                    narratorChip = {
                      name: narratorName,
                      text: stripLeadingNarratorName(presentation.narratorRemark, narratorName),
                      avatar: introducerUser?.avatar ?? null,
                      userId: introducerActor.userId,
                    };
                  } else if (introducerActor?.userId === context.userId) {
                    narratorChip = { name: "You", text: presentation.narratorRemark, userId: context.userId };
                  } else {
                    narratorChip = { name: "Index", text: presentation.narratorRemark };
                  }

                  const card: Record<string, unknown> = {
                    opportunityId: opp.id,
                    userId: counterpartUserId,
                    name: counterpartName,
                    avatar: counterpartUser?.avatar ?? null,
                    mainText: stripUuids(presentation.personalizedSummary),
                    digestSummary: stripUuids(presentation.digestSummary),
                    // Deep-link to the negotiation trace that produced this card
                    // (EDG-51). Only present when a negotiation conversation exists.
                    ...(negotiationUrl ? { negotiationUrl } : {}),
                    cta: presentation.suggestedAction,
                    headline: viewerIsIntroducerHere && secondPartyNameForHeadline
                      ? `${counterpartName} → ${secondPartyNameForHeadline}`
                      : presentation.headline,
                    primaryActionLabel: getPrimaryActionLabel(viewerRole),
                    secondaryActionLabel: SECONDARY_ACTION_LABEL,
                    mutualIntentsLabel: presentation.mutualIntentsLabel,
                    narratorChip,
                    viewerRole,
                    score: typeof opp.interpretation?.confidence === "number"
                      ? opp.interpretation.confidence
                      : undefined,
                    status: opp.status,
                    ...(redeliveryIds.has(opp.id) ? { redelivery: true } : {}),
                    ...(viewerIsIntroducerHere && secondPartyNameForHeadline
                      ? {
                          secondParty: {
                            name: secondPartyNameForHeadline,
                            ...(secondPartyUser?.avatar != null ? { avatar: secondPartyUser.avatar } : {}),
                            ...(secondPartyActorForHeadline?.userId ? { userId: secondPartyActorForHeadline.userId } : {}),
                          },
                        }
                      : {}),
                  };

                  // Attach the agent-facing profile and opportunity links for
                  // MCP callers
                  if (context.isMcp) {
                    attachProfileLink(card as Record<string, unknown> & { opportunityId: string }, {
                      counterpartUserId,
                      frontendUrl: deps.frontendUrl,
                    });
                    attachOpportunityAppLink(card as Record<string, unknown> & { opportunityId: string }, {
                      frontendUrl: deps.frontendUrl,
                    });
                  }

                  return card as Record<string, unknown> & { opportunityId: string };
                } catch (presenterErr) {
                  logger.warn("LLM presenter failed for list_opportunities digest card, skipping raw fallback", {
                    opportunityId: opp.id,
                    err: presenterErr,
                  });
                  // Scheduled digests should only surface OpportunityPresenter-rendered
                  // copy. The minimal fallback reuses evaluator reasoning, which can
                  // contain raw narrator phrasing (for example "The discoverer...")
                  // and is not suitable for AgentVillage morning briefs.
                  skippedIds.push(opp.id);
                  return null;
                }
              } catch (err) {
                logger.warn("Skipping opportunity that failed to build card", {
                  opportunityId: opp.id,
                  err,
                });
                skippedIds.push(opp.id);
                return null;
              }
            }),
          );
          for (const card of chunkCards) {
            if (card) cardDataList.push(card);
          }
        }
      } else {
        // ── Chat/list mode: use OpportunityPresenter for user-facing card copy ──
        const presenter = createOpportunityPresenter();
        const presenterDb: PresenterDatabase = database;
        const PRESENTER_CONCURRENCY = 6;

        for (let i = 0; i < opportunities.length; i += PRESENTER_CONCURRENCY) {
          const chunk = opportunities.slice(i, i + PRESENTER_CONCURRENCY);
          const chunkCards = await Promise.all(
            chunk.map(async (opp) => {
              if (seenOpportunityIds.has(opp.id)) return null;
              seenOpportunityIds.add(opp.id);
              try {
                const counterpartActor = opp.actors.find(
                  (a) => a.userId !== context.userId && a.role !== "introducer",
                );
                const counterpartUserId = counterpartActor?.userId;
                if (!counterpartUserId) return null;

                const viewerIsIntroducerHere = opp.actors.some(
                  (a) => a.role === "introducer" && a.userId === context.userId,
                );
                const secondPartyActorForHeadline = viewerIsIntroducerHere
                  ? opp.actors.find(
                      (a) =>
                        a.userId !== context.userId &&
                        a.userId !== counterpartUserId &&
                        a.role !== "introducer",
                    )
                  : undefined;

                const introducerActor = opp.actors.find(
                  (a) => a.role === "introducer" && a.userId !== context.userId,
                );
                const createdByName = opp.detection.createdByName;

                const counterpartProfile = profileMap.get(counterpartUserId) ?? null;
                const counterpartUser = userMap.get(counterpartUserId) ?? null;
                const introducerProfile =
                  introducerActor && !createdByName
                    ? profileMap.get(introducerActor.userId) ?? null
                    : null;

                const counterpartName =
                  counterpartProfile?.identity?.name ??
                  counterpartUser?.name ??
                  "Someone";
                const introducerName =
                  createdByName ??
                  (introducerActor ? introducerProfile?.identity?.name ?? null : null);
                const introducerUser = introducerActor
                  ? userMap.get(introducerActor.userId) ?? null
                  : null;

                const secondPartyUser = secondPartyActorForHeadline
                  ? userMap.get(secondPartyActorForHeadline.userId) ?? null
                  : null;
                const secondPartyNameForHeadline = secondPartyActorForHeadline
                  ? (profileMap.get(secondPartyActorForHeadline.userId)?.identity?.name ??
                    secondPartyUser?.name ??
                    undefined)
                  : undefined;

                const viewerActor = opp.actors.find((a) => a.userId === context.userId);
                const viewerRole = viewerActor?.role ?? "party";

                const [ctx, negotiationContext] = await Promise.all([
                  gatherOpportunityPresenterContext(
                    presenterDb,
                    opp,
                    context.userId,
                    counterpartUserId,
                    effectiveIntentScope.scopeId,
                  ),
                  loadNegotiationContext(deps.negotiationDatabase, opp.id, opp.status, context.userId),
                ]);

                const presentation = await presenter.presentCard({
                  ...ctx,
                  opportunityStatus: opp.status,
                  ...(negotiationContext ? { negotiationContext } : {}),
                });

                let narratorChip: { name: string; text: string; avatar?: string | null; userId?: string };
                const introducerIsCounterpart = introducerActor && counterpartActor && introducerActor.userId === counterpartActor.userId;
                if (introducerActor && introducerActor.userId !== context.userId && !introducerIsCounterpart) {
                  const narratorName = introducerName?.trim() || "Someone";
                  narratorChip = {
                    name: narratorName,
                    text: stripLeadingNarratorName(presentation.narratorRemark, narratorName),
                    avatar: introducerUser?.avatar ?? null,
                    userId: introducerActor.userId,
                  };
                } else if (introducerActor?.userId === context.userId) {
                  narratorChip = { name: "You", text: presentation.narratorRemark, userId: context.userId };
                } else {
                  narratorChip = { name: "Index", text: presentation.narratorRemark };
                }

                const cardData: Record<string, unknown> & { opportunityId: string } = {
                  opportunityId: opp.id,
                  userId: counterpartUserId,
                  name: counterpartName,
                  avatar: counterpartUser?.avatar ?? null,
                  mainText: stripUuids(presentation.personalizedSummary),
                  cta: presentation.suggestedAction,
                  headline: viewerIsIntroducerHere && secondPartyNameForHeadline
                    ? `${counterpartName} → ${secondPartyNameForHeadline}`
                    : presentation.headline,
                  primaryActionLabel: getPrimaryActionLabel(viewerRole),
                  secondaryActionLabel: SECONDARY_ACTION_LABEL,
                  mutualIntentsLabel: presentation.mutualIntentsLabel,
                  narratorChip,
                  viewerRole,
                  score: typeof opp.interpretation?.confidence === "number"
                    ? opp.interpretation.confidence
                    : undefined,
                  status: opp.status,
                  ...(viewerIsIntroducerHere && secondPartyNameForHeadline
                    ? {
                        secondParty: {
                          name: secondPartyNameForHeadline,
                          ...(secondPartyUser?.avatar != null ? { avatar: secondPartyUser.avatar } : {}),
                          ...(secondPartyActorForHeadline?.userId ? { userId: secondPartyActorForHeadline.userId } : {}),
                        },
                      }
                    : {}),
                };

                // For MCP callers, attach the agent-facing profile link and the
                // opportunity deep link so the agent never has to fabricate
                // either. Accepting still happens in the Index app behind an
                // authenticated call — the deep link only opens the card.
                if (context.isMcp) {
                  attachProfileLink(cardData as Record<string, unknown> & { opportunityId: string }, {
                    counterpartUserId,
                    frontendUrl: deps.frontendUrl,
                  });
                  attachOpportunityAppLink(cardData as Record<string, unknown> & { opportunityId: string }, {
                    frontendUrl: deps.frontendUrl,
                  });
                }

                return cardData;
              } catch (err) {
                logger.warn("Skipping opportunity that failed to build presenter card", {
                  opportunityId: opp.id,
                  err,
                });
                skippedIds.push(opp.id);
                return null;
              }
            }),
          );
          for (const card of chunkCards) {
            if (card) cardDataList.push(card);
          }
        }
      }

      const listDebugSteps = buildListDebugSteps();

      if (cardDataList.length === 0) {
        if (skippedIds.length > 0) {
          return success({
            found: false,
            count: 0,
            summary: "Some opportunities couldn't be displayed",
            message:
              "I found opportunities, but couldn't render them. Please try again.",
            ...(listDebugSteps.length ? { debugSteps: listDebugSteps } : {}),
          });
        }
        return success({
          found: false,
          count: 0,
          summary: "No opportunities yet",
          message:
            "You have no opportunities yet. Create or refine an approved signal with create_intent or update_intent; matches are created in the background. Use list_opportunities later to review persisted results.",
        });
      }

      return success({
        found: true,
        count: cardDataList.length,
        summary: `You have ${cardDataList.length} opportunity(ies)`,
        message: buildOpportunityPresentation(cardDataList, {
          isMcp: context.isMcp ?? false,
          leadIn: `You have ${cardDataList.length} opportunity(ies).`,
          includeDigestMarkers: context.isMcp === true && query.includeDigestMarkers === true,
        }),
        ...(listDebugSteps.length ? { debugSteps: listDebugSteps } : {}),
      });
    },
  });
  return listOpportunities;
}
