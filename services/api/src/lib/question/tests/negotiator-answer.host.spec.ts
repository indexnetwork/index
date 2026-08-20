/**
 * The host behind `answer_pending_question` (#1466): position → negotiation
 * ref, then the same consumption path every other answer takes.
 *
 * The tool is given numbers and never an id — this module owns the mapping,
 * for the same reason the answer router does not see one: a ref the model
 * could name is a ref it could get wrong, and a misroute resumes the wrong
 * negotiation with the wrong fact.
 *
 * What these specs now also pin is the state the host may NOT report. On
 * 2026-08-20 at 21:11 the model was shown an open question and called this
 * tool with `question: 1`; the host resolved openness from the newest agent
 * message, found an edit-confirmation there, and answered `no_open_question` —
 * whose copy tells the client "the negotiations moved on". The task was
 * `input_required` and stayed so. `no_open_question` is now reachable only
 * when nothing is parked, which is the only state that copy is true of.
 */
import { describe, expect, it } from 'bun:test';

import { serializeQuestionMessage } from '@indexnetwork/protocol';
import type { QuestionBlock } from '@indexnetwork/protocol';

import type { ParkedNegotiation } from '../../../adapters/parked-negotiation.reader.adapter';
import { answerOpenQuestion } from '../negotiator-answer.host';
import { readOpenQuestionsForIntent } from '../open-question-message';

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

/** The message that buries the question without settling it. */
const EDIT_CONFIRMATION = 'Updated your signal: timing is now open to this month.';

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

interface Enqueued {
  sessionId: string;
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
      readParkedNegotiations: async () => [park(TIMING_OPPORTUNITY, 'Timing: This week')],
      enqueueAnswer: (async (input: Enqueued) => { enqueued.push(input); return true; }) as never,
      ...overrides,
    },
  };
}

describe('answerOpenQuestion', () => {
  it("maps the position the model was shown onto that question's negotiation ref", async () => {
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

  it('finds the question when a later agent message buried it — 21:11', async () => {
    // The incident. The park is live; the question-message is two messages up.
    // This call used to return `no_open_question`.
    const { enqueued, deps: harness } = deps({
      getSessionMessages: async () => [
        { id: 'm2', role: 'assistant', content: BODY },
        { id: 'm3', role: 'assistant', content: EDIT_CONFIRMATION },
        { id: 'm4', role: 'user', content: 'this month' },
      ],
    });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'This month.' }, harness);

    expect(result).toEqual({ status: 'routed', label: 'Timing: This week' });
    expect(enqueued[0].precedence).toMatchObject({
      questionMessageId: 'm2',
      routedAnswers: [{ ref: TIMING_OPPORTUNITY, answerText: 'This month.' }],
    });
  });

  it('routes against a derived block when the park has no delivered message', async () => {
    const { enqueued, deps: harness } = deps({
      getSessionMessages: async () => [{ id: 'm1', role: 'assistant', content: EDIT_CONFIRMATION }],
    });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'This month.' }, harness);

    // Same negotiation ref, so the same settlement resumes it: consumption
    // re-resolves the park and keys on the task's own settlement id, which the
    // block's shape never enters.
    expect(result).toEqual({ status: 'routed', label: 'Timing: This week' });
    expect(enqueued[0].precedence?.routedAnswers).toEqual([
      { ref: TIMING_OPPORTUNITY, answerText: 'This month.' },
    ]);
    expect(enqueued[0].replyMessageId).toBe(`tool-answer.${TIMING_OPPORTUNITY}`);
  });

  it('reports the open count rather than guessing when the position names nothing', async () => {
    const { enqueued, deps: harness } = deps();

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 5, answer: 'Yes.' }, harness);

    expect(result).toEqual({ status: 'unknown_question', open: 2 });
    expect(enqueued).toHaveLength(0);
  });

  it('reports nothing open ONLY when nothing is parked', async () => {
    // The one state in which telling the client the negotiations moved on is
    // the truth: the parks resolved or expired. The question-message may still
    // be sitting in the DM — it is a stale rendering, and answering it would
    // resume nothing.
    const { deps: harness } = deps({ readParkedNegotiations: async () => [] });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'Yes.' }, harness);

    expect(result).toEqual({ status: 'no_open_question' });
  });

  it('reports an honest failure, not a close-out, when the signal has no DM', async () => {
    // Previously `no_open_question` — which would tell a client with a LIVE
    // park that their negotiations had moved on. They have not; the reply
    // simply has no conversation to be consumed in, which cannot happen from a
    // tool call made inside that very DM.
    const { deps: harness } = deps({ findSession: async () => null });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'Yes.' }, harness);

    expect(result).toEqual({ status: 'error' });
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
      readParkedNegotiations: async () => { read = true; return [park(TIMING_OPPORTUNITY, 'Timing: This week')]; },
    });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: '  ' }, harness);

    expect(result).toEqual({ status: 'error' });
    expect(read).toBe(false);
  });
});

/**
 * The context the model is shown and the host that resolves its call are the
 * SAME resolution, not two implementations of one rule.
 *
 * On 2026-08-20 they disagreed: the orchestrator's context listed an open
 * question, the model called the tool with its number, and the host said
 * nothing was open. Both read the DM; only one of them was looking at the
 * right anchor. They now share `readOpenQuestionsForIntent` — the function
 * `chat.service.ts` calls to build `openQuestions` and the one the host calls
 * to resolve a position — so a divergence would have to be a divergence inside
 * one function.
 */
describe('context enumeration and host resolution', () => {
  it('agree on every position, buried question included', async () => {
    const { enqueued, deps: harness } = deps({
      getSessionMessages: async () => [
        { id: 'm2', role: 'assistant', content: BODY },
        { id: 'm3', role: 'assistant', content: EDIT_CONFIRMATION },
      ],
      readParkedNegotiations: async () => [
        park(TIMING_OPPORTUNITY, 'Timing: This week'),
        park(BUDGET_OPPORTUNITY, 'Budget'),
      ],
    });

    // What the negotiator persona is given (chat.service.ts builds its
    // `openQuestions` from exactly this call's `questions`).
    const context = await readOpenQuestionsForIntent(USER_ID, INTENT_ID, harness);
    expect(context?.questions.map((question) => question.label)).toEqual(['Timing: This week', 'Budget']);

    // What the host does with the number the model reads off that context.
    for (const question of context!.questions) {
      const result = await answerOpenQuestion(USER_ID, {
        intentId: INTENT_ID,
        question: question.position,
        answer: 'Answered.',
      }, harness);
      expect(result).toEqual({ status: 'routed', label: question.label });
    }
    expect(enqueued.map((job) => job.precedence?.routedAnswers[0]?.ref))
      .toEqual([TIMING_OPPORTUNITY, BUDGET_OPPORTUNITY]);
  });

  it('close together: nothing in context, nothing routable', async () => {
    const { deps: harness } = deps({ readParkedNegotiations: async () => [] });

    expect(await readOpenQuestionsForIntent(USER_ID, INTENT_ID, harness)).toBeNull();
    expect(await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'Yes.' }, harness))
      .toEqual({ status: 'no_open_question' });
  });
});
