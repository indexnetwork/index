import { rateWithCI } from "./stats.js";
import type { Regression, ScorecardLike } from "./types.js";

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const fmtPValue = (p: number): string => (p < 0.001 ? "p<0.001" : `p=${p.toFixed(3)}`);

export interface ConsoleOptions {
  /** Scorecard heading, e.g. "Matching Quality Scorecard". */
  title?: string;
  /** Column width for the rule/group label. */
  ruleWidth?: number;
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
  // Per-run observations drive the CI; case-level pass-rates drive the aggregate display.
  lines.push(`aggregate pass-rate: ${rateWithCI(sc.cases.reduce((s, c) => s + c.passes, 0), sc.cases.length * sc.runs)}\n`);
  lines.push(`Per rule:`);
  for (const r of [...sc.rules].sort((a, b) => a.passRate - b.passRate)) {
    const n = r.caseCount * sc.runs;
    const passes = Math.round(r.passRate * n);
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
