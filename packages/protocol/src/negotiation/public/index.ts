/**
 * negotiation/public — curated public surface of the negotiation capability.
 *
 * Re-exports stable contracts from domain, application, and ports.
 *
 * ## Boundary
 *
 * References only negotiation/domain, negotiation/application, and
 * negotiation/ports. Never imports from runtime/foreground, host
 * implementations, or other capability internals.
 *
 * ## Intentionally excluded from public surface
 *
 * Internal prompt constants, Zod schemas (ScreenDecisionSchema is accessible
 * but not surface-forced), test-only helpers.
 *
 * ## Runtime adapters
 *
 * ### Foreground (participant-directed)
 * - `createNegotiationTools` — MCP tools for the negotiation turn protocol.
 * - `AMBIENT_PARK_WINDOW_MS` — personal-agent park window constant.
 * - `buildLifecycleNarration` — opportunity feed lifecycle mapper.
 *
 * ### Ambient (background, graph-driven)
 * - `NegotiationGraphFactory` — LangGraph state machine for bilateral turns.
 * - `negotiateCandidates` — parallel discovery negotiation runner.
 *
 * IND-550: canonical public surface for the negotiation capability.
 * Legacy paths (capabilities/negotiation*.facade.ts) re-export from here.
 */

// ── Domain: protocol rules ────────────────────────────────────────────────────
export {
  DEFAULT_NEGOTIATION_MAX_TURNS,
  isNegotiationTurnCapReached,
  expectedNegotiationSpeaker,
  allowedActionsFor,
  isTerminalAction,
  isRejectLikeAction,
  readProtocolVersion,
  configuredProtocolVersion,
  configuredAskUserEnabled,
  askUserAnswerWindowMs,
  ASK_USER_LOCK_SLACK_MS,
  DEFAULT_ASK_USER_WINDOW_MS,
  resolveSeat,
  seatViolationMessage,
  fallbackActionFor,
  rejectActionFor,
  turnSchemaFor,
  InitiatorTurnSchema,
  CounterpartyTurnSchema,
  FinalInitiatorTurnSchema,
  FinalCounterpartyTurnSchema,
  InitiatorAskUserTurnSchema,
  CounterpartyAskUserTurnSchema,
} from "../domain/index.js";
export type {
  NegotiationSpeakerParticipants,
  NegotiationSpeakerMessage,
} from "../domain/index.js";

// ── Domain: Hermes structural response contract ──────────────────────────────
export {
  HERMES_OWNER_DIRECTIVE,
  HERMES_SHARED_MESSAGE_TEMPLATES,
  HermesNegotiationActionSchema,
  HermesNegotiationResponseSchema,
  HermesOwnerDirectiveSchema,
  HermesRoleAlignmentSchema,
  allowedHermesActionsFor,
  buildHermesNegotiationTurn,
} from "../domain/index.js";
export type {
  HermesNegotiationAction,
  HermesNegotiationResponse,
  HermesOwnerDirective,
  HermesRoleAlignment,
} from "../domain/index.js";

// ── Domain: graph state types ─────────────────────────────────────────────────
export {
  NegotiationTurnSchema,
  SystemNegotiationTurnSchema,
  FinalNegotiationTurnSchema,
  NegotiationOutcomeSchema,
  NegotiationGraphState,
} from "../domain/index.js";
export type {
  NegotiationTurn,
  NegotiationOutcome,
  UserNegotiationContext,
  SeedAssessment,
  NegotiationGraphLike,
  NegotiationMessage,
} from "../domain/index.js";

// ── Domain: screen contracts ──────────────────────────────────────────────────
export {
  NEGOTIATION_SCREEN_MODES,
  configuredScreenMode,
  ScreenDecisionSchema,
  blocksNegotiationBeforeFirstTurn,
} from "../domain/index.js";
export type {
  NegotiationScreenMode,
  ScreenDecision,
  ScreenDecisionRecord,
} from "../domain/index.js";

// ── Domain: stance contracts (IND-611) ───────────────────────────────────────
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
} from "../domain/index.js";
export type { NegotiatorStance } from "../domain/index.js";

// ── Domain: deadlock ──────────────────────────────────────────────────────────
export {
  assessDeadlock,
  configuredDeadlockShiftEnabled,
  configuredDeadlockThreshold,
  renderBargainingShiftSection,
  DEFAULT_DEADLOCK_THRESHOLD,
  MIN_DEADLOCK_THRESHOLD,
} from "../domain/index.js";
export type {
  DeadlockAssessment,
  DeadlockShiftRecord,
} from "../domain/index.js";

// ── Domain: consultation policy ───────────────────────────────────────────────
export {
  assessConsultationEligibility,
  consultationPromptFor,
  negotiationConsultationPolicyMode,
} from "../domain/index.js";
export type {
  NegotiationConsultationPolicyMode,
  NegotiationConsultationReason,
  ConsultationEligibility,
  ConsultationEligibilityInput,
} from "../domain/index.js";

// ── Domain: question safety ───────────────────────────────────────────────────
export {
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY,
  isSafeNegotiationQuestionText,
  validateInflightAskUserFields,
  negotiationQuestionSettlementId,
} from "../domain/index.js";

// ── Domain: memory vocabulary and renderers ───────────────────────────────────
export {
  NEGOTIATOR_MEMORY_KINDS,
  renderNegotiatorMemorySection,
  renderNegotiatorChatMemorySection,
} from "../domain/index.js";
export type {
  DistilledMemoryKind,
  NegotiatorMemoryEntry,
  NegotiatorMemoryScope,
  NegotiatorMemoryRetrieveFn,
  NegotiatorMemoryQuery,
} from "../domain/index.js";

// ── Domain: lifecycle narration ───────────────────────────────────────────────
export { buildLifecycleNarration } from "../domain/index.js";
export type { NegotiationLifecycleNarration } from "../domain/index.js";

// ── Domain: task lock policy ──────────────────────────────────────────────────
export { holdsNegotiationConversationLock } from "../domain/index.js";

// ── Application: graph factory ────────────────────────────────────────────────
export { NegotiationGraphFactory, negotiateCandidates } from "../application/index.js";
export type { NegotiationCandidate, OnNegotiationResolved } from "../application/index.js";

// ── Application: tool factory ─────────────────────────────────────────────────
export { createNegotiationTools, AMBIENT_PARK_WINDOW_MS } from "../application/index.js";

// ── Application: system agents ────────────────────────────────────────────────
export { IndexNegotiator } from "../application/index.js";
export { NegotiationScreener } from "../application/index.js";
export type { NegotiationScreenerInput } from "../application/index.js";
export { NegotiationReflector } from "../application/index.js";
export type {
  DistilledMemory,
  ReflectionTranscriptEntry,
  NegotiationReflectionInput,
  ChatReflectionInput,
  NegotiationReflectJobData,
  ReflectEnqueueFn,
} from "../application/index.js";
export { NegotiationSummarizer, buildFallbackDigest } from "../application/index.js";
export { NegotiationInsightsGenerator } from "../application/index.js";
export type { NegotiationDigest } from "../application/index.js";

// ── Application: detail projection ───────────────────────────────────────────
export { readAuthorizedNegotiationDetail } from "../application/index.js";

// ── Ports ─────────────────────────────────────────────────────────────────────
export type { NegotiationToolDeps } from "../ports/index.js";
