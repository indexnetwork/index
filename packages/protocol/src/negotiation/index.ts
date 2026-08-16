/**
 * negotiation — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 * Supersedes the capabilities/*.facade.ts + negotiation/public/ pair; the export
 * list is the union of the facades it replaces, so the contract is unchanged.
 */
export {
  AMBIENT_PARK_WINDOW_MS,
  buildFallbackDigest,
  createNegotiationTools,
  IndexNegotiator,
  negotiateCandidates,
  NegotiationGraphFactory,
  NegotiationInsightsGenerator,
  NegotiationReflector,
  NegotiationScreener,
  NegotiationSummarizer,
} from "./application/index.js";
export type {
  ChatReflectionInput,
  DistilledMemory,
  NegotiationCandidate,
  NegotiationDigest,
  NegotiationReflectionInput,
  NegotiationReflectJobData,
  OnNegotiationResolved,
  ReflectEnqueueFn,
  ReflectionTranscriptEntry,
} from "./application/index.js";
export {
  allowedActionsFor,
  allowedHermesActionsFor,
  ASK_USER_LOCK_SLACK_MS,
  askUserAnswerWindowMs,
  assessConsultationEligibility,
  buildHermesNegotiationTurn,
  configuredAskUserEnabled,
  consultationPromptFor,
  DEFAULT_NEGOTIATION_MAX_TURNS,
  expectedNegotiationSpeaker,
  HERMES_OWNER_DIRECTIVE,
  HERMES_SHARED_MESSAGE_TEMPLATES,
  HermesNegotiationActionSchema,
  HermesNegotiationResponseSchema,
  HermesOwnerDirectiveSchema,
  HermesRoleAlignmentSchema,
  isNegotiationTurnCapReached,
  isRejectLikeAction,
  isSafeNegotiationQuestionText,
  isTerminalAction,
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY,
  negotiationConsultationPolicyMode,
  negotiationQuestionSettlementId,
  readProtocolVersion,
  renderNegotiatorChatMemorySection,
  resolveSeat,
  seatViolationMessage,
  validateInflightAskUserFields,
} from "./domain/index.js";
export type {
  ConsultationEligibility,
  ConsultationEligibilityInput,
  HermesNegotiationAction,
  HermesNegotiationResponse,
  HermesOwnerDirective,
  HermesRoleAlignment,
  NegotiationConsultationPolicyMode,
  NegotiationConsultationReason,
  NegotiationGraphLike,
  NegotiationOutcome,
  NegotiationSpeakerMessage,
  NegotiationSpeakerParticipants,
  NegotiationTurn,
  NegotiatorMemoryEntry,
  UserNegotiationContext,
} from "./domain/index.js";
export type {
  NegotiationToolDeps,
} from "./ports/index.js";
