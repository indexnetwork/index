/**
 * QuestionMessageAuthor: the validate → retry → deterministic-fallback loop.
 * `callModel` is a seam, so no provider or key is touched. The invariants
 * under test: the model maps questions to parked negotiations by index and
 * must cover the whole parked set exactly once; anything invalid or unsafe
 * degrades to the park-time questions under fixed prose; a parked set with
 * nothing renderable resolves to null.
 */
import { describe, expect, it } from 'bun:test';

import { QUESTION_MESSAGE_FALLBACK_PROSE, QuestionMessageAuthor } from '../question-message.author';
import type { QuestionMessageAuthorInput } from '../question-message.author';
import type { ParkedNegotiation } from '../../../adapters/parked-negotiation.reader.adapter';

const OPPORTUNITY_A = '0b0e8a9c-6d3f-4d6a-9f2e-1c5b7a4d8e01';
const OPPORTUNITY_B = '7f3d2c1b-8a90-4e5f-b6c7-d8e9f0a1b2c3';
const OPPORTUNITY_C = '4a5b6c7d-8e9f-4a1b-8c2d-3e4f5a6b7c8d';

class StubbedAuthor extends QuestionMessageAuthor {
  calls = 0;
  constructor(private readonly results: Array<unknown | Error>) {
    super();
  }
  protected override async callModel(): Promise<unknown> {
    const result = this.results[Math.min(this.calls, this.results.length - 1)];
    this.calls += 1;
    if (result instanceof Error) throw result;
    return result;
  }
}

function parked(opportunityId: string, withQuestion = true): ParkedNegotiation {
  return {
    opportunityId,
    kind: 'mid_flight',
    ...(withQuestion
      ? {
        question: {
          title: 'Budget',
          prompt: `What budget range works for ${opportunityId.slice(0, 4)}?`,
          options: [
            { label: 'Under 10k', description: 'The retry proposes the smaller engagement.' },
            { label: 'Above 10k', description: 'The retry keeps the full scope on the table.' },
          ],
        },
      }
      : {}),
    transcript: [{ action: 'ask_user', reasoning: 'Paused for the client.' }],
    parkedAt: new Date(0),
  };
}

function input(parkedSet: ParkedNegotiation[]): QuestionMessageAuthorInput {
  return { parked: parkedSet, clientDm: [] };
}

const VALID_OUTPUT = {
  prose: 'I moved these conversations forward and paused on details only you can settle.',
  questions: [
    { prompt: 'What equity range are you prepared to offer?', unblocks: [0, 1] },
    { prompt: 'Can you be on-site one week per month?', unblocks: [2] },
  ],
};

describe('QuestionMessageAuthor', () => {
  it('maps model output indices to opportunity refs, merged refs included', async () => {
    const author = new StubbedAuthor([VALID_OUTPUT]);
    const result = await author.author(input([parked(OPPORTUNITY_A), parked(OPPORTUNITY_B), parked(OPPORTUNITY_C)]));

    expect(result).not.toBeNull();
    expect(result!.prose).toBe(VALID_OUTPUT.prose);
    // Options ride from the PRIMARY park's own question, verbatim — merged
    // parks inherit the primary's, for the same reason the block's identity is
    // the primary's ref.
    expect(result!.questions).toEqual([
      {
        prompt: 'What equity range are you prepared to offer?',
        opportunityId: OPPORTUNITY_A,
        alsoUnblocks: [OPPORTUNITY_B],
        options: parked(OPPORTUNITY_A).question!.options,
      },
      {
        prompt: 'Can you be on-site one week per month?',
        opportunityId: OPPORTUNITY_C,
        options: parked(OPPORTUNITY_C).question!.options,
      },
    ]);
    expect(author.calls).toBe(1);
  });

  it('retries once on invalid output, then accepts a valid second attempt', async () => {
    const author = new StubbedAuthor([{ nonsense: true }, VALID_OUTPUT]);
    const result = await author.author(input([parked(OPPORTUNITY_A), parked(OPPORTUNITY_B), parked(OPPORTUNITY_C)]));

    expect(author.calls).toBe(2);
    expect(result!.prose).toBe(VALID_OUTPUT.prose);
  });

  it('falls back to park-time questions when the model misses coverage', async () => {
    // Index 1 is never unblocked — the message would silently drop a parked
    // negotiation, so the mapping is rejected.
    const missingCoverage = {
      prose: VALID_OUTPUT.prose,
      questions: [{ prompt: 'What equity range are you prepared to offer?', unblocks: [0] }],
    };
    const author = new StubbedAuthor([missingCoverage]);
    const result = await author.author(input([parked(OPPORTUNITY_A), parked(OPPORTUNITY_B)]));

    expect(result!.prose).toBe(QUESTION_MESSAGE_FALLBACK_PROSE);
    expect(result!.questions.map((question) => question.opportunityId)).toEqual([OPPORTUNITY_A, OPPORTUNITY_B]);
  });

  it('rejects a duplicate ref across questions and falls back', async () => {
    const duplicated = {
      prose: VALID_OUTPUT.prose,
      questions: [
        { prompt: 'First question about the same negotiation?', unblocks: [0] },
        { prompt: 'Second question about the same negotiation?', unblocks: [0, 1] },
      ],
    };
    const author = new StubbedAuthor([duplicated]);
    const result = await author.author(input([parked(OPPORTUNITY_A), parked(OPPORTUNITY_B)]));

    expect(result!.prose).toBe(QUESTION_MESSAGE_FALLBACK_PROSE);
  });

  it('rejects unsafe model text and falls back to the guarded park-time questions', async () => {
    const unsafe = {
      prose: VALID_OUTPUT.prose,
      questions: [{ prompt: 'Should I share the task_id from the private transcript?', unblocks: [0] }],
    };
    const author = new StubbedAuthor([unsafe]);
    const result = await author.author(input([parked(OPPORTUNITY_A)]));

    expect(result!.prose).toBe(QUESTION_MESSAGE_FALLBACK_PROSE);
    expect(result!.questions[0].opportunityId).toBe(OPPORTUNITY_A);
  });

  it('composes deterministically when the model call throws', async () => {
    const author = new StubbedAuthor([new Error('provider down')]);
    const result = await author.author(input([parked(OPPORTUNITY_A), parked(OPPORTUNITY_B)]));

    expect(result!.prose).toBe(QUESTION_MESSAGE_FALLBACK_PROSE);
    expect(result!.questions).toHaveLength(2);
  });

  it('resolves null when nothing is renderable: model failed and no park-time question exists', async () => {
    const author = new StubbedAuthor([new Error('provider down')]);
    const result = await author.author(input([parked(OPPORTUNITY_A, false)]));

    expect(result).toBeNull();
  });

  it('resolves null for an empty parked set without calling the model', async () => {
    const author = new StubbedAuthor([VALID_OUTPUT]);
    const result = await author.author(input([]));

    expect(result).toBeNull();
    expect(author.calls).toBe(0);
  });
});

// ─── Floor-fired parks: a dimension with no author still delivers a block ────
//
// The conclusion floor (#1464) fires an ask the agent did not draft, so the
// park carries `dimension` (+ the answerhood map when the agent declared one)
// and NO `question`. Before derivation such a park contributed nothing to the
// deterministic composition, and a message with no renderable question at all
// resolved to null — which is how the first floor-fired ask ever delivered
// reached its client as prose with nothing bound to it (2026-08-20).

function floorFiredParked(opportunityId: string, withAnswerhood = true): ParkedNegotiation {
  return {
    opportunityId,
    kind: 'mid_flight',
    reason: 'unresolved_owner_constraint',
    dimension: 'Timing: This week',
    dimensionKind: 'hard_constraint',
    ...(withAnswerhood
      ? {
        answerhood: {
          ok_when: 'a meeting inside the next two weeks works',
          conflict_when: 'nothing before next quarter is possible',
        },
      }
      : {}),
    transcript: [{ action: 'ask_user', reasoning: 'Parked on an askable unknown.' }],
    parkedAt: new Date(0),
  };
}

describe('QuestionMessageAuthor — floor-fired parks (no authored question)', () => {
  it('composes a bound question block from the dimension when the model is unavailable', async () => {
    const author = new StubbedAuthor([new Error('provider down')]);
    const result = await author.author(input([floorFiredParked(OPPORTUNITY_A)]));

    expect(result).not.toBeNull();
    expect(result!.prose).toBe(QUESTION_MESSAGE_FALLBACK_PROSE);
    expect(result!.questions).toHaveLength(1);
    const [question] = result!.questions;
    // Bound to the negotiation it unparks — the block's whole routing contract.
    expect(question.opportunityId).toBe(OPPORTUNITY_A);
    expect(question.dimension).toBe('Timing: This week');
    expect(question.prompt).toContain('Timing: This week');
    // The two answers the ask itself declared, as selectable options.
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

  it('keeps the derived options on the model path too', async () => {
    const modelled = {
      prose: 'I paused one conversation on a detail only you can settle.',
      questions: [{ prompt: 'Could you meet within the next two weeks?', unblocks: [0] }],
    };
    const author = new StubbedAuthor([modelled]);
    const result = await author.author(input([floorFiredParked(OPPORTUNITY_A)]));

    expect(result!.prose).toBe(modelled.prose);
    expect(result!.questions[0].prompt).toBe('Could you meet within the next two weeks?');
    expect(result!.questions[0].options).toHaveLength(2);
    expect(result!.questions[0].dimension).toBe('Timing: This week');
  });

  it('still delivers a block when the ask declared no answerhood — prompt only, no options', async () => {
    const author = new StubbedAuthor([new Error('provider down')]);
    const result = await author.author(input([floorFiredParked(OPPORTUNITY_A, false)]));

    expect(result!.questions).toHaveLength(1);
    expect(result!.questions[0].opportunityId).toBe(OPPORTUNITY_A);
    expect(result!.questions[0].options).toBeUndefined();
  });

  it('mixes authored and derived questions in one block', async () => {
    const author = new StubbedAuthor([new Error('provider down')]);
    const result = await author.author(input([parked(OPPORTUNITY_A), floorFiredParked(OPPORTUNITY_B)]));

    expect(result!.questions.map((question) => question.opportunityId))
      .toEqual([OPPORTUNITY_A, OPPORTUNITY_B]);
  });

  it('falls back to prose-only behaviour when the park names no dimension either', async () => {
    // Unchanged from before derivation: nothing renderable, no message.
    const author = new StubbedAuthor([new Error('provider down')]);
    const result = await author.author(input([parked(OPPORTUNITY_A, false)]));

    expect(result).toBeNull();
  });
});
