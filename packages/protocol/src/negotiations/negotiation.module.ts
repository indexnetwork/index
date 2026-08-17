/**
 * negotiation — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 */
export { AMBIENT_PARK_WINDOW_MS, createNegotiationTools } from "./negotiation.tools.js";
export { buildFallbackDigest, NegotiationSummarizer } from "./negotiation.summarizer.js";
export { IndexNegotiator } from "./negotiation.agent.js";
export { negotiateCandidates, NegotiationGraphFactory } from "./negotiation.graph.js";
export { NegotiationInsightsGenerator } from "./insight.generator.js";
export { NegotiationReflector } from "./negotiation.reflect.js";
export { NegotiationScreener } from "./negotiation.screen.js";
export type {
  ChatReflectionInput,
  DistilledMemory,
  NegotiationReflectionInput,
  NegotiationReflectJobData,
  ReflectEnqueueFn,
  ReflectionTranscriptEntry,
} from "./negotiation.reflect.js";
export type { NegotiationCandidate, OnNegotiationResolved } from "./negotiation.graph.js";
export type { NegotiationDigest } from "./insight.generator.js";

export {
  ASK_USER_LOCK_SLACK_MS,
  allowedActionsFor,
  askUserAnswerWindowMs,
  configuredAskUserEnabled,
  isRejectLikeAction,
  isTerminalAction,
  readProtocolVersion,
  resolveSeat,
  seatViolationMessage,
} from "./negotiation.protocol.js";
export {
  HERMES_OWNER_DIRECTIVE,
  HERMES_SHARED_MESSAGE_TEMPLATES,
  HermesNegotiationActionSchema,
  HermesNegotiationResponseSchema,
  HermesOwnerDirectiveSchema,
  HermesRoleAlignmentSchema,
  allowedHermesActionsFor,
  buildHermesNegotiationTurn,
} from "./negotiation.hermes-contract.js";
export { DEFAULT_NEGOTIATION_MAX_TURNS, isNegotiationTurnCapReached } from "./negotiation.turn-cap.js";
export { expectedNegotiationSpeaker } from "./negotiation.expected-speaker.js";
export {
  assessConsultationEligibility,
  consultationPromptFor,
  negotiationConsultationPolicyMode,
} from "./negotiation.consultation-policy.js";
export {
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY,
  isSafeNegotiationQuestionText,
  negotiationQuestionSettlementId,
  validateInflightAskUserFields,
} from "./negotiation.question-safety.js";
export { renderNegotiatorChatMemorySection } from "./negotiation.memory.js";
export type {
  ConsultationEligibility,
  ConsultationEligibilityInput,
  NegotiationConsultationPolicyMode,
  NegotiationConsultationReason,
} from "./negotiation.consultation-policy.js";
export type {
  HermesNegotiationAction,
  HermesNegotiationResponse,
  HermesOwnerDirective,
  HermesRoleAlignment,
} from "./negotiation.hermes-contract.js";
export type {
  NegotiationGraphLike,
  NegotiationOutcome,
  NegotiationTurn,
  UserNegotiationContext,
} from "./negotiation.state.js";
export type { NegotiationSpeakerMessage, NegotiationSpeakerParticipants } from "./negotiation.expected-speaker.js";
export type { NegotiatorMemoryEntry } from "./negotiation.memory.js";
export type { NegotiationToolDeps } from "./negotiation.tools.port.js";
