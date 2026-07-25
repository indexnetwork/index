import { z } from 'zod';

export const intentProposalVerifierOutputSchema = z.object({
  reasoning: z.string(),
  classification: z.enum(['COMMISSIVE', 'DIRECTIVE', 'ASSERTIVE', 'EXPRESSIVE', 'DECLARATION', 'UNKNOWN']),
  felicity_scores: z.object({
    clarity: z.number().min(0).max(100),
    authority: z.number().min(0).max(100),
    sincerity: z.number().min(0).max(100),
  }).strict(),
  semantic_entropy: z.number().min(0).max(1),
  referential_anchor: z.string().nullable(),
  referential_breadth: z.enum(['narrow', 'moderate', 'broad']),
  missing_selectional_constraints: z.array(z.enum([
    'role',
    'outcome',
    'location',
    'timeframe',
    'domain',
    'concrete_need',
  ])),
  specificity_warning: z.string().nullable(),
  flags: z.array(z.string()),
}).strict();

export const intentProposalAnalysisSchema = z.object({
  verifierOutput: intentProposalVerifierOutputSchema,
  combinedScore: z.number().min(0).max(100).nullable(),
}).strict();

export type ValidIntentProposalAnalysis = z.infer<typeof intentProposalAnalysisSchema>;

/** Map exact verifier output to the canonical intent graph persistence columns. */
export function mapProposalAnalysisToIntent(analysis: ValidIntentProposalAnalysis) {
  const verifier = analysis.verifierOutput;
  return {
    semanticEntropy: verifier.semantic_entropy,
    referentialAnchor: verifier.referential_anchor,
    intentMode: verifier.referential_anchor ? 'REFERENTIAL' as const : 'ATTRIBUTIVE' as const,
    speechActType: verifier.classification === 'COMMISSIVE' || verifier.classification === 'DIRECTIVE'
      ? verifier.classification
      : null,
    felicityAuthority: verifier.felicity_scores.authority,
    felicitySincerity: verifier.felicity_scores.sincerity,
    felicityClarity: verifier.felicity_scores.clarity,
  };
}
