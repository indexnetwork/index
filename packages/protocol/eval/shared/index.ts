/**
 * Shared eval-harness library.
 *
 * Harness-agnostic machinery every eval reuses: scorecard aggregation, baseline
 * I/O + regression detection, rolling baselines, the repeat/retry runner,
 * console + HTML reporting, statistics, and argv helpers. Harnesses
 * (`eval/matching`, `eval/premise`, `eval/profile`, …) own only their corpus,
 * scorer, and harness-specific types; everything generic lives here.
 *
 * See `eval/README.md` for the harness anatomy and how to add a new one.
 */

// ─── Types ──────────────────────────────────────────────────────────────────
export type { CaseResultLike, ScoredRunProvenance, RuleResult, ScorecardLike, Regression } from "./types.js";

// ─── Statistics ───────────────────────────────────────────────────────────
export { binomialCI, binomialPValue, predictivePValue, binomialSignificance, mean, rateWithCI } from "./stats.js";

// ─── Scorecard + baseline ──────────────────────────────────────────────────
export { buildScorecard, meanRate } from "./scorecard.js";
export { assertBaselineWriteEligible, diffBaseline, readBaseline, readBaselineArtifact, writeBaseline, writeRunReport, type BaselineDiff } from "./baseline.js";
export { computeRollingBaseline, type RollingBaselineOptions, type RollingBaselineResult, type RollingCompatibility, type RollingExclusion } from "./rolling.js";

// ─── Baseline governance (IND-445) ────────────────────────────────────
export {
  EVAL_BASELINE_UPDATE_SUMMARY_TYPE,
  assessBaselineComparability,
  assertBaselineUpdatePermitted,
  baselineUpdateSummaryPath,
  buildBaselineUpdateSummary,
  buildEvalScoringConfigFingerprint,
  compareAgainstGovernedBaseline,
  comparisonSubjectFromMeta,
  emptyGovernedComparison,
  formatBaselineUpdateSummary,
  formatGovernedComparison,
  governedComparisonExitStatus,
  governedRegressionCount,
  performGovernedBaselineUpdate,
  resolveEvalJudgeModelId,
  type BaselineArtifactDigest,
  type BaselineUpdateSummary,
  type EvalComparability,
  type EvalComparabilityDimension,
  type EvalComparabilityFinding,
  type EvalComparabilityStatus,
  type EvalComparisonSubject,
  type EvalComparisonVerdict,
  type GovernedBaselineUpdateOptions,
  type GovernedComparison,
  type GovernedComparisonOptions,
} from "./governance.js";

// ─── Versioned artifact envelope ───────────────────────────────────────────
export {
  EVAL_ARTIFACT_SCHEMA_VERSION,
  EVAL_ARTIFACT_SCHEMA_VERSION_V1,
  EVAL_ARTIFACT_SCHEMA_VERSION_V2,
  EVAL_BASELINE_ARTIFACT_TYPE,
  EVAL_RUN_REPORT_ARTIFACT_TYPE,
  EVAL_LEGACY_UNAVAILABLE,
  EvalArtifactEnvelopeSchema,
  EvalArtifactEnvelopeV1Schema,
  EvalArtifactEnvelopeV2Schema,
  EvalScorecardPayloadSchema,
  EvalScorecardPayloadV1Schema,
  EvalScorecardPayloadV2Schema,
  EvalExecutionEvidenceSchema,
  buildEvalArtifact,
  parseEvalArtifact,
  isEvalArtifactV2,
  getExecutionEvidence,
  looksLikeLegacyScorecard,
  migrateLegacyBaseline,
  canonicalizeForFingerprint,
  fingerprintCanonicalJson,
  fingerprintEvalCorpus,
  fingerprintEvalConfig,
  readEvalGitProvenance,
  type EvalArtifactType,
  type EvalArtifactEnvelope,
  type EvalArtifactEnvelopeV1,
  type EvalArtifactEnvelopeV2,
  type EvalRunMeta,
  type EvalSelection,
  type EvalGitProvenance,
  type EvalCompleteness,
  type EvalCompletenessV1,
  type EvalCompletenessV2,
  type GitCommandRunner,
} from "./artifact.js";
export {
  readEvalArtifact,
  writeEvalArtifact,
  writeEvalJsonFile,
  assertEvalWritePlan,
  type EvalWritePlan,
  type EvalWriteOutput,
  type WriteEvalArtifactOptions,
} from "./artifact.io.js";

// ─── Reporting ─────────────────────────────────────────────────────────────
export { formatConsole, type ConsoleOptions } from "./console.js";
export {
  htmlEscape,
  rateClass,
  htmlRateCI,
  renderRuleTable,
  renderScorecardShell,
  renderHumanReport,
  renderExecutionEvidence,
  computeVerdict,
  groupStatus,
  SCORECARD_CSS,
  HUMAN_CSS,
  type ShellOptions,
  type ShellSection,
  type HumanReport,
  type HumanGroup,
  type HumanCase,
  type Verdict,
} from "./html.js";

// ─── Execution ─────────────────────────────────────────────────────────────
export {
  executeRuns,
  repeatRuns,
  invokeWithRetry,
  buildExecutionEvidence,
  attachScoredRunProvenance,
  summarizeExecution,
  sanitizeEvalError,
  sanitizeEvalErrorMessage,
  type RetryOptions,
  type AttemptAwareRunOptions,
  type EvalEvidencePolicy,
  type EvalAttemptOutcome,
  type EvalRunOutcome,
  type SanitizedEvalError,
  type EvalAttemptEvidence,
  type EvalRunEvidence,
  type EvalRunResult,
  type EvalRunBatch,
  type EvalExecutionEvidence,
  type EvalExecutionSummary,
} from "./runner.js";
export {
  arg,
  has,
  flagValue,
  resolveEvalExitCode,
  assertBaselineEvidenceComplete,
  runEvalEvidenceFlow,
  installEvalProcessCancellation,
  type EvalComparisonExitStatus,
  type EvalEvidenceFlowOptions,
  type EvalEvidenceFlowResult,
  type EvalProcessCancellation,
  EVAL_EXIT_PASS,
  EVAL_EXIT_REGRESSION,
  EVAL_EXIT_EXECUTION_ERROR,
  EVAL_EXIT_INSUFFICIENT_EVIDENCE,
} from "./cli.js";
