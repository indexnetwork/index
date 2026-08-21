/**
 * The host behind `answer_pending_question` (#1466, repointed by the
 * intent-agent collapse, docs/plans/2026-08-21-holistic-intent-agent.md):
 * position → negotiation ref, then the IntentAgent's ONE answer executor —
 * dossier entry first, spine second, ledger third.
 *
 * The tool is given numbers and never an id — this module owns the mapping,
 * for the same reason the agent's own turn maps indices: a ref the model
 * could name is a ref it could get wrong, and a misroute resumes the wrong
 * negotiation with the wrong fact.
 *
 * What these specs also pin is the state the host may NOT report. On
 * 2026-08-20 at 21:11 the model was shown an open question and the host
 * answered `no_open_question` — whose copy tells the client "the
 * negotiations moved on" — while the task sat `input_required`. Openness is
 * the parked set, so `no_open_question` is reachable only when nothing is
 * parked, the only state that copy is true of.
 */
import { describe, expect, it } from 'bun:test';

import { serializeQuestionMessage } from '@indexnetwork/protocol';
import type { QuestionBlock } from '@indexnetwork/protocol';

import type { ParkedNegotiation } from '../../../adapters/parked-negotiation.reader.adapter';
import { answerOpenQuestion } from '../negotiator-answer.host';
import type { NegotiatorAnswerHostDeps } from '../negotiator-answer.host';
import { readOpenQuestionsForIntent } from '../open-question-message';
import type { IntentAgentEvent, IntentAgentExecutedAct, NegotiationAnswerOutcome } from '../../intent-agent/intent-agent.types';

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

interface ExecutedCall {
  event: IntentAgentEvent;
  opportunityId: string;
  answer: string;
}

function deps(overrides: Record<string, unknown> = {}, outcome: NegotiationAnswerOutcome = 'resumed_inflight') {
  const executed: ExecutedCall[] = [];
  const harness: NegotiatorAnswerHostDeps = {
    findSession: async () => ({ id: 'session-1' }),
    getSessionMessages: async () => [{ id: 'm2', role: 'assistant', content: BODY }],
    readParkedNegotiations: async () => [park(TIMING_OPPORTUNITY, 'Timing: This week')],
    executeAnswer: (async (event: IntentAgentEvent, input: { opportunityId: string; answer: string }) => {
      executed.push({ event, opportunityId: input.opportunityId, answer: input.answer });
      return {
        tool: 'answer_negotiation',
        opportunityId: input.opportunityId,
        answer: input.answer,
        dossierEntryId: 'dossier-1',
        outcome,
      } satisfies IntentAgentExecutedAct;
    }) as never,
    ...overrides,
  };
  return { executed, deps: harness };
}

describe('answerOpenQuestion', () => {
  it("maps the position the model was shown onto that question's negotiation ref", async () => {
    const { executed, deps: harness } = deps();

    const result = await answerOpenQuestion(USER_ID, {
      intentId: INTENT_ID,
      question: 2,
      answer: 'Up to twenty thousand.',
    }, harness);

    expect(result).toEqual({ status: 'routed', label: 'Budget' });
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({
      opportunityId: BUDGET_OPPORTUNITY,
      answer: 'Up to twenty thousand.',
    });
    // The ledger names the tool as what woke the act.
    expect(executed[0].event).toEqual({
      kind: 'answer_tool',
      userId: USER_ID,
      intentId: INTENT_ID,
      opportunityId: BUDGET_OPPORTUNITY,
      source: 'persona_tool',
    });
  });

  it('finds the question when a later agent message buried it — 21:11', async () => {
    // The incident. The park is live; the question-message is two messages up.
    const { executed, deps: harness } = deps({
      getSessionMessages: async () => [
        { id: 'm2', role: 'assistant', content: BODY },
        { id: 'm3', role: 'assistant', content: EDIT_CONFIRMATION },
        { id: 'm4', role: 'user', content: 'this month' },
      ],
    });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'This month.' }, harness);

    expect(result).toEqual({ status: 'routed', label: 'Timing: This week' });
    expect(executed[0]).toMatchObject({ opportunityId: TIMING_OPPORTUNITY, answer: 'This month.' });
  });

  it('routes against a derived block when the park has no delivered message', async () => {
    const { executed, deps: harness } = deps({
      getSessionMessages: async () => [{ id: 'm1', role: 'assistant', content: EDIT_CONFIRMATION }],
    });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'This month.' }, harness);

    // Same negotiation ref, so the same settlement resumes it: the executor
    // re-resolves the park and keys on the task's own settlement id, which
    // the block's shape never enters.
    expect(result).toEqual({ status: 'routed', label: 'Timing: This week' });
    expect(executed[0]).toMatchObject({ opportunityId: TIMING_OPPORTUNITY });
  });

  it('answers even for a signal with no DM — the park, not the conversation, is the record', async () => {
    // The retired queue path needed a session to consume the reply in; the
    // executor does not. An MCP client can answer for a signal whose DM was
    // never opened.
    const { executed, deps: harness } = deps({ findSession: async () => null });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'This month.' }, harness);

    expect(result).toEqual({ status: 'routed', label: 'Timing: This week' });
    expect(executed).toHaveLength(1);
  });

  it('reports the open count rather than guessing when the position names nothing', async () => {
    const { executed, deps: harness } = deps();

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 5, answer: 'Yes.' }, harness);

    expect(result).toEqual({ status: 'unknown_question', open: 2 });
    expect(executed).toHaveLength(0);
  });

  it('reports nothing open ONLY when nothing is parked', async () => {
    const { deps: harness } = deps({ readParkedNegotiations: async () => [] });

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'Yes.' }, harness);

    expect(result).toEqual({ status: 'no_open_question' });
  });

  it('a park that resolved between the read and the resume reports as nothing open', async () => {
    const { deps: harness } = deps({}, 'not_parked');

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'Yes.' }, harness);

    expect(result).toEqual({ status: 'no_open_question' });
  });

  it('an answer heard on an unresumable park still routes — the truth-telling is the caller business', async () => {
    const { deps: harness } = deps({}, 'recorded_unresumable');

    const result = await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'Yes.' }, harness);

    expect(result).toEqual({ status: 'routed', label: 'Timing: This week' });
  });

  it('never throws — a failed executor is reported, not raised', async () => {
    const { deps: harness } = deps({
      executeAnswer: (async () => { throw new Error('spine unavailable'); }) as never,
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
 * SAME resolution, not two implementations of one rule. They share
 * `readOpenQuestionsForIntent` — the function `chat.service.ts` calls to
 * build `openQuestions` and the one the host calls to resolve a position —
 * so a divergence would have to be a divergence inside one function.
 */
describe('context enumeration and host resolution', () => {
  it('agree on every position, buried question included', async () => {
    const { executed, deps: harness } = deps({
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
    expect(executed.map((call) => call.opportunityId)).toEqual([TIMING_OPPORTUNITY, BUDGET_OPPORTUNITY]);
  });

  it('close together: nothing in context, nothing routable', async () => {
    const { deps: harness } = deps({ readParkedNegotiations: async () => [] });

    expect(await readOpenQuestionsForIntent(USER_ID, INTENT_ID, harness)).toBeNull();
    expect(await answerOpenQuestion(USER_ID, { intentId: INTENT_ID, question: 1, answer: 'Yes.' }, harness))
      .toEqual({ status: 'no_open_question' });
  });
});
