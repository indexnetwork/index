import type { MatchingCase, Rule } from "./matching.types.js";

export interface CaseFilters {
  rule?: string;
  caseId?: string;
  tier?: number;
}

/** Parse and validate a tier CLI argument. */
export function parseTier(value: string | undefined): 1 | 2 | 3 | 4 | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  throw new Error(`--tier must be one of 1, 2, 3, 4 (got "${value}")`);
}

/** Select matching eval cases by optional rule, id/prefix, and tier filters. */
export function selectCases(cases: MatchingCase[], filters: CaseFilters): MatchingCase[] {
  return cases.filter((c) => {
    if (filters.rule && c.rule !== filters.rule) return false;
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

/** Format corpus counts by tier and rule. */
export function formatCaseSummary(cases: MatchingCase[]): string {
  const byTier = [...countBy(cases.map((c) => c.tier)).entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([tier, count]) => `t${tier}:${count}`)
    .join("  ");
  const byRule = [...countBy(cases.map((c) => c.rule)).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([rule, count]) => `${rule}:${count}`)
    .join("  ");
  const byDomain = [...countBy(cases.flatMap((c) => c.domains)).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([domain, count]) => `${domain}:${count}`)
    .join("  ");
  return `total:${cases.length}${byTier ? `\nby tier: ${byTier}` : ""}${byRule ? `\nby rule: ${byRule}` : ""}${byDomain ? `\nby domain: ${byDomain}` : ""}`;
}

/** Format a case inventory for --list-cases. */
export function formatCaseList(cases: MatchingCase[]): string {
  const lines = ["Matching eval cases:", formatCaseSummary(cases), ""];
  for (const c of [...cases].sort((a, b) => a.rule.localeCompare(b.rule) || a.id.localeCompare(b.id))) {
    lines.push(`  [t${c.tier}] [${c.domains.join(",")}] ${c.rule.padEnd(20)} ${c.id}`);
  }
  return lines.join("\n");
}

/** True when a string is a known rule value in the corpus. */
export function hasRule(cases: MatchingCase[], rule: string): rule is Rule {
  return cases.some((c) => c.rule === rule);
}
