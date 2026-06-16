import type { CaseResultLike, RuleResult as SharedRuleResult, ScorecardLike } from "../shared/index.js";

/** Which premise agent a case exercises. */
export type PremiseComponent = "decompose" | "analyze";

/** Each rule maps to a distinct premise behaviour the corpus exercises. */
export type Rule =
  // decomposer
  | "atomicity"
  | "tier_classification"
  | "intent_exclusion"
  | "empty_input"
  // analyzer
  | "speech_act"
  | "felicity_calibration"
  | "entropy";

/** Inclusive numeric band [min, max]. */
export type Band = [min: number, max: number];

/** Expectations for a decomposer case (`PremiseDecomposer.invoke`). */
export interface DecomposeExpectation {
  /** Minimum number of premises that must be extracted. */
  minPremises?: number;
  /** Maximum number of premises (guards against over-splitting). */
  maxPremises?: number;
  /** The input contains no extractable premises — expect an empty array. */
  expectEmpty?: boolean;
  /** Minimum number of premises with each tier, when the case is about tiering. */
  minAssertive?: number;
  minContextual?: number;
  /** Facts the premise set must collectively cover (LLM-judged). */
  mustCover?: string[];
  /** Content that must NOT appear, e.g. leaked intents/desires (LLM-judged). */
  mustNotContain?: string;
  /** Free-form reasoning rubric graded by the judge. */
  reasoningCriteria?: string;
}

/** Expectations for an analyzer case (`PremiseAnalyzer.invoke`). */
export interface AnalyzeExpectation {
  speechActType?: "DECLARATIVE" | "ASSERTIVE";
  authorityBand?: Band;
  sincerityBand?: Band;
  clarityBand?: Band;
  entropyBand?: Band;
  reasoningCriteria?: string;
}

interface PremiseCaseBase {
  id: string;
  rule: Rule;
  tier: 1 | 2;
  /** Technical one-liner (for the engineer view). */
  description: string;
  /** Plain-language narrative for the non-technical report. */
  human?: { scenario: string; expectation: string };
}

/** A decomposer corpus case. */
export interface DecomposeCase extends PremiseCaseBase {
  component: "decompose";
  /** Free-text input handed to the decomposer. */
  input: string;
  expect: DecomposeExpectation;
}

/** An analyzer corpus case. */
export interface AnalyzeCase extends PremiseCaseBase {
  component: "analyze";
  /** The premise text handed to the analyzer. */
  input: string;
  /** Optional speaker profile context. */
  profileContext?: string;
  expect: AnalyzeExpectation;
}

export type PremiseCase = DecomposeCase | AnalyzeCase;

export type AssertionKind =
  | "count"
  | "empty"
  | "tier"
  | "first_person"
  | "coverage"
  | "exclusion"
  | "speech_act"
  | "authority"
  | "sincerity"
  | "clarity"
  | "entropy"
  | "reasoning";

export interface AssertionResult {
  kind: AssertionKind;
  passed: boolean;
  detail: string;
}

/** Normalized agent output for one run, captured for run reports (stripped from baselines). */
export interface PremiseRunDetail {
  component: PremiseComponent;
  reasoning: string;
  /** decompose */
  premises?: { text: string; tier: "assertive" | "contextual" }[];
  /** analyze */
  speechActType?: "DECLARATIVE" | "ASSERTIVE";
  felicity?: { authority: number; sincerity: number; clarity: number };
  semanticEntropy?: number;
}

export interface RunResult {
  passed: boolean;
  assertions: AssertionResult[];
  /** Present in run reports; stripped from the committed baseline to keep diffs lean. */
  detail?: PremiseRunDetail;
}

export interface CaseResult extends CaseResultLike {
  rule: Rule;
  runResults: RunResult[];
}

export type RuleResult = SharedRuleResult;
export type Scorecard = ScorecardLike<CaseResult>;
