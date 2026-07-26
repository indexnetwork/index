import { z } from "zod";

import { requestContext } from "../../shared/observability/request-context.js";

import type { DefineTool } from "../../shared/agent/tool.helpers.js";
import type { OpportunityToolDeps } from "../../capabilities/opportunities.tools.port.js";
import { success, error, UUID_REGEX } from "../../shared/agent/tool.helpers.js";
import { deriveDiscoveryNetworkIds, focusedIntentId, focusedNetworkId, focusedNetworkLabel } from "../../shared/agent/tool.scope.js";
import { MINIMAL_MAIN_TEXT_MAX_CHARS, getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from "../domain/opportunity.labels.js";
import { narratorRemarkFromReasoning, stripUuids } from "../domain/opportunity.presentation.js";
import { safeFallbackSummary, getSafePresentationOrSkip } from "../domain/opportunity.safe-presentation.js";
import { buildOpportunityPresentation } from "./opportunity.card-presentation.js";
import { findCoalescedDiscoveryRun } from "../domain/opportunity.discovery-run-coalescing.js";
import { finalizeMcpDiscoveryLifecycle } from './opportunity.discovery-mcp-lifecycle-finalization.js';
import { runDiscoverFromQuery, continueDiscovery, type CompiledOpportunityGraph } from "./opportunity.discover.js";
import { isDiscoveryQuestionsEnabled, isUptakeGuardEnabled } from "../../capabilities/questions.runtime.facade.js";
import { OpportunityPresenter, gatherPresenterContext, type PresenterDatabase } from "./opportunity.presenter.js";
import { loadNegotiationContext } from "./negotiation-context.loader.js";
import { admitOpportunityUpdate } from './opportunity.update-admission.js';
import { opportunityOwnerActionForStatus, type OpportunityOwnerAction, type OpportunityOwnerApprovalVerdict } from './opportunity.owner-approval.js';
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
import type { DiscoveryRunInput, DiscoveryRunRecord } from "../../shared/interfaces/discovery-run.interface.js";
import type { ConnectLinkKind } from "../../shared/interfaces/connect-link.interface.js";
import { mergePendingQuestions } from "./opportunity.pending-questions.js";
import { invokeWithAbortSignal } from "../../shared/agent/model-signal.js";

const logger = protocolLogger("ChatTools:Opportunity");
const discoverOpportunitiesLog = protocolLogger("ChatTools:Opportunity:discover_opportunities");

/**
 * Exact-principal ownership guard for async discovery runs (IND-592).
 *
 * The store lookup is already user-scoped, but a single user can drive both a
 * session-human principal and one or more agent principals over MCP. A run is
 * owned by exactly one principal: the session human (agentId null/absent) or a
 * specific agent. `get_discovery_run` / `cancel_discovery_run` must therefore
 * reject a run whose recorded principal differs from the caller's, even within
 * the same user, so a principal can never read status/results or cancel another
 * principal's run. Both sides normalize absent/null to null.
 */
function isSameDiscoveryRunPrincipal(
  run: Pick<DiscoveryRunRecord, "agentId">,
  context: { agentId?: string | null },
): boolean {
  return (run.agentId ?? null) === (context.agentId ?? null);
}

/**
 * Pure status × role → ConnectLinkKind matrix.
 *
 * Returns the kind of short-link the viewer can act on directly, or `null` if
 * no direct link makes sense for this combination. Non-null kinds map to:
 *
 * - `connect` — pending opp where viewer is a non-introducer party. Clicking
 *   flips the opp to accepted and opens the chat with the counterpart.
 * - `approve_introduction` — draft or latent opp where viewer is an unapproved
 *   introducer. Clicking flips approved=true and triggers negotiation. The
 *   `draft` case comes from `discover_opportunities` intro mode; the `latent`
 *   case comes from background-discovered connector-flow cards surfaced in
 *   `list_opportunities`. In both, status remains pre-send and the `/c/<code>`
 *   link is the only MCP path to approve.
 * - `outreach` — accepted opp where viewer is a non-introducer party.
 *   Clicking opens the existing chat (no state change).
 * - `send_direct` — draft or latent opp where viewer is a non-introducer
 *   party. Issued by `discover_opportunities` in direct (no-introducer)
 *   mode: the match has already passed evaluation, the row exists in
 *   draft state, and the sender just needs to release it. Clicking flips
 *   the opp straight to accepted and opens the chat with a greeting —
 *   same handler path as `connect`. The counterpart's side sees the new
 *   accepted opp and can engage or ignore.
 */
export function resolveActionableLinkKind(input: {
  status: string;
  viewerRole: string;
  viewerApproved?: boolean;
  viewerActedAt?: string | null;
}): ConnectLinkKind | null {
  const { status, viewerRole, viewerApproved, viewerActedAt } = input;
  const isIntroducer = viewerRole === "introducer";
  const hasViewerActed = !!viewerActedAt;
  if (status === "accepted") {
    return isIntroducer ? null : "outreach";
  }
  if (status === "pending") {
    return isIntroducer || hasViewerActed ? null : "connect";
  }
  if (status === "draft" || status === "latent") {
    if (!isIntroducer) return hasViewerActed ? null : "send_direct";
    return viewerApproved === true ? null : "approve_introduction";
  }
  return null;
}

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
  // counterpart's socials or the viewer's surface. Surface-aware Telegram
  // deep-linking lives on the connect URL (`/c/:code`) — the connect-link
  // controller resolves that to a pre-messaged t.me link — never here.
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
 * Mint a short-link for `card` if the (status, viewerRole, viewerApproved)
 * combination is actionable; mutate the card in place with `acceptUrl`,
 * `profileUrl`, and `feedCategory`. No-op (and no DB call) if not actionable.
 *
 * Swallows mint errors after logging — the card is still returned without an
 * `acceptUrl`, matching the prior `list_opportunities` resilience behavior.
 */
export async function attachActionableLinks(
  card: Record<string, unknown> & {
    opportunityId: string;
    viewerRole: string;
    status: string;
  },
  opts: {
    viewerId: string;
    viewerApproved?: boolean;
    viewerActedAt?: string | null;
    counterpartUserId: string;
    mintConnectLink: NonNullable<OpportunityToolDeps["mintConnectLink"]>;
    frontendUrl: string | undefined;
    preferredSurface?: 'telegram' | 'web';
  },
): Promise<void> {
  // profileUrl is independent of whether the (status, viewerRole) combination
  // is actionable — every counterpart has a profile page worth linking to,
  // even on a fresh draft where there is no acceptUrl yet. Setting it before
  // the early-return below means cards from non-actionable combinations
  // (e.g. draft + party in `discover_opportunities` direct mode) still carry
  // the profile link the agent needs to render. Without this, the agent gets
  // a name with no URL attached and tends to fabricate one.
  const profileUrl = buildProfileUrl(opts.counterpartUserId, opts.frontendUrl);
  if (profileUrl) card.profileUrl = profileUrl;

  const kind = resolveActionableLinkKind({
    status: card.status,
    viewerRole: card.viewerRole,
    viewerApproved: opts.viewerApproved,
    viewerActedAt: opts.viewerActedAt,
  });
  logger.info("Opportunity actionability decision", {
    opportunityId: card.opportunityId,
    status: card.status,
    viewerRole: card.viewerRole,
    viewerApproved: opts.viewerApproved,
    viewerActedAt: opts.viewerActedAt,
    kind: kind ?? "none",
  });
  if (kind === null) return;

  try {
    const { url } = await opts.mintConnectLink({
      userId: opts.viewerId,
      opportunityId: card.opportunityId,
      kind,
      greeting: null,
      preferredSurface: opts.preferredSurface,
    });
    card.acceptUrl = url;
    card.feedCategory = card.viewerRole === "introducer" ? "connector-flow" : "connection";
  } catch (err) {
    logger.warn(
      "Failed to mint MCP opportunity link — surfacing card without acceptUrl/feedCategory; profileUrl is still attached",
      {
        opportunityId: card.opportunityId,
        kind,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
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
 * consider making this function async and delegating to OpportunityPresenter.presentHomeCard()
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
  const runDiscoveryFromQuery =
    (deps.opportunityDiscovery?.runDiscoverFromQuery as typeof runDiscoverFromQuery | undefined) ??
    runDiscoverFromQuery;
  const continueOpportunityDiscovery =
    (deps.opportunityDiscovery?.continueDiscovery as typeof continueDiscovery | undefined) ??
    continueDiscovery;
  const createOpportunityPresenter =
    (deps.opportunityPresentation?.createPresenter as (() => OpportunityPresenter) | undefined) ??
    (() => new OpportunityPresenter());
  const gatherOpportunityPresenterContext =
    (deps.opportunityPresentation?.gatherPresenterContext as typeof gatherPresenterContext | undefined) ??
    gatherPresenterContext;

  const discoverOpportunities = defineTool({
    name: "discover_opportunities",
    description:
      "Discovers opportunities — connections between users based on complementary intents — and persists them as drafts. " +
      "Opportunities are the core output of the discovery engine, representing potential valuable connections between people.\n\n" +
      "**NOT for person lookup** — use read_user_contexts(query=name) to find people by name.\n\n" +
      "**Four modes:**\n" +
      "1. **Discovery** (most common): pass `searchQuery` and/or `networkId`. The system finds other users in shared networkes " +
      "whose intents semantically complement the query. Uses HyDE embeddings and LLM evaluation for scoring.\n" +
      "2. **Introduction**: pass `partyUserIds` (2+ user IDs) + `entities` (pre-gathered profiles and intents from shared networkes). " +
      "You MUST call read_user_contexts and read_intents for each party BEFORE calling this. " +
      "Optionally pass `hint` with the user's reason for the introduction.\n" +
      "3. **Direct connection**: pass `targetUserId` + `searchQuery`. Creates an opportunity between the current user and one specific person.\n" +
      "4. **Introducer discovery**: pass `introTargetUserId` (find matches FOR that person; current user becomes the introducer). " +
      "Use when user asks 'who should I introduce to [person]?'\n\n" +
      "**Returns:** In regular chat, opportunity code blocks (render as interactive cards) with opportunityId, match reasoning, confidence score, and status. " +
      "In MCP contexts, starts an async discovery run and returns `discoveryRunId` with status `queued`. " +
      "Then poll get_discovery_run with that id roughly every 5 seconds until status is `succeeded`, `failed`, or `cancelled`, and present its `result`. " +
      "Do NOT call discover_opportunities again for the same request while a run is in progress — a repeat call with the same parameters " +
      "returns the SAME in-progress run (with `coalesced: true`), not a new one. Keep polling the run id instead of starting new runs. " +
      "All results start as drafts. Supports pagination via `continueFrom` for large result sets.\n\n" +
      "**Next steps:** Use update_opportunity(opportunityId, status='pending') to send a draft to the other party.\n\n" +
      "**Discovery-first rule.** For open-ended connection-seeking requests (\"find me a mentor\", " +
      "\"who needs a React dev\", \"looking for investors\"), call this tool with `searchQuery` FIRST. " +
      "Do NOT call create_intent for these phrasings — create_intent is only for when the user explicitly " +
      "asks to \"create\", \"save\", \"add\", or \"remember\" a signal.\n\n" +
      "**Personal-index scoping.** When the user says \"in my network\", \"from my contacts\", \"people I know\", " +
      "or similar scoping language, pass the user's personal network ID (from memberships where `isPersonal: true`) " +
      "as `networkId`. The personal network contains the user's contacts — scoping discovery to it restricts " +
      "results to people the user already knows. Without this scoping language, omit networkId to let discovery " +
      "run across all networks.\n\n" +
      "**Introduction mode prerequisites.** When using `partyUserIds` + `entities`, YOU must pre-fetch each party's " +
      "profile and intents before calling this tool. The entities array must include each party's userId, profile, " +
      "intents from shared networkes, and the shared networkId. Call read_user_contexts, read_network_memberships, " +
      "and read_intents for both parties first. The introducer (current user) must NOT appear in entities.\n\n" +
      "**Signal-visibility follow-up.** If the response includes `suggestIntentCreationForVisibility: true` and " +
      "`suggestedIntentDescription`, after presenting opportunity cards ask the user ONCE whether they'd also like " +
      "to create a signal so others can find them. On yes, call create_intent with the suggested description. " +
      "Never suggest this after introducer-mode (`introTargetUserId`) calls — the query describes the other person's " +
      "needs, not the signed-in user's.",
    querySchema: z.object({
      continueFrom: z
        .string()
        .optional()
        .describe("Pagination token: pass the discoveryId from a previous discover_opportunities result to evaluate the next batch of candidates. Do not combine with searchQuery or other mode parameters — when a fresh searchQuery is also present, the server ignores continueFrom and runs a fresh discovery."),
      searchQuery: z
        .string()
        .optional()
        .describe("Discovery mode: natural language description of what to look for (e.g. 'AI/ML engineers', 'startup advisors in fintech'). Drives semantic matching against other users' intents and profiles."),
      networkId: z
        .string()
        .optional()
        .describe("Network UUID to scope discovery to a specific community. Get from read_networks. In an network-scoped chat, omitting this runs discovery only in the scoped community; pass the personal network ID (from read_networks, isPersonal=true) only when the user explicitly asks to discover among contacts."),
      intentId: z
        .string()
        .optional()
        .describe("Optional intent UUID to use as the discovery source. The intent's description drives matching instead of searchQuery. Get from read_intents. Typically used by background processing, not direct agent calls."),
      targetUserId: z
        .string()
        .optional()
        .describe("Direct connection mode: create an opportunity with this specific user. Get the userId from read_user_contexts(query=name). Combine with searchQuery to explain the connection reason."),
      introTargetUserId: z
        .string()
        .optional()
        .describe(
          "Introducer discovery mode: find matches FOR this user ID (the current user becomes the introducer). " +
          "Get the userId from read_user_contexts(query=name). " +
          "Use when the user asks 'who should I introduce to [person]?'. " +
          "Do NOT combine with partyUserIds (that's full introduction mode)."
        ),
      partyUserIds: z
        .array(z.string())
        .optional()
        .describe("Introduction mode: array of 2+ user IDs to introduce to each other. Get user IDs from read_user_contexts or read_network_memberships. Must also provide entities with pre-gathered profile/intent data."),
      entities: z
        .array(
          z.object({
            userId: z.string(),
            profile: z
              .object({
                name: z.string().optional(),
                bio: z.string().optional(),
                location: z.string().optional(),
                interests: z.array(z.string()).optional(),
                skills: z.array(z.string()).optional(),
                context: z.string().optional(),
              })
              .optional(),
            intents: z
              .array(
                z.object({
                  intentId: z.string(),
                  payload: z.string(),
                  summary: z.string().optional(),
                }),
              )
              .optional(),
            networkId: z
              .string()
              .describe("Shared network this entity's data comes from (required for intro mode)"),
          }),
        )
        .optional()
        .describe(
          "Introduction mode: pre-gathered profile and intent data for each party being introduced. " +
          "Each entry needs userId, networkId (the shared network), and optionally profile (name, bio, skills, interests) and intents (intentId, payload). " +
          "Gather this data by calling read_user_contexts and read_intents for each party BEFORE calling discover_opportunities. " +
          "All entities must share the same networkId (the shared network where both parties are members).",
        ),
      hint: z
        .string()
        .optional()
        .describe(
          "Introduction mode: the user's reason for making this introduction (e.g. 'both working on AI in healthcare', " +
          "'complementary skills for a startup'). Helps the evaluator produce better match reasoning.",
        ),
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
          `This chat is scoped to ${scopedIndexLabel}. You can only create opportunities in this community.`,
        );
      }

      // Distinguish an explicit `query.networkId` override (caller wants discovery
      // scoped to one specific index) from an implicit scoped-chat context.
      // Scoped-chat discovery stays focused to the scoped community only; the
      // personal-inclusive allowed reach is reserved for self-owned writes.
      const explicitIndexId = query.networkId?.trim() || undefined;
      const effectiveIndexId = explicitIndexId;
      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid network ID format.");
      }

      const contextIntentId = focusedIntentId(context);
      const requestedIntentId = query.intentId?.trim() || undefined;
      if (requestedIntentId != null && !UUID_REGEX.test(requestedIntentId)) {
        return error("Invalid intent ID format.");
      }
      if (contextIntentId && requestedIntentId && requestedIntentId !== contextIntentId) {
        return error("This chat is scoped to a different intent.");
      }
      const triggerIntentId = contextIntentId ?? requestedIntentId;
      if (triggerIntentId) {
        const triggerIntent = await systemDb.getIntent(triggerIntentId);
        if (!triggerIntent || triggerIntent.userId !== context.userId) {
          return error("Intent not found or you are not authorized to use it for discovery.");
        }
        if (
          triggerIntent.archivedAt ||
          (triggerIntent.status != null && triggerIntent.status !== 'ACTIVE')
        ) {
          return error("This intent is not active. Resume it before starting discovery.");
        }
      }

      if (context.isMcp && deps.discoveryRuns && deps.discoveryRunQueue) {
        // Coalesce: if an equivalent discovery is already queued/running for this
        // user, return that run instead of spawning a duplicate. An over-eager
        // MCP client that re-fires discover_opportunities (instead of polling
        // get_discovery_run) would otherwise kick off a fresh, expensive
        // opportunity-graph run on every call — the loop that drives the agent
        // into provider rate limits.
        try {
          const active = await deps.discoveryRuns.listActive(context.userId);
          const existing = findCoalescedDiscoveryRun(
            query as DiscoveryRunInput,
            context,
            active,
          );
          if (existing) {
            return success({
              status: existing.status === "running" ? ("running" as const) : ("queued" as const),
              discoveryRunId: existing.id,
              coalesced: true,
              message:
                `A discovery run for this exact request is already ${existing.status}. ` +
                `Do NOT call discover_opportunities again — keep calling get_discovery_run with ` +
                `discoveryRunId="${existing.id}" (about every 5 seconds) until it succeeds, fails, ` +
                `or is cancelled, then present its result.`,
            });
          }
        } catch {
          // listActive is a best-effort optimization; fall through to create on error.
        }

        const run = await deps.discoveryRuns.create({
          userId: context.userId,
          agentId: context.agentId ?? null,
          input: query as DiscoveryRunInput,
          context: {
            userId: context.userId,
            userName: context.userName,
            userEmail: context.userEmail,
            ...(context.scopeType && context.scopeId ? { scopeType: context.scopeType, scopeId: context.scopeId } : scopedNetworkId ? { scopeType: 'network' as const, scopeId: scopedNetworkId } : {}),
            ...(context.indexName ? { indexName: context.indexName } : {}),
            ...(context.sessionId ? { sessionId: context.sessionId } : {}),
            ...(context.agentId ? { agentId: context.agentId } : {}),
            ...(context.clientSurface ? { clientSurface: context.clientSurface } : {}),
          },
        });
        try {
          await deps.discoveryRunQueue.enqueue(run.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await deps.discoveryRuns.markFailed(run.id, message);
          return error(`Failed to enqueue discovery run: ${message}`);
        }
        return success({
          status: "queued" as const,
          discoveryRunId: run.id,
          message:
            `Discovery started. Poll get_discovery_run with discoveryRunId="${run.id}" about every 5 seconds ` +
            `until status is succeeded, failed, or cancelled, then present its result. ` +
            `Do NOT call discover_opportunities again for this request while the run is in progress — ` +
            `a repeat call returns this same run, not a new one.`,
        });
      }

      // ── Continuation mode ──
      // `continueFrom` is a pagination token for resuming a prior discovery's
      // cached candidates. When a caller (typically an MCP client's LLM) sends
      // a fresh `searchQuery` alongside a stale `continueFrom`, treat it as a
      // fresh search — the explicit search intent wins. Resuming against the
      // stale session's exhausted cache silently produced the "No more
      // matching opportunities found in the remaining candidates" response
      // for users who expected fresh results (IND-305).
      if (query.continueFrom && query.searchQuery?.trim()) {
        logger.warn("discover_opportunities: dropping stale continueFrom in favor of fresh searchQuery", {
          userId: context.userId,
          continueFrom: query.continueFrom,
        });
      }
      if (query.continueFrom && !query.searchQuery?.trim()) {
        const _continueTraceEmitter = requestContext.getStore()?.traceEmitter;
        const _graphStart = Date.now();
        _continueTraceEmitter?.({ type: "graph_start", name: "opportunity" });
        const result = await continueOpportunityDiscovery({
          opportunityGraph: graphs.opportunity as CompiledOpportunityGraph,
          database,
          cache,
          userId: context.userId,
          discoveryId: query.continueFrom,
          expectedIndexId: scopedNetworkId,
          limit: 20,
          presenter: createOpportunityPresenter(),
          useHomeCardFormat: true,
          ...(context.sessionId ? { chatSessionId: context.sessionId } : {}),
        });
        const _graphMs = Date.now() - _graphStart;
        _continueTraceEmitter?.({ type: "graph_end", name: "opportunity", durationMs: _graphMs });

        const allDebugSteps = [...(result.debugSteps ?? [])];

        if (!result.found) {
          return success({
            found: false,
            count: 0,
            message: result.message ?? "No more matching opportunities found in the remaining candidates.",
            summary: "No more matches found",
            ...(result.pagination ? { pagination: result.pagination } : {}),
            debugSteps: allDebugSteps,
            _graphTimings: [{ name: 'opportunity', durationMs: _graphMs, agents: [] }],
          });
        }

        // Continuation now negotiates just like fresh discovery. For MCP callers,
        // surface only post-negotiation drafts; keep in-flight attempts count-only
        // and never render rejected/stalled or fallback latent rows as cards.
        let negotiatingCount = 0;
        const continuationCards = context.isMcp
          ? (result.opportunities ?? []).filter((opportunity) => {
              if (opportunity.status === 'draft') return true;
              if (opportunity.status === 'negotiating') {
                negotiatingCount += 1;
                return false;
              }
              if (opportunity.status === 'rejected' || opportunity.status === 'stalled' || opportunity.status === 'latent') {
                return false;
              }
              discoverOpportunitiesLog.warn('unexpected continuation status — counting as negotiating', {
                opportunityId: opportunity.opportunityId,
                status: opportunity.status,
              });
              negotiatingCount += 1;
              return false;
            })
          : (result.opportunities ?? []);

        // Build card data; cap at CHAT_DISPLAY_LIMIT (remaining feeds into pagination)
        const allCardData = continuationCards.map((opp) => ({
          opportunityId: opp.opportunityId,
          userId: opp.userId,
          name: opp.name,
          avatar: opp.avatar,
          mainText: getSafePresentationOrSkip(opp, { counterpartName: opp.name })?.summary ?? "",
          cta: opp.homeCardPresentation?.suggestedAction,
          headline: opp.homeCardPresentation?.headline,
          primaryActionLabel: opp.homeCardPresentation?.primaryActionLabel,
          secondaryActionLabel: opp.homeCardPresentation?.secondaryActionLabel,
          mutualIntentsLabel: opp.homeCardPresentation?.mutualIntentsLabel,
          narratorChip: opp.narratorChip,
          viewerRole: opp.viewerRole,
          isGhost: opp.isGhost ?? false,
          score: opp.score,
          status: opp.status,
          viewerActedAt: opp.viewerActedAt,
        }));
        const displayedCards = allCardData.slice(0, CHAT_DISPLAY_LIMIT);
        const extraFromCap = allCardData.length - displayedCards.length;

        let message = buildOpportunityPresentation(displayedCards, {
          isMcp: context.isMcp ?? false,
          leadIn: `Found ${displayedCards.length} more potential connection(s).`,
        });
        if (context.isMcp && negotiatingCount > 0) {
          message = displayedCards.length > 0
            ? `${message}\n\n${negotiatingCount} more opportunit${negotiatingCount === 1 ? 'y is' : 'ies are'} still being evaluated — check back via \`list_opportunities\` shortly.`
            : `Found candidates, but they're still being evaluated. Try \`list_opportunities\` in a minute — ${negotiatingCount} pending.`;
        } else if (context.isMcp && displayedCards.length === 0) {
          message = 'No additional actionable matches were found in this continuation.';
        }

        const isIntroducerContinuation = !!query.introTargetUserId?.trim();
        const totalRemaining = (result.pagination?.remaining ?? 0) + extraFromCap;
        if (totalRemaining > 0 && result.pagination?.discoveryId) {
          message += `\n\nThere are ${totalRemaining} more candidates. Ask if the user wants to see more — they can say "show me more" and you should call discover_opportunities with continueFrom="${result.pagination.discoveryId}".`;
        } else if (displayedCards.length > 0 && isIntroducerContinuation) {
          message += `\n\nThese are all the introduction candidates I found for this person.`;
        } else if (displayedCards.length > 0) {
          message += `\n\nThese are all the connections I found. If the user wants to attract more connections, suggest they create a signal — e.g. "Would you like to create a signal so others looking for someone like you can find you?" If they agree, call create_intent with a description based on what they were searching for.`;
        }

        return success({
          found: true,
          count: displayedCards.length,
          message,
          summary: `Found ${displayedCards.length} more match(es)`,
          ...(result.pagination ? { pagination: result.pagination } : {}),
          debugSteps: allDebugSteps,
          _graphTimings: [{ name: 'opportunity', durationMs: _graphMs, agents: [] }],
        });
      }

      // Normalize entity networkIds before any checks to avoid raw-vs-trimmed mismatches.
      const normalizedEntities = query.entities?.map((e) => ({ ...e, networkId: e.networkId?.trim() }));

      // Derive partyUserIds from entities when agent passes entities but omits partyUserIds (intro mode).
      // Only derive when all entities share the same networkId to prevent cross-network introductions.
      const partyUserIdsFromEntities =
        normalizedEntities &&
        normalizedEntities.length >= 2 &&
        normalizedEntities.every((e) => e.userId && e.networkId) &&
        new Set(normalizedEntities.map((e) => e.networkId)).size === 1
          ? [...new Set(normalizedEntities.map((e) => e.userId))]
          : undefined;
      const effectivePartyUserIds =
        query.partyUserIds && query.partyUserIds.length >= 2
          ? query.partyUserIds
          : (partyUserIdsFromEntities?.length ?? 0) >= 2
            ? partyUserIdsFromEntities
            : undefined;

      // ── Introduction mode ── (validation and persistence via opportunity graph)
      if (effectivePartyUserIds && effectivePartyUserIds.length >= 2) {
        if (!normalizedEntities || normalizedEntities.length === 0) {
          return error(
            "Introduction requires pre-gathered entity data. " +
              "First use read_network_memberships to find shared networks, " +
              "then read_user_contexts and read_intents for each party, " +
              "then pass the results as entities.",
          );
        }

        const normalizedEntityNetworkIds = normalizedEntities
          .map((e) => e.networkId)
          .filter((id): id is string => Boolean(id));

        if (
          normalizedEntityNetworkIds.length !== normalizedEntities.length ||
          new Set(normalizedEntityNetworkIds).size !== 1
        ) {
          return error("All entities must include the same shared networkId.");
        }

        const [primaryNetworkId] = normalizedEntityNetworkIds;

        const introducedPartyUserIds = effectivePartyUserIds.filter(
          (uid) => uid !== context.userId,
        );
        if (introducedPartyUserIds.length === 0) {
          return error(
            "No counterpart to introduce. Provide at least one other user ID in partyUserIds (besides yourself).",
          );
        }

        const evaluatorEntities: EvaluatorEntity[] = normalizedEntities.map(
          (e) => ({
            userId: e.userId,
            profile: e.profile ?? {},
            intents: e.intents,
            networkId: e.networkId,
          }),
        );

        const _introGraphStart = Date.now();
        const _introTraceEmitter = requestContext.getStore()?.traceEmitter;
        _introTraceEmitter?.({ type: "graph_start", name: "opportunity" });
        const result = await invokeWithAbortSignal(graphs.opportunity, {
          operationMode: "create_introduction",
          userId: context.userId,
          networkId: primaryNetworkId,
          introductionEntities: evaluatorEntities,
          introductionHint: query.hint,
          requiredNetworkId: scopedNetworkId,
          options: {
            initialStatus: "draft" as const,
            ...(context.sessionId ? { conversationId: context.sessionId } : {}),
          },
        });
        const _introGraphMs = Date.now() - _introGraphStart;
        _introTraceEmitter?.({ type: "graph_end", name: "opportunity", durationMs: _introGraphMs });

        if (result.error || !result.opportunities?.length) {
          return error(
            result.error ?? "Failed to create introduction.",
          );
        }

        const created = result.opportunities[0];
        const reasoning =
          created.interpretation?.reasoning ?? "A suggested connection.";
        const confidence =
          typeof created.interpretation?.confidence === "number"
            ? created.interpretation.confidence
            : parseFloat(String(created.confidence ?? 0)) || 0;
        const introducerUser = await userDb.getUser();
        const firstPartyId = introducedPartyUserIds[0];
        const firstEntity = query.entities?.find((e) => e.userId === firstPartyId);
        const counterpartUser = firstPartyId
          ? await database.getUser(firstPartyId)
          : null;
        const counterpartName =
          firstEntity?.profile?.name ?? firstPartyId ?? "Someone";

        // Second party — used in the headline and arrow layout for the introducer view ("A → B")
        const secondPartyId = introducedPartyUserIds[1];
        const secondEntity = query.entities?.find((e) => e.userId === secondPartyId);
        const secondPartyName = (secondEntity?.profile as { name?: string } | undefined)?.name;
        const secondPartyAvatar = (secondEntity?.profile as { avatar?: string | null } | undefined)?.avatar ?? null;
        const secondPartyUser = secondPartyId ? await database.getUser(secondPartyId) : null;

        const viewerIsParty = effectivePartyUserIds.includes(context.userId);
        const viewerRole = viewerIsParty ? "party" : "introducer";
        const isCounterpartGhost = counterpartUser?.isGhost ?? false;
        const primaryActionLabel = getPrimaryActionLabel(viewerRole);
        const publicMatchReason = safeFallbackSummary(reasoning, {
          counterpartName,
          introducerName: introducerUser?.name ?? undefined,
          maxChars: MINIMAL_MAIN_TEXT_MAX_CHARS,
          emptyText: "A suggested connection.",
        });
        const narratorText = narratorRemarkFromReasoning(reasoning, counterpartName, introducerUser?.name ?? undefined);
        const narratorChip = viewerIsParty
          ? {
              name: "Index",
              text: narratorText,
            }
          : {
              name: "You",
              text: narratorText,
              userId: context.userId,
            };

        const headline =
          !viewerIsParty && secondPartyName
            ? `${counterpartName} → ${secondPartyName}`
            : `Connection with ${counterpartName}`;

        const cardData = {
          opportunityId: created.id,
          userId: firstPartyId,
          name: counterpartName,
          avatar:
            counterpartUser?.avatar ??
            (firstEntity?.profile as { avatar?: string | null } | undefined)
              ?.avatar ??
            null,
          mainText: safeFallbackSummary(reasoning, {
            counterpartName,
            // viewerName not available in this context; introducer name passed separately
            introducerName: introducerUser?.name ?? undefined,
            maxChars: MINIMAL_MAIN_TEXT_MAX_CHARS,
            emptyText: "A suggested connection.",
          }),
          cta: "Start a conversation to connect.",
          headline,
          primaryActionLabel,
          secondaryActionLabel: SECONDARY_ACTION_LABEL,
          mutualIntentsLabel: "Suggested connection",
          narratorChip,
          viewerRole,
          isGhost: isCounterpartGhost,
          score: confidence,
          status: created.status ?? "draft",
          ...(!viewerIsParty && secondPartyName
            ? {
                secondParty: {
                  name: secondPartyName,
                  avatar: secondPartyUser?.avatar ?? secondPartyAvatar,
                  ...(secondPartyId ? { userId: secondPartyId } : {}),
                },
              }
            : {}),
        };

        if (context.isMcp && deps.mintConnectLink) {
          await attachActionableLinks(cardData as Record<string, unknown> & {
            opportunityId: string;
            viewerRole: string;
            status: string;
          }, {
            viewerId: context.userId,
            viewerApproved: false,
            counterpartUserId: firstPartyId,
            mintConnectLink: deps.mintConnectLink,
            frontendUrl: deps.frontendUrl,
            preferredSurface: context.clientSurface,
          });
        }

        return success({
          found: true,
          count: 1,
          summary: "Draft introduction created",
          message: buildOpportunityPresentation([cardData], {
            isMcp: context.isMcp ?? false,
            leadIn: "Draft introduction created.",
            label: "opportunity",
          }),
          opportunities: [
            {
              opportunityId: created.id,
              matchReason: publicMatchReason,
              score: confidence,
              status: created.status ?? "draft",
            },
          ],
          _graphTimings: [{ name: 'opportunity', durationMs: _introGraphMs, agents: result.agentTimings ?? [] }],
        });
      }

      // ── Discovery mode ──
      const searchQuery = query.searchQuery?.trim() ?? "";

      if (query.intentId != null && query.intentId !== "" && !UUID_REGEX.test(query.intentId.trim())) {
        return error("Invalid intent ID format.");
      }

      let indexScope: string[];
      const _scopeGraphTimings: Array<{ name: string; durationMs: number; agents: Array<{ name: string; durationMs: number }> }> = [];
      if (effectiveIndexId) {
        if (!UUID_REGEX.test(effectiveIndexId)) {
          return error("Invalid network ID format.");
        }
        const _scopeGraphStart = Date.now();
        const _scopeIndexMembershipTraceEmitter = requestContext.getStore()?.traceEmitter;
        _scopeIndexMembershipTraceEmitter?.({ type: "graph_start", name: "network_membership" });
        const memberResult = await invokeWithAbortSignal(graphs.networkMembership, {
          userId: context.userId,
          networkId: effectiveIndexId,
          operationMode: "read" as const,
        });
        const _scopeIndexMembershipMs = Date.now() - _scopeGraphStart;
        _scopeIndexMembershipTraceEmitter?.({ type: "graph_end", name: "network_membership", durationMs: _scopeIndexMembershipMs });
        _scopeGraphTimings.push({ name: 'network_membership', durationMs: _scopeIndexMembershipMs, agents: [] });
        if (memberResult.error) {
          return error("Network not found or you are not a member.");
        }
        indexScope = [effectiveIndexId];
      } else if (context.scopeType === 'network' && context.scopeId) {
        // Scoped chat: discovery is focused-network only. Self-owned writes may
        // include personal networkes, but opportunity visibility must not.
        const scopedDiscoveryIds = deriveDiscoveryNetworkIds({
          memberships: context.userNetworks,
          scopeType: context.scopeType,
          scopeId: context.scopeId,
        });
        indexScope = scopedDiscoveryIds;
      } else if (scopedNetworkId) {
        // Scoped context: preserve focused-only discovery using the scope envelope.
        indexScope = [scopedNetworkId];
      } else {
        // No scope - use all networks (only in unscoped chat)
        const _scopeGraphStart = Date.now();
        const _scopeIndexTraceEmitter = requestContext.getStore()?.traceEmitter;
        _scopeIndexTraceEmitter?.({ type: "graph_start", name: "index" });
        const indexResult = await invokeWithAbortSignal(graphs.index, {
          userId: context.userId,
          operationMode: "read" as const,
          showAll: true,
        });
        const _scopeIndexMs = Date.now() - _scopeGraphStart;
        _scopeIndexTraceEmitter?.({ type: "graph_end", name: "index", durationMs: _scopeIndexMs });
        _scopeGraphTimings.push({ name: 'index', durationMs: _scopeIndexMs, agents: [] });
        if (indexResult.error) {
          return error(indexResult.error);
        }
        indexScope = (indexResult.readResult?.memberOf || []).map(
          (m: { networkId: string }) => m.networkId,
        );
      }

      const toolDebugSteps: Array<{ step: string; detail?: string }> = [
        { step: "resolve_index_scope", detail: `${indexScope.length} index(es)` },
      ];

      if (query.introTargetUserId?.trim() && query.introTargetUserId.trim() === context.userId) {
        return error("You cannot discover introductions for yourself. Try regular discovery instead.");
      }

      const _discoverTraceEmitter = requestContext.getStore()?.traceEmitter;
      const _discoverGraphStart = Date.now();
      _discoverTraceEmitter?.({ type: "graph_start", name: "opportunity" });
      // Chat-driven invocations run under the orchestrator trigger: persist
      // opens at 'negotiating', negotiate fans out with a 60s park window,
      // each accepted draft streams via traceEmitter, and the persist step
      // surfaces already-accepted pairs. Other callers (maintenance, queue
      // workers) still get the 'ambient' default.
      // Orchestrator trigger fires for both web chat (has sessionId) and MCP
      // (isMcp=true, no sessionId). Both are user-initiated discovery that
      // should persist as `negotiating` and flip to `draft` post-finalize via
      // onCandidateResolved. Ambient/cron paths leave both falsy and use the
      // `pending` default.
      const runDiscoveryOrchestrator = !!context.sessionId || !!context.isMcp;
      const result = await runDiscoveryFromQuery({
        opportunityGraph: graphs.opportunity as CompiledOpportunityGraph,
        database,
        userId: context.userId,
        query: searchQuery,
        indexScope,
        limit: 20,
        presenter: createOpportunityPresenter(),
        useHomeCardFormat: true,
        triggerIntentId,
        targetUserId: query.targetUserId?.trim() || undefined,
        onBehalfOfUserId: query.introTargetUserId?.trim() || undefined,
        cache,
        // MCP-only: cap the negotiate phase at 20 s so Railway's edge proxy
        // (which 502s the client at ~57 s) never beats the response. The
        // remainder finalizes in the background and is fetched on the
        // user's next list_opportunities call. Removable when IND-274
        // (negotiation conversation continuation) lands.
        ...(context.isMcp ? { negotiateTimeoutMs: 20_000 } : {}),
        ...(context.sessionId ? { chatSessionId: context.sessionId } : {}),
        ...(runDiscoveryOrchestrator && { trigger: 'orchestrator' as const }),
        ...(deps.chatSummary && { chatSummary: deps.chatSummary }),
        ...(deps.questionGenerator && { questionGenerator: deps.questionGenerator }),
        ...(deps.questionerEnqueue && { questionerEnqueue: deps.questionerEnqueue }),
        ...(context.scopeType && context.scopeId ? { scopeType: context.scopeType, scopeId: context.scopeId } : {}),
        ...(deps.negotiationSummary && { negotiationSummary: deps.negotiationSummary }),
        // Decision questions add an LLM call after the negotiation phase.
        // Capped at QUESTIONER_DISCOVERY_TIMEOUT_MS (12 s default,
        // env-overridable; see opportunity.discover.ts). Aborted calls return
        // no questions but the rest of the discovery payload still ships.
        // For chat sessions, questions are rendered by the frontend via
        // streamed events (Slice 4). For MCP, they drive a sequential
        // elicitation/create flow (Slice 5) — the MCP tool handler awaits the
        // elicitations before returning the tool result. The per-negotiation
        // summarizer is similarly capped at NEGOTIATION_SUMMARY_TIMEOUT_MS
        // (5 s default per negotiation). Gated by QUESTIONER_DISCOVERY_ENABLED
        // (hierarchical: requires QUESTIONER_ENABLED too).
        enableQuestions:
          isDiscoveryQuestionsEnabled() &&
          (!!context.sessionId || !!context.isMcp),
      });

      // ── Pending question injection ────────────────────────────────────
      // Look up previously-generated questions relevant to this user's
      // discovery context and merge them into the result alongside any
      // inline-generated questions from the current run.
      const pendingQuestionResult = await mergePendingQuestions({
        findPendingQuestions: deps.findPendingQuestions,
        userId: context.userId,
        sourceType: 'discovery',
        ...(context.scopeType === 'network' && context.scopeId ? { networkId: context.scopeId } : {}),
        ...(contextIntentId ? { scopeType: 'intent' as const, scopeId: contextIntentId } : {}),
        surfacedQuestionIds: new Set(), // Dedup handled at chat.agent level
      });
      const pendingQuestions = pendingQuestionResult.questions;

      const _discoverGraphMs = Date.now() - _discoverGraphStart;
      _discoverTraceEmitter?.({ type: "graph_end", name: "opportunity", durationMs: _discoverGraphMs });
      const _discoverGraphTimings = [
        ..._scopeGraphTimings,
        { name: 'opportunity', durationMs: _discoverGraphMs, agents: [] },
      ];

      const allDebugSteps = [
        ...toolDebugSteps,
        ...(result.debugSteps ?? []),
      ];

      // Extract negotiation timing from trace (if negotiation ran)
      const negotiateStep = (result.debugSteps ?? []).find(
        s => s.step === 'negotiate' && s.data?.durationMs != null
      );
      const _allGraphTimings = [
        ..._discoverGraphTimings,
        ...(negotiateStep?.data?.durationMs != null
          ? [{ name: 'negotiation', durationMs: negotiateStep.data.durationMs as number, agents: [] }]
          : []),
      ];

      const isIntroducerFlow = !!query.introTargetUserId?.trim();

      if (result.createIntentSuggested && result.suggestedIntentDescription && !isIntroducerFlow) {
        return success({
          found: false,
          count: 0,
          createIntentSuggested: true,
          suggestedIntentDescription: result.suggestedIntentDescription,
          message:
            "No matching opportunities found. Call create_intent with the suggested description, then discover_opportunities again.",
          summary: "No matches found",
          ...(result.pagination ? { pagination: result.pagination } : {}),
          debugSteps: allDebugSteps,
          _graphTimings: _allGraphTimings,
          ...(() => {
            const allQ = [...(result.questions ?? []), ...pendingQuestions];
            return allQ.length > 0 ? { questions: allQ } : {};
          })(),
          ...(result.discoveryQuestionsDebug ? { _discoveryQuestionsDebug: result.discoveryQuestionsDebug } : {}),
        });
      }

      if (!result.found) {
        return success({
          found: false,
          count: 0,
          message: result.message ?? "No matching opportunities found.",
          summary: "No matches found",
          ...(result.pagination ? { pagination: result.pagination } : {}),
          debugSteps: allDebugSteps,
          _graphTimings: _allGraphTimings,
          ...(() => {
            const allQ = [...(result.questions ?? []), ...pendingQuestions];
            return allQ.length > 0 ? { questions: allQ } : {};
          })(),
          ...(result.discoveryQuestionsDebug ? { _discoveryQuestionsDebug: result.discoveryQuestionsDebug } : {}),
        });
      }

      // Found but only existing connections (no new opportunities created)
      const forMention = result.existingConnectionsForMention ?? result.existingConnections ?? [];
      if ((result.opportunities?.length ?? 0) === 0 && forMention.length > 0) {
        return success({
          found: true,
          count: 0,
          message:
            result.message ??
            "No new opportunities created; you already have a connection with: " +
              forMention.map((c) => c.name + (c.status ? " (" + c.status + ")" : "")).join(", ") +
              ". View on your home page.",
          existingConnections: result.existingConnections,
          summary: "No new matches (existing connections only)",
          debugSteps: allDebugSteps,
          _graphTimings: _allGraphTimings,
          ...(() => {
            const allQ = [...(result.questions ?? []), ...pendingQuestions];
            return allQ.length > 0 ? { questions: allQ } : {};
          })(),
          ...(result.discoveryQuestionsDebug ? { _discoveryQuestionsDebug: result.discoveryQuestionsDebug } : {}),
        });
      }

      const lifecycleFinalization = await finalizeMcpDiscoveryLifecycle({
        isMcp: context.isMcp === true,
        candidates: result.opportunities ?? [],
        existingConnections: result.existingConnections,
        existingConnectionsForMention: result.existingConnectionsForMention,
        alreadyAcceptedPairs: result.alreadyAcceptedPairs,
        pagination: result.pagination,
        isIntroducerFlow,
        displayLimit: CHAT_DISPLAY_LIMIT,
        readOpportunitiesByIds: (ids) => database.getOpportunitiesByIds(ids),
        warn: (message, data) => discoverOpportunitiesLog.warn(message, data),
        projectSafeCard: (opp) => ({
        opportunityId: opp.opportunityId,
        userId: opp.userId,
        name: opp.name,
        avatar: opp.avatar,
        mainText:
          getSafePresentationOrSkip(opp, { counterpartName: opp.name })?.summary ?? "",
        cta: opp.homeCardPresentation?.suggestedAction,
        headline: opp.homeCardPresentation?.headline,
        primaryActionLabel: opp.homeCardPresentation?.primaryActionLabel,
        secondaryActionLabel: opp.homeCardPresentation?.secondaryActionLabel,
        mutualIntentsLabel: opp.homeCardPresentation?.mutualIntentsLabel,
        narratorChip: opp.narratorChip,
        viewerRole: opp.viewerRole,
        isGhost: opp.isGhost ?? false,
        score: opp.score,
        status: opp.status,
        ...(opp.secondParty && { secondParty: opp.secondParty }),
        }),
      });
      const { displayedCards, displayedCandidates } = lifecycleFinalization;

      if (context.isMcp && deps.mintConnectLink) {
        const mintConnectLink = deps.mintConnectLink;
        await Promise.all(
          displayedCards.map(async (card, idx) => {
            const source = displayedCandidates[idx];
            await attachActionableLinks(card as Record<string, unknown> & {
              opportunityId: string;
              viewerRole: string;
              status: string;
            }, {
              viewerId: context.userId,
              viewerApproved: source?.viewerApproved,
              viewerActedAt: source?.viewerActedAt,
              counterpartUserId: source?.userId ?? card.userId,
              mintConnectLink,
              frontendUrl: deps.frontendUrl,
              preferredSurface: context.clientSurface,
            });
          }),
        );
      }

      let message = buildOpportunityPresentation(displayedCards, {
        isMcp: context.isMcp ?? false,
        leadIn: `Found ${displayedCards.length} potential connection(s).`,
      });
      message = lifecycleFinalization.composeMessage(message);

      return success({
        found: true,
        count: displayedCards.length,
        message,
        summary: `Found ${displayedCards.length} match(es)`,
        ...(result.existingConnections?.length ? { existingConnections: result.existingConnections } : {}),
        ...(result.pagination ? { pagination: result.pagination } : {}),
        debugSteps: allDebugSteps,
        // Distinct from `createIntentSuggested` (no-results path) intentionally:
        // `handleCreateIntentCallback` in chat.agent.ts auto-creates for that key.
        // This flag is for the results-found path where the agent must ask the user first.
        ...(searchQuery && !query.targetUserId && !isIntroducerFlow
          ? {
              suggestIntentCreationForVisibility: true,
              suggestedIntentDescription: searchQuery,
            }
          : {}),
        ...(() => {
          const allQ = [...(result.questions ?? []), ...pendingQuestions];
          return allQ.length > 0 ? { questions: allQ } : {};
        })(),
        ...(result.discoveryQuestionsDebug ? { _discoveryQuestionsDebug: result.discoveryQuestionsDebug } : {}),
        _graphTimings: _allGraphTimings,
      });
    },
  });

  const getDiscoveryRun = defineTool({
    name: "get_discovery_run",
    description:
      "Checks the status of an async discovery run started by discover_opportunities in MCP contexts. " +
      "Poll this tool with the discoveryRunId roughly every 5 seconds until status is succeeded, failed, or cancelled. " +
      "While status is queued or running, keep polling THIS tool — do NOT call discover_opportunities again (that does not speed anything up and returns the same run). " +
      "When succeeded, the result field contains the same discovery payload that discover_opportunities would have returned synchronously.",
    querySchema: z.object({
      discoveryRunId: z.string().describe("Discovery run ID returned by discover_opportunities."),
    }),
    handler: async ({ context, query }) => {
      if (!deps.discoveryRuns) {
        return error("Async discovery runs are not available in this context.");
      }
      const run = await deps.discoveryRuns.get(query.discoveryRunId, context.userId);
      if (!run || !isSameDiscoveryRunPrincipal(run, context)) return error("Discovery run not found.");
      return success({
        discoveryRunId: run.id,
        status: run.status,
        progress: run.progress ?? null,
        result: run.result ?? null,
        error: run.error ?? null,
        cancelRequestedAt: run.cancelRequestedAt?.toISOString?.() ?? null,
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt?.toISOString?.() ?? null,
        completedAt: run.completedAt?.toISOString?.() ?? null,
      });
    },
  });

  const cancelDiscoveryRun = defineTool({
    name: "cancel_discovery_run",
    description:
      "Requests cancellation for an async discovery run. If the queued job has not started, it is removed and marked cancelled. " +
      "If already running, the worker observes cancellation and stops at the next cancellation check.",
    querySchema: z.object({
      discoveryRunId: z.string().describe("Discovery run ID returned by discover_opportunities."),
    }),
    handler: async ({ context, query }) => {
      if (!deps.discoveryRuns || !deps.discoveryRunQueue) {
        return error("Async discovery runs are not available in this context.");
      }
      const existing = await deps.discoveryRuns.get(query.discoveryRunId, context.userId);
      if (!existing || !isSameDiscoveryRunPrincipal(existing, context)) return error("Discovery run not found.");
      if (!["queued", "running"].includes(existing.status)) {
        return success({
          discoveryRunId: existing.id,
          status: existing.status,
          cancelled: existing.status === "cancelled",
          message: `Discovery run is already ${existing.status}.`,
        });
      }
      const run = await deps.discoveryRuns.requestCancel(query.discoveryRunId, context.userId);
      if (!run) return error("Discovery run is no longer cancellable.");
      const removed = await deps.discoveryRunQueue.cancel(run.id);
      if (removed) {
        await deps.discoveryRuns.markCancelled(run.id, "cancelled before worker start");
      }
      const updated = await deps.discoveryRuns.get(run.id, context.userId);
      const status = updated?.status ?? (removed ? "cancelled" : run.status);
      const message = removed
        ? "Discovery run cancelled."
        : status === "queued"
          ? "Cancellation requested while the discovery run is still queued. It will be skipped or cancelled before work starts."
          : status === "running"
            ? "Cancellation requested. The running worker will stop at the next cancellation check."
            : `Cancellation requested. Discovery run is now ${status}.`;
      return success({
        discoveryRunId: run.id,
        status,
        cancelled: removed || status === "cancelled",
        message,
      });
    },
  });

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
            "You have no opportunities yet. Use discover_opportunities to find connections.",
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

                  const presentation = await presenter.presentHomeCard({
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

                  // Attach actionable links for MCP callers
                  if (context.isMcp && deps.mintConnectLink) {
                    const viewerApproved =
                      viewerActor?.role === "introducer" ? viewerActor.approved === true : undefined;
                    await attachActionableLinks(card as Record<string, unknown> & {
                      opportunityId: string;
                      viewerRole: string;
                      status: string;
                    }, {
                      viewerId: context.userId,
                      viewerApproved,
                      viewerActedAt: viewerActor?.actedAt ?? null,
                      counterpartUserId,
                      mintConnectLink: deps.mintConnectLink,
                      frontendUrl: deps.frontendUrl,
                      preferredSurface: context.clientSurface,
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

                const presentation = await presenter.presentHomeCard({
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

                // For MCP callers (e.g. Edge Claw), mint a connect token and attach
                // acceptUrl + profileUrl when the (status, viewerRole) is actionable
                // for the viewer. Non-actionable combos (sender-on-draft,
                // pending-on-introducer-waiting, rejected, etc.) deliberately get
                // no link — the LLM would otherwise hallucinate `/api/.../connect`
                // URLs from the exposed opportunityId.
                if (context.isMcp && deps.mintConnectLink) {
                  const viewerApproved =
                    viewerActor?.role === "introducer" ? viewerActor.approved === true : undefined;
                  await attachActionableLinks(cardData as Record<string, unknown> & {
                    opportunityId: string;
                    viewerRole: string;
                    status: string;
                  }, {
                    viewerId: context.userId,
                    viewerApproved,
                    viewerActedAt: viewerActor?.actedAt ?? null,
                    counterpartUserId,
                    mintConnectLink: deps.mintConnectLink,
                    frontendUrl: deps.frontendUrl,
                    preferredSurface: context.clientSurface,
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
            "You have no opportunities yet. Use discover_opportunities to find connections.",
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
      "This is the primary action after discover_opportunities returns a draft.\n" +
      "- `accepted`: Accept a received opportunity — opens a direct conversation between both parties. Returns a conversationId to surface to the user.\n" +
      "- `rejected`: Decline a received opportunity.\n" +
      "- `expired`: Mark as expired (typically done by the system after timeout).\n\n" +
      "**When to use:** After discover_opportunities or list_opportunities returns opportunity cards. " +
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
        .describe("The UUID of the opportunity to update. Get from discover_opportunities or list_opportunities results."),
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
        const verdict = context.agentId
          ? await authority.consumeAgentProof(query.ownerApprovalProof, {
              opportunityId,
              action: ownerAction,
              ownerId: context.userId,
              agentId: context.agentId,
            })
          : await authority.attestOwnerInteraction({
              opportunityId,
              action: ownerAction,
              ownerId: context.userId,
              // Trusted, server-derived interaction/surface provenance — built
              // from the resolved context only. Chat turns carry a chat
              // session; `isSessionAuth` is bound solely by host composition
              // from the authenticated request identity. Tool arguments can
              // never populate any of it.
              provenance: {
                surface: context.isMcp ? 'mcp' : context.sessionId ? 'chat' : 'rest',
                sessionAuthenticated: context.isSessionAuth === true,
              },
            });
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
    discoverOpportunities,
    getDiscoveryRun,
    cancelDiscoveryRun,
    listOpportunities,
    updateOpportunity,
    confirmOpportunityDelivery,
  ] as const;
}
