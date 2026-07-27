import { describe, expect, it } from 'bun:test';

import { intentProposalAnalysisSchema, mapProposalAnalysisToIntent } from '../intent-proposal';

describe('intent proposal analysis contract', () => {
  it('maps exact verifier fields without consulting assignment scores', () => {
    const analysis = intentProposalAnalysisSchema.parse({
      verifierOutput: {
        reasoning: 'The owner requests one named organization.',
        classification: 'COMMISSIVE',
        felicity_scores: { authority: 86, sincerity: 92, clarity: 89 },
        semantic_entropy: 0.18,
        referential_anchor: 'Climate Founders Circle',
        referential_breadth: 'narrow',
        missing_selectional_constraints: [],
        specificity_warning: null,
        flags: [],
      },
      combinedScore: 86,
    });

    expect(mapProposalAnalysisToIntent(analysis)).toEqual({
      semanticEntropy: 0.18,
      referentialAnchor: 'Climate Founders Circle',
      intentMode: 'REFERENTIAL',
      speechActType: 'COMMISSIVE',
      felicityAuthority: 86,
      felicitySincerity: 92,
      felicityClarity: 89,
    });
  });

  it('rejects incomplete analysis instead of allowing schema defaults', () => {
    expect(intentProposalAnalysisSchema.safeParse({
      verifierOutput: {
        classification: 'DIRECTIVE',
        semantic_entropy: 0.3,
      },
      combinedScore: 80,
    }).success).toBe(false);
  });
});
