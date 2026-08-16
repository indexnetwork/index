/**
 * negotiations/domain — pure negotiation types, protocol rules, and deterministic
 * policy functions.
 *
 * ## What lives here
 *
 * - NegotiationGraphState and all graph state types (negotiation.state.ts)
 * - Seat-scoped protocol rules and action vocabulary (negotiation.protocol.ts)
 * - Screen-gate pure contracts: mode, decision record, block predicate (negotiation.screen.contracts.ts)
 * - Negotiator stance contracts + prompt fragments (negotiation.stance.contracts.ts)
 * - Deadlock detection + bargaining prompt section (negotiation.deadlock.ts)
 * - Lifecycle narration mapper (negotiation.lifecycle-narration.ts)
 * - Task conversation-lock predicate (negotiation.task-lock-policy.ts)
 * - Immutable intent-snapshot provenance builder (negotiation.intent-snapshot-provenance.ts)
 * - IND-508 consultation policy: eligibility funnel + prompt pairs (negotiation.consultation-policy.ts)
 * - Privacy-gate for question text (negotiation.question-safety.ts)
 * - Memory vocabulary, renderer, retrieve-fn type (negotiation.memory.ts)
 *
 * ## What does NOT live here
 *
 * - NegotiationScreener (LLM agent) → negotiations/application
 * - NegotiationGraphFactory, negotiateCandidates (LangGraph) → negotiations/application
 * - IndexNegotiator (LLM structured model) → negotiations/application
 * - NegotiationReflector (LLM memory write) → negotiations/application
 * - NegotiationSummarizer (LLM digest) → negotiations/application
 * - NegotiationInsightsGenerator (LLM narrative) → negotiations/application
 * - createNegotiationTools (MCP tool factory) → negotiations/application
 * - NegotiationToolDeps (host port) → negotiations/ports
 *
 * IND-550: canonical domain layer for the negotiation capability.
 */

// ── Screen contracts ──────────────────────────────────────────────────────────
export {
  NEGOTIATION_SCREEN_MODES,
  configuredScreenMode,
  ScreenDecisionSchema,
  blocksNegotiationBeforeFirstTurn,
} from "./negotiation.screen.contracts.js";
export type {
  NegotiationScreenMode,
  ScreenDecision,
  ScreenDecisionRecord,
} from "./negotiation.screen.contracts.js";

// ── Stance contracts (IND-611) ────────────────────────────────────────────────
export {
  NEGOTIATOR_STANCES,
  DEFAULT_NEGOTIATOR_STANCE,
  configuredNegotiatorStance,
  stanceAppliesValueBar,
  stanceQueryMatchIsNecessaryNotSufficient,
  stanceResolvesDeadlockByStalemate,
  stanceJobFraming,
  stanceActionRules,
  stanceQuerySatisfiedRule,
} from "./negotiation.stance.contracts.js";
export type { NegotiatorStance } from "./negotiation.stance.contracts.js";

// ── Graph state and DTOs ──────────────────────────────────────────────────────
export {
  NegotiationTurnSchema,
  SystemNegotiationTurnSchema,
  FinalNegotiationTurnSchema,
  NegotiationOutcomeSchema,
  NegotiationGraphState,
} from "./negotiation.state.js";
export type {
  NegotiationTurn,
  NegotiationOutcome,
  UserNegotiationContext,
  SeedAssessment,
  NegotiationGraphLike,
  NegotiationMessage,
} from "./negotiation.state.js";

// ── Protocol rules ────────────────────────────────────────────────────────────
export {
  DEFAULT_NEGOTIATION_MAX_TURNS,
  isNegotiationTurnCapReached,
} from "./negotiation.turn-cap.js";
export { expectedNegotiationSpeaker } from "./negotiation.expected-speaker.js";
export type {
  NegotiationSpeakerParticipants,
  NegotiationSpeakerMessage,
} from "./negotiation.expected-speaker.js";
export {
  InitiatorTurnSchema,
  CounterpartyTurnSchema,
  FinalInitiatorTurnSchema,
  FinalCounterpartyTurnSchema,
  InitiatorAskUserTurnSchema,
  CounterpartyAskUserTurnSchema,
  allowedActionsFor,
  turnSchemaFor,
  isTerminalAction,
  isRejectLikeAction,
  fallbackActionFor,
  rejectActionFor,
  readProtocolVersion,
  configuredProtocolVersion,
  configuredAskUserEnabled,
  askUserAnswerWindowMs,
  ASK_USER_LOCK_SLACK_MS,
  DEFAULT_ASK_USER_WINDOW_MS,
  resolveSeat,
  seatViolationMessage,
} from "./negotiation.protocol.js";

// ── Hermes structural response contract ──────────────────────────────────────
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
export type {
  HermesNegotiationAction,
  HermesNegotiationResponse,
  HermesOwnerDirective,
  HermesRoleAlignment,
} from "./negotiation.hermes-contract.js";

// ── Deadlock detection ────────────────────────────────────────────────────────
export {
  configuredDeadlockShiftEnabled,
  configuredDeadlockThreshold,
  assessDeadlock,
  renderBargainingShiftSection,
  DEFAULT_DEADLOCK_THRESHOLD,
  MIN_DEADLOCK_THRESHOLD,
} from "./negotiation.deadlock.js";
export type { DeadlockAssessment } from "./negotiation.deadlock.js";
export type { DeadlockShiftRecord } from "./negotiation.deadlock.contracts.js";

// ── Lifecycle narration ───────────────────────────────────────────────────────
export { buildLifecycleNarration } from "./negotiation.lifecycle-narration.js";
export type { NegotiationLifecycleNarration } from "./negotiation.lifecycle-narration.js";

// ── Task lock policy ──────────────────────────────────────────────────────────
export { holdsNegotiationConversationLock } from "./negotiation.task-lock-policy.js";

// ── Intent snapshot provenance ────────────────────────────────────────────────
export { buildIntentSnapshots } from "./negotiation.intent-snapshot-provenance.js";
export type { IntentSnapshot } from "./negotiation.intent-snapshot-provenance.js";

// ── Consultation policy ───────────────────────────────────────────────────────
export {
  assessConsultationEligibility,
  consultationPromptFor,
  negotiationConsultationPolicyMode,
} from "./negotiation.consultation-policy.js";
export type {
  NegotiationConsultationPolicyMode,
  NegotiationConsultationReason,
  ConsultationEligibility,
  ConsultationEligibilityInput,
} from "./negotiation.consultation-policy.js";

// ── Question safety ───────────────────────────────────────────────────────────
export {
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY,
  isSafeNegotiationQuestionText,
  validateInflightAskUserFields,
  negotiationQuestionSettlementId,
} from "./negotiation.question-safety.js";

// ── Memory vocabulary and renderers ──────────────────────────────────────────
export {
  NEGOTIATOR_MEMORY_KINDS,
  renderNegotiatorMemorySection,
  renderNegotiatorChatMemorySection,
} from "./negotiation.memory.js";
export type {
  DistilledMemoryKind,
  NegotiatorMemoryEntry,
  NegotiatorMemoryScope,
  NegotiatorMemoryRetrieveFn,
  NegotiatorMemoryQuery,
} from "./negotiation.memory.js";
