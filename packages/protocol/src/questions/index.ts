/**
 * questions — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 * Supersedes the capabilities/*.facade.ts + questions/public/ pair; the export
 * list is the union of the facades it replaces, so the contract is unchanged.
 */
export type {
  QuestionerEnqueueFn,
} from "./application/question.input.js";
export {
  createAskUserQuestionTools,
  createQuestionerTools,
  INTENT_QUESTION_DAILY_CAP_DEFAULT,
  INTENT_QUESTION_DAILY_WINDOW_HOURS,
  intentQuestionDailyCap,
  isQuestionerEnabled,
  isUptakeGuardEnabled,
  isValidQuestionerInputContract,
  QuestionerAgent,
  uptakeAuthorityThreshold,
} from "./application/index.js";
export type {
  InflightQuestionerInput,
  PoolDiscoveryContext,
  PostStallQuestionerInput,
  QuestionerEnqueuePayload,
  QuestionerInput,
  RecoveryQuestionerInput,
  UptakeQuestionerInput,
} from "./application/index.js";
export type {
  AskUserQuestionToolDeps,
  ChatQuestionsHost,
  PersistableQuestion,
  PersistedQuestion,
  QuestionerDatabase,
  QuestionerToolDeps,
  QuestionFilters,
} from "./ports/index.js";
export {
  NegotiationQuestionCandidateSchema,
  NegotiationQuestionProvenanceSchema,
  UnderspecificationTypeSchema,
} from "./domain/index.js";
export type {
  NegotiationQuestionCandidate,
  QuestionOption,
  NegotiationQuestionProvenance,
  NegotiationQuestionPurpose,
  Question,
  QuestionGenerationResult,
  QuestionPoolDiscriminator,
  QuestionPoolPush,
  QuestionPoolPushRequestReason,
  QuestionPoolPushRequestStatus,
  QuestionPoolSnapshot,
  QuestionPurpose,
  QuestionRecoverySnapshot,
  QuestionStrategy,
  QuestionVoidedReason,
  UnderspecificationType,
} from "./domain/index.js";
