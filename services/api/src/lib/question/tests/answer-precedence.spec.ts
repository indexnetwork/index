/**
 * Answer precedence: while a question is open in a signal's negotiator DM,
 * the evaluator sees a free-text reply BEFORE the orchestrator does.
 *
 * The incident this encodes (2026-08-20, sandbox): a negotiation parked on the
 * checklist dimension "Timing: This week" asked its client; three minutes
 * later the client replied "This month?"; the chat orchestrator's signal edit
 * rule consumed it and rewrote the intent, and the negotiation that asked was
 * never told. The evaluator was always capable of recognizing that reply — it
 * simply ran after the orchestrator had finished.
 *
 * The three outcomes under test are the whole contract: an answer never
 * reaches the orchestrator, a decline always does, and with no open question
 * nothing here runs at all.
 */
import { describe, expect, it } from 'bun:test';

import { negotiationQuestionSettlementId, serializeQuestionMessage } from '@indexnetwork/protocol';
import type { NegotiationAnswerConsumptionPorts, QuestionBlock } from '@indexnetwork/protocol';

import { evaluateQuestionAnswerPrecedence } from '../answer-precedence';
import type { AnswerPrecedenceDeps } from '../answer-precedence';

const USER_ID = 'user-1';
const INTENT_ID = 'intent-1';
const SESSION_ID = 'session-1';
const PARKED_OPPORTUNITY = '6d8b07ef-7fa8-4968-80d9-6af0ce364d27';

const BLOCK: QuestionBlock = {
  version: 1,
  questions: [{
    prompt: 'Timing: This week — a constraint I cannot work around on my own. Where do you land?',
    opportunityId: PARKED_OPPORTUNITY,
    dimension: 'Timing: This week',
  }],
};

const QUESTION_MESSAGE_BODY = serializeQuestionMessage(
  'One of the conversations I am running on this signal is waiting on you.',
  BLOCK,
);

function sessionMessages(agentContent = QUESTION_MESSAGE_BODY) {
  return [
    { id: 'm1', role: 'user', content: 'Any news?' },
    { id: 'm2', role: 'assistant', content: agentContent },
  ];
}

const TASK_ID = 'task-1';

/**
 * Only `database` is reached from this module — the resume seams stay unused.
 * The mid-flight park shape `classifyParkedNegotiation` demands: an exact task
 * in `input_required` whose ask-user binding names this user, this opportunity
 * and the settlement id derived from the task itself.
 */
function ports(parked: boolean): NegotiationAnswerConsumptionPorts {
  return {
    database: {
      getNegotiationTaskForOpportunity: async () => (parked
        ? {
          id: TASK_ID,
          state: 'input_required',
          metadata: {
            type: 'negotiation',
            opportunityId: PARKED_OPPORTUNITY,
            turnContext: {
              askUserBinding: {
                settlementId: negotiationQuestionSettlementId(TASK_ID),
                recipientUserId: USER_ID,
                recipientIntentId: INTENT_ID,
                networkId: 'network-1',
                opportunityId: PARKED_OPPORTUNITY,
              },
            },
          },
        }
        // No task at all: "no negotiation", which is not parked — the block is
        // closed and the reply is ordinary conversation.
        : null),
      getNegotiationMessages: async () => [],
    } as unknown as NegotiationAnswerConsumptionPorts['database'],
  } as unknown as NegotiationAnswerConsumptionPorts;
}

function deps(overrides: Partial<AnswerPrecedenceDeps> = {}): AnswerPrecedenceDeps {
  return {
    getSessionMessages: async () => sessionMessages(),
    answerPorts: ports(true),
    answerRouter: {
      route: async () => ({
        addressesQuestions: true,
        answers: [{ ref: PARKED_OPPORTUNITY, answerText: 'This month.' }],
      }),
    },
    ...overrides,
  };
}

const REPLY = { userId: USER_ID, intentId: INTENT_ID, sessionId: SESSION_ID, replyText: 'This month?' };

describe('evaluateQuestionAnswerPrecedence', () => {
  it('takes a reply that answers the open question — the incident, as a spec', async () => {
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps());

    expect(precedence.status).toBe('answered');
    if (precedence.status !== 'answered') throw new Error('unreachable');
    // The orchestrator never sees this reply, so the edit rule cannot run on
    // it and the intent cannot be rewritten from it.
    expect(precedence.questionMessageId).toBe('m2');
    expect(precedence.questionMessageBody).toBe(QUESTION_MESSAGE_BODY);
    expect(precedence.routedAnswers).toEqual([{ ref: PARKED_OPPORTUNITY, answerText: 'This month.' }]);
  });

  it('falls through when the evaluator declines the reply', async () => {
    const precedence = await evaluateQuestionAnswerPrecedence(
      { ...REPLY, replyText: "what's my radar look like?" },
      deps({ answerRouter: { route: async () => ({ addressesQuestions: false, answers: [] }) } }),
    );

    expect(precedence).toEqual({ status: 'declined', questionMessageId: 'm2' });
  });

  it('falls through when the evaluator addresses the question but extracts nothing', async () => {
    // The oblique long tail: the orchestrator's tool is the lane for it, not a
    // consumption that would resume nothing and then ask again.
    const precedence = await evaluateQuestionAnswerPrecedence(
      REPLY,
      deps({ answerRouter: { route: async () => ({ addressesQuestions: true, answers: [] }) } }),
    );

    expect(precedence.status).toBe('declined');
  });

  it('does not run at all when the DM has no question block', async () => {
    let routed = false;
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps({
      getSessionMessages: async () => sessionMessages('Here is what I found on the record.'),
      answerRouter: { route: async () => { routed = true; throw new Error('must not route'); } },
    }));

    expect(precedence).toEqual({ status: 'no_open_question' });
    expect(routed).toBe(false);
  });

  it('does not run when the block is there but every negotiation it references has resolved', async () => {
    let routed = false;
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps({
      answerPorts: ports(false),
      answerRouter: { route: async () => { routed = true; throw new Error('must not route'); } },
    }));

    expect(precedence).toEqual({ status: 'no_open_question' });
    expect(routed).toBe(false);
  });

  it('falls through, not closed, when the evaluator is unavailable', async () => {
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps({
      answerRouter: { route: async () => { throw new Error('provider down'); } },
    }));

    expect(precedence).toEqual({ status: 'unavailable', questionMessageId: 'm2' });
  });

  it('falls through when the session read itself fails', async () => {
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps({
      getSessionMessages: async () => { throw new Error('db down'); },
    }));

    expect(precedence).toEqual({ status: 'no_open_question' });
  });

  it('ignores an empty reply without touching the session', async () => {
    let read = false;
    const precedence = await evaluateQuestionAnswerPrecedence(
      { ...REPLY, replyText: '   ' },
      deps({ getSessionMessages: async () => { read = true; return sessionMessages(); } }),
    );

    expect(precedence).toEqual({ status: 'no_open_question' });
    expect(read).toBe(false);
  });
});
