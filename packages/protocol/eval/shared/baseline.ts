import { predictivePValue } from "./stats.js";
import type { CaseResultLike, Regression, ScorecardLike } from "./types.js";

/**
 * Compares a current scorecard against a baseline and returns any regressions.
 *
 * A regression is a case or rule where the current pass count is significantly
 * lower than expected from the baseline evidence (one-sided beta-binomial
 * posterior-predictive test at significance level alpha). New cases (absent from
 * the baseline) are never regressions; they are reported in `skippedCaseIds`.
 *
 * @param current - The scorecard produced by the current run.
 * @param baseline - The previously saved baseline scorecard, or `null` if none exists.
 * @param alpha - Significance level for the one-sided test.
 * @returns Detected regressions plus the ids of current cases absent from the baseline.
 */
export function diffBaseline(
  current: ScorecardLike,
  baseline: ScorecardLike | null,
  alpha = 0.05,
): { regressions: Regression[]; skippedCaseIds: string[] } {
  if (!baseline) return { regressions: [], skippedCaseIds: [] };
  const regressions: Regression[] = [];
  const skippedCaseIds: string[] = [];

  const baseCases = new Map(baseline.cases.map((c) => [c.caseId, c]));
  for (const c of current.cases) {
    const base = baseCases.get(c.caseId);
    if (base === undefined) {
      skippedCaseIds.push(c.caseId);
      continue;
    }
    const pValue = predictivePValue(c.passes, c.runs, base.passes, base.runs);
    if (pValue <= alpha) {
      regressions.push({ id: c.caseId, kind: "case", before: base.passRate, after: c.passRate, pValue });
    }
  }

  const baseByRule = new Map<string, { passes: number; runs: number }>();
  for (const c of baseline.cases) {
    const acc = baseByRule.get(c.rule) ?? { passes: 0, runs: 0 };
    acc.passes += c.passes;
    acc.runs += c.runs;
    baseByRule.set(c.rule, acc);
  }
  const comparableByRule = new Map<string, { passes: number; runs: number }>();
  for (const c of current.cases) {
    if (!baseCases.has(c.caseId)) continue;
    const acc = comparableByRule.get(c.rule) ?? { passes: 0, runs: 0 };
    acc.passes += c.passes;
    acc.runs += c.runs;
    comparableByRule.set(c.rule, acc);
  }
  for (const [rule, acc] of comparableByRule.entries()) {
    const base = baseByRule.get(rule);
    if (base === undefined || acc.runs === 0 || base.runs === 0) continue;
    const before = base.passes / base.runs;
    const after = acc.passes / acc.runs;
    const pValue = predictivePValue(acc.passes, acc.runs, base.passes, base.runs);
    if (pValue <= alpha) {
      regressions.push({ id: rule, kind: "rule", before, after, pValue });
    }
  }

  return { regressions, skippedCaseIds };
}

/**
 * Reads a baseline scorecard from a JSON file on disk.
 *
 * @param path - Absolute or relative path to the baseline JSON file.
 * @returns The parsed scorecard, or `null` if the file does not exist.
 */
export async function readBaseline<T extends ScorecardLike>(path: string): Promise<T | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return (await file.json()) as T;
}

/**
 * Writes a scorecard to disk as a formatted JSON baseline file.
 *
 * The committed baseline is a diff target, so verbose per-run detail (model
 * reasoning, candidate outcomes) is best stripped to keep `--update-baseline`
 * diffs lean. Pass `leanCase` to transform each case before writing (e.g. drop
 * per-run candidate payloads); the full detail lives in the run report instead
 * (see {@link writeRunReport}).
 *
 * @param path - Absolute or relative path to write to (created or overwritten).
 * @param sc - The scorecard to persist.
 * @param opts.leanCase - Optional per-case transform applied before serialization.
 */
export async function writeBaseline<C extends CaseResultLike>(
  path: string,
  sc: ScorecardLike<C>,
  opts: { leanCase?: (c: C) => C } = {},
): Promise<void> {
  const leanCase = opts.leanCase ?? ((c: C) => c);
  const lean: ScorecardLike<C> = { ...sc, cases: sc.cases.map(leanCase) };
  await Bun.write(path, JSON.stringify(lean, null, 2) + "\n");
}

/**
 * Writes a full run report to disk: the scorecard *including* every per-run
 * detail. This is the explanatory artifact a reviewer or a report skill reads to
 * see the agent's own justification for each score. Written on demand via the
 * `--report` flag and auto-saved for full-corpus runs; never committed.
 *
 * @param path - Absolute or relative path to write to. Parent dirs are created by Bun.
 * @param sc - The scorecard to persist, with detail intact.
 */
export async function writeRunReport(path: string, sc: ScorecardLike): Promise<void> {
  await Bun.write(path, JSON.stringify(sc, null, 2) + "\n");
}
