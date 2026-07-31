import type { DiscoveryRetrievalCase, Rule } from "./discovery-retrieval.types.js";

export interface CaseFilters {
  rule?: string;
  caseId?: string;
  tier?: number;
}

/** Parse and validate the only supported initial corpus tier. */
export function parseTier(value: string | undefined): 1 | undefined {
  if (value === undefined) return undefined;
  if (Number(value) === 1) return 1;
  throw new Error(`--tier must be 1 (got "${value}")`);
}

/** Select discovery retrieval cases by optional rule, exact-or-prefix id, and tier filters. */
export function selectCases(cases: DiscoveryRetrievalCase[], filters: CaseFilters): DiscoveryRetrievalCase[] {
  return cases.filter((c) => {
    if (filters.rule && c.rule !== filters.rule) return false;
    if (filters.tier !== undefined && c.tier !== filters.tier) return false;
    if (filters.caseId && c.id !== filters.caseId && !c.id.startsWith(filters.caseId)) return false;
    return true;
  });
}

function countBy<T extends string | number>(values: T[]): Map<T, number> {
  const out = new Map<T, number>();
  for (const value of values) out.set(value, (out.get(value) ?? 0) + 1);
  return out;
}

/** Format corpus counts by tier and rule. */
export function formatCaseSummary(cases: DiscoveryRetrievalCase[]): string {
  const byTier = [...countBy(cases.map((c) => c.tier)).entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([tier, count]) => `t${tier}:${count}`)
    .join("  ");
  const byRule = [...countBy(cases.map((c) => c.rule)).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([rule, count]) => `${rule}:${count}`)
    .join("  ");
  return `total:${cases.length}${byTier ? `\nby tier: ${byTier}` : ""}${byRule ? `\nby rule: ${byRule}` : ""}`;
}

/** Format a corpus inventory for --list-cases. */
export function formatCaseList(cases: DiscoveryRetrievalCase[]): string {
  const lines = ["Discovery retrieval eval cases:", formatCaseSummary(cases), ""];
  for (const c of [...cases].sort((a, b) => a.rule.localeCompare(b.rule) || a.id.localeCompare(b.id))) {
    lines.push(`  [t${c.tier}] ${c.rule.padEnd(24)} ${c.id}`);
  }
  return lines.join("\n");
}

/** True when a string is a known corpus rule. */
export function hasRule(cases: DiscoveryRetrievalCase[], rule: string): rule is Rule {
  return cases.some((c) => c.rule === rule);
}
