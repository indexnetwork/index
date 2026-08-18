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
    expect(result!.questions).toEqual([
      {
        prompt: 'What equity range are you prepared to offer?',
        opportunityId: OPPORTUNITY_A,
        alsoUnblocks: [OPPORTUNITY_B],
      },
      {
        prompt: 'Can you be on-site one week per month?',
        opportunityId: OPPORTUNITY_C,
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
