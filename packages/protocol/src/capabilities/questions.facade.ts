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
  isDiscoveryQuestionsEnabled,
  discoveryQuestionsInputMode,
  discoveryQuestionsTimeoutMs,
  createQuestionerTools,
  createAskUserQuestionTools,
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
} from "../questions/public/index.js";
