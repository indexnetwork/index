/**
 * `list_opportunities` — the persisted opportunity feed for chat and MCP.
 *
 * Split out of `opportunity.tools.ts`: the listing is by far the largest of the
 * three opportunity tools, and it is the only one that renders cards.
 */

import { z } from "zod";



import type { DefineTool } from "../shared/agent/tool.helpers.js";
import type { OpportunityToolDeps } from "./opportunity.tools.port.js";
import { success, error, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import { focusedIntentId, focusedNetworkId, focusedNetworkLabel } from "../shared/agent/tool.scope.js";
import { getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from "./opportunity.labels.js";
import { OpportunityPresenter, gatherPresenterContext, stripUuids, type PresenterDatabase } from "./opportunity.presentation.js";
import { buildOpportunityPresentation } from "./opportunity.presentation.js";
import { loadNegotiationContext } from "./negotiation-context.loader.js";
import { selectOpportunityFeed } from "./opportunity.feed-selection.js";


import { CHAT_DISPLAY_LIMIT, attachOpportunityAppLink, attachProfileLink } from "./opportunity.tools.cards.js";
import { logger } from "./opportunity.tools.cards.js";

/** Builds the `list_opportunities` tool against the host's capabilities. */
export function createListOpportunitiesTool(defineTool: DefineTool, deps: OpportunityToolDeps) {
  const { database } = deps;
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
    }),
    handler: async ({ context, query }) => {
      const scopedNetworkId = focusedNetworkId(context) ?? context.networkId?.trim();
      const scopedNetworkLabel = focusedNetworkLabel(context);

      // Strict scope enforcement: when chat is network-scoped, only allow that network
      if (
        scopedNetworkId &&
        query.networkId?.trim() &&
        query.networkId.trim() !== scopedNetworkId
      ) {
        return error(
          `This chat is scoped to ${scopedNetworkLabel}. You can only list opportunities from this community.`,
        );
      }

      const effectiveNetworkId =
        (scopedNetworkId || query.networkId?.trim()) ?? undefined;
      if (effectiveNetworkId && !UUID_REGEX.test(effectiveNetworkId)) {
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
        viewerId: context.userId,
        networkId: effectiveNetworkId,
        intentScope: effectiveIntentScope,
        displayLimit: CHAT_DISPLAY_LIMIT,
        warn: (message, data) => logger.warn(message, data),
      });
      const { opportunities, skippedIds, fetchedCount } = selection;
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
        return success({
          found: false,
          count: 0,
          summary: "No opportunities yet",
          message:
            "You have no opportunities yet. Create or refine an approved signal with create_intent or update_intent; matches are created in the background. Use list_opportunities later to review persisted results.",
        });
      }

      // Batch-fetch profiles and users for every counterpart to avoid N+1
      const counterpartUserIds = new Set<string>();
      for (const opp of opportunities) {
        const counterpartActor = opp.actors.find((a) => a.userId !== context.userId);
        if (counterpartActor?.userId) counterpartUserIds.add(counterpartActor.userId);
      }
      const allUserIds = [...counterpartUserIds];
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
              const counterpartActor = opp.actors.find((a) => a.userId !== context.userId);
              const counterpartUserId = counterpartActor?.userId;
              if (!counterpartUserId) return null;

              const counterpartProfile = profileMap.get(counterpartUserId) ?? null;
              const counterpartUser = userMap.get(counterpartUserId) ?? null;
              const counterpartName =
                counterpartProfile?.identity?.name ??
                counterpartUser?.name ??
                "Someone";

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
                loadNegotiationContext(deps.database, opp.id, opp.status, context.userId),
              ]);

              const presentation = await presenter.presentCard({
                ...ctx,
                opportunityStatus: opp.status,
                ...(negotiationContext ? { negotiationContext } : {}),
              });

              const narratorChip: { name: string; text: string; avatar?: string | null; userId?: string } =
                { name: "Index", text: presentation.narratorRemark };

              const cardData: Record<string, unknown> & { opportunityId: string } = {
                opportunityId: opp.id,
                userId: counterpartUserId,
                name: counterpartName,
                avatar: counterpartUser?.avatar ?? null,
                mainText: stripUuids(presentation.personalizedSummary),
                cta: presentation.suggestedAction,
                headline: presentation.headline,
                primaryActionLabel: getPrimaryActionLabel(viewerRole),
                secondaryActionLabel: SECONDARY_ACTION_LABEL,
                mutualIntentsLabel: presentation.mutualIntentsLabel,
                narratorChip,
                viewerRole,
                score: typeof opp.interpretation?.confidence === "number"
                  ? opp.interpretation.confidence
                  : undefined,
                status: opp.status,
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
        }),
        ...(listDebugSteps.length ? { debugSteps: listDebugSteps } : {}),
      });
    },
  });
  return listOpportunities;
}
