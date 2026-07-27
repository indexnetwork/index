/**
 * Negotiation capability facade — IND-550.
 *
 * Sources now route through the canonical negotiation module public surface
 * instead of the legacy flat negotiation/ files.
 */
export { NegotiationSummarizer } from "../negotiation/public/index.js";
export { NegotiationGraphFactory, negotiateCandidates } from "../negotiation/public/index.js";
export { createNegotiationTools } from "../negotiation/public/index.js";
export type { NegotiationToolDeps } from "../negotiation/public/index.js";
export { NegotiationInsightsGenerator } from "../negotiation/public/index.js";
export type { NegotiationDigest } from "../negotiation/public/index.js";
export { IndexNegotiator } from "../negotiation/public/index.js";
export { NegotiationScreener } from "../negotiation/public/index.js";
export { NegotiationReflector } from "../negotiation/public/index.js";
export type { DistilledMemory, ReflectionTranscriptEntry, NegotiationReflectionInput, ChatReflectionInput, NegotiationReflectJobData, ReflectEnqueueFn } from "../negotiation/public/index.js";
export type { NegotiatorMemoryEntry } from "../negotiation/public/index.js";
export type { NegotiationGraphLike } from "../negotiation/public/index.js";
export { AMBIENT_PARK_WINDOW_MS } from "../negotiation/public/index.js";
export { allowedActionsFor, isTerminalAction, isRejectLikeAction, readProtocolVersion, resolveSeat, seatViolationMessage } from "../negotiation/public/index.js";
export { assessConsultationEligibility, consultationPromptFor, negotiationConsultationPolicyMode } from "../negotiation/public/index.js";
export type { ConsultationEligibility, ConsultationEligibilityInput, NegotiationConsultationPolicyMode, NegotiationConsultationReason } from "../negotiation/public/index.js";
export {
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY,
  isSafeNegotiationQuestionText,
  validateInflightAskUserFields,
  negotiationQuestionSettlementId,
} from "../negotiation/public/index.js";
