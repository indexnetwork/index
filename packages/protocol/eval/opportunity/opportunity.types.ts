import type { CaseResultLike, ScoredRunProvenance, RuleResult as SharedRuleResult, ScorecardLike } from "../shared/index.js";

/** Each rule maps to a distinct presenter behaviour the corpus exercises. */
export type Rule = "viewer_voice" | "no_leakage" | "greeting" | "grounding" | "introducer_role" | "tone";

/** Viewer's role in the opportunity (drives framing rules). */
export type ViewerRole = "party" | "patient" | "introducer";

/** The pre-assembled context handed to `OpportunityPresenter.present`. */
export interface PresenterInputCase {
  viewerContext: string;
  otherPartyContext: string;
  matchReasoning: string;
  category: string;
  confidence: number;
  signalsSummary: string;
  indexName: string;
  viewerRole: ViewerRole;
  isIntroduction?: boolean;
  introducerName?: string;
}

export interface OpportunityExpectation {
  // ── Deterministic (default on for every card) ───────────────────────────
  /** personalizedSummary must address the viewer in second person. Default true. */
  secondPerson?: boolean;
  /** No UUIDs or internal labels in any field. Default true. */
  noLeakage?: boolean;
  /**
   * Assert the greeting is plain prose within length, with no salutation prefix.
   * Opt-in (default off) so a minor greeting nit doesn't fail a card whose primary
   * concern is voice/grounding/framing; set on greeting-focused cases.
   */
  greetingClean?: boolean;
  // ── Judged (LLM) ────────────────────────────────────────────────────────
  /** Grounding: the summary must reference this (real context fact), not hallucinate. */
  mustReference?: string;
  /** Role framing requirement for introduction / introducer cases. */
  framingCriteria?: string;
  /** Tone rubric (compelling, personal, not analytical). */
  toneCriteria?: string;
}

export interface OpportunityCase {
  id: string;
  rule: Rule;
  tier: 1 | 2;
  /** Technical one-liner (for the engineer view). */
  description: string;
  /** Plain-language narrative for the non-technical report. */
  human?: { scenario: string; expectation: string };
  input: PresenterInputCase;
  expect: OpportunityExpectation;
}

export type AssertionKind =
  | "non_empty"
  | "voice"
  | "uuid"
  | "label"
  | "greeting_format"
  | "greeting_length"
  | "grounding"
  | "framing"
  | "tone";

export interface AssertionResult {
  kind: AssertionKind;
  passed: boolean;
  detail: string;
}

/** Normalized presenter output for one run (stripped from baselines, kept in run reports). */
export interface OpportunityRunDetail {
  headline: string;
  personalizedSummary: string;
  suggestedAction: string;
  greeting: string;
  /** Leakage findings for the report (empty when clean). */
  leaks: string[];
}

export interface RunResult extends ScoredRunProvenance {
  passed: boolean;
  assertions: AssertionResult[];
  detail?: OpportunityRunDetail;
}

export interface CaseResult extends CaseResultLike {
  rule: Rule;
  runResults: RunResult[];
}

export type RuleResult = SharedRuleResult;
export type Scorecard = ScorecardLike<CaseResult>;
