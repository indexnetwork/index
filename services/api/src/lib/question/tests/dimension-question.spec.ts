/**
 * Deriving a question from the dimension a floor-fired park names (#1464 →
 * #1466). No model call: the derivation is deterministic, because an arrow
 * that matters must not be a model's choice.
 */
import { describe, expect, it } from 'bun:test';

import { MAX_DERIVED_TITLE_CHARS, deriveQuestionFromDimension, renderableQuestion, titleFromDimension } from '../dimension-question';
import type { ParkedNegotiation } from '../../../adapters/parked-negotiation.reader.adapter';

const OPPORTUNITY = '6d8b07ef-7fa8-4968-80d9-6af0ce364d27';

function parked(overrides: Partial<ParkedNegotiation> = {}): ParkedNegotiation {
  return {
    opportunityId: OPPORTUNITY,
    kind: 'mid_flight',
    dimension: 'Timing: This week',
    dimensionKind: 'hard_constraint',
    answerhood: {
      ok_when: 'a meeting inside the next two weeks works',
      conflict_when: 'nothing before next quarter is possible',
    },
    transcript: [],
    parkedAt: new Date(0),
    ...overrides,
  };
}

describe('titleFromDimension', () => {
  it('takes the decision-domain noun and respects the title cap', () => {
    expect(titleFromDimension('Timing: This week')).toBe('Timing');
    expect(titleFromDimension('Stage fit (pre-seed)')).toBe('Stage fit');
    expect(titleFromDimension('Compensation expectations alignment').length)
      .toBeLessThanOrEqual(MAX_DERIVED_TITLE_CHARS);
  });

  it('never resolves empty', () => {
    expect(titleFromDimension(':::').length).toBeGreaterThan(0);
  });
});

describe('deriveQuestionFromDimension', () => {
  it('names the dimension and what kind of fact it is, and ends in a question', () => {
    const question = deriveQuestionFromDimension(parked())!;

    expect(question.title).toBe('Timing');
    expect(question.prompt).toContain('Timing: This week');
    expect(question.prompt).toContain('a constraint I cannot work around on my own');
    expect(question.prompt.trimEnd().endsWith('?')).toBe(true);
    expect(question.prompt.length).toBeLessThanOrEqual(400);
  });

  it('turns the declared answerhood into the two options, each with its consequence', () => {
    const question = deriveQuestionFromDimension(parked())!;

    expect(question.options).toEqual([
      {
        label: 'a meeting inside the next two weeks works',
        description: 'That settles timing and I carry the negotiation forward on it.',
      },
      {
        label: 'nothing before next quarter is possible',
        description: 'That marks timing as a conflict and I stop pressing it there.',
      },
    ]);
  });

  it('still derives a question when the ask declared no answerhood', () => {
    const question = deriveQuestionFromDimension(parked({ answerhood: undefined }))!;

    expect(question.prompt).toContain('Timing: This week');
    expect(question.options).toEqual([]);
  });

  it('omits the kind clause when the checklist did not carry the dimension', () => {
    const question = deriveQuestionFromDimension(parked({ dimensionKind: undefined }))!;

    expect(question.prompt).toContain('Timing: This week');
    expect(question.prompt).not.toContain('constraint I cannot work around');
  });

  it('derives nothing at all when the park names no dimension', () => {
    expect(deriveQuestionFromDimension(parked({ dimension: undefined }))).toBeUndefined();
  });

  it('drops the whole derivation when the dimension name would leak into a prompt', () => {
    // The dimension name is agent-written, and this is the first surface that
    // renders it as a question rather than as a label.
    expect(deriveQuestionFromDimension(parked({ dimension: 'Whether to share the seed assessment' })))
      .toBeUndefined();
  });

  it('drops only the options when an answerhood half would leak', () => {
    const question = deriveQuestionFromDimension(parked({
      answerhood: { ok_when: 'Bianca is available on Thursday', conflict_when: 'she is not' },
    }))!;

    // The block still binds to its negotiation, which is the property that
    // matters; only the selectable answers are withheld.
    expect(question.prompt).toContain('Timing: This week');
    expect(question.options).toEqual([]);
  });
});

describe('renderableQuestion', () => {
  it('prefers the question the agent actually authored', () => {
    const authored = {
      title: 'Budget',
      prompt: 'What budget range works?',
      options: [
        { label: 'Under 10k', description: 'I propose the smaller engagement.' },
        { label: 'Above 10k', description: 'I keep the full scope on the table.' },
      ],
    };

    expect(renderableQuestion(parked({ question: authored }))).toBe(authored);
  });

  it('falls back to the derived one when there is no author', () => {
    expect(renderableQuestion(parked())?.title).toBe('Timing');
  });
});
