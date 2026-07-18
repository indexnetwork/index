import type { CaseResultLike, ScoredRunProvenance, RuleResult as SharedRuleResult, ScorecardLike } from "../shared/index.js";

/** Each rule maps to a distinct profile-generator behaviour the corpus exercises. */
export type Rule = "extraction" | "location" | "privacy" | "skills_interests" | "update";

export interface ProfileExpectation {
  // ── Deterministic ──────────────────────────────────────────────────────
  /** `identity.name` must contain this (case-insensitive). */
  expectNameContains?: string;
  /** `identity.location` must contain this (case-insensitive). */
  expectLocationContains?: string;
  /** Public fields must contain no email/phone PII. Defaults to true. */
  noPII?: boolean;
  minSkills?: number;
  minInterests?: number;
  // ── Judged (LLM) ───────────────────────────────────────────────────────
  /** Skills the profile must capture (judged coverage). */
  mustHaveSkills?: string[];
  /** Interests the profile must capture (judged coverage). */
  mustHaveInterests?: string[];
  /** For update cases: the change that must be applied (judged). */
  mustApply?: string;
  /** For update cases: existing content that must be preserved (judged). */
  mustPreserve?: string;
  /** Free-form rubric graded by the judge against the whole profile. */
  reasoningCriteria?: string;
}

export interface ProfileCase {
  id: string;
  rule: Rule;
  tier: 1 | 2;
  /** Technical one-liner (for the engineer view). */
  description: string;
  /** Plain-language narrative for the non-technical report. */
  human?: { scenario: string; expectation: string };
  /** Raw data (or existing-profile + request) handed to the generator. */
  input: string;
  expect: ProfileExpectation;
}

export type AssertionKind =
  | "name"
  | "location"
  | "privacy"
  | "skills"
  | "interests"
  | "coverage_skills"
  | "coverage_interests"
  | "apply"
  | "preserve"
  | "reasoning";

export interface AssertionResult {
  kind: AssertionKind;
  passed: boolean;
  detail: string;
}

/** Normalized generator output for one run (stripped from baselines, kept in run reports). */
export interface ProfileRunDetail {
  name: string;
  bio: string;
  location: string;
  context: string;
  interests: string[];
  skills: string[];
  /** PII strings found in public fields, if any — the privacy assertion's evidence. */
  piiHits: string[];
}

export interface RunResult extends ScoredRunProvenance {
  passed: boolean;
  assertions: AssertionResult[];
  detail?: ProfileRunDetail;
}

export interface CaseResult extends CaseResultLike {
  rule: Rule;
  runResults: RunResult[];
}

export type RuleResult = SharedRuleResult;
export type Scorecard = ScorecardLike<CaseResult>;
