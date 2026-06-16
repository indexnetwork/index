import { mean } from "./stats.js";
import type { CaseResultLike, RuleResult, ScorecardLike } from "./types.js";

/** Mean of case pass-rates within a list (0 for empty). */
export function meanRate(list: CaseResultLike[]): number {
  return mean(list.map((c) => c.passRate));
}

/**
 * Aggregates raw case results into a scorecard with per-rule and aggregate pass-rates.
 *
 * Generic over the concrete case type `C` so each harness keeps its richer
 * CaseResult (with assertions / candidate detail) in the returned scorecard.
 *
 * @param results - The individual case results to aggregate.
 * @param meta - Run metadata: the model name and number of runs per case.
 * @returns A scorecard with per-rule breakdowns, aggregate pass-rate, and a generation timestamp.
 */
export function buildScorecard<C extends CaseResultLike>(
  results: C[],
  meta: { model: string; runs: number },
): ScorecardLike<C> {
  const byRule = new Map<string, C[]>();
  for (const r of results) {
    const list = byRule.get(r.rule) ?? [];
    list.push(r);
    byRule.set(r.rule, list);
  }
  const rules: RuleResult[] = [...byRule.entries()].map(([rule, list]) => ({
    rule,
    caseCount: list.length,
    passRate: meanRate(list),
  }));
  return {
    generatedAt: new Date().toISOString(),
    model: meta.model,
    runs: meta.runs,
    aggregatePassRate: meanRate(results),
    rules,
    cases: results,
  };
}
