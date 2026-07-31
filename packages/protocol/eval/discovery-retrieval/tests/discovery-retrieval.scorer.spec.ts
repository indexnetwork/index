import { describe, expect, it } from "bun:test";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EVAL_RUN_REPORT_ARTIFACT_TYPE, buildScorecard, executeRuns, readEvalArtifact, writeRunReport } from "../../shared/index.js";
import { CASES } from "../discovery-retrieval.cases.js";
import { scoreCase, scoreModeRun } from "../discovery-retrieval.scorer.js";
import { buildDiscoveryRetrievalExecutionEvidence, projectCaseExecutionEvidence, type CaseRunBatches, type ModeRunOutput } from "../discovery-retrieval.runner.js";
import type { DiscoveryRetrievalCase, RetrievalMode } from "../discovery-retrieval.types.js";

const MODES: RetrievalMode[] = ["intent_to_premise", "intent_to_context", "context_to_context"];

async function successfulModeBatches(c: DiscoveryRetrievalCase): Promise<CaseRunBatches["batches"]> {
  const batchEntries = await Promise.all(MODES.map(async (mode) => [
    mode,
    await executeRuns<ModeRunOutput>(
      async () => ({
        mode,
        ranking: [{ userId: c.expect.expectedUserIds[0]!, score: 1, text: "expected" }],
      }),
      1,
      { caseId: `${c.id}/${mode}`, attemptTimeoutMs: 100, maxAttempts: 1, retryDelayMs: 0 },
    ),
  ] as const));
  return Object.fromEntries(batchEntries) as CaseRunBatches["batches"];
}

describe("scoreModeRun", () => {
  it("passes a full candidate ranking when an excluded candidate is outside topK", async () => {
    const c = CASES[0]!;
    const [expected, excluded, neutral] = c.candidates;
    const result = await scoreModeRun(
      c,
      "intent_to_context",
      [
        { userId: expected!.userId, score: 0.91, text: expected!.userContext },
        { userId: neutral!.userId, score: 0.72, text: neutral!.userContext },
        { userId: excluded!.userId, score: 0.68, text: excluded!.userContext },
      ],
      async () => true,
    );

    expect(result.passed).toBe(true);
    expect(result.assertions.some((a) => a.kind === "recall_at_k" && a.passed)).toBe(true);
    expect(result.detail.excludedInTopK).toEqual([]);
  });

  it("fails when an excluded candidate appears in topK", async () => {
    const c = CASES.find((x) => x.expect.excludedUserIds.length > 0)!;
    const result = await scoreModeRun(c, "intent_to_context", [{ userId: c.expect.excludedUserIds[0]!, score: 0.99, text: "excluded" }], async () => true);
    expect(result.passed).toBe(false);
    expect(result.assertions.some((a) => a.kind === "excluded_top_k" && !a.passed)).toBe(true);
  });

  it("aggregates successful run IDs from all retrieval modes in execution order", async () => {
    const c = CASES[0]!;
    const batches = await successfulModeBatches(c);
    const result = await scoreCase(c, batches, async () => true);

    const execution = projectCaseExecutionEvidence(c.id, batches);
    expect(result.scoredRunIds).toEqual(MODES.flatMap((mode) => execution[mode]
      .filter((run) => run.outcome === "success")
      .map((run) => run.runId)));
  });

  it("persists the three-mode case result with aggregate execution evidence", async () => {
    const c = CASES[0]!;
    const batches = await successfulModeBatches(c);
    const result = await scoreCase(c, batches, async () => true);
    const execution = buildDiscoveryRetrievalExecutionEvidence([{ caseId: c.id, batches }]);
    const completedAt = new Date().toISOString();
    const reportPath = join(tmpdir(), `discovery-retrieval-${Date.now()}-${Math.random()}.json`);

    try {
      await writeRunReport(reportPath, buildScorecard([result], { model: "test/model", runs: MODES.length }), {
        meta: {
          harness: "discovery-retrieval-test",
          harnessVersion: "1",
          models: ["test/model"],
          runs: MODES.length,
          selection: { fullCorpus: false, filters: { case: c.id } },
          corpusFingerprint: "a".repeat(64),
          configFingerprint: "b".repeat(64),
          git: { revision: "c".repeat(40), dirty: false },
          startedAt: new Date(Date.parse(completedAt) - 60_000).toISOString(),
          completedAt,
          execution,
        },
      });

      const artifact = await readEvalArtifact(reportPath, { expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE });
      expect(artifact?.payload.cases[0]?.scoredRunIds).toEqual(result.scoredRunIds);
      if (!artifact || artifact.schemaVersion !== 2) throw new Error("expected a v2 discovery retrieval report");
      expect(artifact.execution.runs.map((run) => run.caseId)).toEqual([c.id, c.id, c.id]);
    } finally {
      await unlink(reportPath).catch(() => undefined);
    }
  });
});
