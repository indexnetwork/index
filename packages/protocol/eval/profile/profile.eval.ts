#!/usr/bin/env bun
/**
 * Profile quality eval harness.
 *
 * Usage (from packages/protocol):
 *   bun run eval:profile                          # all cases, 3 runs, judge on, diff baseline
 *   bun run eval:profile -- --runs 5              # more runs = less noise
 *   bun run eval:profile -- --rule privacy        # one rule
 *   bun run eval:profile -- --case extraction/     # one case or id prefix
 *   bun run eval:profile -- --tier 1               # one tier
 *   bun run eval:profile -- --list-cases           # print selected cases and exit
 *   bun run eval:profile -- --no-judge             # skip LLM coverage/apply/preserve checks
 *   bun run eval:profile -- --update-baseline --reason "why" --force # replace the committed baseline
 *   bun run eval:profile -- --report [path]        # write a full run report (incl. generated profiles)
 *   bun run eval:profile -- --html [path]          # write a standalone HTML scorecard
 *   bun run eval:profile -- --rolling-baseline [d] # compare against recent runs (default 7d)
 *   bun run eval:profile -- --alpha 0.01           # stricter regression significance threshold
 *   bun run eval:profile -- --no-save              # do not auto-save full-corpus run JSON
 *
 * Requires OPENROUTER_API_KEY (loaded via --env-file=../../.env.test in the package script).
 * Exits non-zero when a regression vs the committed baseline is detected.
 */
import path from "path";

import { EnrichmentGenerator } from "../../src/enrichment/enrichment.generator.js";
import { getModelName } from "../../src/shared/agent/model.config.js";
import { assertLLM } from "../../src/shared/agent/tests/llm-assert.js";
import { arg, assertEvalWritePlan, attachScoredRunProvenance, baselineUpdateSummaryPath, buildEvalScoringConfigFingerprint, buildExecutionEvidence, buildScorecard, compareAgainstGovernedBaseline, emptyGovernedComparison, fingerprintEvalCorpus, flagValue, formatBaselineUpdateSummary, formatConsole, formatGovernedComparison, governedComparisonExitStatus, governedRegressionCount, has, installEvalProcessCancellation, performGovernedBaselineUpdate, readEvalGitProvenance, runEvalEvidenceFlow, summarizeExecution, writeBaseline, writeRunReport, type EvalEvidencePolicy, type EvalRunMeta, type GovernedComparison } from "../shared/index.js";
import { CASES } from "./profile.cases.js";
import { PROFILE_EVAL_ATTEMPT_TIMEOUT_MS } from "./profile.constants.js";
import { runCase } from "./profile.runner.js";
import { scoreCase, type Judge } from "./profile.scorer.js";
import { writeHtmlReport } from "./profile.reporter.js";
import { formatCaseList, hasRule, parseTier, selectCases } from "./profile.selection.js";
import type { CaseResult, Scorecard } from "./profile.types.js";

const HARNESS = "profile";
const HARNESS_VERSION = "1";
const DEFAULT_ALPHA = 0.05;
const BASELINE_PATH = path.resolve(import.meta.dir, "baselines/profile.baseline.json");
const RUNS_DIR = path.resolve(import.meta.dir, "runs");

function usage(): string {
  return `Profile quality eval harness

Usage (from packages/protocol):
  bun run eval:profile [-- options]

Selection:
  --rule <rule>             Run one rule (extraction|location|privacy|skills_interests|update)
  --case <id-or-prefix>     Run one case or id prefix
  --tier <1|2>              Run one tier
  --list-cases              Print selected cases and exit

Execution:
  --runs <n>                Runs per case (default: 3)
  --attempt-timeout-ms <n>  Deadline for each invocation attempt (default: ${PROFILE_EVAL_ATTEMPT_TIMEOUT_MS})
  --strict-evidence         Exit 3 when any requested run is incomplete
  --no-judge                Skip LLM coverage/apply/preserve/reasoning checks
  --alpha <p>               Regression significance threshold (default: ${DEFAULT_ALPHA})
  --no-save                 Do not auto-save full-corpus run JSON for rolling-baseline fuel

Baselines/reports:
  --update-baseline         Overwrite committed baseline (complete full-corpus run at a clean Git revision only; needs --force if one exists)
  --reason <text>           Operator justification recorded in the baseline update summary (required with --update-baseline)
  --force                   Consent to overwrite existing baseline/report/HTML outputs
  --rolling-baseline [days] Compare against recent run reports (default: 7)
  --report [path]           Write JSON scorecard
  --html [path]             Write standalone HTML scorecard

Exit codes:
  0 pass · 1 measured regression · 2 execution/artifact error · 3 insufficient strict evidence

Other:
  --help, -h                Show this help
`;
}

async function main(): Promise<void> {
  if (has("--help") || has("-h")) {
    console.log(usage());
    process.exit(0);
  }

  const runs = Number(arg("--runs") ?? 3);
  if (!Number.isInteger(runs) || runs < 1) {
    console.error(`--runs must be a positive integer (got "${arg("--runs")}")`);
    process.exit(2);
  }
  const ruleFilter = arg("--rule");
  if (ruleFilter && !hasRule(CASES, ruleFilter)) {
    console.error(`No cases match --rule ${ruleFilter}`);
    process.exit(2);
  }
  const caseFilter = arg("--case");
  let tierFilter: 1 | 2 | undefined;
  try {
    tierFilter = parseTier(arg("--tier"));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const listCases = has("--list-cases");
  const updateBaseline = has("--update-baseline");
  const evidencePolicy: EvalEvidencePolicy = has("--strict-evidence") || updateBaseline ? "strict" : "normal";
  const attemptTimeoutMs = Number(arg("--attempt-timeout-ms") ?? PROFILE_EVAL_ATTEMPT_TIMEOUT_MS);
  if (!Number.isFinite(attemptTimeoutMs) || attemptTimeoutMs <= 0) {
    console.error(`--attempt-timeout-ms must be a positive number (got "${arg("--attempt-timeout-ms")}")`);
    process.exit(2);
  }
  const noJudge = has("--no-judge");
  const report = has("--report");
  const html = has("--html");
  const noSave = has("--no-save");
  const force = has("--force");
  const alpha = Number(arg("--alpha") ?? DEFAULT_ALPHA);
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    console.error(`--alpha must be a number between 0 and 1 (got "${arg("--alpha")}")`);
    process.exit(2);
  }
  const rollingBaseline = has("--rolling-baseline");
  const rollingBaselineDays = rollingBaseline ? Number(flagValue("--rolling-baseline") ?? 7) : null;
  if (rollingBaselineDays !== null && (!Number.isFinite(rollingBaselineDays) || rollingBaselineDays <= 0)) {
    console.error(`--rolling-baseline must be a positive number of days (got "${flagValue("--rolling-baseline")}")`);
    process.exit(2);
  }

  const judge: Judge = noJudge
    ? async () => true
    : async (output, criteria) => {
        try {
          await assertLLM(output, criteria);
          return true;
        } catch {
          return false;
        }
      };

  const selected = selectCases(CASES, { rule: ruleFilter, caseId: caseFilter, tier: tierFilter });
  const fullCorpus = !ruleFilter && !caseFilter && tierFilter === undefined;
  if (listCases) {
    console.log(formatCaseList(selected));
    process.exit(0);
  }
  if (selected.length === 0) {
    console.error(`No cases match selected filters`);
    process.exit(2);
  }
  const updateReason = flagValue("--reason");
  if (updateBaseline && !fullCorpus) {
    console.error(`--update-baseline requires a full-corpus run (remove --rule/--case/--tier filters)`);
    process.exit(2);
  }
  if (updateBaseline && !updateReason) {
    console.error(`--update-baseline requires --reason "<operator justification>" for the auditable update summary`);
    process.exit(2);
  }
  if (updateBaseline) {
    // Fail fast before any provider spend: baseline updates require an
    // identifiable clean Git revision (re-verified at write time).
    const git = readEvalGitProvenance(import.meta.dir);
    if (git.revision === "unknown" || git.dirty !== false) {
      console.error(`--update-baseline requires a clean, identifiable Git revision; commit or stash local changes first`);
      process.exit(2);
    }
  }

  // Assert every declared output before running anything: no output may
  // clobber an input, and existing destinations need explicit --force.
  const explicitReportPath = report ? flagValue("--report") : undefined;
  const explicitHtmlPath = html ? flagValue("--html") : undefined;
  try {
    await assertEvalWritePlan({
      inputs: [BASELINE_PATH],
      outputs: [
        ...(updateBaseline ? [{ path: BASELINE_PATH, updatesInput: true }, { path: baselineUpdateSummaryPath(BASELINE_PATH), updatesInput: true }] : []),
        ...(explicitReportPath ? [explicitReportPath] : []),
        ...(explicitHtmlPath ? [explicitHtmlPath] : []),
      ],
      force,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const generator = new EnrichmentGenerator();
  const model = getModelName("profileGenerator");
  console.log(`Running ${selected.length} case(s) × ${runs} run(s) against ${model}${noJudge ? " (judge off)" : ""}…`);

  const startedAt = new Date().toISOString();
  const results: CaseResult[] = [];
  const batches: Array<Awaited<ReturnType<typeof runCase>>> = [];
  const cancellation = installEvalProcessCancellation();
  for (const c of selected) {
    process.stdout.write(`  ${c.id} … `);
    const batch = await runCase(generator, c, runs, { policy: evidencePolicy, attemptTimeoutMs, signal: cancellation.signal });
    batches.push(batch);
    const scored = await scoreCase(c, batch.outputs, judge);
    const result = attachScoredRunProvenance(scored, batch.successfulRuns) as CaseResult;
    results.push(result);
    console.log(`${result.passes}/${result.runs}${result.flaky ? " (flaky)" : ""}`);
  }

  const execution = buildExecutionEvidence(batches, evidencePolicy);
  const executionSummary = summarizeExecution(execution);
  const scorecard = buildScorecard(results, { model, runs }) as Scorecard;
  const completedAt = new Date().toISOString();
  const filters: Record<string, string> = {};
  if (ruleFilter) filters.rule = ruleFilter;
  if (caseFilter) filters.case = caseFilter;
  if (tierFilter !== undefined) filters.tier = String(tierFilter);
  const models = [...new Set([model])];
  const meta: EvalRunMeta = {
    harness: HARNESS,
    harnessVersion: HARNESS_VERSION,
    models,
    runs,
    selection: { fullCorpus, filters },
    corpusFingerprint: fingerprintEvalCorpus(selected),
    configFingerprint: buildEvalScoringConfigFingerprint({ judge: !noJudge }),
    git: readEvalGitProvenance(import.meta.dir),
    startedAt,
    completedAt,
    execution,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const autoRunPath = path.resolve(RUNS_DIR, `${stamp}.json`);
  const autoSaved = fullCorpus && !noSave;
  const flow = await runEvalEvidenceFlow<GovernedComparison>({
    evidencePolicy,
    execution: executionSummary,
    noComparison: emptyGovernedComparison(),
    compareBaseline: () =>
      compareAgainstGovernedBaseline({
        scorecard,
        alpha,
        evidencePolicy,
        meta,
        execution: executionSummary,
        baselinePath: BASELINE_PATH,
        rolling: rollingBaselineDays !== null ? { runsDir: RUNS_DIR, days: rollingBaselineDays } : undefined,
        forUpdate: updateBaseline,
      }),
    regressionCount: governedRegressionCount,
    comparisonStatus: (comparison) => governedComparisonExitStatus(comparison, { forUpdate: updateBaseline }),
    updateBaseline: updateBaseline
      ? async (comparison) => {
          const summary = await performGovernedBaselineUpdate({
            baselinePath: BASELINE_PATH,
            scorecard,
            meta,
            execution: executionSummary,
            reason: updateReason,
            force,
            comparison,
            writeBaselineArtifact: () =>
              writeBaseline(BASELINE_PATH, scorecard, {
                meta,
                force,
                leanCase: (c) => ({ ...c, runResults: c.runResults.map(({ detail: _detail, ...rest }) => rest) }),
              }),
          });
          console.log(formatBaselineUpdateSummary(summary));
          console.log(`\nBaseline updated at ${BASELINE_PATH}; update summary at ${baselineUpdateSummaryPath(BASELINE_PATH)}`);
        }
      : undefined,
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

  if (!flow.compared) {
    console.log("\nSkipping baseline comparison: incomplete execution evidence.");
  } else if (rollingBaselineDays !== null) {
    console.log(
      baseline
        ? `\nComparing against rolling ${rollingBaselineDays}-day baseline (${baseline.model}, α=${alpha}).`
        : `\nNo rolling ${rollingBaselineDays}-day baseline found; skipping regression comparison.`,
    );
  }

  const governanceReport = flow.compared ? formatGovernedComparison(flow.comparison, { fullCorpus }) : null;
  if (governanceReport) console.log(`\n${governanceReport}`);

  console.log(formatConsole(scorecard, regressions, skippedCaseIds, { title: "Profile Quality Scorecard", execution }));
  if (!executionSummary.complete) {
    console.error(`\nIncomplete execution evidence: ${executionSummary.completedRuns}/${executionSummary.requestedRuns} requested runs completed.`);
  }

  if (html) {
    const htmlPath = flagValue("--html") ?? path.resolve(RUNS_DIR, `${stamp}.html`);
    await writeHtmlReport(htmlPath, scorecard, regressions, CASES, execution);
    console.log(`\nHTML report written to ${htmlPath}`);
  }

  cancellation.dispose();
  process.exit(flow.exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
