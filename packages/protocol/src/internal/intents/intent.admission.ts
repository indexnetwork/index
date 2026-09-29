import type { SemanticVerifierOutput } from "./intent.verifier.js";
import type { IntentValidationFailure } from "./graph/intent.graph.state.js";

const MAX_PERMISSIBLE_ENTROPY = 0.75;
const MIN_CLEAR_INTENT_SCORE = 40;
const NON_ACTIONABLE_MESSAGE = "Describe who you want to reach and what you want to do together.";
const VAGUE_MESSAGE = "Make the goal more concrete: specify the role, outcome, or particular help you need.";
const BROAD_MESSAGE = "This signal is broad and may produce many weak matches. Add a more concrete role, outcome, location, timeframe, domain, or specific need to get better recommendations.";

/** A noul at or above this is a yes the admission check acts on. */
export const ADMISSION_NOUL = 0.8;

export const ADMISSION_CONSTRAINTS = ["role", "outcome", "location", "timeframe", "domain", "concrete_need"] as const;
export type AdmissionConstraint = (typeof ADMISSION_CONSTRAINTS)[number];
type SpeechAct = "commissive" | "directive" | "declaration" | "other";

/** One Jev admission call, already read into numbers. */
export interface AdmissionDecision {
  speechAct: SpeechAct;
  tooVague: number;
  tooBroad: number;
  constraints: Record<AdmissionConstraint, number>;
}

/** The admission policy shared by preparation and explicit updates. */
export function admissionFailure(
  verdict: SemanticVerifierOutput,
  isExplicitUpdate = false,
): IntentValidationFailure | undefined {
  const details = { classification: verdict.classification, referentialBreadth: verdict.referential_breadth };
  if (!["COMMISSIVE", "DIRECTIVE", "DECLARATION"].includes(verdict.classification)) {
    return { ...details, category: "non_actionable", message: NON_ACTIONABLE_MESSAGE };
  }
  if (verdict.semantic_entropy > MAX_PERMISSIBLE_ENTROPY || verdict.felicity_scores.clarity < MIN_CLEAR_INTENT_SCORE) {
    return { ...details, category: "vague_or_invalid", message: VAGUE_MESSAGE };
  }
  if (!isExplicitUpdate && verdict.referential_breadth === "broad") {
    return { ...details, category: "vague_or_invalid", message: verdict.specificity_warning?.trim() || BROAD_MESSAGE };
  }
}

/**
 * The prepare-path admission check. Constraint nouls at or above {@link ADMISSION_NOUL}
 * are still missing; they do not fail admission on their own.
 */
export function admissionFromDecision(decision: AdmissionDecision): { failure?: IntentValidationFailure; missing: AdmissionConstraint[] } {
  const missing = ADMISSION_CONSTRAINTS.filter((name) => decision.constraints[name] >= ADMISSION_NOUL);
  const classification = decision.speechAct === "other" ? "UNKNOWN" : decision.speechAct.toUpperCase();
  if (decision.speechAct === "other") {
    return { missing, failure: { category: "non_actionable", classification, message: NON_ACTIONABLE_MESSAGE } };
  }
  if (decision.tooVague >= ADMISSION_NOUL) {
    return { missing, failure: { category: "vague_or_invalid", classification, message: VAGUE_MESSAGE } };
  }
  if (decision.tooBroad >= ADMISSION_NOUL) {
    return { missing, failure: { category: "vague_or_invalid", classification, referentialBreadth: "broad", message: BROAD_MESSAGE } };
  }
  return { missing };
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
