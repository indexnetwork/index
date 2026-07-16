import { describe, expect, it } from 'bun:test';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import type { BaseMessage } from '@langchain/core/messages';

import { getHydeGenerationMode, HYDE_FRAME_GENERATION_VERSION } from '../hyde.env.js';
import { HydeSourceFrameSchema, sanitizeHydeSourceFrame, type HydeSourceFrame } from '../hyde.frame.js';
import { FrameLensResponseSchema, LensInferrer, type LensStructuredModel } from '../lens.inferrer.js';

function messageText(input: BaseLanguageModelInput): string[] {
  return (input as BaseMessage[]).map((message) => String(message.content));
}

describe('HyDE frame environment', () => {
  it('enables frame-v1 only for the strict literal true', () => {
    expect(getHydeGenerationMode('true')).toBe(HYDE_FRAME_GENERATION_VERSION);
    for (const value of [undefined, '', 'false', 'TRUE', ' true', 'true ']) {
      expect(getHydeGenerationMode(value)).toBe('legacy');
    }
  });
});

describe('HyDE source frame evidence boundary', () => {
  it('drops every element without case-insensitive exact source evidence', () => {
    const frame: HydeSourceFrame = {
      sourceRoles: [
        { role: 'founder', evidence: 'FOUNDER' },
        { role: 'doctor', evidence: 'medical profile' },
      ],
      counterpartRoles: [{ role: 'investor', evidence: 'seed funding' }],
      hardConstraints: [
        { type: 'location', value: 'Berlin', evidence: 'Berlin' },
        { type: 'numeric', value: '$2m', evidence: '$2m' },
      ],
      namedEntities: [
        { type: 'location', name: 'Berlin', evidence: 'Berlin' },
        { type: 'organization', name: 'Profile Corp', evidence: 'Profile Corp' },
      ],
      domainVocabulary: [
        { term: 'climate tech', evidence: 'climate tech' },
        { term: 'oncology', evidence: 'oncology' },
      ],
    };

    expect(sanitizeHydeSourceFrame('Founder seeking seed funding for climate tech in berlin', frame)).toEqual({
      sourceRoles: [{ role: 'founder', evidence: 'FOUNDER' }],
      counterpartRoles: [{ role: 'investor', evidence: 'seed funding' }],
      hardConstraints: [{ type: 'location', value: 'Berlin', evidence: 'Berlin' }],
      namedEntities: [{ type: 'location', name: 'Berlin', evidence: 'Berlin' }],
      domainVocabulary: [{ term: 'climate tech', evidence: 'climate tech' }],
    });
  });

  it('allows profile context to shape lenses but never to survive as frame evidence', async () => {
    let prompts: string[] = [];
    const frameModel: LensStructuredModel = {
      async invoke(input) {
        prompts = messageText(input);
        return {
          lenses: [{ label: 'healthcare seed investor', corpus: 'profiles', reasoning: 'profile specialization' }],
          sourceFrame: {
            sourceRoles: [{ role: 'founder', evidence: 'founder' }],
            counterpartRoles: [{ role: 'investor', evidence: 'funding' }],
            hardConstraints: [{ type: 'location', value: 'Zurich', evidence: 'Zurich' }],
            namedEntities: [{ type: 'organization', name: 'Profile Corp', evidence: 'Profile Corp' }],
            domainVocabulary: [{ term: 'oncology', evidence: 'oncology' }],
          },
        };
      },
    };

    const result = await new LensInferrer({ frameModel }).infer({
      sourceText: 'I am a founder seeking funding',
      profileContext: 'Oncology operator at Profile Corp in Zurich',
      frameConstrained: true,
    });

    expect(prompts.join('\n')).toContain('profileContext may specialize');
    expect(prompts.join('\n')).toContain('Oncology operator at Profile Corp in Zurich');
    expect(result.lenses[0]?.label).toBe('healthcare seed investor');
    expect(result.sourceFrame).toEqual({
      sourceRoles: [{ role: 'founder', evidence: 'founder' }],
      counterpartRoles: [{ role: 'investor', evidence: 'funding' }],
      hardConstraints: [],
      namedEntities: [],
      domainVocabulary: [],
    });
  });

  it('uses a dedicated frame schema and prompt that allow reciprocal role inference', () => {
    const parsed = FrameLensResponseSchema.parse({
      lenses: [{ label: 'buyer', corpus: 'intents', reasoning: 'reciprocal target' }],
      sourceFrame: {
        sourceRoles: [{ role: 'seller', evidence: 'selling' }],
        counterpartRoles: [{ role: 'buyer', evidence: 'selling' }],
        hardConstraints: [], namedEntities: [], domainVocabulary: [],
      },
    });
    expect(parsed.sourceFrame.counterpartRoles[0]?.role).toBe('buyer');
    expect(HydeSourceFrameSchema.safeParse(parsed.sourceFrame).success).toBe(true);
  });
});
