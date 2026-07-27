#!/usr/bin/env bun
/** Live, baseline-governed paired premise versus user-context retrieval eval. */
import path from "path";

import { HydeGenerator } from "../../src/shared/hyde/hyde.generator.js";
import { HydeGraphFactory } from "../../src/shared/hyde/hyde.graph.js";
import type { HydeDocumentState } from "../../src/shared/hyde/hyde.state.js";
import { LensInferrer } from "../../src/shared/hyde/lens.inferrer.js";
import type { HydeCache } from "../../src/shared/interfaces/cache.interface.js";
import type { CreateHydeDocumentData, HydeDocument, HydeGraphDatabase } from "../../src/shared/interfaces/database.interface.js";
import type { EmbeddingGenerator } from "../../src/shared/interfaces/embedder.interface.js";
import { getModelName } from "../../src/shared/agent/model.config.js";
import { assertLLM } from "../../src/shared/agent/tests/llm-assert.js";
import { createHydeEvalEmbedder } from "../hyde/hyde.runner.js";
import { arg, assertEvalWritePlan, attachScoredRunProvenance, baselineUpdateSummaryPath, buildEvalScoringConfigFingerprint, buildExecutionEvidence, buildScorecard, compareAgainstGovernedBaseline, emptyGovernedComparison, fingerprintEvalCorpus, flagValue, formatBaselineUpdateSummary, formatConsole, formatGovernedComparison, governedComparisonExitStatus, governedRegressionCount, has, installEvalProcessCancellation, performGovernedBaselineUpdate, readEvalGitProvenance, runEvalEvidenceFlow, summarizeExecution, writeBaseline, writeRunReport, type EvalEvidencePolicy, type EvalRunMeta, type GovernedComparison } from "../shared/index.js";
import { CASES, validateCorpus } from "./discovery-retrieval.cases.js";
import { DEFAULT_RUNS, HARNESS, HARNESS_VERSION, RETRIEVAL_EVAL_ATTEMPT_TIMEOUT_MS } from "./discovery-retrieval.constants.js";
import { runCase, type EmbedderLike, type HydeLike } from "./discovery-retrieval.runner.js";
import { writeHtmlReport } from "./discovery-retrieval.reporter.js";
import { scoreModeRun, type RetrievalJudge } from "./discovery-retrieval.scorer.js";
import { formatCaseList, hasRule, parseTier, selectCases } from "./discovery-retrieval.selection.js";
import type { CaseResult, DiscoveryRetrievalCase, ModeResult, RetrievalMode, Scorecard } from "./discovery-retrieval.types.js";

const DEFAULT_ALPHA = 0.05;
const BASELINE_PATH = path.resolve(import.meta.dir, "baselines/discovery-retrieval.baseline.json");
const RUNS_DIR = path.resolve(import.meta.dir, "runs");
const MODES: RetrievalMode[] = ["intent_to_premise", "intent_to_context", "context_to_context"];

class EmptyCache implements HydeCache {
  async get<T>(): Promise<T | null> { return null; }
  async set<_T>(): Promise<void> {}
  async delete(): Promise<boolean> { return false; }
  async exists(): Promise<boolean> { return false; }
}

/** Eval-only persistence seam: live HyDE generation, no database reads or writes. */
function memoryDatabase(): HydeGraphDatabase {
  return {
    async getHydeDocument(): Promise<HydeDocument | null> { return null; },
    async getHydeDocumentsForSource(): Promise<HydeDocument[]> { return []; },
    async saveHydeDocument(data: CreateHydeDocumentData): Promise<HydeDocument> {
      return {
        id: "discovery-retrieval-eval-only",
        sourceType: data.sourceType,
        sourceId: data.sourceId ?? null,
        sourceText: data.sourceText ?? null,
        strategy: data.strategy,
        targetCorpus: data.targetCorpus,
        hydeText: data.hydeText,
        hydeEmbedding: data.hydeEmbedding,
        context: data.context ?? null,
        createdAt: new Date(0),
        expiresAt: data.expiresAt ?? null,
      };
    },
    async getIntent() { return null; },
  };
}

class LiveEmbedder implements EmbedderLike {
  constructor(private readonly delegate: EmbeddingGenerator) {}

  async generate(texts: string[]): Promise<number[][]> {
    const output = await this.delegate.generate(texts);
    if (!Array.isArray(output) || !Array.isArray(output[0])) {
      throw new Error("Embedding provider did not return a vector for every input text");
    }
    return output as number[][];
  }
}

/** Adapts real protocol lens inference + HyDE generation graph to the runner seam. */
class LiveHyde implements HydeLike {
  private readonly graph;

  constructor(embedder: EmbeddingGenerator) {
    this.graph = new HydeGraphFactory(
      memoryDatabase(),
      embedder,
      new EmptyCache(),
      new LensInferrer(),
      new HydeGenerator(),
    ).createGraph();
  }

  async invoke(input: { sourceType: "query"; sourceText: string; forceRegenerate: boolean }): Promise<{ hydeEmbeddings: Record<string, number[]> }> {
    const result = await this.graph.invoke({ ...input, maxLenses: 3 });
    const documents = result.hydeDocuments as Record<string, HydeDocumentState>;
    return {
      hydeEmbeddings: Object.fromEntries(
        Object.entries(documents).map(([lens, document]) => [lens, document.hydeEmbedding]),
      ),
    };
  }
}

function usage(): string {
  return `Discovery retrieval eval

Usage (from packages/protocol):
  bun run eval:discovery-retrieval [-- options]

Selection:
  --rule <rule>             Run one rule
  --case <id-or-prefix>     Run one case or id prefix
  --tier <1>                Run Tier 1 cases
  --list-cases              Print selected cases and exit

Execution:
  --runs <n>                Runs per case/mode (default: ${DEFAULT_RUNS})
  --attempt-timeout-ms <n>  Deadline for each provider attempt (default: ${RETRIEVAL_EVAL_ATTEMPT_TIMEOUT_MS})
  --strict-evidence         Exit 3 when any requested mode/run is incomplete
  --no-judge                Skip only the LLM relationship judge
  --no-save                 Do not auto-save a full-corpus run report

Baselines/reports:
  --update-baseline         Replace baseline after a complete clean full-corpus run
  --reason <text>           Required audit reason for --update-baseline
  --force                   Allow replacement of existing outputs
  --rolling-baseline [days] Compare against recent run reports (default: 7)
  --alpha <p>               Regression significance threshold (default: ${DEFAULT_ALPHA})
  --report [path]           Write JSON scorecard
  --html [path]             Write standalone HTML scorecard
`;
}

function judge(noJudge: boolean): RetrievalJudge {
  if (noJudge) return async () => true;
  return async (c, _mode, topK) => {
    const criteria = `Evaluate this discovery-retrieval result. The rule is ${c.rule}.
Required relationship: ${c.expect.reasoningCriteria}
Expected IDs: ${c.expect.expectedUserIds.join(", ")}
Excluded IDs: ${c.expect.excludedUserIds.join(", ") || "(none)"}
Top results: ${topK.map((result, index) => `${index + 1}. ${result.userId}: ${result.text}`).join("\n")}
Does this ranking satisfy the required relationship without treating network membership or unsupported facts as person evidence? Reply only PASS or FAIL.`;
    try {
      await assertLLM(topK.map(({ userId, text }) => ({ userId, text })), criteria);
      return true;
    } catch {
      return false;
    }
  };
}

async function scoreCase(
  c: DiscoveryRetrievalCase,
  batches: Awaited<ReturnType<typeof runCase>>["batches"],
  evaluator: RetrievalJudge,
): Promise<CaseResult> {
  const modeResults: ModeResult[] = [];
  for (const mode of MODES) {
    const batch = batches[mode];
    const scoredRuns = await Promise.all(batch.outputs.map((output) => scoreModeRun(c, mode, output.ranking, evaluator)));
    const withProvenance = attachScoredRunProvenance({ runResults: scoredRuns }, batch.successfulRuns).runResults;
    const passes = withProvenance.filter((run) => run.passed).length;
    modeResults.push({
      mode,
      runs: withProvenance.length,
      passes,
      passRate: withProvenance.length === 0 ? 0 : passes / withProvenance.length,
      flaky: passes > 0 && passes < withProvenance.length,
      runResults: withProvenance,
    });
  }
  const runs = modeResults.reduce((total, result) => total + result.runs, 0);
  const passes = modeResults.reduce((total, result) => total + result.passes, 0);
  return {
    caseId: c.id,
    rule: c.rule,
    runs,
    passes,
    passRate: runs === 0 ? 0 : passes / runs,
    flaky: passes > 0 && passes < runs,
    modeResults,
  };
}

function leanCase(c: CaseResult): CaseResult {
  return {
    ...c,
    modeResults: c.modeResults.map((mode) => ({
      ...mode,
      runResults: mode.runResults.map(({ detail, ...run }) => ({
        ...run,
        detail: {
          ...detail,
          ranking: [],
        },
      })),
    })),
  };
}

async function main(): Promise<void> {
  if (has("--help") || has("-h")) {
    console.log(usage());
    return;
  }
  validateCorpus(CASES);
  const runs = Number(arg("--runs") ?? DEFAULT_RUNS);
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer (got "${arg("--runs")}")`);
  const ruleFilter = arg("--rule");
  if (ruleFilter && !hasRule(CASES, ruleFilter)) throw new Error(`No cases match --rule ${ruleFilter}`);
  const tierFilter = parseTier(arg("--tier"));
  const caseFilter = arg("--case");
  const selected = selectCases(CASES, { rule: ruleFilter, caseId: caseFilter, tier: tierFilter });
  if (has("--list-cases")) {
    console.log(formatCaseList(selected));
    return;
  }
  if (selected.length === 0) throw new Error("No cases match selected filters");

  const updateBaseline = has("--update-baseline");
  const noJudge = has("--no-judge");
  const noSave = has("--no-save");
  const force = has("--force");
  const report = has("--report");
  const html = has("--html");
  const fullCorpus = !ruleFilter && !caseFilter && tierFilter === undefined;
  const updateReason = flagValue("--reason");
  if (updateBaseline && !fullCorpus) throw new Error("--update-baseline requires a full-corpus run (remove --rule/--case/--tier filters)");
  if (updateBaseline && !updateReason) throw new Error('--update-baseline requires --reason "<operator justification>"');
  if (updateBaseline) {
    const git = readEvalGitProvenance(import.meta.dir);
    if (git.revision === "unknown" || git.dirty !== false) throw new Error("--update-baseline requires a clean, identifiable Git revision");
  }
  const evidencePolicy: EvalEvidencePolicy = has("--strict-evidence") || updateBaseline ? "strict" : "normal";
  const attemptTimeoutMs = Number(arg("--attempt-timeout-ms") ?? RETRIEVAL_EVAL_ATTEMPT_TIMEOUT_MS);
  if (!Number.isFinite(attemptTimeoutMs) || attemptTimeoutMs <= 0) throw new Error(`--attempt-timeout-ms must be a positive number (got "${arg("--attempt-timeout-ms")}")`);
  const alpha = Number(arg("--alpha") ?? DEFAULT_ALPHA);
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) throw new Error(`--alpha must be a number between 0 and 1 (got "${arg("--alpha")}")`);
  const rollingBaseline = has("--rolling-baseline");
  const rollingBaselineDays = rollingBaseline ? Number(flagValue("--rolling-baseline") ?? 7) : null;
  if (rollingBaselineDays !== null && (!Number.isFinite(rollingBaselineDays) || rollingBaselineDays <= 0)) throw new Error("--rolling-baseline must be a positive number of days");

  const explicitReportPath = report ? flagValue("--report") : undefined;
  const explicitHtmlPath = html ? flagValue("--html") : undefined;
  await assertEvalWritePlan({
    inputs: [BASELINE_PATH],
    outputs: [
      ...(updateBaseline ? [{ path: BASELINE_PATH, updatesInput: true }, { path: baselineUpdateSummaryPath(BASELINE_PATH), updatesInput: true }] : []),
      ...(explicitReportPath ? [explicitReportPath] : []),
      ...(explicitHtmlPath ? [explicitHtmlPath] : []),
    ],
    force,
  });

  const rawEmbedder = createHydeEvalEmbedder();
  const deps = { embedder: new LiveEmbedder(rawEmbedder), hyde: new LiveHyde(rawEmbedder) };
  const model = `${getModelName("hydeGenerator")} / ${process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-large"}`;
  console.log(`Running ${selected.length} case(s) × ${runs} run(s) × ${MODES.length} modes against ${model}${noJudge ? " (judge off)" : ""}…`);
  const startedAt = new Date().toISOString();
  const results: CaseResult[] = [];
  const batches: Array<Awaited<ReturnType<typeof runCase>>> = [];
  const cancellation = installEvalProcessCancellation();
  try {
    for (const c of selected) {
      process.stdout.write(`  ${c.id} … `);
      const batch = await runCase(deps, c, runs, { policy: evidencePolicy, attemptTimeoutMs, signal: cancellation.signal });
      batches.push(batch);
      const result = await scoreCase(c, batch.batches, judge(noJudge));
      results.push(result);
      console.log(`${result.passes}/${result.runs}${result.flaky ? " (flaky)" : ""}`);
    }
  } finally {
    cancellation.dispose();
  }

  const execution = buildExecutionEvidence(batches.flatMap((batch) => MODES.map((mode) => batch.batches[mode])), evidencePolicy);
  const executionSummary = summarizeExecution(execution);
  const scorecard = buildScorecard(results, { model, runs }) as Scorecard;
  const filters: Record<string, string> = {};
  if (ruleFilter) filters.rule = ruleFilter;
  if (caseFilter) filters.case = caseFilter;
  if (tierFilter !== undefined) filters.tier = String(tierFilter);
  const meta: EvalRunMeta = {
    harness: HARNESS,
    harnessVersion: HARNESS_VERSION,
    models: [getModelName("hydeGenerator"), process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-large"],
    runs,
    selection: { fullCorpus, filters },
    corpusFingerprint: fingerprintEvalCorpus(selected),
    configFingerprint: buildEvalScoringConfigFingerprint({ judge: !noJudge }),
    git: readEvalGitProvenance(import.meta.dir),
    startedAt,
    completedAt: new Date().toISOString(),
    execution,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const autoRunPath = path.resolve(RUNS_DIR, `${stamp}.json`);
  const autoSaved = fullCorpus && !noSave;
  const flow = await runEvalEvidenceFlow<GovernedComparison>({
    evidencePolicy,
    execution: executionSummary,
    noComparison: emptyGovernedComparison(),
    compareBaseline: () => compareAgainstGovernedBaseline({
      scorecard,
      alpha,
      evidencePolicy,
      meta,
      execution: executionSummary,
      baselinePath: BASELINE_PATH,
      rolling: rollingBaselineDays === null ? undefined : { runsDir: RUNS_DIR, days: rollingBaselineDays },
      forUpdate: updateBaseline,
    }),
    regressionCount: governedRegressionCount,
    comparisonStatus: (comparison) => governedComparisonExitStatus(comparison, { forUpdate: updateBaseline }),
    updateBaseline: updateBaseline ? async (comparison) => {
      const summary = await performGovernedBaselineUpdate({
        baselinePath: BASELINE_PATH,
        scorecard,
        meta,
        execution: executionSummary,
        reason: updateReason,
        force,
        comparison,
        writeBaselineArtifact: () => writeBaseline(BASELINE_PATH, scorecard, { meta, force, leanCase }),
      });
      console.log(formatBaselineUpdateSummary(summary));
      console.log(`\nBaseline updated at ${BASELINE_PATH}; update summary at ${baselineUpdateSummaryPath(BASELINE_PATH)}`);
    } : undefined,
    persistDiagnosticReport: async () => {
      if (autoSaved) await writeRunReport(autoRunPath, scorecard, { meta });
      if (report) {
        const reportPath = flagValue("--report") ?? autoRunPath;
        if (!(autoSaved && reportPath === autoRunPath)) await writeRunReport(reportPath, scorecard, { meta, force });
        console.log(`\nRun report written to ${reportPath}`);
      }
    },
  });
  const { baseline, regressions, skippedCaseIds } = flow.comparison;
  if (!flow.compared) console.log("\nSkipping baseline comparison: incomplete execution evidence.");
  else if (rollingBaselineDays !== null) console.log(baseline ? `\nComparing against rolling ${rollingBaselineDays}-day baseline (${baseline.model}, α=${alpha}).` : `\nNo rolling ${rollingBaselineDays}-day baseline found; skipping regression comparison.`);
  const governanceReport = flow.compared ? formatGovernedComparison(flow.comparison, { fullCorpus }) : null;
  if (governanceReport) console.log(`\n${governanceReport}`);
  console.log(formatConsole(scorecard, regressions, skippedCaseIds, { title: "Discovery Retrieval Scorecard", execution }));
  if (!executionSummary.complete) console.error(`\nIncomplete execution evidence: ${executionSummary.completedRuns}/${executionSummary.requestedRuns} requested runs completed.`);
  if (html) {
    const htmlPath = flagValue("--html") ?? path.resolve(RUNS_DIR, `${stamp}.html`);
    await writeHtmlReport(htmlPath, scorecard, regressions, CASES, execution);
    console.log(`\nHTML report written to ${htmlPath}`);
  }
  process.exitCode = flow.exitCode;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
