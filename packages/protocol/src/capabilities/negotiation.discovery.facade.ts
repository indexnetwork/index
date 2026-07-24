/**
 * Narrow discovery port consumed by the opportunity graph — IND-550.
 * Sources now route through the canonical negotiation module public surface.
 */
export { negotiateCandidates } from "../negotiation/public/index.js";
export type { NegotiationCandidate, OnNegotiationResolved } from "../negotiation/public/index.js";
export { ASK_USER_LOCK_SLACK_MS, askUserAnswerWindowMs } from "../negotiation/public/index.js";
export { AMBIENT_PARK_WINDOW_MS } from "../negotiation/public/index.js";
export type { NegotiationGraphLike, UserNegotiationContext } from "../negotiation/public/index.js";
