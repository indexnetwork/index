/**
 * The host behind `answer_pending_question` (#1466): position → negotiation
 * ref, then the same consumption path every other answer takes.
 *
 * The tool is given numbers and never an id — this module owns the mapping,
 * for the same reason the answer router does not see one: a ref the model
 * could name is a ref it could get wrong, and a misroute resumes the wrong
 * negotiation with the wrong fact.
 */
import { describe, expect, it } from 'bun:test';

import { serializeQuestionMessage } from '@indexnetwork/protocol';
import type { QuestionBlock } from '@indexnetwork/protocol';

import { answerOpenQuestion } from '../negotiator-answer.host';

const USER_ID = 'user-1';
const INTENT_ID = 'intent-1';
const TIMING_OPPORTUNITY = '6d8b07ef-7fa8-4968-80d9-6af0ce364d27';
const BUDGET_OPPORTUNITY = '7f3d2c1b-8a90-4e5f-b6c7-d8e9f0a1b2c3';

const BLOCK: QuestionBlock = {
  version: 1,
  questions: [
    { prompt: 'When could you meet?', opportunityId: TIMING_OPPORTUNITY, dimension: 'Timing: This week' },
    { prompt: 'What budget range works?', opportunityId: BUDGET_OPPORTUNITY, dimension: 'Budget' },
  ],
};
const BODY = serializeQuestionMessage('Two conversations are waiting on you.', BLOCK);

interface Enqueued {
  replyMessageId: string;
  precedence?: { questionMessageId: string; routedAnswers: Array<{ ref: string; answerText: string }> };
}

function deps(overrides: Record<string, unknown> = {}) {
  const enqueued: Enqueued[] = [];
  return {
    enqueued,
    deps: {
      findSession: async () => ({ id: 'session-1' }),
      getSessionMessages: async () => [{ id: 'm2', role: 'assistant', content: BODY }],
      readParkedNegotiations: async () => [{ opportunityId: TIMING_OPPORTUNITY }],
      enqueueAnswer: (async (input: Enqueued) => { enqueued.push(input); return true; }) as never,
      ...overrides,
    },
  };
}

describe('answerOpenQuestion', () => {
  it('maps the position the model was shown onto that question\'s negotiation ref', async () => {
    const { enqueued, deps: harness } = deps();

    const result = await answerOpenQuestion(USER_ID, {
      intentId: INTENT_ID,
      question: 2,
      answer: 'Up to twenty thousand.',
    }, harness);

    expect(result).toEqual({ status: 'routed', label: 'Budget' });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].precedence).toMatchObject({
      questionMessageId: 'm2',
      routedAnswers: [{ ref: BUDGET_OPPORTUNITY, answerText: 'Up to twenty thousand.' }],
    });
    // Two tool calls for the same question in one turn coalesce on this id;
    // everything below the enqueue is settlement-keyed and idempotent.
    expect(enqueued[0].replyMessageId).toBe(`tool-answer.${BUDGET_OPPORTUNITY}`);
  });

  it('reports the open count rather than guessing when the position names nothing', async () => {
    const { enqueued, deps: harness } = deps();

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 5, answer: 'Yes.' }, harness);

    expect(result).toEqual({ status: 'unknown_question', open: 2 });
    expect(enqueued).toHaveLength(0);
  });

  it('reports nothing open when the block\'s negotiations have all resolved', async () => {
    const { deps: harness } = deps({ readParkedNegotiations: async () => [] });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'Yes.' }, harness);

    expect(result).toEqual({ status: 'no_open_question' });
  });

  it('reports nothing open when the signal has no DM at all', async () => {
    const { deps: harness } = deps({ findSession: async () => null });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'Yes.' }, harness);

    expect(result).toEqual({ status: 'no_open_question' });
  });

  it('never throws — a failed enqueue is reported, not raised', async () => {
    const { deps: harness } = deps({
      enqueueAnswer: (async () => { throw new Error('queue unavailable'); }) as never,
    });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'Yes.' }, harness);

    expect(result).toEqual({ status: 'error' });
  });

  it('refuses an empty answer without touching the conversation', async () => {
    let read = false;
    const { deps: harness } = deps({
      findSession: async () => { read = true; return { id: 'session-1' }; },
    });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: '  ' }, harness);

    expect(result).toEqual({ status: 'error' });
    expect(read).toBe(false);
  });
});
