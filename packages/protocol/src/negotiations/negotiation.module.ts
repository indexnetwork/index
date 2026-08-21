/**
 * negotiation — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 */
export { AMBIENT_PARK_WINDOW_MS, createNegotiationTools } from "./negotiation.tools.js";
export { createNegotiationAnswerTools } from "./negotiation.answer.tools.js";
export { buildLifecycleNarration, parkLifecycleLabel } from "./negotiation.lifecycle-narration.js";
export type { NegotiationLifecycleNarration, NegotiationParkNarration } from "./negotiation.lifecycle-narration.js";
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
  DEFAULT_NEGOTIATION_ASK_ROUNDS_CAP,
  allowedActionsFor,
  ASK_USER_WINDOW_MS,
  NEGOTIATION_MAX_TURNS_AMBIENT,
  NEGOTIATION_MAX_TURNS_CHAT,
  isRejectLikeAction,
  isTerminalAction,
  negotiationAskRoundsCap,
  readProtocolVersion,
  resolveSeat,
  seatViolationMessage,
} from "./negotiation.protocol.js";
export { countNegotiationAskRounds, countPrincipalAskUserTurns } from "./negotiation.graph.shared.js";
export {
  QUESTION_BUDGET_PER_PRINCIPAL,
  configuredQuestionBudgetPerPrincipal,
  MAX_CHECKLIST_DIMENSIONS,
  MIN_CHECKLIST_DIMENSIONS,
  NegotiationChecklistSchema,
  assessAskAdmissibility,
  authorChecklist,
  checklistFromTurns,
  checklistVerdictState,
  isChecklistAuthored,
  reconcileChecklist,
  renderChecklistSection,
} from "./negotiation.checklist.contracts.js";
export type {
  Answerhood,
  AskAdmissibility,
  AskInadmissibility,
  ChecklistItem,
  ChecklistKind,
  ChecklistResult,
  NegotiationChecklist,
} from "./negotiation.checklist.contracts.js";
export { NEGOTIATION_PARK_REASONING, NegotiationStallGapAuthor } from "./negotiation.stall-gap.js";
export type { NegotiationStallGap, NegotiationStallReason, StallGapAuthorInput } from "./negotiation.stall-gap.js";
export {
  classifyInflightPark,
  classifyParkedNegotiation,
  classifyPostStallPark,
  consumeQuestionBlockAnswers,
  negotiationParkAnswerId,
  resumeParkedNegotiation,
  routeAnswerRef,
} from "./negotiation.answer-consumption.js";
export type {
  AnswerRoute,
  InflightAnswerSettlementInput,
  InflightAnswerSettlementResult,
  NegotiationAnswerConsumptionPorts,
  NegotiationAnswerInput,
  NegotiationAnswerResumeOutcome,
  ParkClassification,
  ParkClassificationMessage,
  ParkClassificationTask,
  QuestionBlockAnswerConsumptionInput,
  QuestionBlockAnswerConsumptionResult,
  RoutedAnswer,
} from "./negotiation.answer-consumption.js";
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
export { MAX_CONSECUTIVE_TURN_FAILURES, appendTurnFailure, isTimeoutFailure, turnFailureBoundReached } from "./negotiation.turn-failure.js";
export type { NegotiationTurnFailure } from "./negotiation.turn-failure.js";
export { expectedNegotiationSpeaker } from "./negotiation.expected-speaker.js";
export { negotiationScopeKey, readNegotiationMessages } from "./negotiation.scope.js";
export {
  NEGOTIATION_CONSULTATION_POLICY_MODE,
  assessConsultationEligibility,
  consultationPromptFor,
  countOpenPreContactConsults,
} from "./negotiation.consultation-policy.js";
export {
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  isSafeAuthoredNegotiationQuestion,
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
  PreContactConsultTaskRow,
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
export type { NegotiationScopeMetadata } from "./negotiation.scope.js";
export type { NegotiatorMemoryEntry } from "./negotiation.memory.js";
export type {
  NegotiatorClientDmMessage,
  NegotiatorClientDmQuery,
  NegotiatorClientDmRetrieveFn,
} from "./negotiation.client-dm.js";
export type { NegotiationToolDeps } from "./negotiation.tools.port.js";
