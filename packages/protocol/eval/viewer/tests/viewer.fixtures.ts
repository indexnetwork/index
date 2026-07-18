import { readFile } from "node:fs/promises";

import { EVAL_RUN_REPORT_ARTIFACT_TYPE, buildEvalArtifact, type EvalArtifactEnvelopeV2 } from "../../shared/artifact.js";
import type { EvalAttemptEvidence, EvalExecutionEvidence, EvalRunEvidence } from "../../shared/runner.js";
import { fingerprintHydeArtifact, parseHydeBlindPublicBatch } from "../../hyde/hyde.artifacts.js";
import { HYDE_BLIND_PUBLIC_BATCH_ARTIFACT_TYPE, HYDE_CANDIDATE_RUBRIC, HYDE_CANDIDATE_TASK_KIND, HYDE_GROUNDING_RUBRIC, HYDE_GROUNDING_TASK_KIND, type HydeBlindPublicBatch } from "../../hyde/hyde.schemas.js";
import { HYDE_ARTIFACT_SCHEMA_VERSION, HYDE_EXPECTED_CANDIDATE_COUNT, HYDE_RUBRIC_VERSION } from "../../hyde/hyde.policy.js";

export const SHARED_HARNESSES = ["matching", "profile", "premise", "opportunity"] as const;
export const V2_ERROR_SENTINEL = "PROVIDER_ERROR_SENTINEL_6f91";

function runId(caseId: string, runIndex: number): string {
  return `${encodeURIComponent(caseId)}::run:${runIndex + 1}`;
}

function attempt(
  caseId: string,
  runIndex: number,
  attemptNumber: number,
  options: {
    startedMs: number;
    durationMs: number;
    outcome: EvalAttemptEvidence["outcome"];
    retryable?: boolean;
    backoffMs?: number;
  },
): EvalAttemptEvidence {
  const id = runId(caseId, runIndex);
  const startedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, options.startedMs)).toISOString();
  const completedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, options.startedMs + options.durationMs)).toISOString();
  return {
    attemptId: `${id}::attempt:${attemptNumber}`,
    runId: id,
    runIndex,
    attemptNumber,
    startedAt,
    completedAt,
    durationMs: options.durationMs,
    outcome: options.outcome,
    ...(options.outcome === "success" ? {} : {
      error: {
        class: `Private${V2_ERROR_SENTINEL}`,
        code: `CODE_${V2_ERROR_SENTINEL}`,
        message: V2_ERROR_SENTINEL,
      },
    }),
    retryable: options.retryable ?? false,
    backoffMs: options.backoffMs ?? 0,
  };
}

function executionRun(
  caseId: string,
  runIndex: number,
  outcome: EvalRunEvidence["outcome"],
  attempts: EvalAttemptEvidence[],
  recovered = false,
): EvalRunEvidence {
  return { runId: runId(caseId, runIndex), caseId, runIndex, outcome, recovered, attempts };
}

/** Valid incomplete v2 report with recovery, failure, timeout, cancellation, and zero-output evidence. */
export function makeAttemptAwareV2RunReport(): EvalArtifactEnvelopeV2 {
  const partialCaseId = "attempt-partial";
  const zeroCaseId = "attempt-zero";
  const partialSuccessId = runId(partialCaseId, 1);
  const execution: EvalExecutionEvidence = {
    policy: "normal",
    runs: [
      executionRun(partialCaseId, 0, "failed", [
        attempt(partialCaseId, 0, 1, { startedMs: 10, durationMs: 5, outcome: "failure" }),
      ]),
      executionRun(partialCaseId, 1, "success", [
        attempt(partialCaseId, 1, 1, { startedMs: 20, durationMs: 5, outcome: "failure", retryable: true, backoffMs: 5 }),
        attempt(partialCaseId, 1, 2, { startedMs: 30, durationMs: 5, outcome: "success" }),
      ], true),
      executionRun(partialCaseId, 2, "cancelled", []),
      executionRun(zeroCaseId, 0, "failed", [
        attempt(zeroCaseId, 0, 1, { startedMs: 40, durationMs: 5, outcome: "timeout" }),
      ]),
      executionRun(zeroCaseId, 1, "cancelled", [
        attempt(zeroCaseId, 1, 1, { startedMs: 50, durationMs: 5, outcome: "cancelled" }),
      ]),
      executionRun(zeroCaseId, 2, "cancelled", []),
    ],
  };
  return buildEvalArtifact(EVAL_RUN_REPORT_ARTIFACT_TYPE, {
    generatedAt: "2026-01-01T00:00:01.000Z",
    model: "test/model",
    runs: 3,
    aggregatePassRate: 1,
    rules: [{ rule: "attempts", caseCount: 2, passRate: 1 }],
    cases: [
      {
        caseId: partialCaseId,
        rule: "attempts",
        runs: 1,
        passes: 1,
        passRate: 1,
        flaky: false,
        scoredRunIds: [partialSuccessId],
        runResults: [{
          runId: partialSuccessId,
          runIndex: 1,
          passed: true,
          assertions: [{ kind: "match", passed: true, detail: V2_ERROR_SENTINEL }],
          rawReasoning: V2_ERROR_SENTINEL,
        }],
      },
      {
        caseId: zeroCaseId,
        rule: "attempts",
        runs: 0,
        passes: 0,
        passRate: 0,
        flaky: false,
        scoredRunIds: [],
        runResults: [],
      },
    ],
  }, {
    harness: "matching",
    harnessVersion: "1",
    models: ["test/model"],
    runs: 3,
    selection: { fullCorpus: true, filters: {} },
    corpusFingerprint: "4".repeat(64),
    configFingerprint: "5".repeat(64),
    git: { revision: "6".repeat(40), dirty: false },
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    execution,
  }, { createdAt: "2026-01-01T00:00:01.000Z" });
}

/** Complete v2 report used to prove comparison with committed v1 baselines. */
export function makeCompleteV2RunReport(): EvalArtifactEnvelopeV2 {
  const caseId = "complete-v2";
  const id = runId(caseId, 0);
  const execution: EvalExecutionEvidence = {
    policy: "strict",
    runs: [executionRun(caseId, 0, "success", [
      attempt(caseId, 0, 1, { startedMs: 10, durationMs: 5, outcome: "success" }),
    ])],
  };
  return buildEvalArtifact(EVAL_RUN_REPORT_ARTIFACT_TYPE, {
    generatedAt: "2026-01-01T00:00:01.000Z",
    model: "test/model",
    runs: 1,
    aggregatePassRate: 1,
    rules: [{ rule: "attempts", caseCount: 1, passRate: 1 }],
    cases: [{
      caseId,
      rule: "attempts",
      runs: 1,
      passes: 1,
      passRate: 1,
      flaky: false,
      scoredRunIds: [id],
      runResults: [{ runId: id, runIndex: 0, passed: true, assertions: [{ kind: "match", passed: true }] }],
    }],
  }, {
    harness: "matching",
    harnessVersion: "1",
    models: ["test/model"],
    runs: 1,
    selection: { fullCorpus: true, filters: {} },
    corpusFingerprint: "7".repeat(64),
    configFingerprint: "8".repeat(64),
    git: { revision: "9".repeat(40), dirty: false },
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    execution,
  }, { createdAt: "2026-01-01T00:00:01.000Z" });
}

/** Reads one committed schema-v1 baseline as plain JSON for viewer tests. */
export async function readCommittedBaseline(harness: typeof SHARED_HARNESSES[number]): Promise<Record<string, unknown>> {
  const path = new URL(`../../${harness}/baselines/${harness}.baseline.json`, import.meta.url);
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

/** Builds the smallest valid deterministic HyDE blind public batch (candidate items only). */
export function makeHydePublicBatch(): HydeBlindPublicBatch {
  const items: HydeBlindPublicBatch["items"] = Array.from(
    { length: HYDE_EXPECTED_CANDIDATE_COUNT },
    (_, index) => ({
      opaqueId: `blind-${index.toString(16).padStart(64, "0")}`,
      taskKind: HYDE_CANDIDATE_TASK_KIND,
      rubric: HYDE_CANDIDATE_RUBRIC,
      sourceText: index === 0 ? "PUBLIC_SOURCE_TEXT" : `Public source ${index}`,
      itemText: index === 0 ? "PUBLIC_ITEM_TEXT" : `Public item ${index}`,
    }),
  );
  items.push({
    opaqueId: `blind-${"f".repeat(64)}`,
    taskKind: HYDE_GROUNDING_TASK_KIND,
    rubric: HYDE_GROUNDING_RUBRIC,
    sourceText: "PUBLIC_GROUNDING_SOURCE_TEXT",
    itemText: "PUBLIC_GROUNDING_ITEM_TEXT",
  });
  const content: Omit<HydeBlindPublicBatch, "batchFingerprint"> = {
    artifactType: HYDE_BLIND_PUBLIC_BATCH_ARTIFACT_TYPE,
    schemaVersion: HYDE_ARTIFACT_SCHEMA_VERSION,
    studyId: "viewer-public-study",
    createdAt: "2026-01-01T00:00:00.000Z",
    rubricVersion: HYDE_RUBRIC_VERSION,
    collectionFingerprint: "1".repeat(64),
    corpusFingerprint: "2".repeat(64),
    configFingerprint: "3".repeat(64),
    items,
  };
  return parseHydeBlindPublicBatch({
    ...content,
    batchFingerprint: fingerprintHydeArtifact(content),
  });
}
