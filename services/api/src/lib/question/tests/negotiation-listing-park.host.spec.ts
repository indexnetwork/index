/**
 * The host behind `list_negotiations`' park annotations (#1472), and the
 * anti-divergence contract it exists to hold.
 *
 * The listing was the last surface answering "what is happening on this
 * pairing?" from a source of its own — opportunity status, where a parked
 * pairing legitimately reads `negotiating`. On 2026-08-20 the model held a
 * correct open-questions context section AND a listing that said "still
 * negotiating", and it went with the tool: "there are currently no open
 * questions… nothing for you to decide", while a task had sat
 * `input_required` on the client's side for two hours.
 *
 * So the number the listing prints and the number `answer_pending_question`
 * routes against must come from ONE call. These specs drive both from a single
 * fixture and assert they are equal — the #1470 pattern, one surface further.
 */
import { describe, expect, it } from 'bun:test';

import { serializeQuestionMessage } from '@indexnetwork/protocol';
import type { QuestionBlock } from '@indexnetwork/protocol';

import type { ParkedNegotiation } from '../../../adapters/parked-negotiation.reader.adapter';
import { readListingOpenQuestions } from '../negotiation-listing-park.host';
import { readOpenQuestionsForIntent } from '../open-question-message';

const USER_ID = '6c17f313-0000-4000-8000-000000000001';
const INTENT_ID = '34fa30bc-0000-4000-8000-000000000002';
const TIMING_OPPORTUNITY = '6d8b07ef-7fa8-4968-80d9-6af0ce364d27';
const BUDGET_OPPORTUNITY = '7f3d2c1b-8a90-4e5f-b6c7-d8e9f0a1b2c3';
const SIBLING_OPPORTUNITY = '1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

/** The incident's own block: the buried question is question 1. */
const BLOCK: QuestionBlock = {
  version: 1,
  questions: [
    { prompt: 'When could you meet?', opportunityId: TIMING_OPPORTUNITY, dimension: 'Timing: This week' },
    { prompt: 'What budget range works?', opportunityId: BUDGET_OPPORTUNITY, dimension: 'Budget' },
  ],
};
const BODY = serializeQuestionMessage('Two conversations are waiting on you.', BLOCK);

function park(opportunityId: string, dimension: string): ParkedNegotiation {
  return {
    opportunityId,
    kind: 'mid_flight',
    dimension,
    dimensionKind: 'hard_constraint',
    transcript: [],
    parkedAt: new Date('2026-08-20T20:20:00Z'),
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    findSession: async () => ({ id: 'session-1' }),
    getSessionMessages: async () => [
      { id: 'm1', role: 'assistant', content: BODY },
      // The message that buried the question without settling it.
      { id: 'm2', role: 'assistant', content: 'Updated your signal: timing is now open to this month.' },
    ],
    readParkedNegotiations: async () => [
      park(TIMING_OPPORTUNITY, 'Timing: This week'),
      park(BUDGET_OPPORTUNITY, 'Budget'),
    ],
    ...overrides,
  };
}

describe('readListingOpenQuestions', () => {
  it('numbers each negotiation exactly as the open-questions enumeration does', async () => {
    const harness = deps();

    const listing = await readListingOpenQuestions(USER_ID, INTENT_ID, harness);
    const enumeration = await readOpenQuestionsForIntent(USER_ID, INTENT_ID, harness);

    // The anti-divergence assertion: same fixture, one call underneath, so the
    // listing's numbers ARE the enumeration's numbers — and the enumeration's
    // numbers are what the prompt section renders and the answer host resolves.
    expect(enumeration).not.toBeNull();
    for (const question of enumeration!.questions) {
      const annotation = listing.find((entry) => entry.opportunityId === question.opportunityId);
      expect(annotation).toBeDefined();
      expect(annotation!.question).toBe(question.position);
      expect(annotation!.label).toBe(question.label);
    }
    expect(listing).toHaveLength(enumeration!.questions.length);
  });

  it("names the incident's buried question as question 1", async () => {
    const listing = await readListingOpenQuestions(USER_ID, INTENT_ID, deps());

    expect(listing.find((entry) => entry.opportunityId === TIMING_OPPORTUNITY)).toEqual({
      opportunityId: TIMING_OPPORTUNITY,
      question: 1,
      label: 'Timing: This week',
    });
  });

  it('annotates every negotiation one question unblocks with that question\'s number', async () => {
    const block: QuestionBlock = {
      version: 1,
      questions: [{
        prompt: 'When could you meet?',
        opportunityId: TIMING_OPPORTUNITY,
        dimension: 'Timing: This week',
        alsoUnblocks: [SIBLING_OPPORTUNITY],
      }],
    };
    const harness = deps({
      getSessionMessages: async () => [{ id: 'm1', role: 'assistant', content: serializeQuestionMessage('Waiting on you.', block) }],
      readParkedNegotiations: async () => [
        park(TIMING_OPPORTUNITY, 'Timing: This week'),
        park(SIBLING_OPPORTUNITY, 'Timing: This week'),
      ],
    });

    const listing = await readListingOpenQuestions(USER_ID, INTENT_ID, harness);

    // One answer resumes both, so both pairings carry the same number — the
    // alternative is one of them rendering as parked-with-no-number beside its
    // sibling, which is the same divergence one level down.
    expect(listing).toEqual([
      { opportunityId: TIMING_OPPORTUNITY, question: 1, label: 'Timing: This week' },
      { opportunityId: SIBLING_OPPORTUNITY, question: 1, label: 'Timing: This week' },
    ]);
  });

  it('returns nothing when nothing is parked on this user for this signal', async () => {
    const listing = await readListingOpenQuestions(USER_ID, INTENT_ID, deps({
      readParkedNegotiations: async () => [],
    }));

    expect(listing).toEqual([]);
  });

  it('degrades to no annotations rather than failing the listing', async () => {
    const listing = await readListingOpenQuestions(USER_ID, INTENT_ID, deps({
      readParkedNegotiations: async () => { throw new Error('db down'); },
    }));

    expect(listing).toEqual([]);
  });
});
