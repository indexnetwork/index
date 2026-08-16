/**
 * questions capability facade — re-exports from the canonical questions public surface.
 *
 * IND-547: updated to re-export from questions/public/index.js.
 * Legacy consumers importing from this path continue to work unchanged.
 */
export {
  QuestionerAgent,
  isValidQuestionerInputContract,
  isQuestionerEnabled,
  isUptakeGuardEnabled,
  uptakeAuthorityThreshold,
  intentQuestionDailyCap,
  INTENT_QUESTION_DAILY_CAP_DEFAULT,
  INTENT_QUESTION_DAILY_WINDOW_HOURS,
  createQuestionerTools,
  createAskUserQuestionTools,
  NegotiationQuestionCandidateSchema,
  NegotiationQuestionProvenanceSchema,
} from "../questions/public/index.js";
export type {
  QuestionerInput,
  RecoveryQuestionerInput,
  UptakeQuestionerInput,
  PostStallQuestionerInput,
  InflightQuestionerInput,
  QuestionerEnqueuePayload,
  QuestionerEnqueueFn,
  PoolDiscoveryContext,
  QuestionerToolDeps,
  AskUserQuestionToolDeps,
  ChatQuestionsHost,
  NegotiationQuestionCandidate,
  NegotiationQuestionProvenance,
  NegotiationQuestionPurpose,
  PersistableQuestion,
  PersistedQuestion,
  Question,
  QuestionFilters,
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
  QuestionerDatabase,
  UnderspecificationType,
} from "../questions/public/index.js";
