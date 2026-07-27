import type { CaseResultLike, ScoredRunProvenance, RuleResult as SharedRuleResult, ScorecardLike } from "../shared/index.js";

export type Rule =
  | "complementary_role"
  | "same_side_exclusion"
  | "location_constraint"
  | "organization_constraint"
  | "compressed_context"
  | "premise_distractor";

export type RetrievalMode = "intent_to_premise" | "intent_to_context" | "context_to_context";
export type ProfileRepresentation = "premise" | "user_context";

export interface CandidatePerson {
  userId: string;
  displayName: string;
  premises: string[];
  userContext: string;
}

export interface DiscoveryRetrievalCase {
  id: string;
  rule: Rule;
  tier: 1;
  description: string;
  source: { intent: string; userContext: string };
  candidates: CandidatePerson[];
  expect: {
    expectedUserIds: string[];
    excludedUserIds: string[];
    topK: number;
    maxExpectedRank: number;
    reasoningCriteria: string;
  };
}

export interface RankedUser {
  userId: string;
  score: number;
  text: string;
  representation?: ProfileRepresentation;
}

export type RetrievalAssertionKind = "recall_at_k" | "expected_rank" | "excluded_top_k" | "judge";

export interface RetrievalAssertion {
  kind: RetrievalAssertionKind;
  passed: boolean;
  detail: string;
}

/** Deterministic and judged evidence retained for one mode/run. */
export interface ModeRunDetail {
  mode: RetrievalMode;
  ranking: RankedUser[];
  recallAtK: number;
  expectedRanks: Record<string, number | null>;
  excludedInTopK: string[];
}

export interface RunResult extends ScoredRunProvenance {
  passed: boolean;
  assertions: RetrievalAssertion[];
  detail: ModeRunDetail;
}

export interface CaseResult extends CaseResultLike {
  rule: Rule;
  runResults: RunResult[];
}

export type RuleResult = SharedRuleResult;
export type Scorecard = ScorecardLike<CaseResult>;
