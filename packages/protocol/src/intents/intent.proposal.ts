/** Default user-facing warning for broad attributive intent proposals. */
export const DEFAULT_SPECIFICITY_WARNING = "This signal is broad and may produce many weak matches. Add a more concrete role, outcome, location, timeframe, domain, or specific need to get better recommendations.";

/** Verifier output retained verbatim across the host persistence boundary. */
export interface IntentProposalVerifierOutput {
  reasoning: string;
  classification: "COMMISSIVE" | "DIRECTIVE" | "ASSERTIVE" | "EXPRESSIVE" | "DECLARATION" | "UNKNOWN";
  felicity_scores: {
    clarity: number;
    authority: number;
    sincerity: number;
  };
  semantic_entropy: number;
  referential_anchor: string | null;
  referential_breadth: "narrow" | "moderate" | "broad";
  missing_selectional_constraints: Array<
    "role" | "outcome" | "location" | "timeframe" | "domain" | "concrete_need"
  >;
  specificity_warning: string | null;
  flags: string[];
}

/** Complete server-authoritative analysis captured for a verified intent proposal. */
export interface IntentProposalAnalysis {
  verifierOutput: IntentProposalVerifierOutput;
  combinedScore: number | null;
}

/** One proposal persisted by the host before its display card is emitted. */
export interface PersistableIntentProposal {
  proposalId: string;
  userId: string;
  description: string;
  networkId?: string;
  analysis: IntentProposalAnalysis;
}

/** Host persistence boundary for durable, owner-scoped intent proposals. */
export interface IntentProposalStore {
  createProposals(proposals: PersistableIntentProposal[]): Promise<void>;
}

/** Normalize intent text exactly as the direct graph write path does. */
export function normalizeIntentDescription(description: string): string {
  if (!description || typeof description !== "string") return description;
  const normalized = description
    .replace(/\s*More details at\s*:?\s*https?:\/\/[^\s"'<>)\]]+/gi, "")
    .replace(/\s*See\s+https?:\/\/[^\s"'<>)\]]+\s+for\s+more[^.]*\.?/gi, "")
    .replace(/https?:\/\/[^\s"'<>)\]]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return normalized.replace(/[.,;]\s*$/, "").trim() || description;
}
