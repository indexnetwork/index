/**
 * Shared eval-harness library.
 *
 * Harness-agnostic machinery every eval reuses: scorecard aggregation, baseline
 * I/O + regression detection, rolling baselines, the repeat/retry runner,
 * console + HTML reporting, statistics, and argv helpers. Harnesses
 * (`eval/matching`, `eval/premise`, `eval/profile`, …) own only their corpus,
 * scorer, and harness-specific types; everything generic lives here.
 *
 * See `eval/README.md` for the harness anatomy and how to add a new one.
 */

// ─── Types ──────────────────────────────────────────────────────────────────
export type { CaseResultLike, RuleResult, ScorecardLike, Regression } from "./types.js";

// ─── Statistics ───────────────────────────────────────────────────────────
export { binomialCI, binomialPValue, predictivePValue, binomialSignificance, mean, rateWithCI } from "./stats.js";

// ─── Scorecard + baseline ──────────────────────────────────────────────────
export { buildScorecard, meanRate } from "./scorecard.js";
export { diffBaseline, readBaseline, writeBaseline, writeRunReport } from "./baseline.js";
export { computeRollingBaseline } from "./rolling.js";

// ─── Reporting ─────────────────────────────────────────────────────────────
export { formatConsole, type ConsoleOptions } from "./console.js";
export {
  htmlEscape,
  rateClass,
  htmlRateCI,
  renderRuleTable,
  renderScorecardShell,
  renderHumanReport,
  computeVerdict,
  groupStatus,
  SCORECARD_CSS,
  HUMAN_CSS,
  type ShellOptions,
  type ShellSection,
  type HumanReport,
  type HumanGroup,
  type HumanCase,
  type Verdict,
} from "./html.js";

// ─── Execution ─────────────────────────────────────────────────────────────
export { repeatRuns, invokeWithRetry, type RetryOptions } from "./runner.js";
export { arg, has, flagValue } from "./cli.js";
