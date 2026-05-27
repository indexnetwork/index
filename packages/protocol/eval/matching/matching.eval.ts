#!/usr/bin/env bun
/**
 * Matching quality eval harness.
 *
 * Usage (from packages/protocol):
 *   bun run eval:matching                       # all cases, 3 runs, judge on, diff baseline
 *   bun run eval:matching -- --runs 1           # faster, noisier
 *   bun run eval:matching -- --rule is_a_identity
 *   bun run eval:matching -- --no-judge         # skip assertLLM checks (free)
 *   bun run eval:matching -- --update-baseline  # overwrite the committed baseline
 *
 * Requires OPENROUTER_API_KEY (loaded via --env-file=.env.test in the package script).
 * Exits non-zero when a regression vs the committed baseline is detected.
 */
import path from "path";
import { OpportunityEvaluator } from "../../src/opportunity/opportunity.evaluator.js";
import { getModelName } from "../../src/shared/agent/model.config.js";
import { assertLLM } from "../../src/shared/agent/tests/llm-assert.js";
import { CASES } from "./matching.cases.js";
import { runCase } from "./matching.runner.js";
import { scoreCase, type Judge } from "./matching.scorer.js";
import {
  buildScorecard,
  diffBaseline,
  formatConsole,
  readBaseline,
  writeBaseline,
} from "./matching.reporter.js";
import type { CaseResult } from "./matching.types.js";

const REGRESSION_THRESHOLD = 0.34;
const BASELINE_PATH = path.resolve(import.meta.dir, "baselines/matching.baseline.json");

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const runs = Number(arg("--runs") ?? 3);
  const ruleFilter = arg("--rule");
  const updateBaseline = has("--update-baseline");
  const noJudge = has("--no-judge");

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

  const selected = ruleFilter ? CASES.filter((c) => c.rule === ruleFilter) : CASES;
  if (selected.length === 0) {
    console.error(`No cases match --rule ${ruleFilter}`);
    process.exit(2);
  }

  const evaluator = new OpportunityEvaluator();
  const model = getModelName("opportunityEvaluator");
  console.log(`Running ${selected.length} case(s) × ${runs} run(s) against ${model}${noJudge ? " (judge off)" : ""}…`);

  const results: CaseResult[] = [];
  for (const c of selected) {
    process.stdout.write(`  ${c.id} … `);
    const runOutputs = await runCase(evaluator, c, runs);
    const result = await scoreCase(c, runOutputs, judge);
    results.push(result);
    console.log(`${result.passes}/${result.runs}${result.flaky ? " (flaky)" : ""}`);
  }

  const scorecard = buildScorecard(results, { model, runs });
  const baseline = ruleFilter ? null : await readBaseline(BASELINE_PATH);
  const { regressions } = diffBaseline(scorecard, baseline, REGRESSION_THRESHOLD);

  console.log(formatConsole(scorecard, regressions));

  if (updateBaseline) {
    await writeBaseline(BASELINE_PATH, scorecard);
    console.log(`\nBaseline updated at ${BASELINE_PATH}`);
  }

  process.exit(regressions.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
