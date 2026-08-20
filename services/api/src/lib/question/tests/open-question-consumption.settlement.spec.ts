/**
 * One settlement, whichever shape the block arrived in.
 *
 * Openness is now the parked set, so the block an answer is consumed against
 * may be the DELIVERED question-message or one DERIVED from the parked turns
 * (`open-question-message.ts`). That is a new degree of freedom, and it must
 * not become a new way to resume a negotiation twice — or to resume it under a
 * different key and lose the idempotency the spine depends on.
 *
 * It does not, and this pins why: the block carries a negotiation REF and
 * nothing else. Consumption re-resolves that ref to its current park and keys
 * the settle on the task's own `negotiationQuestionSettlementId(taskId)`. The
 * shape of the question the client answered never enters it.
 */
import { describe, expect, test } from 'bun:test';

import { consumeQuestionBlockAnswers, negotiationQuestionSettlementId, serializeQuestionMessage } from '@indexnetwork/protocol';
import type { InflightAnswerSettlementInput, NegotiationAnswerConsumptionPorts, QuestionBlock } from '@indexnetwork/protocol';

import type { ParkedNegotiation } from '../../../adapters/parked-negotiation.reader.adapter';
import { readOpenQuestionsForIntent } from '../open-question-message';

const USER_ID = 'user-1';
const INTENT_ID = 'intent-1';
const OPPORTUNITY = '6d8b07ef-7fa8-4968-80d9-6af0ce364d27';
const TASK_ID = 'task-1';
const ANSWER = 'This month.';

const DELIVERED_BLOCK: QuestionBlock = {
  version: 1,
  questions: [{ prompt: 'When could you meet?', opportunityId: OPPORTUNITY, dimension: 'Timing: This week' }],
};
const DELIVERED_BODY = serializeQuestionMessage('One conversation is waiting on you.', DELIVERED_BLOCK);

const PARK: ParkedNegotiation = {
  opportunityId: OPPORTUNITY,
  kind: 'mid_flight',
  dimension: 'Timing: This week',
  dimensionKind: 'hard_constraint',
  transcript: [],
  parkedAt: new Date('2026-08-20T20:20:00Z'),
};

/** The mid-flight park shape `classifyParkedNegotiation` demands. */
function ports() {
  const settled: InflightAnswerSettlementInput[] = [];
  const resumed: Array<{ taskId: string; settlementId: string }> = [];
  return {
    settled,
    resumed,
    ports: {
      database: {
        getNegotiationTaskForOpportunity: async () => ({
          id: TASK_ID,
          state: 'input_required',
          metadata: {
            type: 'negotiation',
            opportunityId: OPPORTUNITY,
            turnContext: {
              askUserBinding: {
                settlementId: negotiationQuestionSettlementId(TASK_ID),
                recipientUserId: USER_ID,
                recipientIntentId: INTENT_ID,
                networkId: 'network-1',
                opportunityId: OPPORTUNITY,
              },
            },
          },
        }),
        getNegotiationMessages: async () => [],
      },
      settleInflightAnswer: async (input: InflightAnswerSettlementInput) => {
        settled.push(input);
        return 'settled' as const;
      },
      enqueueInflightResume: async (input: { taskId: string; settlementId: string }) => {
        resumed.push({ taskId: input.taskId, settlementId: input.settlementId });
      },
      recordOpportunityAnswer: async () => {},
      enqueueStalledRetry: async () => {},
    } as unknown as NegotiationAnswerConsumptionPorts,
  };
}

async function resolveBlock(messages: Array<{ id: string; role: string; content: string }>): Promise<QuestionBlock> {
  const open = await readOpenQuestionsForIntent(USER_ID, INTENT_ID, {
    findSession: async () => ({ id: 'session-1' }),
    getSessionMessages: async () => messages,
    readParkedNegotiations: async () => [PARK],
  });
  if (!open) throw new Error('expected the park to be open');
  return open.block;
}

describe('answer consumption across delivered and derived blocks', () => {
  test('both shapes settle the same park under the same settlement id', async () => {
    // Delivered: the client answered the message they can see, buried or not.
    const delivered = await resolveBlock([
      { id: 'm2', role: 'assistant', content: DELIVERED_BODY },
      { id: 'm3', role: 'assistant', content: 'Updated your signal.' },
    ]);
    // Derived: the park's rendering never reached the DM.
    const derived = await resolveBlock([{ id: 'm1', role: 'assistant', content: 'Updated your signal.' }]);
    expect(delivered.questions[0].prompt).not.toBe(derived.questions[0].prompt);

    const first = ports();
    await consumeQuestionBlockAnswers(first.ports, {
      block: delivered,
      userId: USER_ID,
      answers: [{ ref: OPPORTUNITY, answerText: ANSWER }],
      answeredAt: '2026-08-20T21:11:00.000Z',
    });
    const second = ports();
    await consumeQuestionBlockAnswers(second.ports, {
      block: derived,
      userId: USER_ID,
      answers: [{ ref: OPPORTUNITY, answerText: ANSWER }],
      answeredAt: '2026-08-20T21:11:00.000Z',
    });

    // Identical settlements: the ref is the identity, the prompt is dressing.
    expect(first.settled).toEqual(second.settled);
    expect(first.settled[0]?.settlementId).toBe(negotiationQuestionSettlementId(TASK_ID));
    expect(first.resumed).toEqual(second.resumed);
    // So a delivered-shape delivery and a derived-shape delivery of the same
    // answer are the SAME delivery twice — which the CAS on the parked task
    // reports as `already_settled` and never resumes twice.
    expect(first.resumed).toEqual([{ taskId: TASK_ID, settlementId: negotiationQuestionSettlementId(TASK_ID) }]);
  });
});
