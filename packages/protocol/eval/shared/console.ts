import { summarizeExecution, type EvalExecutionEvidence } from "./runner.js";
import { rateWithCI } from "./stats.js";
import type { Regression, ScorecardLike } from "./types.js";

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const fmtPValue = (p: number): string => (p < 0.001 ? "p<0.001" : `p=${p.toFixed(3)}`);

export interface ConsoleOptions {
  /** Scorecard heading, e.g. "Matching Quality Scorecard". */
  title?: string;
  /** Column width for the rule/group label. */
  ruleWidth?: number;
  /** Genuine v2 attempt evidence for completeness/retry reporting. */
  execution?: EvalExecutionEvidence;
}

/**
 * Renders a human-readable scorecard for the console: aggregate pass-rate with
 * 95% CI, per-rule rollup (worst first), flaky cases, regressions, and any cases
 * absent from the baseline.
 *
 * @param sc - The scorecard to format.
 * @param regressions - Regressions vs the baseline, surfaced with p-values.
 * @param skippedCaseIds - Current case ids not present in the baseline.
 * @param opts - Title and formatting options.
 */
export function formatConsole(
  sc: ScorecardLike,
  regressions: Regression[],
  skippedCaseIds: string[] = [],
  opts: ConsoleOptions = {},
): string {
  const title = opts.title ?? "Quality Scorecard";
  const ruleWidth = opts.ruleWidth ?? 20;
  const lines: string[] = [];
  lines.push(`\n=== ${title} ===`);
  lines.push(`model=${sc.model}  runs=${sc.runs}  cases=${sc.cases.length}`);
  const totalScoredRuns = sc.cases.reduce((sum, entry) => sum + entry.runs, 0);
  lines.push(`aggregate pass-rate: ${rateWithCI(sc.cases.reduce((s, c) => s + c.passes, 0), totalScoredRuns)}\n`);
  if (opts.execution) {
    const summary = summarizeExecution(opts.execution);
    lines.push(
      `execution (${opts.execution.policy}): requested=${summary.requestedRuns} completed=${summary.completedRuns} `
        + `failed=${summary.failedRuns} recovered=${summary.recoveredRuns} attempts=${summary.totalAttempts}`,
    );
    const noteworthy = opts.execution.runs.filter((run) => run.outcome !== "success" || run.recovered);
    for (const run of noteworthy.slice(0, 20)) {
      const last = run.attempts[run.attempts.length - 1];
      lines.push(
        `  ${run.runId}  ${run.outcome}${run.recovered ? " (recovered)" : ""}  attempts=${run.attempts.length}`
          + `${last?.error ? `  ${last.error.class}: ${last.error.message}` : ""}`,
      );
    }
    if (noteworthy.length > 20) lines.push(`  …and ${noteworthy.length - 20} more noteworthy run(s)`);
    lines.push("");
  }
  lines.push(`Per rule:`);
  for (const r of [...sc.rules].sort((a, b) => a.passRate - b.passRate)) {
    const members = sc.cases.filter((entry) => entry.rule === r.rule);
    const n = members.reduce((sum, entry) => sum + entry.runs, 0);
    const passes = members.reduce((sum, entry) => sum + entry.passes, 0);
    lines.push(`  ${r.rule.padEnd(ruleWidth)} ${rateWithCI(passes, n)}  (${r.caseCount} case(s))`);
  }
  const flaky = sc.cases.filter((c) => c.flaky);
  if (flaky.length > 0) {
    lines.push(`\nFlaky (passed some runs, failed others):`);
    for (const c of flaky) lines.push(`  ${c.caseId}  ${c.passes}/${c.runs}`);
  }
  if (regressions.length > 0) {
    lines.push(`\n⚠ Regressions vs baseline:`);
    for (const r of regressions) {
      lines.push(`  [${r.kind}] ${r.id}: ${pct(r.before)} → ${pct(r.after)} (${fmtPValue(r.pValue)})`);
    }
  }
  if (skippedCaseIds.length > 0) {
    lines.push(`\nℹ ${skippedCaseIds.length} case(s) absent from baseline; not regression-checked:`);
    for (const id of skippedCaseIds.slice(0, 10)) lines.push(`  ${id}`);
    if (skippedCaseIds.length > 10) lines.push(`  …and ${skippedCaseIds.length - 10} more`);
  }
  return lines.join("\n");
}
