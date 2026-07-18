/**
 * Harness-agnostic scorecard types.
 *
 * These describe only the *aggregate* shape the shared scorecard / baseline /
 * console / rolling functions read. Each harness defines its own richer per-run
 * and per-case types (assertions, candidate outcomes, expectations) that
 * structurally extend {@link CaseResultLike} / {@link ScorecardLike}. The shared
 * layer never reads into harness-specific run internals, so harness types stay
 * fully owned by their harness while reusing all the aggregation machinery.
 */

/** Per-rule (a.k.a. group) rollup of case pass-rates. `rule` is a free string label. */
export interface RuleResult {
  rule: string;
  caseCount: number;
  passRate: number;
}

/** Provenance attached to each scored terminal-success output in v2 reports. */
export interface ScoredRunProvenance {
  runId?: string;
  /** Zero-based requested slot index; absent from v1 artifacts. */
  runIndex?: number;
}

/** Minimal per-case fields every shared function reads. Harness CaseResult types extend this. */
export interface CaseResultLike {
  caseId: string;
  /** Group label the case belongs to (each harness uses its own string union). */
  rule: string;
  runs: number;
  passes: number;
  passRate: number;
  /** True when the case passed some successful runs and failed others. */
  flaky: boolean;
  /**
   * Deterministic ids of terminal successful runs consumed by the scorer.
   * Required in v2 artifacts; absent from v1 artifacts and legacy payloads.
   */
  scoredRunIds?: string[];
}

/** Minimal scorecard shape. Harness Scorecard types extend this with their CaseResult. */
export interface ScorecardLike<C extends CaseResultLike = CaseResultLike> {
  generatedAt: string;
  model: string;
  runs: number;
  aggregatePassRate: number;
  rules: RuleResult[];
  cases: C[];
}

/** A single detected regression of a case or rule vs a baseline. */
export interface Regression {
  id: string;
  kind: "case" | "rule";
  before: number;
  after: number;
  /** One-sided posterior-predictive p-value for the current pass count or lower under the baseline. */
  pValue: number;
}
