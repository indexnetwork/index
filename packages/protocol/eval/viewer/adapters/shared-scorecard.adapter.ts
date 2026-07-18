import { EVAL_ARTIFACT_SCHEMA_VERSION_V1, EVAL_ARTIFACT_SCHEMA_VERSION_V2, EVAL_BASELINE_ARTIFACT_TYPE, EVAL_RUN_REPORT_ARTIFACT_TYPE, getExecutionEvidence, isEvalArtifactV2, parseEvalArtifact, type EvalArtifactEnvelope, type EvalArtifactEnvelopeV2, type EvalArtifactType } from "../../shared/artifact.js";
import type { EvalRunEvidence } from "../../shared/runner.js";
import type { ScorecardLike } from "../../shared/types.js";
import { isViewerRecord } from "../viewer.redaction.js";
import type { ViewerAdapter, ViewerAdapterContext, ViewerCheck, ViewerDocument, ViewerExecutionRunDiagnostic, ViewerField, ViewerItem, ViewerRunDiagnostic } from "../viewer.types.js";

const SHARED_HARNESS_VERSION = "1";
const SHARED_V1_TELEMETRY_NOTICE =
  "Schema v1 records scored run outcomes only. Execution retry/attempt telemetry was not recorded.";
const SHARED_V2_TELEMETRY_NOTICE =
  "Schema v2 structural execution attempts are shown. Provider error details and model output/reasoning remain redacted.";

const SHARED_SENSITIVE_FIELDS = [
  "detail",
  "candidateId",
  "candidates",
  "reasoning",
  "rawReasoning",
  "piiHits",
  "input",
  "profileContext",
  "expect",
  "apiKey",
  "authorization",
  "headers",
  "embedding",
  "embeddings",
  "secret",
  "secrets",
  "error",
] as const;

/** Shared harnesses with explicit public presentation policies. */
export type SharedHarness = "matching" | "profile" | "premise" | "opportunity";

/** Shared artifact schema versions explicitly supported by the viewer. */
export type SharedArtifactSchemaVersion =
  | typeof EVAL_ARTIFACT_SCHEMA_VERSION_V1
  | typeof EVAL_ARTIFACT_SCHEMA_VERSION_V2;

const ALLOWED_SELECTION_FILTERS = {
  matching: new Set(["case", "rule", "tier"]),
  profile: new Set(["case", "rule", "tier"]),
  premise: new Set(["case", "component", "rule", "tier"]),
  opportunity: new Set(["case", "rule", "tier"]),
} as const satisfies Record<SharedHarness, ReadonlySet<string>>;

const ASSERTION_KINDS = {
  matching: new Set(["match", "band", "role", "reasoning"]),
  profile: new Set([
    "name",
    "location",
    "privacy",
    "skills",
    "interests",
    "coverage_skills",
    "coverage_interests",
    "apply",
    "preserve",
    "reasoning",
  ]),
  premise: new Set([
    "count",
    "empty",
    "tier",
    "first_person",
    "coverage",
    "exclusion",
    "speech_act",
    "authority",
    "sincerity",
    "clarity",
    "entropy",
    "reasoning",
  ]),
  opportunity: new Set([
    "non_empty",
    "voice",
    "uuid",
    "label",
    "greeting_format",
    "greeting_length",
    "grounding",
    "framing",
    "tone",
  ]),
} as const satisfies Record<SharedHarness, ReadonlySet<string>>;

interface SharedCaseProjection {
  caseId: string;
  rule: string;
  runs: number;
  passes: number;
  passRate: number;
  flaky: boolean;
  runResults: ViewerRunDiagnostic[];
  executionRuns: ViewerExecutionRunDiagnostic[];
  executionComplete: boolean | null;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function field(label: string, value: string | number | boolean | null): ViewerField {
  return { label, value: value === null ? "unknown" : String(value) };
}

function parseChecks(value: unknown, harness: SharedHarness): { passed: boolean; checks: ViewerCheck[] } {
  if (!isViewerRecord(value) || typeof value.passed !== "boolean" || !Array.isArray(value.assertions)) {
    throw new Error("Shared case contains a malformed scored run result");
  }
  const checks = value.assertions.map((assertion): ViewerCheck => {
    if (
      !isViewerRecord(assertion)
      || typeof assertion.kind !== "string"
      || !ASSERTION_KINDS[harness].has(assertion.kind)
      || typeof assertion.passed !== "boolean"
    ) {
      throw new Error("Shared case contains an unsupported assertion result");
    }
    return { kind: assertion.kind, passed: assertion.passed };
  });
  if (value.passed !== checks.every((check) => check.passed)) {
    throw new Error("Shared case scored-run status is inconsistent with its assertions");
  }
  return { passed: value.passed, checks };
}

function assertPassCount(diagnostics: readonly ViewerRunDiagnostic[], expectedPasses: number): void {
  if (diagnostics.filter((diagnostic) => diagnostic.passed).length !== expectedPasses) {
    throw new Error("Shared case pass count is inconsistent with its scored run results");
  }
}

function parseV1RunResults(
  value: unknown,
  harness: SharedHarness,
  expectedRuns: number,
  expectedPasses: number,
): ViewerRunDiagnostic[] {
  if (!Array.isArray(value) || value.length !== expectedRuns) {
    throw new Error("Shared case runResults do not match the declared run count");
  }
  const diagnostics = value.map((runResult, index): ViewerRunDiagnostic => ({
    run: index + 1,
    ...parseChecks(runResult, harness),
  }));
  assertPassCount(diagnostics, expectedPasses);
  return diagnostics;
}

function projectExecutionRun(run: EvalRunEvidence): ViewerExecutionRunDiagnostic {
  return {
    runId: run.runId,
    run: run.runIndex + 1,
    outcome: run.outcome,
    recovered: run.recovered,
    attempts: run.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      durationMs: attempt.durationMs,
      outcome: attempt.outcome,
      retryable: attempt.retryable,
      backoffMs: attempt.backoffMs,
    })),
  };
}

function parseV2RunResults(
  value: unknown,
  harness: SharedHarness,
  scoredRunIds: readonly string[],
  expectedPasses: number,
  executionRuns: readonly EvalRunEvidence[],
): ViewerRunDiagnostic[] {
  if (!Array.isArray(value) || value.length !== scoredRunIds.length) {
    throw new Error("Shared case runResults do not match its scored run IDs");
  }

  const executionById = new Map(executionRuns.map((run) => [run.runId, run]));
  const scoredIdSet = new Set(scoredRunIds);
  if (executionById.size !== executionRuns.length || scoredIdSet.size !== scoredRunIds.length) {
    throw new Error("Shared case contains duplicate run provenance");
  }

  const diagnosticsById = new Map<string, ViewerRunDiagnostic>();
  for (const runResult of value) {
    if (
      !isViewerRecord(runResult)
      || typeof runResult.runId !== "string"
      || !Number.isInteger(runResult.runIndex)
      || (runResult.runIndex as number) < 0
    ) {
      throw new Error("Shared case scored run is missing v2 run provenance");
    }
    const runIndex = runResult.runIndex as number;
    const executionRun = executionById.get(runResult.runId);
    if (
      !scoredIdSet.has(runResult.runId)
      || !executionRun
      || executionRun.outcome !== "success"
      || executionRun.runIndex !== runIndex
      || diagnosticsById.has(runResult.runId)
    ) {
      throw new Error("Shared case scored run provenance does not match execution evidence");
    }
    diagnosticsById.set(runResult.runId, {
      run: runIndex + 1,
      ...parseChecks(runResult, harness),
    });
  }

  const diagnostics = scoredRunIds.map((runId) => {
    const diagnostic = diagnosticsById.get(runId);
    if (!diagnostic) throw new Error("Shared case is missing a scored run result");
    return diagnostic;
  });
  assertPassCount(diagnostics, expectedPasses);
  return diagnostics;
}

function projectV1Cases(envelope: EvalArtifactEnvelope, harness: SharedHarness): SharedCaseProjection[] {
  if (isEvalArtifactV2(envelope) || getExecutionEvidence(envelope) !== null) {
    throw new Error("Schema-v1 adapter received execution evidence");
  }
  return envelope.payload.cases.map((caseResult) => {
    if (caseResult.runs !== envelope.payload.runs) {
      throw new Error("Shared case run count is inconsistent with its scorecard");
    }
    const sourceCase = caseResult as unknown as Record<string, unknown>;
    return {
      caseId: caseResult.caseId,
      rule: caseResult.rule,
      runs: caseResult.runs,
      passes: caseResult.passes,
      passRate: caseResult.passRate,
      flaky: caseResult.flaky,
      runResults: parseV1RunResults(sourceCase.runResults, harness, caseResult.runs, caseResult.passes),
      executionRuns: [],
      executionComplete: null,
    };
  });
}

function projectV2Cases(envelope: EvalArtifactEnvelopeV2<ScorecardLike>, harness: SharedHarness): SharedCaseProjection[] {
  const execution = getExecutionEvidence(envelope);
  if (!execution) throw new Error("Schema-v2 artifact is missing execution evidence");

  return envelope.payload.cases.map((caseResult) => {
    const sourceCase = caseResult as unknown as Record<string, unknown>;
    const scoredRunIds = caseResult.scoredRunIds;
    if (!Array.isArray(scoredRunIds) || scoredRunIds.some((runId) => typeof runId !== "string")) {
      throw new Error("Shared schema-v2 case is missing scored run IDs");
    }
    const caseExecution = execution.runs
      .filter((run) => run.caseId === caseResult.caseId)
      .sort((left, right) => left.runIndex - right.runIndex);
    if (caseExecution.length !== envelope.payload.runs) {
      throw new Error("Shared case execution evidence does not cover every requested run");
    }
    return {
      caseId: caseResult.caseId,
      rule: caseResult.rule,
      runs: caseResult.runs,
      passes: caseResult.passes,
      passRate: caseResult.passRate,
      flaky: caseResult.flaky,
      runResults: parseV2RunResults(
        sourceCase.runResults,
        harness,
        scoredRunIds,
        caseResult.passes,
        caseExecution,
      ),
      executionRuns: caseExecution.map(projectExecutionRun),
      executionComplete: caseExecution.every((run) => run.outcome === "success"),
    };
  });
}

function scoredStateForCase(caseResult: SharedCaseProjection): Exclude<ViewerItem["state"], "incomplete"> {
  if (caseResult.runs === 0) return "unjudged";
  if (caseResult.flaky) return "flaky";
  return caseResult.passes === caseResult.runs ? "pass" : "fail";
}

function stateForCase(caseResult: SharedCaseProjection): ViewerItem["state"] {
  const scoredState = scoredStateForCase(caseResult);
  return caseResult.executionComplete === false && scoredState !== "unjudged"
    ? "incomplete"
    : scoredState;
}

function titleFor(harness: SharedHarness, artifactType: EvalArtifactType): string {
  const harnessTitle = `${harness[0]?.toUpperCase() ?? ""}${harness.slice(1)}`;
  return `${harnessTitle} ${artifactType === EVAL_BASELINE_ARTIFACT_TYPE ? "Baseline" : "Run Report"}`;
}

function selectionFields(harness: SharedHarness, filters: Record<string, string>): ViewerField[] {
  return Object.entries(filters)
    .sort(([left], [right]) => compareAscii(left, right))
    .map(([key, value]) => {
      if (!ALLOWED_SELECTION_FILTERS[harness].has(key)) {
        throw new Error("Shared artifact contains an unsupported selection filter");
      }
      return field(`Selection filter: ${key}`, value);
    });
}

function projectedRulePassRate(
  envelope: EvalArtifactEnvelope,
  ruleId: string,
  reportedPassRate: number,
): number | null {
  if (!isEvalArtifactV2(envelope)) return reportedPassRate;
  return envelope.payload.cases.some((entry) => entry.rule === ruleId && entry.runs > 0)
    ? reportedPassRate
    : null;
}

function adaptSharedArtifact(
  value: unknown,
  context: ViewerAdapterContext,
  harness: SharedHarness,
  artifactType: EvalArtifactType,
  schemaVersion: SharedArtifactSchemaVersion,
  adapterId: string,
): ViewerDocument {
  const envelope = parseEvalArtifact<ScorecardLike>(value, { expectedType: artifactType, expectedHarness: harness });
  if (envelope.schemaVersion !== schemaVersion || envelope.harnessVersion !== SHARED_HARNESS_VERSION) {
    throw new Error("Unsupported shared artifact identity");
  }

  const v2 = isEvalArtifactV2(envelope);
  const cases = (v2 ? projectV2Cases(envelope, harness) : projectV1Cases(envelope, harness))
    .sort((left, right) => compareAscii(left.caseId, right.caseId));
  const rules = [...envelope.payload.rules]
    .sort((left, right) => compareAscii(left.rule, right.rule))
    .map((rule) => ({
      id: rule.rule,
      itemCount: rule.caseCount,
      passRate: projectedRulePassRate(envelope, rule.rule, rule.passRate),
    }));

  const completeness = [
    field("Full corpus", envelope.selection.fullCorpus),
    ...selectionFields(harness, envelope.selection.filters),
    field("Case count", envelope.completeness.caseCount),
    field("Rule count", envelope.completeness.ruleCount),
    field("Total scored runs", envelope.completeness.totalRuns),
    field("Total passes", envelope.completeness.totalPasses),
    field("Flaky cases", envelope.completeness.flakyCaseCount),
  ];
  if (v2) {
    const execution = getExecutionEvidence(envelope);
    if (!execution) throw new Error("Schema-v2 artifact is missing execution evidence");
    completeness.push(
      field("Requested runs", envelope.completeness.requestedRuns),
      field("Completed runs", envelope.completeness.completedRuns),
      field("Failed runs", envelope.completeness.failedRuns),
      field("Recovered runs", envelope.completeness.recoveredRuns),
      field("Total attempts", envelope.completeness.totalAttempts),
      field("Complete", envelope.completeness.complete),
      field("Execution policy", execution.policy),
    );
  }

  return {
    viewerSchemaVersion: 1,
    kind: v2 ? "shared-scorecard-v2" : "shared-scorecard-v1",
    adapterId,
    title: titleFor(harness, artifactType),
    source: { sha256: context.source.sha256, byteLength: context.source.byteLength },
    artifact: [
      field("Artifact type", envelope.artifactType),
      field("Schema version", envelope.schemaVersion),
      field("Harness", envelope.harness),
      field("Harness version", envelope.harnessVersion),
      field("Source", envelope.source),
    ],
    provenance: [
      field("Created at", envelope.createdAt),
      field("Started at", envelope.startedAt),
      field("Completed at", envelope.completedAt),
      field("Models", envelope.models.join(", ")),
      field("Corpus fingerprint", envelope.corpusFingerprint),
      field("Config fingerprint", envelope.configFingerprint),
      field("Git revision", envelope.git.revision),
      field("Git dirty", envelope.git.dirty),
    ],
    completeness,
    summary: [
      field("Generated at", envelope.payload.generatedAt),
      field("Model", envelope.payload.model),
      field("Configured runs per case", envelope.payload.runs),
    ],
    aggregatePassRate: v2 && envelope.completeness.totalRuns === 0
      ? null
      : envelope.payload.aggregatePassRate,
    sharedComparison: {
      artifactKind: artifactType === EVAL_BASELINE_ARTIFACT_TYPE ? "baseline" : "run-report",
      artifactSchemaVersion: envelope.schemaVersion,
      harness,
      harnessVersion: envelope.harnessVersion,
      fullCorpus: envelope.selection.fullCorpus,
      corpusFingerprint: envelope.corpusFingerprint,
      executionComplete: v2 ? envelope.completeness.complete : null,
    },
    rules,
    items: cases.map((caseResult): ViewerItem => ({
      id: caseResult.caseId,
      group: caseResult.rule,
      state: stateForCase(caseResult),
      runs: caseResult.runs,
      passes: caseResult.passes,
      ...(caseResult.runs === 0 ? {} : { passRate: caseResult.passRate }),
      fields: [
        field("Flaky", caseResult.flaky),
        ...(caseResult.executionComplete === false
          ? [field("Scored output state", scoredStateForCase(caseResult))]
          : []),
      ],
      diagnostics: caseResult.runResults,
      diagnosticsAvailable: caseResult.runResults.length > 0,
      executionRuns: caseResult.executionRuns,
      executionAvailable: v2,
    })),
    telemetryNotice: v2 ? SHARED_V2_TELEMETRY_NOTICE : SHARED_V1_TELEMETRY_NOTICE,
  };
}

/**
 * Creates one exact shared scorecard adapter.
 *
 * @param harness - Allowlisted shared eval harness.
 * @param artifactType - Baseline or run-report envelope type.
 * @param schemaVersion - Exact artifact schema accepted by the adapter.
 * @returns An adapter whose id and document kind identify the same schema version.
 */
export function createSharedScorecardAdapter(
  harness: SharedHarness,
  artifactType: EvalArtifactType,
  schemaVersion: SharedArtifactSchemaVersion = EVAL_ARTIFACT_SCHEMA_VERSION_V1,
): ViewerAdapter {
  const suffix = artifactType === EVAL_BASELINE_ARTIFACT_TYPE ? "baseline" : "run-report";
  const id = `shared-${harness}-${suffix}-v${schemaVersion}`;
  return {
    id,
    artifactType,
    harness,
    schemaVersion,
    harnessVersion: SHARED_HARNESS_VERSION,
    sensitiveFields: SHARED_SENSITIVE_FIELDS,
    adapt(value, context) {
      return adaptSharedArtifact(value, context, harness, artifactType, schemaVersion, id);
    },
  };
}

/** Exact v1 and v2 adapters for every supported shared harness artifact. */
export const SHARED_SCORECARD_ADAPTERS: readonly ViewerAdapter[] = (
  ["matching", "profile", "premise", "opportunity"] as const
).flatMap((harness) => [
  createSharedScorecardAdapter(harness, EVAL_BASELINE_ARTIFACT_TYPE, EVAL_ARTIFACT_SCHEMA_VERSION_V1),
  createSharedScorecardAdapter(harness, EVAL_RUN_REPORT_ARTIFACT_TYPE, EVAL_ARTIFACT_SCHEMA_VERSION_V1),
  createSharedScorecardAdapter(harness, EVAL_BASELINE_ARTIFACT_TYPE, EVAL_ARTIFACT_SCHEMA_VERSION_V2),
  createSharedScorecardAdapter(harness, EVAL_RUN_REPORT_ARTIFACT_TYPE, EVAL_ARTIFACT_SCHEMA_VERSION_V2),
]);
