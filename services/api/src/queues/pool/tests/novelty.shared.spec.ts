import { describe, expect, it } from 'bun:test';

import type { QuestionPoolDiscriminator } from '@indexnetwork/protocol';

import { poolAxisReferenceText, resolvePoolAxisNoveltyReferences } from '../novelty.shared';

function axis(overrides: Partial<QuestionPoolDiscriminator> = {}): QuestionPoolDiscriminator {
  return {
    label: 'Builders vs advisors',
    questionSeed: 'Do you prefer builders or advisors?',
    sides: ['Builders', 'Advisors'],
    sideCounts: { Builders: 3, Advisors: 3 },
    voi: 0.5,
    evidenceRate: 1,
    assignments: [],
    ...overrides,
  };
}

describe('resolvePoolAxisNoveltyReferences', () => {
  it('reuses same-model stored embeddings for post-answer semantic suppression', () => {
    const resolved = axis({ embedding: [0.2, 0.8], embeddingModel: 'model-v1' });
    expect(resolvePoolAxisNoveltyReferences([resolved], 'model-v1', 2)).toEqual({
      referenceTexts: [],
      referenceEmbeddings: [[0.2, 0.8]],
    });
  });

  it('falls back to canonical text for model mismatches and legacy rows', () => {
    const mismatched = axis({ embedding: [0.2, 0.8], embeddingModel: 'model-v0' });
    const legacy = axis({ label: 'Remote vs local', questionSeed: 'Remote or local?' });
    expect(resolvePoolAxisNoveltyReferences([mismatched, legacy], 'model-v1', 2)).toEqual({
      referenceTexts: [poolAxisReferenceText(mismatched), poolAxisReferenceText(legacy)],
      referenceEmbeddings: [],
    });
  });

  it('falls back to text for the same model with the wrong dimensions', () => {
    const wrongDimensions = axis({ embedding: [0.2, 0.3, 0.5], embeddingModel: 'model-v1' });
    expect(resolvePoolAxisNoveltyReferences([wrongDimensions], 'model-v1', 2)).toEqual({
      referenceTexts: [poolAxisReferenceText(wrongDimensions)],
      referenceEmbeddings: [],
    });
  });
});
