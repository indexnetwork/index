import type { EvaluatorInput } from "../../src/opportunity/opportunity.evaluator.js";
import type { CaseResultLike, ScoredRunProvenance, RuleResult as SharedRuleResult, ScorecardLike } from "../shared/index.js";

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

/** Broad domain(s) the case exercises for coverage and reporting. */
export type Domain = "technology" | "research" | "arts" | "funding" | "location" | "community" | "sports";

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
  tier: 1 | 2 | 3 | 4;
  domains: Domain[];
  description: string;
  input: EvaluatorInput;
  expect: CandidateExpectation[];
  /**
   * Optional report-only display names keyed by entity id. Use when evaluator input
   * should remain anonymized (e.g. historical cases) but reports may reveal the
   * real-world referents. Never sent to the protocol evaluator.
   */
  reportNames?: Record<string, string>;
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
  /** Did the evaluator return an opportunity object for this candidate, even below the surfacing threshold? */
  returned?: boolean;
  /** Did an opportunity for this candidate surface at or above the eval surfacing threshold? */
  matched: boolean;
  score: number;
  /** Valency role assigned to this candidate when matched. */
  role?: Role;
  /** The evaluator's own natural-language justification for this candidate, verbatim. */
  reasoning: string;
}

export interface RunResult extends ScoredRunProvenance {
  passed: boolean;
  assertions: AssertionResult[];
  /**
   * The evaluator's per-candidate output incl. reasoning. Present in run reports
   * (written via `--report`), stripped from the committed baseline to keep diffs
   * lean. Optional so a baseline loaded without it remains a valid RunResult.
   */
  candidates?: CandidateOutcome[];
}

/**
 * Matching case result: the shared aggregate shape narrowed to matching's `Rule`
 * union and carrying matching's per-run {@link RunResult} detail (candidate
 * outcomes + reasoning).
 */
export interface CaseResult extends CaseResultLike {
  rule: Rule;
  runResults: RunResult[];
}

/** Per-rule rollup. Aliased from the shared type (rule stored as a string label). */
export type RuleResult = SharedRuleResult;

/** Matching scorecard: the shared scorecard specialized to matching {@link CaseResult}s. */
export type Scorecard = ScorecardLike<CaseResult>;
