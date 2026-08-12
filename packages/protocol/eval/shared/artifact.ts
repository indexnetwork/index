/**
 * Versioned envelopes for committed eval baselines and diagnostic run reports.
 *
 * Version 1 remains readable for ER2 artifacts and explicit legacy migrations.
 * Version 2 adds real attempt/run evidence and execution completeness. A v1
 * artifact is never upgraded in memory and never receives fabricated attempts.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { z } from "zod";

import type { EvalExecutionEvidence } from "./runner.js";
import { sanitizeEvalErrorMessage, summarizeExecution } from "./runner.js";
import type { CaseResultLike, ScorecardLike } from "./types.js";

export const EVAL_ARTIFACT_SCHEMA_VERSION_V1 = 1;
export const EVAL_ARTIFACT_SCHEMA_VERSION_V2 = 2;
export const EVAL_ARTIFACT_SCHEMA_VERSION = EVAL_ARTIFACT_SCHEMA_VERSION_V2;

export const EVAL_BASELINE_ARTIFACT_TYPE = "index-eval/baseline";
export const EVAL_RUN_REPORT_ARTIFACT_TYPE = "index-eval/run-report";
export type EvalArtifactType = typeof EVAL_BASELINE_ARTIFACT_TYPE | typeof EVAL_RUN_REPORT_ARTIFACT_TYPE;

export const EVAL_LEGACY_UNAVAILABLE = "unavailable-legacy-migration";
const RATE_TOLERANCE = 1e-6;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "expected a lowercase hex SHA-256");
const dateTimeSchema = z.string().datetime({ offset: true });
const rateSchema = z.number().finite().min(0).max(1);
const countSchema = z.number().int().min(0);

export const EvalGitProvenanceSchema = z.object({
  revision: z.union([z.string().regex(/^[a-f0-9]{40,64}$/i), z.literal("unknown")]),
  dirty: z.boolean().nullable(),
}).strict();
export type EvalGitProvenance = z.infer<typeof EvalGitProvenanceSchema>;

export const EvalSelectionSchema = z.object({
  fullCorpus: z.boolean(),
  filters: z.record(z.string().min(1)),
}).strict().superRefine((selection, context) => {
  if (selection.fullCorpus && Object.keys(selection.filters).length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["filters"],
      message: "fullCorpus artifacts must not carry selection filters",
    });
  }
});
export type EvalSelection = z.infer<typeof EvalSelectionSchema>;

export const EvalCompletenessV1Schema = z.object({
  caseCount: countSchema,
  ruleCount: countSchema,
  totalRuns: countSchema,
  totalPasses: countSchema,
  flakyCaseCount: countSchema,
}).strict();
export type EvalCompletenessV1 = z.infer<typeof EvalCompletenessV1Schema>;

export const EvalCompletenessV2Schema = EvalCompletenessV1Schema.extend({
  requestedRuns: countSchema,
  completedRuns: countSchema,
  failedRuns: countSchema,
  recoveredRuns: countSchema,
  totalAttempts: countSchema,
  complete: z.boolean(),
}).strict();
export type EvalCompletenessV2 = z.infer<typeof EvalCompletenessV2Schema>;
/** Current completeness shape. */
export type EvalCompleteness = EvalCompletenessV2;

const ruleResultSchema = z.object({
  rule: z.string().min(1),
  caseCount: z.number().int().min(1),
  passRate: rateSchema,
}).strict();

function caseResultBaseSchema(minRuns: number, requireScoredRunIds: boolean) {
  return z.object({
    caseId: z.string().min(1),
    rule: z.string().min(1),
    runs: z.number().int().min(minRuns),
    passes: countSchema,
    passRate: rateSchema,
    flaky: z.boolean(),
    ...(requireScoredRunIds ? { scoredRunIds: z.array(z.string().min(1)) } : {}),
  }).passthrough();
}

function addScorecardValidation(
  payload: {
    aggregatePassRate: number;
    rules: Array<{ rule: string; caseCount: number; passRate: number }>;
    cases: Array<CaseResultLike & { scoredRunIds?: string[] }>;
  },
  context: z.RefinementCtx,
): void {
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  const caseIds = payload.cases.map((entry) => entry.caseId);
  if (new Set(caseIds).size !== caseIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["cases"], message: "duplicate caseId values" });
  }
  const ruleLabels = payload.rules.map((entry) => entry.rule);
  if (new Set(ruleLabels).size !== ruleLabels.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rules"], message: "duplicate rule labels" });
  }

  for (const [index, entry] of payload.cases.entries()) {
    if (entry.passes > entry.runs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cases", index],
        message: `case ${entry.caseId}: passes (${entry.passes}) exceeds runs (${entry.runs})`,
      });
      continue;
    }
    const expectedRate = entry.runs === 0 ? 0 : entry.passes / entry.runs;
    if (Math.abs(entry.passRate - expectedRate) > RATE_TOLERANCE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cases", index, "passRate"],
        message: `case ${entry.caseId}: passRate ${entry.passRate} is inconsistent with ${entry.passes}/${entry.runs}`,
      });
    }
    if (entry.flaky !== (entry.passes > 0 && entry.passes < entry.runs)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cases", index, "flaky"],
        message: `case ${entry.caseId}: flaky flag is inconsistent with passes/runs`,
      });
    }
    if (entry.scoredRunIds && new Set(entry.scoredRunIds).size !== entry.scoredRunIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cases", index, "scoredRunIds"],
        message: `case ${entry.caseId}: duplicate scoredRunIds`,
      });
    }
  }

  const scoredCases = payload.cases.filter((entry) => entry.runs > 0);
  const expectedAggregate = scoredCases.length === 0 ? 0 : mean(scoredCases.map((entry) => entry.passRate));
  if (Math.abs(payload.aggregatePassRate - expectedAggregate) > RATE_TOLERANCE) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["aggregatePassRate"],
      message: "aggregatePassRate is inconsistent with the mean of case pass rates",
    });
  }

  const casesByRule = new Map<string, typeof payload.cases>();
  for (const entry of payload.cases) {
    const members = casesByRule.get(entry.rule) ?? [];
    members.push(entry);
    casesByRule.set(entry.rule, members);
  }
  if (casesByRule.size !== payload.rules.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rules"],
      message: "rules rollup does not cover exactly the rules present in cases",
    });
  }
  for (const [index, rule] of payload.rules.entries()) {
    const members = casesByRule.get(rule.rule);
    if (!members) continue;
    if (members.length !== rule.caseCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rules", index, "caseCount"],
        message: `rule ${rule.rule}: caseCount ${rule.caseCount} != ${members.length} cases`,
      });
    } else {
      const scoredMembers = members.filter((entry) => entry.runs > 0);
      const expectedRuleRate = scoredMembers.length === 0 ? 0 : mean(scoredMembers.map((entry) => entry.passRate));
      if (Math.abs(rule.passRate - expectedRuleRate) <= RATE_TOLERANCE) continue;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rules", index, "passRate"],
        message: `rule ${rule.rule}: passRate is inconsistent with its scored member cases`,
      });
    }
  }
}

export const EvalScorecardPayloadV1Schema = z.object({
  generatedAt: dateTimeSchema,
  model: z.string().min(1),
  runs: z.number().int().min(1),
  aggregatePassRate: rateSchema,
  rules: z.array(ruleResultSchema).min(1),
  cases: z.array(caseResultBaseSchema(1, false)).min(1),
}).strict().superRefine((payload, context) => addScorecardValidation(payload as never, context));

const evalScorecardPayloadV2BaseSchema = z.object({
  generatedAt: dateTimeSchema,
  model: z.string().min(1),
  runs: z.number().int().min(1),
  aggregatePassRate: rateSchema,
  rules: z.array(ruleResultSchema).min(1),
  cases: z.array(caseResultBaseSchema(0, true)).min(1),
}).strict();
type EvalScorecardPayloadV2Input = z.infer<typeof evalScorecardPayloadV2BaseSchema>;
function refineEvalScorecardPayloadV2(payload: EvalScorecardPayloadV2Input, context: z.RefinementCtx): void {
  addScorecardValidation(payload as never, context);
}
export const EvalScorecardPayloadV2Schema = evalScorecardPayloadV2BaseSchema.superRefine(refineEvalScorecardPayloadV2);
/** Current payload schema. */
export const EvalScorecardPayloadSchema = EvalScorecardPayloadV2Schema;

const sanitizedErrorSchema = z.object({
  class: z.string().min(1).max(100),
  code: z.string().min(1).max(100).optional(),
  message: z.string().max(601),
}).strict();

const historicalEvidenceTypeSchema = z.enum(["intent", "premise", "user_context"]);
const historicalFailureStageSchema = z.enum([
  "execution", "retrieval", "evaluation_admission", "evaluation_rejection", "finalization", "none",
]);
const historicalCandidateRoleSchema = z.enum(["target", "semantic-negative", "background"]);
const safeHistoricalIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

export const HistoricalParticipantMetricSchema = z.object({
  participantId: safeHistoricalIdSchema,
  role: historicalCandidateRoleSchema,
  retrieval: z.object({
    rank: z.number().int().min(1).max(24),
    bestScore: z.number().finite(),
    evidenceIds: z.array(safeHistoricalIdSchema).min(1),
    evidenceTypes: z.array(historicalEvidenceTypeSchema).min(1),
  }).strict().nullable(),
  evaluator: z.object({
    eligible: z.boolean(),
    submitted: z.boolean(),
    returned: z.boolean(),
    score: z.number().finite().nullable(),
    errorClass: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(),
  }).strict(),
  finalRank: z.number().int().min(1).max(24).nullable(),
  failureStage: historicalFailureStageSchema,
}).strict().superRefine((metric, context) => {
  const sortedUnique = (values: readonly string[]): boolean => values.every(
    (value, index) => index === 0 || values[index - 1]!.localeCompare(value) < 0,
  );
  if (metric.retrieval !== null) {
    if (!sortedUnique(metric.retrieval.evidenceIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["retrieval", "evidenceIds"], message: "evidenceIds must be sorted and unique" });
    }
    if (!sortedUnique(metric.retrieval.evidenceTypes)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["retrieval", "evidenceTypes"], message: "evidenceTypes must be sorted and unique" });
    }
  }
  if (metric.evaluator.submitted && !metric.evaluator.eligible) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["evaluator", "submitted"], message: "submitted evaluation requires eligibility" });
  }
  if (metric.evaluator.returned && !metric.evaluator.submitted) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["evaluator", "returned"], message: "returned evaluation requires submission" });
  }
  if (metric.evaluator.eligible && metric.retrieval === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["evaluator", "eligible"], message: "eligible evaluation requires retrieval" });
  }
  if ((metric.evaluator.returned && metric.evaluator.score === null)
    || (!metric.evaluator.returned && metric.evaluator.score !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["evaluator", "score"], message: "evaluator score must exist if and only if evaluation returned" });
  }
  if (metric.finalRank !== null && !metric.evaluator.returned) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["finalRank"], message: "final rank requires a returned evaluation" });
  }
});
export type HistoricalParticipantMetric = z.infer<typeof HistoricalParticipantMetricSchema>;

const historicalStageCountsSchema = z.object({
  total: countSchema,
  retrieved: countSchema,
  evaluatorEligible: countSchema,
  evaluatorSubmitted: countSchema,
  evaluatorReturned: countSchema,
  finalIncluded: countSchema,
}).strict();
const historicalRankSummarySchema = z.object({
  count: countSchema,
  sum: countSchema,
  mean: z.number().finite().nullable(),
}).strict();
const historicalStageFunnelBaseSchema = z.object({
  slots: countSchema,
  participants: countSchema,
  target: historicalStageCountsSchema,
  semanticNegatives: historicalStageCountsSchema,
  backgrounds: historicalStageCountsSchema,
  targetRetrievalRank: historicalRankSummarySchema,
  targetFinalRank: historicalRankSummarySchema,
  failureStages: z.object({
    execution: countSchema,
    retrieval: countSchema,
    evaluation_admission: countSchema,
    evaluation_rejection: countSchema,
    finalization: countSchema,
    none: countSchema,
  }).strict(),
}).strict();

type HistoricalStageFunnelInput = z.infer<typeof historicalStageFunnelBaseSchema>;
function refineHistoricalStageFunnel(funnel: HistoricalStageFunnelInput, context: z.RefinementCtx): void {
  const groups = [[funnel.target, 1], [funnel.semanticNegatives, 3], [funnel.backgrounds, 20]] as const;
  for (const [counts, expectedTotal] of groups) {
    if (counts.total !== expectedTotal
      || counts.retrieved < counts.evaluatorEligible
      || counts.evaluatorEligible < counts.evaluatorSubmitted
      || counts.evaluatorSubmitted < counts.evaluatorReturned
      || counts.evaluatorReturned < counts.finalIncluded) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [], message: "stage funnel counts are inconsistent" });
      break;
    }
  }
  const total = (key: keyof z.infer<typeof historicalStageCountsSchema>): number =>
    funnel.target[key] + funnel.semanticNegatives[key] + funnel.backgrounds[key];
  const validRank = (rank: z.infer<typeof historicalRankSummarySchema>, expected: number): boolean =>
    rank.count === expected
    && rank.count <= total("total")
    && rank.sum >= rank.count
    && rank.sum <= rank.count * total("total")
    && rank.mean === (rank.count === 0 ? null : rank.sum / rank.count);
  if (funnel.slots !== 1 || funnel.participants !== 24
    || !validRank(funnel.targetRetrievalRank, funnel.target.retrieved)
    || !validRank(funnel.targetFinalRank, funnel.target.finalIncluded)
    || funnel.failureStages.execution !== 0
    || funnel.failureStages.retrieval !== 24 - total("retrieved")
    || funnel.failureStages.evaluation_admission !== total("retrieved") - total("evaluatorSubmitted")
    || funnel.failureStages.evaluation_rejection !== total("evaluatorSubmitted") - total("evaluatorReturned")
    || funnel.failureStages.finalization !== total("evaluatorReturned") - total("finalIncluded")
    || funnel.failureStages.none !== total("finalIncluded")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [], message: "stage funnel is not a valid single-slot funnel" });
  }
}
export const HistoricalStageFunnelSchema = historicalStageFunnelBaseSchema.superRefine(refineHistoricalStageFunnel);
export type HistoricalStageFunnel = z.infer<typeof HistoricalStageFunnelSchema>;

export const HistoricalQualityMeasurementSchema = z.object({
  kind: z.literal("historical-quality-pilot"),
  scorecardSemantics: z.literal("execution-completeness"),
  repetitionsRequested: z.number().int().min(1),
  requestedSlots: z.number().int().min(1),
  completedSlots: countSchema,
  qualityVerdictAvailable: z.boolean(),
}).strict();
export type HistoricalQualityMeasurement = z.infer<typeof HistoricalQualityMeasurementSchema>;

const historicalQualityTransportRowBaseSchema = z.object({
  kind: z.literal("historical-quality-pilot"),
  logicalCaseId: z.string().min(1),
  trigger: z.enum(["intent", "enrichment"]),
  repetition: countSchema,
  configurationFingerprint: sha256Schema,
  completed: z.boolean(),
  participantMetrics: z.array(HistoricalParticipantMetricSchema).length(24),
  stageFunnel: HistoricalStageFunnelSchema.nullable(),
}).strict();

type HistoricalQualityTransportRowInput = z.infer<typeof historicalQualityTransportRowBaseSchema>;
function refineHistoricalQualityTransportRow(row: HistoricalQualityTransportRowInput, context: z.RefinementCtx): void {
  const ids = row.participantMetrics.map((metric) => metric.participantId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["participantMetrics"], message: "participant metrics must have unique participant IDs" });
  }
  const roleCounts = { target: 0, "semantic-negative": 0, background: 0 };
  for (const metric of row.participantMetrics) roleCounts[metric.role] += 1;
  if (roleCounts.target !== 1 || roleCounts["semantic-negative"] !== 3 || roleCounts.background !== 20) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["participantMetrics"], message: "participant metrics require 1 target, 3 semantic-negative, and 20 background rows" });
  }
  const retrievalRanks = row.participantMetrics.flatMap((metric) => metric.retrieval === null ? [] : [metric.retrieval.rank]).sort((a, b) => a - b);
  const finalRanks = row.participantMetrics.flatMap((metric) => metric.finalRank === null ? [] : [metric.finalRank]).sort((a, b) => a - b);
  const contiguous = (values: readonly number[]): boolean => values.every((value, index) => value === index + 1);
  if (!contiguous(retrievalRanks) || !contiguous(finalRanks)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["participantMetrics"], message: "retrieval and final ranks must be contiguous" });
  }
  if (row.completed) {
    if (row.stageFunnel === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["stageFunnel"], message: "completed transport row requires a stage funnel" });
    }
    const expectedStage = (metric: HistoricalParticipantMetric): z.infer<typeof historicalFailureStageSchema> => {
      if (metric.retrieval === null) return "retrieval";
      if (!metric.evaluator.eligible || !metric.evaluator.submitted) return "evaluation_admission";
      if (!metric.evaluator.returned) return "evaluation_rejection";
      if (metric.finalRank === null) return "finalization";
      return "none";
    };
    if (row.participantMetrics.some((metric) => metric.failureStage !== expectedStage(metric))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["participantMetrics"], message: "participant failure stages are inconsistent with metric evidence" });
    }
    if (row.stageFunnel !== null) {
      const counts = (role: HistoricalParticipantMetric["role"]) => {
        const metrics = row.participantMetrics.filter((metric) => metric.role === role);
        return {
          total: metrics.length,
          retrieved: metrics.filter((metric) => metric.retrieval !== null).length,
          evaluatorEligible: metrics.filter((metric) => metric.evaluator.eligible).length,
          evaluatorSubmitted: metrics.filter((metric) => metric.evaluator.submitted).length,
          evaluatorReturned: metrics.filter((metric) => metric.evaluator.returned).length,
          finalIncluded: metrics.filter((metric) => metric.finalRank !== null).length,
        };
      };
      const target = row.participantMetrics.find((metric) => metric.role === "target")!;
      const rankSummary = (rank: number | null) => ({ count: rank === null ? 0 : 1, sum: rank ?? 0, mean: rank });
      const derived: HistoricalStageFunnelInput = {
        slots: 1,
        participants: 24,
        target: counts("target"),
        semanticNegatives: counts("semantic-negative"),
        backgrounds: counts("background"),
        targetRetrievalRank: rankSummary(target.retrieval?.rank ?? null),
        targetFinalRank: rankSummary(target.finalRank),
        failureStages: {
          execution: row.participantMetrics.filter((metric) => metric.failureStage === "execution").length,
          retrieval: row.participantMetrics.filter((metric) => metric.failureStage === "retrieval").length,
          evaluation_admission: row.participantMetrics.filter((metric) => metric.failureStage === "evaluation_admission").length,
          evaluation_rejection: row.participantMetrics.filter((metric) => metric.failureStage === "evaluation_rejection").length,
          finalization: row.participantMetrics.filter((metric) => metric.failureStage === "finalization").length,
          none: row.participantMetrics.filter((metric) => metric.failureStage === "none").length,
        },
      };
      if (JSON.stringify(row.stageFunnel) !== JSON.stringify(derived)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["stageFunnel"], message: "stage funnel must exactly summarize participant metrics" });
      }
    }
  } else {
    if (row.stageFunnel !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["stageFunnel"], message: "failed transport row must not have a stage funnel" });
    }
    if (row.participantMetrics.some((metric) => metric.failureStage !== "execution")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["participantMetrics"], message: "failed transport row metrics must record execution failure" });
    }
    if (row.participantMetrics.some((metric) => metric.finalRank !== null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["participantMetrics"], message: "failed transport row final ranks must be null" });
    }
  }
}
export const HistoricalQualityTransportRowSchema = historicalQualityTransportRowBaseSchema.superRefine(refineHistoricalQualityTransportRow);
export type HistoricalQualityTransportRow = z.infer<typeof HistoricalQualityTransportRowSchema>;

const attemptEvidenceBaseSchema = z.object({
  attemptId: z.string().min(1),
  runId: z.string().min(1),
  runIndex: countSchema,
  attemptNumber: z.number().int().min(1),
  startedAt: dateTimeSchema,
  completedAt: dateTimeSchema,
  durationMs: countSchema,
  outcome: z.enum(["success", "failure", "timeout", "cancelled"]),
  error: sanitizedErrorSchema.optional(),
  retryable: z.boolean(),
  backoffMs: countSchema,
}).strict();

type AttemptEvidenceInput = z.infer<typeof attemptEvidenceBaseSchema>;
function refineAttemptEvidence(attempt: AttemptEvidenceInput, context: z.RefinementCtx): void {
  const elapsed = Date.parse(attempt.completedAt) - Date.parse(attempt.startedAt);
  if (elapsed < 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "attempt completedAt precedes startedAt" });
  }
  if (Math.abs(elapsed - attempt.durationMs) > 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["durationMs"], message: "attempt durationMs is inconsistent with timestamps" });
  }
  if (attempt.outcome === "success") {
    if (attempt.error) context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "successful attempt must not have an error" });
    if (attempt.retryable) context.addIssue({ code: z.ZodIssueCode.custom, path: ["retryable"], message: "successful attempt cannot be retryable" });
    if (attempt.backoffMs !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["backoffMs"], message: "successful attempt cannot schedule backoff" });
  } else if (!attempt.error) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "non-success attempt requires a sanitized error" });
  } else {
    for (const key of ["class", "code", "message"] as const) {
      const value = attempt.error[key];
      if (value !== undefined && sanitizeEvalErrorMessage(value) !== value) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["error", key], message: "error evidence contains unsanitized secret/header data" });
      }
    }
  }
}
const attemptEvidenceSchema = attemptEvidenceBaseSchema.superRefine(refineAttemptEvidence);

const runEvidenceBaseSchema = z.object({
  runId: z.string().min(1),
  caseId: z.string().min(1),
  runIndex: countSchema,
  outcome: z.enum(["success", "failed", "cancelled"]),
  recovered: z.boolean(),
  attempts: z.array(attemptEvidenceSchema),
}).strict();

type RunEvidenceInput = z.infer<typeof runEvidenceBaseSchema>;
function refineRunEvidence(run: RunEvidenceInput, context: z.RefinementCtx): void {
  const expectedRunId = `${encodeURIComponent(run.caseId)}::run:${run.runIndex + 1}`;
  if (run.runId !== expectedRunId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["runId"], message: `runId must be deterministic (${expectedRunId})` });
  }
  run.attempts.forEach((attempt, index) => {
    if (attempt.runId !== run.runId || attempt.runIndex !== run.runIndex) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts", index], message: "attempt does not belong to its run" });
    }
    if (attempt.attemptNumber !== index + 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts", index, "attemptNumber"], message: "attempt numbers must be contiguous and one-based" });
    }
    const expectedAttemptId = `${run.runId}::attempt:${index + 1}`;
    if (attempt.attemptId !== expectedAttemptId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts", index, "attemptId"], message: `attemptId must be deterministic (${expectedAttemptId})` });
    }
    const next = run.attempts[index + 1];
    if (next) {
      if (!attempt.retryable) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts", index, "retryable"], message: "only retryable attempts may be followed by another attempt" });
      }
      if (attempt.outcome === "cancelled") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts", index, "outcome"], message: "cancelled attempts are terminal" });
      }
      if (Date.parse(next.startedAt) < Date.parse(attempt.completedAt)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts", index + 1, "startedAt"], message: "attempt timestamps must be chronological and non-overlapping" });
      }
    }
    if (!attempt.retryable && attempt.backoffMs !== 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts", index, "backoffMs"], message: "non-retryable attempts cannot schedule backoff" });
    }
  });
  const successes = run.attempts.filter((attempt) => attempt.outcome === "success");
  if (run.outcome === "success") {
    if (successes.length !== 1 || run.attempts[run.attempts.length - 1]?.outcome !== "success") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "successful run must end in exactly one successful attempt" });
    }
    if (run.recovered !== (run.attempts.length > 1)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["recovered"], message: "recovered is inconsistent with successful attempt history" });
    }
  } else {
    if (successes.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts"], message: "non-success run cannot contain a successful attempt" });
    if (run.recovered) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recovered"], message: "non-success run cannot be recovered" });
    if (run.outcome === "failed" && run.attempts.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts"], message: "failed run requires at least one attempt" });
    }
    if (run.outcome === "failed" && run.attempts[run.attempts.length - 1]?.outcome === "cancelled") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "run ending in a cancelled attempt must be cancelled" });
    }
    if (run.outcome !== "cancelled" && run.attempts.some((attempt) => attempt.outcome === "cancelled")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "cancelled attempt requires a cancelled run" });
    }
  }
}
const runEvidenceSchema = runEvidenceBaseSchema.superRefine(refineRunEvidence);

const historicalQualityAttemptBaseSchema = attemptEvidenceBaseSchema.extend({
  retryable: z.literal(false),
  backoffMs: z.literal(0),
});
const historicalQualityAttemptSchema = historicalQualityAttemptBaseSchema.superRefine(refineAttemptEvidence);
const historicalQualityExecutionRunBaseSchema = runEvidenceBaseSchema.extend({
  runIndex: z.literal(0),
  recovered: z.literal(false),
  attempts: z.tuple([historicalQualityAttemptSchema]),
});
export const HistoricalQualityExecutionRunSchema = historicalQualityExecutionRunBaseSchema.superRefine(refineRunEvidence);
export type HistoricalQualityExecutionRun = z.infer<typeof HistoricalQualityExecutionRunSchema>;

export const EvalExecutionEvidenceSchema = z.object({
  policy: z.enum(["normal", "strict"]),
  runs: z.array(runEvidenceSchema),
}).strict();

const historicalQualityCaseBaseSchema = caseResultBaseSchema(1, true).extend({
  rule: z.literal("execution-completeness"),
  runs: z.literal(1),
  passes: z.union([z.literal(0), z.literal(1)]),
  passRate: z.union([z.literal(0), z.literal(1)]),
  flaky: z.literal(false),
  ...historicalQualityTransportRowBaseSchema.shape,
}).strict();
const historicalQualityCaseSchema = historicalQualityCaseBaseSchema.superRefine((row, context) => {
  refineHistoricalQualityTransportRow(row, context);
  if (row.passRate !== row.passes) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["passRate"], message: "quality passRate must equal passes" });
  }
});

const historicalQualityPayloadBaseSchema = evalScorecardPayloadV2BaseSchema.extend({
  runs: z.literal(1),
  rules: z.tuple([ruleResultSchema.extend({ rule: z.literal("execution-completeness"), caseCount: countSchema })]),
  cases: z.array(historicalQualityCaseSchema),
});
type HistoricalQualityPayloadInput = z.infer<typeof historicalQualityPayloadBaseSchema>;
function refineHistoricalQualityPayload(payload: HistoricalQualityPayloadInput, context: z.RefinementCtx): void {
  const caseIds = payload.cases.map((row) => row.caseId);
  if (new Set(caseIds).size !== caseIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["cases"], message: "duplicate caseId values" });
  }
  const expectedRate = payload.cases.length === 0
    ? 0
    : payload.cases.reduce((sum, row) => sum + row.passes, 0) / payload.cases.length;
  if (Math.abs(payload.aggregatePassRate - expectedRate) > RATE_TOLERANCE) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["aggregatePassRate"], message: "aggregatePassRate is inconsistent with quality transport completion" });
  }
  if (payload.rules[0].caseCount !== payload.cases.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rules", 0, "caseCount"], message: "quality rule caseCount must equal emitted transport rows" });
  }
  if (Math.abs(payload.rules[0].passRate - expectedRate) > RATE_TOLERANCE) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rules", 0, "passRate"], message: "quality rule passRate is inconsistent with transport completion" });
  }
  for (const [index, row] of payload.cases.entries()) {
    const expectedId = `${encodeURIComponent(row.logicalCaseId)}/${row.trigger}/r${row.repetition + 1}`;
    if (row.caseId !== expectedId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["cases", index, "caseId"], message: `quality transport caseId must be deterministic (${expectedId})` });
    }
  }
}
const historicalQualityPayloadSchema = historicalQualityPayloadBaseSchema.superRefine(refineHistoricalQualityPayload);

const historicalQualityExecutionSchema = z.object({
  policy: z.enum(["normal", "strict"]),
  runs: z.array(HistoricalQualityExecutionRunSchema),
}).strict();

const fingerprintSchema = z.union([sha256Schema, z.literal(EVAL_LEGACY_UNAVAILABLE)]);
const commonEnvelopeFields = {
  artifactType: z.enum([EVAL_BASELINE_ARTIFACT_TYPE, EVAL_RUN_REPORT_ARTIFACT_TYPE]),
  harness: z.string().min(1),
  harnessVersion: z.string().min(1),
  createdAt: dateTimeSchema,
  startedAt: dateTimeSchema,
  completedAt: dateTimeSchema,
  models: z.array(z.string().min(1)).min(1),
  runs: z.number().int().min(1),
  selection: EvalSelectionSchema,
  corpusFingerprint: fingerprintSchema,
  configFingerprint: fingerprintSchema,
  git: EvalGitProvenanceSchema,
};

function validateCommonEnvelope(
  artifact: {
    startedAt: string;
    completedAt: string;
    createdAt: string;
    source: string;
    corpusFingerprint: string;
    configFingerprint: string;
    models: string[];
    runs: number;
    payload: { runs: number };
  },
  context: z.RefinementCtx,
): void {
  const started = Date.parse(artifact.startedAt);
  const completed = Date.parse(artifact.completedAt);
  const created = Date.parse(artifact.createdAt);
  if (!(started <= completed && completed <= created)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "timestamps must satisfy startedAt <= completedAt <= createdAt" });
  }
  if (artifact.source === "run") {
    for (const key of ["corpusFingerprint", "configFingerprint"] as const) {
      if (artifact[key] === EVAL_LEGACY_UNAVAILABLE) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} "${EVAL_LEGACY_UNAVAILABLE}" is only valid for source "legacy-migration"` });
      }
    }
  }
  if (new Set(artifact.models).size !== artifact.models.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["models"], message: "duplicate model IDs" });
  }
  if (artifact.payload.runs !== artifact.runs) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["runs"], message: `envelope runs (${artifact.runs}) != payload runs (${artifact.payload.runs})` });
  }
}

export const EvalArtifactEnvelopeV1Schema = z.object({
  ...commonEnvelopeFields,
  schemaVersion: z.literal(EVAL_ARTIFACT_SCHEMA_VERSION_V1),
  source: z.enum(["run", "legacy-migration"]),
  completeness: EvalCompletenessV1Schema,
  payload: EvalScorecardPayloadV1Schema,
}).strict().superRefine((artifact, context) => {
  validateCommonEnvelope(artifact, context);
  const expected = summarizeScoreCompleteness(artifact.payload.cases, artifact.payload.rules.length);
  for (const key of Object.keys(expected) as Array<keyof EvalCompletenessV1>) {
    if (artifact.completeness[key] !== expected[key]) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["completeness", key], message: `completeness.${key} is inconsistent with the payload (expected ${expected[key]})` });
    }
  }
});

const evalArtifactEnvelopeV2BaseSchema = z.object({
  ...commonEnvelopeFields,
  schemaVersion: z.literal(EVAL_ARTIFACT_SCHEMA_VERSION_V2),
  source: z.literal("run"),
  completeness: EvalCompletenessV2Schema,
  execution: EvalExecutionEvidenceSchema,
  payload: EvalScorecardPayloadV2Schema,
}).strict();
type EvalArtifactEnvelopeV2Input = z.infer<typeof evalArtifactEnvelopeV2BaseSchema>;

function refineEvalArtifactEnvelopeV2(
  artifact: EvalArtifactEnvelopeV2Input,
  context: z.RefinementCtx,
  quality: boolean,
): void {
  validateCommonEnvelope(artifact, context);
  const expected = summarizeCompletenessV2(artifact.payload.cases, artifact.payload.rules.length, artifact.execution);
  for (const key of Object.keys(expected) as Array<keyof EvalCompletenessV2>) {
    if (quality && key === "complete") continue;
    if (artifact.completeness[key] !== expected[key]) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["completeness", key], message: `completeness.${key} is inconsistent with the payload/execution (expected ${String(expected[key])})` });
    }
  }

  const expectedRequested = artifact.payload.cases.length * artifact.runs;
  if (artifact.execution.runs.length !== expectedRequested) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["execution", "runs"], message: `execution must contain every requested slot (${expectedRequested})` });
  }
  const caseIds = new Set(artifact.payload.cases.map((entry) => entry.caseId));
  const slotKeys = new Set<string>();
  const runIds = new Set<string>();
  const attemptIds = new Set<string>();
  for (const [index, run] of artifact.execution.runs.entries()) {
    if (!caseIds.has(run.caseId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["execution", "runs", index, "caseId"], message: "execution run references a case absent from the payload" });
    }
    if (run.runIndex >= artifact.runs) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["execution", "runs", index, "runIndex"], message: "runIndex exceeds configured runs" });
    }
    const slotKey = `${run.caseId}\u0000${run.runIndex}`;
    if (slotKeys.has(slotKey)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["execution", "runs", index], message: "duplicate requested run slot" });
    slotKeys.add(slotKey);
    if (runIds.has(run.runId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["execution", "runs", index, "runId"], message: "duplicate runId" });
    runIds.add(run.runId);
    for (const [attemptIndex, attempt] of run.attempts.entries()) {
      if (attemptIds.has(attempt.attemptId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["execution", "runs", index, "attempts"], message: "duplicate attemptId" });
      attemptIds.add(attempt.attemptId);
      if (Date.parse(attempt.startedAt) < Date.parse(artifact.startedAt)
        || Date.parse(attempt.completedAt) > Date.parse(artifact.completedAt)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["execution", "runs", index, "attempts", attemptIndex],
          message: "attempt timestamps must fall within the envelope execution window",
        });
      }
    }
  }

  for (const [caseIndex, entry] of artifact.payload.cases.entries()) {
    const successfulIds = artifact.execution.runs
      .filter((run) => run.caseId === entry.caseId && run.outcome === "success")
      .sort((left, right) => left.runIndex - right.runIndex)
      .map((run) => run.runId);
    if (JSON.stringify(entry.scoredRunIds) !== JSON.stringify(successfulIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "cases", caseIndex, "scoredRunIds"], message: "scoredRunIds must exactly match successful terminal runs" });
    }
    if (!quality && entry.runs !== successfulIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "cases", caseIndex, "runs"], message: "case runs must count only successful terminal outputs" });
    }
  }
  if (artifact.artifactType === EVAL_BASELINE_ARTIFACT_TYPE && !artifact.completeness.complete) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completeness", "complete"], message: "baseline artifacts require complete execution evidence" });
  }
}

const evalArtifactEnvelopeV2LegacySchema = evalArtifactEnvelopeV2BaseSchema.superRefine(
  (artifact, context) => refineEvalArtifactEnvelopeV2(artifact, context, false),
);

const historicalQualityArtifactEnvelopeBaseSchema = evalArtifactEnvelopeV2BaseSchema.extend({
  artifactType: z.literal(EVAL_RUN_REPORT_ARTIFACT_TYPE),
  runs: z.literal(1),
  measurement: HistoricalQualityMeasurementSchema,
  execution: historicalQualityExecutionSchema,
  payload: historicalQualityPayloadSchema,
});
type HistoricalQualityArtifactEnvelopeInput = z.infer<typeof historicalQualityArtifactEnvelopeBaseSchema>;
function refineHistoricalQualityArtifactEnvelope(
  artifact: HistoricalQualityArtifactEnvelopeInput,
  context: z.RefinementCtx,
): void {
  refineEvalArtifactEnvelopeV2(artifact, context, true);
  const { measurement } = artifact;
  if (artifact.payload.cases.length > measurement.requestedSlots) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "cases"], message: "emitted quality rows exceed requestedSlots" });
  }
  const executionByCase = new Map(artifact.execution.runs.map((run) => [run.caseId, run]));
  let completedSlots = 0;
  for (const [index, row] of artifact.payload.cases.entries()) {
    const run = executionByCase.get(row.caseId);
    if (!run) continue;
    const attempt = run.attempts[0];
    const executionSucceeded = run.outcome === "success" && attempt.outcome === "success";
    const pass = row.passes === 1 && row.passRate === 1;
    const hasFunnel = row.stageFunnel !== null;
    if (!(row.completed === executionSucceeded && row.completed === pass && row.completed === hasFunnel)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "cases", index], message: "quality completion, pass, execution success, and funnel presence must agree" });
    }
    if (!row.completed && (run.outcome !== "failed" || !["failure", "timeout"].includes(attempt.outcome))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["execution", "runs", index], message: "failed quality row requires one failed-or-timeout execution attempt" });
    }
    if (row.repetition >= measurement.repetitionsRequested) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "cases", index, "repetition"], message: "quality repetition exceeds repetitionsRequested" });
    }
    if (row.configurationFingerprint !== artifact.configFingerprint) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "cases", index, "configurationFingerprint"], message: "quality row configuration fingerprint must match the envelope" });
    }
    if (row.completed) completedSlots += 1;
  }
  if (measurement.completedSlots !== completedSlots) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["measurement", "completedSlots"], message: "completedSlots must equal completed emitted transport rows" });
  }
  const repetitionsByGroup = new Map<string, number[]>();
  for (const row of artifact.payload.cases) {
    const key = JSON.stringify([row.logicalCaseId, row.trigger]);
    const repetitions = repetitionsByGroup.get(key) ?? [];
    repetitions.push(row.repetition);
    repetitionsByGroup.set(key, repetitions);
  }
  const exactRepetitionCoverage = [...repetitionsByGroup.values()].every((repetitions) =>
    repetitions.length === measurement.repetitionsRequested
      && [...repetitions].sort((left, right) => left - right)
        .every((repetition, index) => repetition === index));
  const requestedSlotMath = repetitionsByGroup.size * measurement.repetitionsRequested
    === measurement.requestedSlots;
  const completeEvidence = artifact.payload.cases.length === measurement.requestedSlots
    && completedSlots === measurement.requestedSlots
    && exactRepetitionCoverage
    && requestedSlotMath;
  const selectedTriggers = new Set(artifact.payload.cases.map((row) => row.trigger));
  const fullTriggerSelection = selectedTriggers.size === 2
    && selectedTriggers.has("intent")
    && selectedTriggers.has("enrichment");
  const qualityVerdictAvailable = completeEvidence && artifact.selection.fullCorpus && fullTriggerSelection;
  if (measurement.qualityVerdictAvailable !== qualityVerdictAvailable) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["measurement", "qualityVerdictAvailable"], message: "quality verdict availability requires complete requested evidence with exact repetition coverage and requested-slot math from a full-corpus, full-trigger selection" });
  }
  if (artifact.completeness.complete !== completeEvidence) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completeness", "complete"], message: "quality completeness must exactly match complete requested evidence with exact repetition coverage and requested-slot math" });
  }
}
export const HistoricalQualityArtifactEnvelopeSchema = historicalQualityArtifactEnvelopeBaseSchema
  .superRefine(refineHistoricalQualityArtifactEnvelope);
export type HistoricalQualityArtifactEnvelope = z.infer<typeof HistoricalQualityArtifactEnvelopeSchema>;

/** Selects the strict V2 variant without changing legacy issue paths/messages. */
export const EvalArtifactEnvelopeV2Schema = z.any().transform((value, context) => {
  const schema = isRecord(value) && Object.prototype.hasOwnProperty.call(value, "measurement")
    ? HistoricalQualityArtifactEnvelopeSchema
    : evalArtifactEnvelopeV2LegacySchema;
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) context.addIssue(issue);
  return z.NEVER;
});

/** Current writer schema. Readers explicitly accept both v1 and v2. */
export const EvalArtifactEnvelopeSchema = EvalArtifactEnvelopeV2Schema;

export type EvalArtifactEnvelopeV1<P extends ScorecardLike = ScorecardLike> =
  Omit<z.infer<typeof EvalArtifactEnvelopeV1Schema>, "payload"> & { payload: P };
export type EvalArtifactEnvelopeV2<P extends ScorecardLike = ScorecardLike> =
  Omit<z.infer<typeof EvalArtifactEnvelopeV2Schema>, "payload" | "execution"> & { payload: P; execution: EvalExecutionEvidence };
export type EvalArtifactEnvelope<P extends ScorecardLike = ScorecardLike> = EvalArtifactEnvelopeV1<P> | EvalArtifactEnvelopeV2<P>;

export interface ParseEvalArtifactOptions {
  expectedType: EvalArtifactType;
  expectedHarness?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function looksLikeLegacyScorecard(value: unknown): boolean {
  return isRecord(value) && !("artifactType" in value) && typeof value.generatedAt === "string" && Array.isArray(value.cases);
}

function formatSchemaError(error: z.ZodError): string {
  return error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

export function parseEvalArtifact<P extends ScorecardLike = ScorecardLike>(
  value: unknown,
  options: ParseEvalArtifactOptions,
): EvalArtifactEnvelope<P> {
  if (!isRecord(value)) throw new Error("Eval artifact is not a JSON object; the file is corrupt or truncated");
  if (looksLikeLegacyScorecard(value)) {
    throw new Error("Legacy unversioned eval artifact detected. Convert it explicitly with `bun eval/shared/migrate-legacy-baselines.ts --write` (run from packages/protocol); legacy scorecards are never cast silently.");
  }
  if (value.artifactType !== options.expectedType) {
    throw new Error(`Incompatible artifact type: expected "${options.expectedType}", got "${String(value.artifactType)}"`);
  }

  const schema = value.schemaVersion === EVAL_ARTIFACT_SCHEMA_VERSION_V1
    ? EvalArtifactEnvelopeV1Schema
    : value.schemaVersion === EVAL_ARTIFACT_SCHEMA_VERSION_V2
      ? EvalArtifactEnvelopeV2Schema
      : null;
  if (!schema) {
    throw new Error(`Unsupported eval artifact schema version ${String(value.schemaVersion)}; this build supports versions 1 and 2. Re-generate the artifact or upgrade the eval tooling.`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid eval artifact: ${formatSchemaError(parsed.error)}`);
  if (options.expectedHarness !== undefined && parsed.data.harness !== options.expectedHarness) {
    throw new Error(`Eval artifact belongs to harness "${parsed.data.harness}", expected "${options.expectedHarness}"`);
  }
  return parsed.data as unknown as EvalArtifactEnvelope<P>;
}

export function isEvalArtifactV2<P extends ScorecardLike>(artifact: EvalArtifactEnvelope<P>): artifact is EvalArtifactEnvelopeV2<P> {
  return artifact.schemaVersion === EVAL_ARTIFACT_SCHEMA_VERSION_V2;
}

export function isHistoricalQualityArtifact(artifact: EvalArtifactEnvelope | unknown): artifact is HistoricalQualityArtifactEnvelope {
  return isRecord(artifact)
    && isRecord(artifact.measurement)
    && artifact.measurement.kind === "historical-quality-pilot";
}

/** Returns genuine v2 execution evidence, or null for v1 artifacts. */
export function getExecutionEvidence(artifact: EvalArtifactEnvelope): EvalExecutionEvidence | null {
  return isEvalArtifactV2(artifact) ? artifact.execution : null;
}

function summarizeScoreCompleteness(
  cases: readonly Pick<CaseResultLike, "runs" | "passes" | "flaky">[],
  ruleCount: number,
): EvalCompletenessV1 {
  return {
    caseCount: cases.length,
    ruleCount,
    totalRuns: cases.reduce((sum, entry) => sum + entry.runs, 0),
    totalPasses: cases.reduce((sum, entry) => sum + entry.passes, 0),
    flakyCaseCount: cases.filter((entry) => entry.flaky).length,
  };
}

function summarizeCompletenessV2(
  cases: readonly Pick<CaseResultLike, "runs" | "passes" | "flaky">[],
  ruleCount: number,
  execution: EvalExecutionEvidence,
): EvalCompletenessV2 {
  return { ...summarizeScoreCompleteness(cases, ruleCount), ...summarizeExecution(execution) };
}

export interface EvalRunMeta {
  harness: string;
  harnessVersion: string;
  models: string[];
  runs: number;
  selection: EvalSelection;
  corpusFingerprint: string;
  configFingerprint: string;
  git: EvalGitProvenance;
  startedAt: string;
  completedAt: string;
  /** Genuine v2 attempt/run provenance. Required for live artifact writes. */
  execution: EvalExecutionEvidence;
}

/** Builds and validates a v2 artifact. */
export function buildEvalArtifact<P extends ScorecardLike>(
  artifactType: EvalArtifactType,
  payload: P,
  meta: EvalRunMeta,
  options: { createdAt?: string } = {},
): EvalArtifactEnvelopeV2<P> {
  const envelope = {
    artifactType,
    schemaVersion: EVAL_ARTIFACT_SCHEMA_VERSION_V2,
    harness: meta.harness,
    harnessVersion: meta.harnessVersion,
    source: "run" as const,
    createdAt: options.createdAt ?? new Date().toISOString(),
    startedAt: meta.startedAt,
    completedAt: meta.completedAt,
    models: meta.models,
    runs: meta.runs,
    selection: meta.selection,
    corpusFingerprint: meta.corpusFingerprint,
    configFingerprint: meta.configFingerprint,
    git: meta.git,
    completeness: summarizeCompletenessV2(payload.cases, payload.rules.length, meta.execution),
    execution: meta.execution,
    payload,
  };
  return parseEvalArtifact<P>(envelope, { expectedType: artifactType }) as EvalArtifactEnvelopeV2<P>;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalizeForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForFingerprint);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined && typeof entry !== "function")
      .sort(([left], [right]) => compareAscii(left, right))
      .map(([key, entry]) => [key, canonicalizeForFingerprint(entry)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Fingerprint input contains a non-finite number");
  return value;
}

const SECRETLIKE_KEY = /(api[-_]?key|secret|token|password|credential|authorization)/i;
function assertNoSecretlikeKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretlikeKeys(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SECRETLIKE_KEY.test(key)) throw new Error(`Fingerprint input contains a secret-like key "${path}.${key}"; corpus/config fingerprints must never include API keys, tokens, or raw environment values`);
      assertNoSecretlikeKeys(entry, `${path}.${key}`);
    }
  }
}

export function fingerprintCanonicalJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalizeForFingerprint(value))).digest("hex");
}
export function fingerprintEvalCorpus(cases: readonly unknown[]): string {
  return fingerprintCanonicalJson(cases);
}
export function fingerprintEvalConfig(config: Record<string, unknown>): string {
  assertNoSecretlikeKeys(config, "config");
  return fingerprintCanonicalJson(config);
}

export type GitCommandRunner = (args: string[], cwd: string) => string;
function runGitCommand(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000, maxBuffer: 1024 * 1024 }).trim();
}
export function readEvalGitProvenance(cwd: string, runGit: GitCommandRunner = runGitCommand): EvalGitProvenance {
  try {
    const revision = runGit(["rev-parse", "HEAD"], cwd).trim();
    if (!/^[a-f0-9]{40,64}$/i.test(revision)) throw new Error("git returned a non-revision");
    const dirty = runGit(["status", "--porcelain=v1", "--untracked-files=normal"], cwd).trim().length > 0;
    return { revision: revision.toLowerCase(), dirty };
  } catch {
    return { revision: "unknown", dirty: null };
  }
}

const legacyScorecardSchema = EvalScorecardPayloadV1Schema;

/** Explicitly converts a bare legacy scorecard to v1 without attempt provenance. */
export function migrateLegacyBaseline<P extends ScorecardLike>(
  legacyValue: unknown,
  options: { harness: string; harnessVersion: string; migratedAt?: string },
): EvalArtifactEnvelopeV1<P> {
  if (!looksLikeLegacyScorecard(legacyValue)) throw new Error("Refusing to migrate: input is not a legacy unversioned scorecard");
  const legacyParsed = legacyScorecardSchema.safeParse(legacyValue);
  if (!legacyParsed.success) throw new Error(`Legacy scorecard failed validation; fix or regenerate it instead of migrating: ${formatSchemaError(legacyParsed.error)}`);
  const legacy = legacyValue as P;
  const models = legacy.model.split(" / ").map((model) => model.trim()).filter(Boolean);
  const migratedAt = options.migratedAt ?? legacy.generatedAt;
  const envelope = {
    artifactType: EVAL_BASELINE_ARTIFACT_TYPE,
    schemaVersion: EVAL_ARTIFACT_SCHEMA_VERSION_V1,
    harness: options.harness,
    harnessVersion: options.harnessVersion,
    source: "legacy-migration" as const,
    createdAt: migratedAt,
    startedAt: legacy.generatedAt,
    completedAt: legacy.generatedAt,
    models: [...new Set(models)],
    runs: legacy.runs,
    selection: { fullCorpus: true, filters: {} },
    corpusFingerprint: EVAL_LEGACY_UNAVAILABLE,
    configFingerprint: EVAL_LEGACY_UNAVAILABLE,
    git: { revision: "unknown" as const, dirty: null },
    completeness: summarizeScoreCompleteness(legacy.cases, legacy.rules.length),
    payload: legacy,
  };
  return parseEvalArtifact<P>(envelope, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }) as EvalArtifactEnvelopeV1<P>;
}
