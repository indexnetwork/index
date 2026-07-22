import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it } from 'bun:test';

import { OpportunityEvaluator } from '@indexnetwork/protocol';
import type { EvaluatorInput } from '@indexnetwork/protocol';

describe('OpportunityEvaluator — rethrow on error', () => {
  it('invokeEntityBundle rethrows LLM errors instead of returning []', async () => {
    const llmError = new Error('LLM service unavailable');

    const fakeModel = {
      invoke: async () => {
        throw llmError;
      },
    };

    const evaluator = Object.create(OpportunityEvaluator.prototype) as OpportunityEvaluator;
    (evaluator as unknown as { entityBundleModel: typeof fakeModel }).entityBundleModel = fakeModel;

    const input: EvaluatorInput = {
      discovererId: 'user-1',
      entities: [
        {
          userId: 'user-2',
          indexId: 'index-1',
          profile: { name: 'Alice', bio: 'Engineer' },
        },
      ],
    };

    await expect(evaluator.invokeEntityBundle(input)).rejects.toThrow('LLM service unavailable');
  }, 10_000);

  it('analyzeMatch rethrows LLM errors instead of returning []', async () => {
    const llmError = new Error('Model rate limited');

    const fakeModel = {
      invoke: async () => {
        throw llmError;
      },
    };

    // Construct without the production model-building constructor so this error-path unit test
    // remains hermetic and never requires an OpenRouter credential.
    const evaluator = Object.create(OpportunityEvaluator.prototype) as OpportunityEvaluator;

    // Override the private model to throw
    (evaluator as unknown as { model: typeof fakeModel }).model = fakeModel;

    const analyzeMatch = (evaluator as unknown as {
      analyzeMatch: (
        sourceProfileContext: string,
        candidateProfile: { userId: string },
        candidateUserId: string,
        existingOpportunities: string,
      ) => Promise<unknown[]>;
    }).analyzeMatch.bind(evaluator);

    await expect(
      analyzeMatch('Source profile context', { userId: 'candidate-1' }, 'candidate-1', ''),
    ).rejects.toThrow('Model rate limited');
  }, 10_000);
});
