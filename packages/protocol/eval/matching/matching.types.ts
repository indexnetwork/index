import type { EvaluatorInput } from "../../src/opportunity/opportunity.evaluator.js";

/** Each rule maps to a distinct evaluator behaviour the corpus exercises. */
export type Rule =
  | "is_a_identity"
  | "complementary_role"
  | "same_side"
  | "already_known"
  | "location"
  | "query_primary"
  | "valency_role"
  | "score_calibration"
  | "event_network";

export type Role = "agent" | "patient" | "peer";

/** Expectation for a single candidate within a case. */
export interface CandidateExpectation {
  candidateId: string;
  /** Should an opportunity for this candidate surface (score within band)? */
  match: boolean;
  /** Expected score range. Absent candidate counts as score 0 (satisfies reject bands). */
  scoreBand?: [min: number, max: number];
  /** Expected valency role when matched. Asserted only when the candidate is matched. */
  role?: Role;
  /** Natural-language reasoning check graded by the judge. Only set when needed. */
  reasoningCriteria?: string;
}

export interface MatchingCase {
  id: string;
  rule: Rule;
  tier: 1 | 2;
  description: string;
  input: EvaluatorInput;
  expect: CandidateExpectation[];
}

export type AssertionKind = "match" | "band" | "role" | "reasoning";

export interface AssertionResult {
  kind: AssertionKind;
  candidateId: string;
  passed: boolean;
  detail: string;
}

export interface RunResult {
  passed: boolean;
  assertions: AssertionResult[];
}

export interface CaseResult {
  caseId: string;
  rule: Rule;
  runs: number;
  passes: number;
  passRate: number;
  /** True when the case passed some runs and failed others. */
  flaky: boolean;
  runResults: RunResult[];
}

export interface RuleResult {
  rule: Rule;
  caseCount: number;
  passRate: number;
}

export interface Scorecard {
  generatedAt: string;
  model: string;
  runs: number;
  aggregatePassRate: number;
  rules: RuleResult[];
  cases: CaseResult[];
}
