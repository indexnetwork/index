import type { SemanticVerifierOutput } from "./intent.verifier.js";
import type { IntentValidationFailure } from "./graph/intent.graph.state.js";

const MAX_PERMISSIBLE_ENTROPY = 0.75;
const MIN_CLEAR_INTENT_SCORE = 40;
const GENERIC_JOB_PHRASE = /\b(?:a|any|some)\s+job\b/i;
const DEFAULT_SPECIFICITY_WARNING = "This signal is broad and may produce many weak matches. Add a more concrete role, outcome, location, timeframe, domain, or specific need to get better recommendations.";

/** The admission policy shared by preparation and explicit updates. */
export function admissionFailure(
  description: string,
  verdict: SemanticVerifierOutput,
  isExplicitUpdate = false,
): IntentValidationFailure | undefined {
  const details = { classification: verdict.classification, referentialBreadth: verdict.referential_breadth };
  if (!["COMMISSIVE", "DIRECTIVE", "DECLARATION"].includes(verdict.classification)) {
    return { ...details, category: "non_actionable", message: "Describe who you want to reach and what you want to do together." };
  }
  if (GENERIC_JOB_PHRASE.test(description) || verdict.semantic_entropy > MAX_PERMISSIBLE_ENTROPY || verdict.felicity_scores.clarity < MIN_CLEAR_INTENT_SCORE) {
    return { ...details, category: "vague_or_invalid", message: "Make the goal more concrete: specify the role, outcome, or particular help you need." };
  }
  if (!isExplicitUpdate && verdict.referential_breadth === "broad") {
    return { ...details, category: "vague_or_invalid", message: verdict.specificity_warning?.trim() || DEFAULT_SPECIFICITY_WARNING };
  }
}

/** Measurements of exactly one description, independent of admission. */
export interface IntentSemanticMetadata {
  semanticEntropy: number;
  referentialAnchor: string | null;
  felicityAuthority: number;
  felicitySincerity: number;
  felicityClarity: number;
  intentMode: "REFERENTIAL" | "ATTRIBUTIVE";
  speechActType: "COMMISSIVE" | "DIRECTIVE" | null;
}

/** Map even a negative verdict to measurements without applying admission. */
export function semanticMetadata(verdict: SemanticVerifierOutput): IntentSemanticMetadata {
  return {
    semanticEntropy: verdict.semantic_entropy,
    referentialAnchor: verdict.referential_anchor,
    felicityAuthority: verdict.felicity_scores.authority,
    felicitySincerity: verdict.felicity_scores.sincerity,
    felicityClarity: verdict.felicity_scores.clarity,
    intentMode: verdict.referential_anchor ? "REFERENTIAL" : "ATTRIBUTIVE",
    speechActType: verdict.classification === "COMMISSIVE" || verdict.classification === "DIRECTIVE" ? verdict.classification : null,
  };
}
