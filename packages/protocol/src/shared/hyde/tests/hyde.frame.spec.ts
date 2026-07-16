import { describe, expect, it } from 'bun:test';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import type { BaseMessage } from '@langchain/core/messages';

import { getHydeGenerationMode, HYDE_FRAME_GENERATION_VERSION } from '../hyde.env.js';
import { HydeSourceFrameSchema, sanitizeHydeSourceFrame, type HydeSourceFrame } from '../hyde.frame.js';
import { FrameResponseSchema, LensInferrer, type LensStructuredModel } from '../lens.inferrer.js';

function messageText(input: BaseLanguageModelInput): string[] {
  return (input as BaseMessage[]).map((message) => String(message.content));
}

function emptyFrame(): HydeSourceFrame {
  return {
    sourceRoles: [],
    counterpartRoles: [],
    hardConstraints: [],
    namedEntities: [],
    domainVocabulary: [],
  };
}

const inferredLens = {
  label: 'healthcare seed investor',
  corpus: 'profiles' as const,
  reasoning: 'profile specialization',
};

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
        { role: 'Profile Corp founder', evidence: 'founder' },
        { role: 'profile corp founder', evidence: 'founder' },
        { role: 'Zurich founder', evidence: 'founder' },
        { role: '$2m founder', evidence: 'founder' },
        { role: 'doctor', evidence: 'medical profile' },
      ],
      counterpartRoles: [
        { role: 'investor', evidence: 'seed funding' },
        { role: 'Alice investor', evidence: 'seed funding' },
        { role: 'alice investor', evidence: 'seed funding' },
      ],
      hardConstraints: [
        { type: 'location', value: 'Berlin', evidence: 'in berlin' },
        { type: 'location', value: 'Berlin', evidence: 'founder' },
        { type: 'numeric', value: '$2m', evidence: 'seed funding' },
      ],
      namedEntities: [
        { type: 'location', name: 'Berlin', evidence: 'in berlin' },
        { type: 'organization', name: 'Profile Corp', evidence: 'founder' },
      ],
      domainVocabulary: [
        { term: 'climate tech', evidence: 'climate tech' },
        { term: 'oncology', evidence: 'climate tech' },
      ],
    };

    expect(sanitizeHydeSourceFrame('Founder seeking seed funding for climate tech in berlin', frame)).toEqual({
      sourceRoles: [{ role: 'founder', evidence: 'FOUNDER' }],
      counterpartRoles: [{ role: 'investor', evidence: 'seed funding' }],
      hardConstraints: [{ type: 'location', value: 'Berlin', evidence: 'in berlin' }],
      namedEntities: [{ type: 'location', name: 'Berlin', evidence: 'in berlin' }],
      domainVocabulary: [{ term: 'climate tech', evidence: 'climate tech' }],
    });
  });

  it('requires Unicode alphanumeric span boundaries for grounded values', () => {
    const frame: HydeSourceFrame = {
      ...emptyFrame(),
      namedEntities: [
        { type: 'location', name: 'US', evidence: 'business' },
        { type: 'location', name: 'us', evidence: 'the US' },
        { type: 'other', name: 'क', evidence: 'कि' },
      ],
      domainVocabulary: [
        { term: 'AI', evidence: 'raising' },
        { term: 'ai', evidence: 'AI systems' },
        { term: 'e', evidence: 'e\u0301' },
      ],
    };

    expect(sanitizeHydeSourceFrame('Our business is raising in the US for AI systems, कि and e\u0301', frame)).toEqual({
      ...emptyFrame(),
      namedEntities: [{ type: 'location', name: 'us', evidence: 'the US' }],
      domainVocabulary: [{ term: 'ai', evidence: 'AI systems' }],
    });
  });

  it('does not infer source roles but retains source-supported counterpart role inference', () => {
    const frame: HydeSourceFrame = {
      ...emptyFrame(),
      sourceRoles: [
        { role: 'investor', evidence: 'founder' },
        { role: 'senior founder', evidence: 'founder' },
      ],
      counterpartRoles: [{ role: 'investor', evidence: 'seeking funding' }],
    };

    expect(sanitizeHydeSourceFrame('A founder seeking funding', frame)).toEqual({
      ...emptyFrame(),
      sourceRoles: [{ role: 'senior founder', evidence: 'founder' }],
      counterpartRoles: [{ role: 'investor', evidence: 'seeking funding' }],
    });
  });

  it('uses profile context for lenses but excludes every profile-only token from frame extraction', async () => {
    let lensPrompts: string[] = [];
    let framePrompts: string[] = [];
    const legacyModel: LensStructuredModel = {
      async invoke(input) {
        lensPrompts = messageText(input);
        return { lenses: [inferredLens] };
      },
    };
    const frameModel: LensStructuredModel = {
      async invoke(input) {
        framePrompts = messageText(input);
        return {
          sourceFrame: {
            sourceRoles: [{ role: 'founder', evidence: 'founder' }],
            counterpartRoles: [{ role: 'investor', evidence: 'funding' }],
            hardConstraints: [{ type: 'location', value: 'Zurich', evidence: 'Zurich' }],
            namedEntities: [{ type: 'organization', name: 'ProfileCorp', evidence: 'ProfileCorp' }],
            domainVocabulary: [{ term: 'Oncology', evidence: 'Oncology' }],
          },
        };
      },
    };

    const profileContext = 'Oncology operator at ProfileCorp in Zurich';
    const sourceText = 'I am a founder seeking funding';
    const result = await new LensInferrer({ legacyModel, frameModel }).infer({
      sourceText,
      profileContext,
      frameConstrained: true,
    });

    expect(lensPrompts.join('\n')).toContain(profileContext);
    expect(framePrompts.join('\n')).toContain(sourceText);
    for (const profileOnlyToken of ['Oncology', 'operator', 'ProfileCorp', 'Zurich']) {
      expect(framePrompts.join('\n')).not.toContain(profileOnlyToken);
    }
    expect(result.lenses).toEqual([inferredLens]);
    expect(result.sourceFrame).toEqual({
      sourceRoles: [{ role: 'founder', evidence: 'founder' }],
      counterpartRoles: [{ role: 'investor', evidence: 'funding' }],
      hardConstraints: [],
      namedEntities: [],
      domainVocabulary: [],
    });
  });

  it('returns inferred lenses with an empty source frame when only frame extraction fails', async () => {
    const legacyModel: LensStructuredModel = {
      async invoke() {
        return { lenses: [inferredLens] };
      },
    };
    const frameModel: LensStructuredModel = {
      async invoke() {
        throw new Error('frame unavailable');
      },
    };

    const result = await new LensInferrer({ legacyModel, frameModel }).infer({
      sourceText: 'I am a founder seeking funding',
      profileContext: 'Oncology operator',
      frameConstrained: true,
    });

    expect(result).toEqual({ lenses: [inferredLens], sourceFrame: emptyFrame() });
  });

  it('preserves no-lenses behavior when legacy lens inference fails', async () => {
    const legacyModel: LensStructuredModel = {
      async invoke() {
        throw new Error('lens unavailable');
      },
    };
    const frameModel: LensStructuredModel = {
      async invoke() {
        return { sourceFrame: emptyFrame() };
      },
    };

    const result = await new LensInferrer({ legacyModel, frameModel }).infer({
      sourceText: 'I am a founder seeking funding',
      frameConstrained: true,
    });

    expect(result).toEqual({ lenses: [] });
  });

  it('keeps the flag-off path on the legacy prompt and model only', async () => {
    let legacyPrompts: string[] = [];
    let frameCalls = 0;
    const legacyModel: LensStructuredModel = {
      async invoke(input) {
        legacyPrompts = messageText(input);
        return { lenses: [inferredLens] };
      },
    };
    const frameModel: LensStructuredModel = {
      async invoke() {
        frameCalls += 1;
        return { sourceFrame: emptyFrame() };
      },
    };

    const result = await new LensInferrer({ legacyModel, frameModel }).infer({
      sourceText: 'find investors',
      profileContext: 'PROFILE_ONLY',
      maxLenses: 2,
      frameConstrained: false,
    });

    expect(legacyPrompts[0]).toContain('You analyze goals and search queries');
    expect(legacyPrompts[1]).toBe(
      'Identify up to 2 search perspectives for finding relevant matches.\n\nSource: "find investors"\n\nUser context: PROFILE_ONLY',
    );
    expect(frameCalls).toBe(0);
    expect(result).toEqual({ lenses: [inferredLens] });
  });

  it('uses a frame-only schema that allows reciprocal role inference', () => {
    const parsed = FrameResponseSchema.parse({
      lenses: [{ label: 'buyer', corpus: 'intents', reasoning: 'must be ignored by the frame schema' }],
      sourceFrame: {
        sourceRoles: [{ role: 'seller', evidence: 'selling' }],
        counterpartRoles: [{ role: 'buyer', evidence: 'selling' }],
        hardConstraints: [], namedEntities: [], domainVocabulary: [],
      },
    });
    expect(parsed).toEqual({
      sourceFrame: {
        sourceRoles: [{ role: 'seller', evidence: 'selling' }],
        counterpartRoles: [{ role: 'buyer', evidence: 'selling' }],
        hardConstraints: [], namedEntities: [], domainVocabulary: [],
      },
    });
    expect(HydeSourceFrameSchema.safeParse(parsed.sourceFrame).success).toBe(true);
  });
});
