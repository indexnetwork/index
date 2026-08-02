import { z } from "zod";

import { requestContext } from "../../shared/observability/request-context.js";


import type { DefineTool } from "../../shared/agent/tool.helpers.js";
import type { OpportunityToolDeps } from "../../capabilities/opportunities.tools.port.js";
import { success, error, UUID_REGEX } from "../../shared/agent/tool.helpers.js";
import { focusedIntentId, focusedNetworkId, focusedNetworkLabel } from "../../shared/agent/tool.scope.js";
import { MINIMAL_MAIN_TEXT_MAX_CHARS, getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from "../domain/opportunity.labels.js";
import { narratorRemarkFromReasoning, stripUuids } from "../domain/opportunity.presentation.js";
import { safeFallbackSummary, getSafePresentationOrSkip } from "../domain/opportunity.safe-presentation.js";
import { buildOpportunityPresentation } from "./opportunity.card-presentation.js";
import { isDiscoveryQuestionsEnabled, isUptakeGuardEnabled } from "../../capabilities/questions.runtime.facade.js";
import { OpportunityPresenter, gatherPresenterContext, type PresenterDatabase } from "./opportunity.presenter.js";
import { loadNegotiationContext } from "./negotiation-context.loader.js";
import { admitOpportunityUpdate } from './opportunity.update-admission.js';
import { opportunityOwnerActionForStatus, type OpportunityOwnerAction, type OpportunityOwnerApprovalVerdict } from './opportunity.owner-approval.js';
import { ownerApprovalProvenanceFor } from './opportunity.owner-provenance.js';
import { selectOpportunityFeed } from './opportunity.feed-selection.js';

export { buildOpportunityPresentation } from "./opportunity.card-presentation.js";

function stripLeadingNarratorName(remark: string, narratorName: string): string {
  let t = remark.trim();
  if (!t || !narratorName.trim()) return remark;
  const name = narratorName.trim();
  const nameLower = name.toLowerCase();
  for (;;) {
    const lower = t.toLowerCase();
    if (!lower.startsWith(nameLower)) break;
    // Require a word boundary after the name so a short name like "Al" does not
    // mangle a longer word ("Always …" → "ways …"). The char after the name must
    // be a separator (sentence/clause punctuation or whitespace) or end of string.
    // Keep this set in sync with the separator stripped from `rest` below.
    const boundary = t.charAt(name.length);
    if (boundary && !/[\s.:,\-–—]/.test(boundary)) break;
    const rest = t.slice(name.length).replace(/^\s*[.:,\-–—]\s*/i, '').trim();
    if (rest.length === 0 || rest === t) break;
    t = rest;
  }
  return t;
}
import type { EvaluatorEntity } from "./opportunity.evaluator.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import type { Opportunity } from "../../shared/interfaces/database.interface.js";
import type { PendingQuestionSummary } from "../../shared/schemas/pending-question.schema.js";
import { mergePendingQuestions } from "./opportunity.pending-questions.js";
import { invokeWithAbortSignal } from "../../shared/agent/model-signal.js";

const logger = protocolLogger("ChatTools:Opportunity");

/**
 * Build the agent-facing profile link for a counterpart — always the Index web
 * profile URL with `?link_preview=false`. Returns `undefined` only if
 * `frontendUrl` is not configured.
 *
 * The `?link_preview=false` hint is honored by chat-gateway runtimes (e.g.
 * OpenClaw's Telegram delivery) that strip link previews when present in the
 * URL; consistent placement matters more than Telegram's own handling.
 *
 * Trailing slashes on frontendUrl are stripped before concatenation.
 */
export function buildProfileUrl(
  counterpartUserId: string,
  frontendUrl: string | undefined,
): string | undefined {
  // The profile link is always the Index web profile, regardless of the
  // counterpart's socials.
  if (!frontendUrl) return undefined;
  const base = frontendUrl.replace(/\/+$/, "");
  return `${base}/u/${counterpartUserId}?link_preview=false`;
}

/**
 * Build the deep-link to an opportunity's A2A negotiation trace
 * (`/chat/:conversationId`) so users can see *what negotiation led to* the
 * surfaced opportunity (EDG-50/EDG-51). Returns `undefined` when `frontendUrl`
 * is unset or there is no negotiation conversation to link to.
 *
 * The `?link_preview=false` hint mirrors `buildProfileUrl` — chat-gateway
 * runtimes (e.g. Telegram delivery) strip link previews when it is present.
 * Trailing slashes on `frontendUrl` are stripped before concatenation.
 */
export function buildNegotiationUrl(
  conversationId: string | undefined,
  frontendUrl: string | undefined,
): string | undefined {
  if (!frontendUrl || !conversationId) return undefined;
  const base = frontendUrl.replace(/\/+$/, "");
  return `${base}/chat/${conversationId}?link_preview=false`;
}

/**
 * Attach the agent-facing profile link for a counterpart to `card` (mutates
 * in place). Every counterpart has a profile page worth linking to — without
 * this, the agent gets a name with no URL attached and tends to fabricate
 * one. Accept/act guidance is plain text ("accept in the Index app"); no
 * actionable URLs are minted here.
 */
export function attachProfileLink(
  card: Record<string, unknown> & { opportunityId: string },
  opts: {
    counterpartUserId: string;
    frontendUrl: string | undefined;
  },
): void {
  const profileUrl = buildProfileUrl(opts.counterpartUserId, opts.frontendUrl);
  if (profileUrl) card.profileUrl = profileUrl;
}

interface PublicUptakeQuestion {
  id: string;
  title: string;
  prompt: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

function publicUptakeQuestion(question: PendingQuestionSummary): PublicUptakeQuestion {
  return {
    id: question.id,
    title: question.title,
    prompt: question.prompt,
    options: question.options,
    multiSelect: question.multiSelect,
  };
}

function uptakeAdvisory(opportunityId: string, questions: PublicUptakeQuestion[]): string {
  return JSON.stringify({
    success: false,
    error: "Resolve the pending uptake questions or explicitly continue anyway.",
    advisory: {
      code: "unresolved_uptake_questions",
      advisoryOnly: true,
      opportunityId,
      questions,
      acknowledgedUptakeQuestionIds: questions.map((question) => question.id),
    },
  });
}

/**
 * IND-593: stable fail-closed denial for the owner-approval boundary. The
 * `missing` reason carries the fresh, server-derived interaction challenge the
 * owner must explicitly approve; all other reasons carry no challenge.
 */
function ownerApprovalDenial(
  opportunityId: string,
  action: OpportunityOwnerAction,
  verdict: Extract<OpportunityOwnerApprovalVerdict, { kind: 'denied' }>,
): string {
  return JSON.stringify({
    success: false,
    error: `Owner approval required for this opportunity ${action} (${verdict.reason}).`,
    approval: {
      code: "owner_approval_required",
      reason: verdict.reason,
      opportunityId,
      action,
      ...(verdict.challenge
        ? { interactionId: verdict.challenge.interactionId, expiresAt: verdict.challenge.expiresAt }
        : {}),
    },
  });
}

/**
 * Maximum number of opportunity cards to show per chat response.
 * Sized for `selectByComposition` to fill both feed buckets — up to 3
 * connection + 3 connector-flow per the digest/ambient prompt rules.
 */
const CHAT_DISPLAY_LIMIT = 6;

/**
 * Build minimal opportunity card data for chat without calling the LLM presenter.
 * Uses only required fields from the opportunity record and counterpart name/avatar
 * so list_opportunities and discovery return quickly.
 *
 * Note: narratorChip.text is generated via regex heuristics (narratorRemarkFromReasoning)
 * rather than the OpportunityPresenter LLM. If narrator quality becomes an issue again,
 * consider making this function async and delegating to OpportunityPresenter.presentCard()
 * which already produces a high-quality narratorRemark via LLM (used by the home graph
 * and discovery pipeline). The trade-off is 5-20s latency per card.
 *
 * Exported for use in tests (opportunity.tools.spec.ts).
 */
export function buildMinimalOpportunityCard(
  opp: Opportunity,
  viewerId: string,
  counterpartUserId: string,
  counterpartName: string,
  counterpartAvatar: string | null,
  introducerName?: string | null,
  introducerAvatar?: string | null,
  viewerName?: string,
  secondPartyName?: string,
  secondPartyAvatar?: string | null,
  secondPartyUserId?: string,
  isCounterpartGhost?: boolean,
): {
  opportunityId: string;
  userId: string;
  name: string;
  avatar: string | null;
  mainText: string;
  cta: string;
  headline: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  mutualIntentsLabel: string;
  narratorChip: { name: string; text: string; avatar?: string | null; userId?: string };
  viewerRole: string;
  score: number | undefined;
  status: string;
  isGhost: boolean;
  secondParty?: { name: string; avatar?: string | null; userId?: string };
} {
  const viewerActor = opp.actors.find((a) => a.userId === viewerId);
  const viewerRole = viewerActor?.role ?? "party";
  const introducerActor = opp.actors.find(
    (a) => a.role === "introducer" && a.userId !== viewerId,
  );
  const viewerIsIntroducer = opp.actors.some(
    (a) => a.role === "introducer" && a.userId === viewerId,
  );
  const reasoning = opp.interpretation?.reasoning ?? "";
  // Shared sanitization standard — see opportunity.safe-presentation.ts.
  const mainText = safeFallbackSummary(reasoning, {
    counterpartName,
    viewerName,
    introducerName: introducerName ?? undefined,
    maxChars: MINIMAL_MAIN_TEXT_MAX_CHARS,
    emptyText: "A suggested connection.",
  });
  const score =
    typeof opp.interpretation?.confidence === "number"
      ? opp.interpretation.confidence
      : undefined;
  const narratorName = viewerIsIntroducer
    ? "You"
    : introducerName?.trim() || (introducerActor ? "Someone" : "Index");
  const primaryActionLabel = getPrimaryActionLabel(viewerRole);
  return {
    opportunityId: opp.id,
    userId: counterpartUserId,
    name: counterpartName,
    avatar: counterpartAvatar,
    mainText,
    cta: "Start a conversation to connect.",
    headline: viewerIsIntroducer && secondPartyName
      ? `${counterpartName} → ${secondPartyName}`
      : `Connection with ${counterpartName}`,
    primaryActionLabel,
    secondaryActionLabel: SECONDARY_ACTION_LABEL,
    mutualIntentsLabel: "Suggested connection",
    narratorChip: {
      name: narratorName,
      text: narratorRemarkFromReasoning(reasoning, counterpartName, viewerName),
      ...(viewerIsIntroducer
        ? { userId: viewerId, avatar: null }
        : introducerActor
          ? { userId: introducerActor.userId, avatar: introducerAvatar ?? null }
          : {}),
    },
    viewerRole,
    score,
    status: opp.status ?? "latent",
    isGhost: isCounterpartGhost ?? false,
    ...(viewerIsIntroducer && secondPartyName
      ? {
          secondParty: {
            name: secondPartyName,
            ...(secondPartyAvatar != null ? { avatar: secondPartyAvatar } : {}),
            ...(secondPartyUserId ? { userId: secondPartyUserId } : {}),
          },
        }
      : {}),
  };
}

/**
 * Stable, retry-classified error codes for `confirm_opportunity_delivery`.
 *
 * The plain `error()` envelope only carries a human message, which forced
 * callers (the Hermes digest sweep) to treat every failure — permanent or
 * transient — as retryable, and made "already delivered but never confirmed"
 * impossible to distinguish from "opportunity deleted". Each code carries an
 * explicit `retryable` flag so deterministic callers can retry transient
 * failures and drop permanent ones instead of re-spamming the ledger.
 */
export type ConfirmDeliveryErrorCode =
  | "unauthenticated"
  | "ledger_unavailable"
  | "invalid_opportunity_id"
  | "opportunity_not_found"
  | "not_authorized"
  | "confirm_failed";

function confirmDeliveryError(
  code: ConfirmDeliveryErrorCode,
  retryable: boolean,
  message: string,
): string {
  return JSON.stringify({ success: false, error: message, code, retryable });
}

export function createOpportunityTools(defineTool: DefineTool, deps: OpportunityToolDeps) {
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
                const isCounterpartGhost = counterpartUser?.isGhost ?? false;

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
                    ),
                    loadNegotiationContext(deps.negotiationDatabase, opp.id, opp.status),
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
                    isGhost: isCounterpartGhost,
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

                  // Attach the agent-facing profile link for MCP callers
                  if (context.isMcp) {
                    attachProfileLink(card as Record<string, unknown> & { opportunityId: string }, {
                      counterpartUserId,
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
                const isCounterpartGhost = counterpartUser?.isGhost ?? false;

                const [ctx, negotiationContext] = await Promise.all([
                  gatherOpportunityPresenterContext(
                    presenterDb,
                    opp,
                    context.userId,
                    counterpartUserId,
                  ),
                  loadNegotiationContext(deps.negotiationDatabase, opp.id, opp.status),
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
                  isGhost: isCounterpartGhost,
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

                // For MCP callers, attach the agent-facing profile link so the
                // agent never has to fabricate one. Accept guidance is plain
                // text ("accept in the Index app") — no actionable URLs are
                // minted.
                if (context.isMcp) {
                  attachProfileLink(cardData as Record<string, unknown> & { opportunityId: string }, {
                    counterpartUserId,
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

  const updateOpportunity = defineTool({
    name: "update_opportunity",
    description:
      "Updates an opportunity's status, advancing it through the connection lifecycle.\n\n" +
      "**Status transitions:**\n" +
      "- `pending`: Sends a draft opportunity to the other party. They'll be notified and can accept or reject. " +
      "This is the primary action after a persisted draft is returned.\n" +
      "- `accepted`: Accept a received opportunity — opens a direct conversation between both parties. Returns a conversationId to surface to the user.\n" +
      "- `rejected`: Decline a received opportunity.\n" +
      "- `expired`: Mark as expired (typically done by the system after timeout).\n\n" +
      "**When to use:** After list_opportunities returns persisted opportunity cards. " +
      "The user clicks 'Send' (pending), 'Accept', or 'Reject' on the card, and the agent calls this tool. " +
      "An accepted transition may first return a non-success uptake advisory with preparatory questions. Surface those questions, then retry with all returned question ids in acknowledgedUptakeQuestionIds; acknowledgement confirms presentation, not an answer.\n\n" +
      "**Owner approval (agents):** Agent-driven send/accept/reject transitions require an explicit owner-issued approval proof. " +
      "Call without ownerApprovalProof first: the denial returns an approval challenge (interactionId, expiresAt) bound to the exact opportunity, action, owner, and agent. " +
      "Relay that challenge to the owner for explicit approval, then retry once with the issued ownerApprovalProof. " +
      "Proofs are single-use and expire; acknowledgedUptakeQuestionIds, negotiation approvals, and advisory values are never substitutes.\n\n" +
      "**Returns:** Confirmation with the new status and notification details (who was notified), or a structured uptake advisory without mutation.",
    querySchema: z.object({
      opportunityId: z
        .string()
        .describe("The UUID of the opportunity to update. Get from list_opportunities results."),
      status: z
        .enum(["pending", "accepted", "rejected", "expired"])
        .describe(
          "New status: 'pending' = send the draft to the other party, 'accepted' = accept the connection, " +
          "'rejected' = decline, 'expired' = mark as timed out.",
        ),
      ownerApprovalProof: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Opaque owner-issued approval proof for this exact transition (agents only). Obtained after the owner " +
          "explicitly approves the interaction challenge returned by a proof-less call. The opportunity, action, " +
          "owner, agent, and interaction binding is always derived server-side; only this token is presented.",
        ),
      acknowledgedUptakeQuestionIds: z
        .array(z.string().min(1))
        .optional()
        .describe("On an acknowledged retry after an uptake advisory, include every question id returned by that advisory."),
      scopeType: z
        .enum(['intent'])
        .optional()
        .describe("Optional selected scope type. Use 'intent' to require this opportunity to belong to a selected intent."),
      scopeId: z
        .string()
        .optional()
        .describe("Selected intent UUID when scopeType is 'intent'. Must match the chat's focused intent when one exists."),
    }),
    handler: async ({ context, query }) => {
      const opportunityId = query.opportunityId?.trim();
      if (!opportunityId || !UUID_REGEX.test(opportunityId)) {
        return error("Valid opportunityId required.");
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

      const scopedNetworkId = focusedNetworkId(context) ?? context.networkId?.trim();
      const admission = await admitOpportunityUpdate(systemDb, {
        opportunityId,
        viewerId: context.userId,
        scopedNetworkId,
        selectedIntentScope: effectiveIntentScope,
      });
      if (admission.kind === 'denied') return error(admission.message);

      // IND-593 owner-approval boundary: every owner-gated transition
      // (send/accept/reject) requires an explicit owner-issued, fresh,
      // atomically single-use proof before any graph/state persistence. The
      // binding is derived ONLY from the resolved context and validated input —
      // caller-controlled identity or proof-binding fields are never trusted.
      // Registered agents present the opaque proof token; direct authenticated
      // owners traverse the same boundary via host attestation. Fail closed
      // when no authority is wired.
      const ownerAction = opportunityOwnerActionForStatus(query.status);
      if (ownerAction) {
        const authority = deps.opportunityOwnerApproval;
        if (!authority) {
          return ownerApprovalDenial(opportunityId, ownerAction, { kind: 'denied', reason: 'missing' });
        }
        const directProvenance = ownerApprovalProvenanceFor(context);
        const verdict = context.agentId
          ? await authority.consumeAgentProof(query.ownerApprovalProof, {
              opportunityId,
              action: ownerAction,
              ownerId: context.userId,
              agentId: context.agentId,
            })
          : directProvenance
            ? await authority.attestOwnerInteraction({
                opportunityId,
                action: ownerAction,
                ownerId: context.userId,
                provenance: directProvenance,
              })
            : { kind: 'denied' as const, reason: 'untrusted_provenance' as const };
        if (verdict.kind === 'denied') return ownerApprovalDenial(opportunityId, ownerAction, verdict);
      }

      // The caller actor's own network is the exact question lookup boundary,
      // even for an otherwise unscoped request. A focused network may only be
      // equal to this after the guard above.
      // Unscoped callers query all of their exact opportunity questions; a
      // network-scoped caller is clamped to the bound network. Selecting the
      // first duplicate actor row would miss a valid question on another
      // shared network.
      const uptakeNetworkId = scopedNetworkId;

      // Soft uptake interlock: only acceptance is advisory-gated. All existing
      // actor/scope/privacy guards run first so the question lookup cannot be
      // used to probe opportunities or networks the caller cannot access.
      if (query.status === "accepted" && isUptakeGuardEnabled() && deps.findPendingQuestions) {
        try {
          const pending = await deps.findPendingQuestions(context.userId, {
            sourceType: "opportunity",
            sourceId: opportunityId,
            modes: ["negotiation"],
            purpose: "uptake",
            ...(uptakeNetworkId ? { networkId: uptakeNetworkId } : {}),
          });
          // Defense in depth if a host overlooks one or more filters. Actor
          // internals are checked here and never serialized into the advisory.
          const exactPending = pending.filter((question) => {
            if (
              question.sourceType !== "opportunity" ||
              question.sourceId !== opportunityId ||
              question.mode !== "negotiation" ||
              question.purpose !== "uptake"
            ) {
              return false;
            }
            if (!question.actors?.some((actor) => actor.userId === context.userId)) return false;
            if (uptakeNetworkId && !question.actors.some(
              (actor) => actor.userId === context.userId && actor.networkId === uptakeNetworkId,
            )) {
              return false;
            }
            return true;
          });
          const acknowledged = new Set(query.acknowledgedUptakeQuestionIds ?? []);
          if (exactPending.some((question) => !acknowledged.has(question.id))) {
            return uptakeAdvisory(opportunityId, exactPending.map(publicUptakeQuestion));
          }
        } catch (err) {
          logger.warn("update_opportunity: uptake question lookup failed open", {
            opportunityId,
            userId: context.userId,
            error: err instanceof Error ? err.message : String(err),
          });
          deps.reportToolError?.(err, {
            subsystem: "opportunity",
            operation: "opportunity.uptake_lookup",
            toolName: "update_opportunity",
            userId: context.userId,
          });
        }
      }

      const isSend = query.status === "pending";
      const _updateGraphStart = Date.now();
      const _updateTraceEmitter = requestContext.getStore()?.traceEmitter;
      _updateTraceEmitter?.({ type: "graph_start", name: "opportunity" });
      const result = await invokeWithAbortSignal(graphs.opportunity, {
        userId: context.userId,
        operationMode: isSend ? ("send" as const) : ("update" as const),
        opportunityId: query.opportunityId,
        ...(isSend ? {} : { newStatus: query.status }),
      });
      const _updateGraphMs = Date.now() - _updateGraphStart;
      _updateTraceEmitter?.({ type: "graph_end", name: "opportunity", durationMs: _updateGraphMs });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            opportunityId: result.mutationResult.opportunityId,
            status: query.status,
            message: result.mutationResult.message,
            ...(result.mutationResult.notified && { notified: result.mutationResult.notified }),
            ...(result.mutationResult.conversationId && {
              conversationId: result.mutationResult.conversationId,
            }),
            _graphTimings: [{ name: 'opportunity', durationMs: _updateGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to update opportunity.");
      }
      return error("Failed to update opportunity.");
    },
  });

  const confirmOpportunityDelivery = defineTool({
    name: "confirm_opportunity_delivery",
    description:
      "Marks an opportunity as delivered to the user via the OpenClaw channel. " +
      "Call this for each opportunity you decide to surface, BEFORE including it in your delivery message. " +
      "The 'trigger' argument records which dispatch path produced this delivery: " +
      "'ambient' for real-time critical alerts (target ≤3/day), 'digest' for the daily sweep, " +
      "'accepted' for accepted-opportunity notifications to the counterparty. " +
      "Idempotent — safe to call even if the opportunity was already confirmed.",
    querySchema: z.object({
      opportunityId: z
        .string()
        .describe("The UUID of the opportunity to mark as delivered."),
      trigger: z
        .enum(['ambient', 'digest', 'accepted'])
        .describe(
          "Which dispatch path produced this delivery. Use 'ambient' if the dispatch prompt says you are in the ambient pass; use 'digest' if it says you are in the daily digest; use 'accepted' for accepted-opportunity notifications to the counterparty.",
        ),
    }),
    handler: async ({ context, query }) => {
      if (!context.isMcp || !context.agentId) {
        return confirmDeliveryError(
          "unauthenticated",
          false,
          "confirm_opportunity_delivery is only available to authenticated agent MCP contexts.",
        );
      }
      if (!deps.deliveryLedger) {
        return confirmDeliveryError(
          "ledger_unavailable",
          false,
          "Delivery ledger not available in this context.",
        );
      }
      if (!UUID_REGEX.test(query.opportunityId)) {
        return confirmDeliveryError(
          "invalid_opportunity_id",
          false,
          "Invalid opportunity ID format.",
        );
      }
      try {
        const result = await deps.deliveryLedger.confirmOpportunityDelivery({
          opportunityId: query.opportunityId,
          userId: context.userId,
          agentId: context.agentId,
          trigger: query.trigger,
        });
        return success({ status: result });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // Permanent failures — the caller MUST NOT retry. Retrying a deleted
        // opportunity or an unauthorized actor never succeeds and only spams
        // the ledger / MCP transport.
        if (reason === 'opportunity_not_found') {
          logger.warn('confirm_opportunity_delivery: opportunity not found', {
            opportunityId: query.opportunityId,
          });
          return confirmDeliveryError(
            'opportunity_not_found',
            false,
            'Opportunity not found — it may have been deleted. Do not retry.',
          );
        }
        if (reason === 'not_authorized') {
          logger.warn('confirm_opportunity_delivery: caller is not an actor', {
            opportunityId: query.opportunityId,
            userId: context.userId,
          });
          return confirmDeliveryError(
            'not_authorized',
            false,
            'You are not an actor on this opportunity. Do not retry.',
          );
        }
        // Unknown / transient (e.g. DB connectivity) — safe to retry. The
        // ledger write is idempotent, so a retry that races a prior success
        // returns 'already_delivered' rather than a duplicate row.
        logger.error('Failed to confirm opportunity delivery', { err });
        return confirmDeliveryError(
          'confirm_failed',
          true,
          'Failed to confirm opportunity delivery — transient error, safe to retry.',
        );
      }
    },
  });

  return [
    listOpportunities,
    updateOpportunity,
    confirmOpportunityDelivery,
  ] as const;
}
