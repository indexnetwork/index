/**
 * Card rendering and link minting for the opportunity tools.
 *
 * These are the pieces both `list_opportunities` and the mutation tools reach
 * for: the deep links, the minimal fallback card, and the small guards that
 * shape tool error payloads.
 */




import { MINIMAL_MAIN_TEXT_MAX_CHARS, getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from "./opportunity.labels.js";
import { narratorRemarkFromReasoning, safeFallbackSummary } from "./opportunity.presentation.js";
import { type OpportunityOwnerAction, type OpportunityOwnerApprovalVerdict } from "./opportunity.owner-approval.js";


export function stripLeadingNarratorName(remark: string, narratorName: string): string {
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
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { Opportunity } from "../../platform/database.js";

export const logger = protocolLogger("ChatTools:Opportunity");

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
 * Build the agent-facing deep link for an opportunity — the canonical
 * `https://index.network/o/<id>` universal link. Returns `undefined` when
 * `frontendUrl` is unset or there is no opportunity id.
 *
 * This is the *only* place the protocol mints an opportunity deep link. It is
 * a navigation link, not an authority: opening it raises the opportunity card
 * in the Index macOS app when installed and a static Index landing page
 * otherwise. Acceptance stays an authenticated call.
 *
 * No `?link_preview=false` hint here (unlike `buildProfileUrl`): the Hermes
 * plugin mints the identical bare form for payloads the protocol does not
 * touch, and keeping the two byte-identical is what makes its never-overwrite
 * rule invisible.
 */
export function buildOpportunityAppUrl(
  opportunityId: string,
  frontendUrl: string | undefined,
): string | undefined {
  if (!frontendUrl || !opportunityId) return undefined;
  const base = frontendUrl.replace(/\/+$/, "");
  return `${base}/o/${opportunityId}`;
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

/**
 * Attach the opportunity deep link to `card` (mutates in place) so every MCP
 * client — Claude Desktop, the CLI, the web, Hermes — can hand the user one
 * clickable link to the card instead of fabricating one from an id.
 */
export function attachOpportunityAppLink(
  card: Record<string, unknown> & { opportunityId: string },
  opts: {
    frontendUrl: string | undefined;
  },
): void {
  const appUrl = buildOpportunityAppUrl(card.opportunityId, opts.frontendUrl);
  if (appUrl) card.appUrl = appUrl;
}

/**
 * IND-593: stable fail-closed denial for the owner-approval boundary. The
 * `missing` reason carries the fresh, server-derived interaction challenge the
 * owner must explicitly approve; all other reasons carry no challenge.
 */
export function ownerApprovalDenial(
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
 * connection cards per the digest/ambient prompt rules.
 */
export const CHAT_DISPLAY_LIMIT = 6;

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
  viewerName?: string,
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
} {
  const viewerActor = opp.actors.find((a) => a.userId === viewerId);
  const viewerRole = viewerActor?.role ?? "party";
  const reasoning = opp.interpretation?.reasoning ?? "";
  // Shared sanitization standard — see opportunity.safe-presentation.ts.
  const mainText = safeFallbackSummary(reasoning, {
    counterpartName,
    viewerName,
    maxChars: MINIMAL_MAIN_TEXT_MAX_CHARS,
    emptyText: "A suggested connection.",
  });
  const score =
    typeof opp.interpretation?.confidence === "number"
      ? opp.interpretation.confidence
      : undefined;
  const narratorName = "Index";
  const primaryActionLabel = getPrimaryActionLabel(viewerRole);
  return {
    opportunityId: opp.id,
    userId: counterpartUserId,
    name: counterpartName,
    avatar: counterpartAvatar,
    mainText,
    cta: "Start a conversation to connect.",
    headline: `Connection with ${counterpartName}`,
    primaryActionLabel,
    secondaryActionLabel: SECONDARY_ACTION_LABEL,
    mutualIntentsLabel: "Suggested connection",
    narratorChip: {
      name: narratorName,
      text: narratorRemarkFromReasoning(reasoning, counterpartName, viewerName),
    },
    viewerRole,
    score,
    status: opp.status ?? "negotiating",
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

export function confirmDeliveryError(
  code: ConfirmDeliveryErrorCode,
  retryable: boolean,
  message: string,
): string {
  return JSON.stringify({ success: false, error: message, code, retryable });
}

