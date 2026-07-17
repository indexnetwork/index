#!/usr/bin/env bun
/**
 * Matching quality eval harness.
 *
 * Usage (from packages/protocol):
 *   bun run eval:matching                       # all cases, 3 runs, judge on, diff baseline
 *   bun run eval:matching -- --runs 1           # faster, noisier
 *   bun run eval:matching -- --rule is_a_identity
 *   bun run eval:matching -- --case location/known-mismatch-penalized
 *   bun run eval:matching -- --tier 4
 *   bun run eval:matching -- --list-cases       # list selected cases and exit
 *   bun run eval:matching -- --no-judge         # skip assertLLM checks (free)
 *   bun run eval:matching -- --update-baseline --force  # replace the committed baseline
 *   bun run eval:matching -- --report           # write a full run report (incl. evaluator reasoning)
 *   bun run eval:matching -- --report path.json # ...to a specific path
 *   bun run eval:matching -- --html             # write a standalone HTML scorecard
 *   bun run eval:matching -- --html path.html   # ...to a specific path
 *   bun run eval:matching -- --rolling-baseline # compare against recent runs (default 7d)
 *   bun run eval:matching -- --rolling-baseline 14 # compare against a 14-day window
 *   bun run eval:matching -- --alpha 0.01      # stricter regression significance threshold
 *
 * Requires OPENROUTER_API_KEY (loaded via --env-file=../../.env.test in the package script).
 * Exits non-zero when a regression vs the committed baseline is detected.
 */
import path from "path";
import { OpportunityEvaluator } from "../../src/opportunity/opportunity.evaluator.js";
import { getModelName } from "../../src/shared/agent/model.config.js";
import { assertLLM } from "../../src/shared/agent/tests/llm-assert.js";
import { CASES } from "./matching.cases.js";
import { runCase } from "./matching.runner.js";
import { scoreCase, type Judge } from "./matching.scorer.js";
import { formatCaseList, hasRule, parseTier, selectCases } from "./matching.selection.js";
import { assertEvalWritePlan, fingerprintEvalConfig, fingerprintEvalCorpus, readEvalGitProvenance, type EvalRunMeta } from "../shared/index.js";
import { buildScorecard, computeRollingBaseline, diffBaseline, formatConsole, readBaseline, writeBaseline, writeHtmlReport, writeRunReport } from "./matching.reporter.js";
import type { CaseResult } from "./matching.types.js";

const HARNESS = "matching";
const HARNESS_VERSION = "1";
const DEFAULT_ALPHA = 0.05;
const BASELINE_PATH = path.resolve(import.meta.dir, "baselines/matching.baseline.json");
const RUNS_DIR = path.resolve(import.meta.dir, "runs");

function usage(): string {
  return `Matching quality eval harness

Usage (from packages/protocol):
  bun run eval:matching [-- options]

Selection:
  --rule <rule>             Run one rule
  --case <id-or-prefix>     Run one case or id prefix
  --tier <1|2|3|4>          Run one tier
  --list-cases              Print selected cases and exit

Execution:
  --runs <n>                Runs per case (default: 3)
  --no-judge                Skip LLM reasoning checks
  --alpha <p>               Regression significance threshold (default: ${DEFAULT_ALPHA})
  --no-save                 Do not auto-save full-corpus run JSON for rolling baseline fuel

Baselines/reports:
  --update-baseline         Overwrite committed baseline (full corpus only; needs --force if one exists)
  --force                   Consent to overwrite existing baseline/report/HTML outputs
  --rolling-baseline [days] Compare against recent run reports (default: 7)
  --report [path]           Write JSON scorecard
  --html [path]             Write standalone HTML scorecard

Other:
  --help, -h                Show this help
`;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}
/** A flag's value only when it's a real value, not the next flag (e.g. `--report --runs`). */
function flagValue(flag: string): string | undefined {
  const v = arg(flag);
  return v && !v.startsWith("--") ? v : undefined;
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
  let tierFilter: 1 | 2 | 3 | 4 | undefined;
  try {
    tierFilter = parseTier(arg("--tier"));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const listCases = has("--list-cases");
  const updateBaseline = has("--update-baseline");
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
  if (updateBaseline && !fullCorpus) {
    console.error(`--update-baseline requires a full-corpus run (remove --rule/--case/--tier filters)`);
    process.exit(2);
  }

  // Assert every declared output before running anything: no output may
  // clobber an input, and existing destinations need explicit --force.
  const explicitReportPath = report ? flagValue("--report") : undefined;
  const explicitHtmlPath = html ? flagValue("--html") : undefined;
  try {
    await assertEvalWritePlan({
      inputs: [BASELINE_PATH],
      outputs: [
        ...(updateBaseline ? [{ path: BASELINE_PATH, updatesInput: true }] : []),
        ...(explicitReportPath ? [explicitReportPath] : []),
        ...(explicitHtmlPath ? [explicitHtmlPath] : []),
      ],
      force,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const evaluator = new OpportunityEvaluator();
  const model = getModelName("opportunityEvaluator");
  console.log(`Running ${selected.length} case(s) × ${runs} run(s) against ${model}${noJudge ? " (judge off)" : ""}…`);

  const startedAt = new Date().toISOString();
  const results: CaseResult[] = [];
  for (const c of selected) {
    process.stdout.write(`  ${c.id} … `);
    const runOutputs = await runCase(evaluator, c, runs);
    const result = await scoreCase(c, runOutputs, judge);
    results.push(result);
    console.log(`${result.passes}/${result.runs}${result.flaky ? " (flaky)" : ""}`);
  }

  const scorecard = buildScorecard(results, { model, runs });
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
    configFingerprint: fingerprintEvalConfig({ runs, alpha, judge: !noJudge, filters, models }),
    git: readEvalGitProvenance(import.meta.dir),
    startedAt,
    completedAt,
  };
  const baseline = rollingBaselineDays !== null
    ? await computeRollingBaseline(RUNS_DIR, rollingBaselineDays)
    : await readBaseline(BASELINE_PATH);
  const { regressions, skippedCaseIds } = diffBaseline(scorecard, baseline, alpha);

  if (rollingBaselineDays !== null) {
    console.log(
      baseline
        ? `\nComparing against rolling ${rollingBaselineDays}-day baseline (${baseline.model}, α=${alpha}).`
        : `\nNo rolling ${rollingBaselineDays}-day baseline found; skipping regression comparison.`,
    );
  }

  console.log(formatConsole(scorecard, regressions, skippedCaseIds));

  if (updateBaseline) {
    await writeBaseline(BASELINE_PATH, scorecard, { meta, force });
    console.log(`\nBaseline updated at ${BASELINE_PATH}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const autoRunPath = path.resolve(RUNS_DIR, `${stamp}.json`);
  const autoSaved = fullCorpus && !noSave;
  if (autoSaved) {
    await writeRunReport(autoRunPath, scorecard, { meta });
  }

  if (report) {
    const reportPath = flagValue("--report") ?? autoRunPath;
    if (!(autoSaved && reportPath === autoRunPath)) await writeRunReport(reportPath, scorecard, { meta, force });
    console.log(`\nRun report written to ${reportPath}`);
  }

  if (html) {
    const htmlPath = flagValue("--html") ?? path.resolve(RUNS_DIR, `${stamp}.html`);
    await writeHtmlReport(htmlPath, scorecard, regressions, CASES);
    console.log(`\nHTML report written to ${htmlPath}`);
  }

  process.exit(regressions.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
