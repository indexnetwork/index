import type { CaseResult, RuleResult, Scorecard, Rule } from "./matching.types.js";

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

export function buildScorecard(
  results: CaseResult[],
  meta: { model: string; runs: number },
): Scorecard {
  const byRule = new Map<Rule, CaseResult[]>();
  for (const r of results) {
    const list = byRule.get(r.rule) ?? [];
    list.push(r);
    byRule.set(r.rule, list);
  }
  const rules: RuleResult[] = [...byRule.entries()].map(([rule, list]) => ({
    rule,
    caseCount: list.length,
    passRate: mean(list.map((c) => c.passRate)),
  }));
  return {
    generatedAt: new Date().toISOString(),
    model: meta.model,
    runs: meta.runs,
    aggregatePassRate: mean(results.map((c) => c.passRate)),
    rules,
    cases: results,
  };
}

export interface Regression {
  id: string;
  kind: "case" | "rule";
  before: number;
  after: number;
}

/**
 * A regression is a case or rule whose pass-rate dropped by at least `threshold`
 * versus the baseline. New cases (absent from baseline) are never regressions.
 */
export function diffBaseline(
  current: Scorecard,
  baseline: Scorecard | null,
  threshold: number,
): { regressions: Regression[] } {
  if (!baseline) return { regressions: [] };
  const regressions: Regression[] = [];

  const baseCases = new Map(baseline.cases.map((c) => [c.caseId, c.passRate]));
  for (const c of current.cases) {
    const before = baseCases.get(c.caseId);
    if (before === undefined) continue;
    if (before - c.passRate >= threshold) {
      regressions.push({ id: c.caseId, kind: "case", before, after: c.passRate });
    }
  }

  const baseRules = new Map(baseline.rules.map((r) => [r.rule, r.passRate]));
  for (const r of current.rules) {
    const before = baseRules.get(r.rule);
    if (before === undefined) continue;
    if (before - r.passRate >= threshold) {
      regressions.push({ id: r.rule, kind: "rule", before, after: r.passRate });
    }
  }

  return { regressions };
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** Human-readable scorecard for the console. */
export function formatConsole(sc: Scorecard, regressions: Regression[]): string {
  const lines: string[] = [];
  lines.push(`\n=== Matching Quality Scorecard ===`);
  lines.push(`model=${sc.model}  runs=${sc.runs}  cases=${sc.cases.length}`);
  lines.push(`aggregate pass-rate: ${pct(sc.aggregatePassRate)}\n`);
  lines.push(`Per rule:`);
  for (const r of [...sc.rules].sort((a, b) => a.passRate - b.passRate)) {
    lines.push(`  ${r.rule.padEnd(20)} ${pct(r.passRate).padStart(4)}  (${r.caseCount} case(s))`);
  }
  const flaky = sc.cases.filter((c) => c.flaky);
  if (flaky.length > 0) {
    lines.push(`\nFlaky (passed some runs, failed others):`);
    for (const c of flaky) lines.push(`  ${c.caseId}  ${c.passes}/${c.runs}`);
  }
  if (regressions.length > 0) {
    lines.push(`\n⚠ Regressions vs baseline:`);
    for (const r of regressions) {
      lines.push(`  [${r.kind}] ${r.id}: ${pct(r.before)} → ${pct(r.after)}`);
    }
  }
  return lines.join("\n");
}

export async function readBaseline(path: string): Promise<Scorecard | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return (await file.json()) as Scorecard;
}

export async function writeBaseline(path: string, sc: Scorecard): Promise<void> {
  await Bun.write(path, JSON.stringify(sc, null, 2) + "\n");
}
