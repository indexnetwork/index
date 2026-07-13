#!/usr/bin/env bun
/**
 * Opportunity-card quality eval harness.
 *
 * Usage (from packages/protocol):
 *   bun run eval:opportunity                          # all cases, 3 runs, judge on, diff baseline
 *   bun run eval:opportunity -- --runs 5              # more runs = less noise
 *   bun run eval:opportunity -- --rule no_leakage      # one rule
 *   bun run eval:opportunity -- --case greeting/        # one case or id prefix
 *   bun run eval:opportunity -- --tier 1               # one tier
 *   bun run eval:opportunity -- --list-cases           # print selected cases and exit
 *   bun run eval:opportunity -- --no-judge             # skip LLM grounding/framing/tone checks
 *   bun run eval:opportunity -- --update-baseline      # overwrite the committed baseline
 *   bun run eval:opportunity -- --report [path]        # write a full run report (incl. generated cards)
 *   bun run eval:opportunity -- --html [path]          # write a standalone HTML scorecard
 *   bun run eval:opportunity -- --rolling-baseline [d] # compare against recent runs (default 7d)
 *   bun run eval:opportunity -- --alpha 0.01           # stricter regression significance threshold
 *   bun run eval:opportunity -- --no-save              # do not auto-save full-corpus run JSON
 *
 * Requires OPENROUTER_API_KEY (loaded via --env-file=../../.env.test in the package script).
 * Exits non-zero when a regression vs the committed baseline is detected.
 */
import path from "path";

import { OpportunityPresenter } from "../../src/opportunity/opportunity.presenter.js";
import { getModelName } from "../../src/shared/agent/model.config.js";
import { assertLLM } from "../../src/shared/agent/tests/llm-assert.js";
import { arg, buildScorecard, computeRollingBaseline, diffBaseline, flagValue, formatConsole, has, readBaseline, writeBaseline, writeRunReport } from "../shared/index.js";
import { CASES } from "./opportunity.cases.js";
import { runCase } from "./opportunity.runner.js";
import { scoreCase, type Judge } from "./opportunity.scorer.js";
import { writeHtmlReport } from "./opportunity.reporter.js";
import { formatCaseList, hasRule, parseTier, selectCases } from "./opportunity.selection.js";
import type { CaseResult, Scorecard } from "./opportunity.types.js";

const DEFAULT_ALPHA = 0.05;
const BASELINE_PATH = path.resolve(import.meta.dir, "baselines/opportunity.baseline.json");
const RUNS_DIR = path.resolve(import.meta.dir, "runs");

function usage(): string {
  return `Opportunity-card quality eval harness

Usage (from packages/protocol):
  bun run eval:opportunity [-- options]

Selection:
  --rule <rule>             Run one rule (viewer_voice|no_leakage|greeting|grounding|introducer_role|tone)
  --case <id-or-prefix>     Run one case or id prefix
  --tier <1|2>              Run one tier
  --list-cases              Print selected cases and exit

Execution:
  --runs <n>                Runs per case (default: 3)
  --no-judge                Skip LLM grounding/framing/tone checks
  --alpha <p>               Regression significance threshold (default: ${DEFAULT_ALPHA})
  --no-save                 Do not auto-save full-corpus run JSON for rolling-baseline fuel

Baselines/reports:
  --update-baseline         Overwrite committed baseline (full corpus only)
  --rolling-baseline [days] Compare against recent run reports (default: 7)
  --report [path]           Write JSON scorecard
  --html [path]             Write standalone HTML scorecard

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
  const noJudge = has("--no-judge");
  const report = has("--report");
  const html = has("--html");
  const noSave = has("--no-save");
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

  const presenter = new OpportunityPresenter();
  const model = getModelName("opportunityPresenter");
  console.log(`Running ${selected.length} case(s) × ${runs} run(s) against ${model}${noJudge ? " (judge off)" : ""}…`);

  const results: CaseResult[] = [];
  for (const c of selected) {
    process.stdout.write(`  ${c.id} … `);
    const details = await runCase(presenter, c, runs);
    const result = await scoreCase(c, details, judge);
    results.push(result);
    console.log(`${result.passes}/${result.runs}${result.flaky ? " (flaky)" : ""}`);
  }

  const scorecard = buildScorecard(results, { model, runs }) as Scorecard;
  const baseline =
    rollingBaselineDays !== null
      ? await computeRollingBaseline(RUNS_DIR, rollingBaselineDays)
      : await readBaseline<Scorecard>(BASELINE_PATH);
  const { regressions, skippedCaseIds } = diffBaseline(scorecard, baseline, alpha);

  if (rollingBaselineDays !== null) {
    console.log(
      baseline
        ? `\nComparing against rolling ${rollingBaselineDays}-day baseline (${baseline.model}, α=${alpha}).`
        : `\nNo rolling ${rollingBaselineDays}-day baseline found; skipping regression comparison.`,
    );
  }

  console.log(formatConsole(scorecard, regressions, skippedCaseIds, { title: "Opportunity Card Quality Scorecard" }));

  if (updateBaseline) {
    await writeBaseline(BASELINE_PATH, scorecard, {
      leanCase: (c) => ({ ...c, runResults: c.runResults.map(({ detail: _detail, ...rest }) => rest) }),
    });
    console.log(`\nBaseline updated at ${BASELINE_PATH}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const autoRunPath = path.resolve(RUNS_DIR, `${stamp}.json`);
  if (fullCorpus && !noSave) {
    await writeRunReport(autoRunPath, scorecard);
  }

  if (report) {
    const reportPath = flagValue("--report") ?? autoRunPath;
    if (reportPath !== autoRunPath) await writeRunReport(reportPath, scorecard);
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
