import type { PremiseCase, PremiseComponent, Rule } from "./premise.types.js";

export interface CaseFilters {
  rule?: string;
  caseId?: string;
  component?: string;
  tier?: number;
}

/** Parse and validate a tier CLI argument. */
export function parseTier(value: string | undefined): 1 | 2 | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (n === 1 || n === 2) return n;
  throw new Error(`--tier must be one of 1, 2 (got "${value}")`);
}

/** Parse and validate a component CLI argument. */
export function parseComponent(value: string | undefined): PremiseComponent | undefined {
  if (value === undefined) return undefined;
  if (value === "decompose" || value === "analyze") return value;
  throw new Error(`--component must be "decompose" or "analyze" (got "${value}")`);
}

/** Select premise eval cases by optional rule, id/prefix, component, and tier filters. */
export function selectCases(cases: PremiseCase[], filters: CaseFilters): PremiseCase[] {
  return cases.filter((c) => {
    if (filters.rule && c.rule !== filters.rule) return false;
    if (filters.component && c.component !== filters.component) return false;
    if (filters.tier !== undefined && c.tier !== filters.tier) return false;
    if (filters.caseId) {
      const q = filters.caseId;
      if (c.id !== q && !c.id.startsWith(q)) return false;
    }
    return true;
  });
}

function countBy<T extends string | number>(values: T[]): Map<T, number> {
  const out = new Map<T, number>();
  for (const v of values) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}

/** Format corpus counts by tier, component, and rule. */
export function formatCaseSummary(cases: PremiseCase[]): string {
  const byTier = [...countBy(cases.map((c) => c.tier)).entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([tier, count]) => `t${tier}:${count}`)
    .join("  ");
  const byComponent = [...countBy(cases.map((c) => c.component)).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([comp, count]) => `${comp}:${count}`)
    .join("  ");
  const byRule = [...countBy(cases.map((c) => c.rule)).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([rule, count]) => `${rule}:${count}`)
    .join("  ");
  return `total:${cases.length}${byTier ? `\nby tier: ${byTier}` : ""}${byComponent ? `\nby component: ${byComponent}` : ""}${byRule ? `\nby rule: ${byRule}` : ""}`;
}

/** Format a case inventory for --list-cases. */
export function formatCaseList(cases: PremiseCase[]): string {
  const lines = ["Premise eval cases:", formatCaseSummary(cases), ""];
  for (const c of [...cases].sort((a, b) => a.component.localeCompare(b.component) || a.rule.localeCompare(b.rule) || a.id.localeCompare(b.id))) {
    lines.push(`  [t${c.tier}] [${c.component.padEnd(9)}] ${c.rule.padEnd(20)} ${c.id}`);
  }
  return lines.join("\n");
}

/** True when a string is a known rule value in the corpus. */
export function hasRule(cases: PremiseCase[], rule: string): rule is Rule {
  return cases.some((c) => c.rule === rule);
}
