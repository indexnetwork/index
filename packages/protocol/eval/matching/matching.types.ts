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
  | "event_network"
  | "historical";

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
  tier: 1 | 2 | 3;
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

/**
 * The evaluator's actual output for one expected candidate in one run, including
 * the model's own verbatim reasoning. This is the raw "why" behind a score —
 * the fuel for explanatory run reports. Captured per run; omitted from the
 * committed baseline (see {@link RunResult.candidates}).
 */
export interface CandidateOutcome {
  candidateId: string;
  /** Did an opportunity for this candidate surface with a score > 0? */
  matched: boolean;
  score: number;
  /** Valency role assigned to this candidate when matched. */
  role?: Role;
  /** The evaluator's own natural-language justification for this candidate, verbatim. */
  reasoning: string;
}

export interface RunResult {
  passed: boolean;
  assertions: AssertionResult[];
  /**
   * The evaluator's per-candidate output incl. reasoning. Present in run reports
   * (written via `--report`), stripped from the committed baseline to keep diffs
   * lean. Optional so a baseline loaded without it remains a valid RunResult.
   */
  candidates?: CandidateOutcome[];
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
