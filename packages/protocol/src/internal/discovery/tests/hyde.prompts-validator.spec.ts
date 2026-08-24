import { describe, expect, it } from 'bun:test';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import type { BaseMessage } from '@langchain/core/messages';

import { buildFrameHydePrompt, HydeGenerator, type HydeGeneratorStructuredModel } from '../hyde.generator.js';
import type { HydeSourceFrame } from '../hyde.frame.js';
import { HYDE_CORPUS_PROMPTS } from '../hyde.strategies.js';
import { buildHydeValidationPrompt, HydeValidationResponseSchema, HydeValidator, type HydeValidatorStructuredModel } from '../hyde.validator.js';

const frame: HydeSourceFrame = {
  sourceRoles: [{ role: 'climate founder', evidence: 'climate founder' }],
  counterpartRoles: [{ role: 'investor', evidence: 'seed funding' }],
  hardConstraints: [
    { type: 'location', value: 'Berlin', evidence: 'Berlin' },
    { type: 'numeric', value: '€2m', evidence: '€2m' },
  ],
  namedEntities: [{ type: 'organization', name: 'Acme Labs', evidence: 'Acme Labs' }],
  domainVocabulary: [{ term: 'carbon removal', evidence: 'carbon removal' }],
};

function messages(input: BaseLanguageModelInput): BaseMessage[] {
  return input as BaseMessage[];
}

describe('frame-constrained HyDE generation prompt', () => {
  it('renders all frame slots and the allowed/forbidden elaboration boundary', () => {
    const prompt = buildFrameHydePrompt({
      sourceText: 'Acme Labs climate founder seeks €2m seed funding for carbon removal in Berlin',
      lens: 'ProfileCorp Zurich €9m specialist',
      corpus: 'profiles',
      sourceFrame: frame,
    });

    expect(prompt).toContain('Source roles: climate founder');
    expect(prompt).toContain('Counterpart/complementary roles: investor');
    expect(prompt).toContain('location: Berlin');
    expect(prompt).toContain('numeric: €2m');
    expect(prompt).toContain('organization: Acme Labs');
    expect(prompt).toContain('carbon removal');
    expect(prompt).toContain('generic roles');
    expect(prompt).toContain('reciprocal/complementary inversion');
    expect(prompt).toContain('MUST NOT introduce any new proper noun');
    expect(prompt).toContain('MUST NOT introduce any new hard location, time, numeric, credential, organization, or exclusivity constraint');
    expect(prompt).not.toContain('ProfileCorp Zurich €9m specialist');
    expect(prompt).not.toContain('Target lens');
  });

  it('retains the exact legacy corpus prompt when sourceFrame is absent', async () => {
    let humanPrompt = '';
    const model: HydeGeneratorStructuredModel = {
      async invoke(input) {
        humanPrompt = String(messages(input)[1]?.content);
        return { hypotheticalDocument: 'legacy output' };
      },
    };
    const input = { sourceText: 'Need a React co-founder', lens: 'frontend engineer', corpus: 'profiles' as const };
    const result = await new HydeGenerator(model).generate(input);

    expect(humanPrompt).toBe(HYDE_CORPUS_PROMPTS.profiles(input.sourceText, input.lens));
    expect(result).toEqual({ text: 'legacy output' });
  });
});

describe('HyDE validator', () => {
  it('parses valid and invalid verdicts from one provider-free batch call', async () => {
    let rendered = '';
    const model: HydeValidatorStructuredModel = {
      async invoke(input) {
        rendered = messages(input).map((message) => String(message.content)).join('\n');
        return {
          verdicts: [
            { key: 'd-a', valid: true, unsupportedNamedEntities: [], unsupportedHardConstraints: [], reasoning: 'Grounded.' },
            { key: 'd-b', valid: false, unsupportedNamedEntities: ['NewCo'], unsupportedHardConstraints: ['must be in Paris'], reasoning: 'Invented constraints.' },
          ],
        };
      },
    };
    const validator = new HydeValidator(model);
    const result = await validator.validate({
      sourceText: 'climate founder seeks funding',
      sourceFrame: { ...frame, namedEntities: [], hardConstraints: [] },
      documents: {
        'd-a': { corpus: 'profiles', text: 'I invest in climate companies.' },
        'd-b': { corpus: 'profiles', text: 'I work at NewCo in Paris.' },
      },
    });

    expect(result.verdicts.map((verdict) => verdict.valid)).toEqual([true, false]);
    expect(result.verdicts[1]?.unsupportedNamedEntities).toEqual(['NewCo']);
    expect(rendered).toContain('target voice');
    expect(rendered).toContain('reciprocal or complementary inversion');
    expect(rendered).not.toContain('profileContext');
  });

  it('rejects malformed verdict shapes deterministically', () => {
    expect(HydeValidationResponseSchema.safeParse({
      verdicts: [{ key: 'd-a', valid: 'yes', unsupportedNamedEntities: [], unsupportedHardConstraints: [], reasoning: '' }],
    }).success).toBe(false);
  });

  it('builds a validation prompt from source, frame, and opaque documents only', () => {
    const prompt = buildHydeValidationPrompt({
      sourceText: 'source',
      sourceFrame: frame,
      documents: { 'd-opaque': { corpus: 'profiles', text: 'generated' } },
    });
    expect(prompt).toContain('d-opaque');
    expect(prompt).not.toContain('profileContext');
    expect(prompt).not.toContain('specialized profile-only lens');
  });
});
