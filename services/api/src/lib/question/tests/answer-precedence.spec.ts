/**
 * Answer precedence: while a question is OPEN in a signal's scope, the
 * evaluator sees a free-text reply BEFORE the orchestrator does.
 *
 * Two incidents are encoded here, both from 2026-08-20 in the sandbox, both
 * the same answer being eaten.
 *
 * 20:24 — a negotiation parked on the checklist dimension "Timing: This week"
 * asked its client; three minutes later the client replied; the chat
 * orchestrator's signal edit rule consumed it and rewrote the intent, and the
 * negotiation that asked was never told. That was the ORDER, and #1467 fixed
 * it by running the evaluator first.
 *
 * 21:11 — the same question, the same answer, and the gate itself said
 * "nothing open". An edit-confirmation had posted after the question, so the
 * question was no longer the newest agent message, and openness was defined by
 * message recency. The task had been `input_required` for fifty-one minutes.
 * That is the PREDICATE, and it is what these specs now pin: open means
 * parked, and the delivered message is searched for rather than required at
 * the tail.
 *
 * The outcomes under test are the whole contract: an answer never reaches the
 * orchestrator, a decline always does, an evaluator outage falls through
 * without closing the question, and with nothing parked nothing here runs at
 * all.
 */
import { describe, expect, it } from 'bun:test';

import { serializeQuestionMessage } from '@indexnetwork/protocol';
import type { QuestionBlock } from '@indexnetwork/protocol';

import type { ParkedNegotiation } from '../../../adapters/parked-negotiation.reader.adapter';
import { evaluateQuestionAnswerPrecedence } from '../answer-precedence';
import type { AnswerPrecedenceDeps } from '../answer-precedence';
import { derivedQuestionMessageId } from '../open-question-message';

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

/** The message that buried the question at 20:24 — an edit confirmation. */
const EDIT_CONFIRMATION = 'Updated your signal: timing is now open to this month.';

function sessionMessages(agentContent = QUESTION_MESSAGE_BODY) {
  return [
    { id: 'm1', role: 'user', content: 'Any news?' },
    { id: 'm2', role: 'assistant', content: agentContent },
  ];
}

/**
 * The park is the record: a mid-flight consult whose exact task is
 * `input_required` and bound to this user and signal. The reader adapter is
 * the set-wise mirror of `classifyParkedNegotiation` (the two are held
 * together by the convergence contract test), so a park in this list means
 * exactly what a live `input_required` task with a coherent ask-user binding
 * means.
 */
function park(overrides: Partial<ParkedNegotiation> = {}): ParkedNegotiation {
  return {
    opportunityId: PARKED_OPPORTUNITY,
    kind: 'mid_flight',
    dimension: 'Timing: This week',
    dimensionKind: 'hard_constraint',
    transcript: [],
    parkedAt: new Date('2026-08-20T20:20:00Z'),
    ...overrides,
  };
}

function deps(overrides: Partial<AnswerPrecedenceDeps> = {}): AnswerPrecedenceDeps {
  return {
    getSessionMessages: async () => sessionMessages(),
    readParkedNegotiations: async () => [park()],
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
    // it and the intent cannot be rewritten from it. The controller carries
    // this routing straight into the consumption job (pinned in
    // `answer-precedence.wiring.static.spec.ts`), so the queue consumes the
    // decision the client was acknowledged for rather than re-deciding it.
    expect(precedence.questionMessageId).toBe('m2');
    expect(precedence.questionMessageBody).toBe(QUESTION_MESSAGE_BODY);
    expect(precedence.routedAnswers).toEqual([{ ref: PARKED_OPPORTUNITY, answerText: 'This month.' }]);
  });

  it('takes the answer when a later agent message buried the question — 21:11', async () => {
    // The 21:11 incident, exactly: question at 20:21, edit-confirmation at
    // 20:24, reply at 21:11 while the task is still `input_required`. Under
    // message recency this returned `no_open_question` and the reply fell
    // through to the orchestrator, which edited the signal from it.
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps({
      getSessionMessages: async () => [
        ...sessionMessages(),
        { id: 'm3', role: 'assistant', content: EDIT_CONFIRMATION },
      ],
    }));

    expect(precedence.status).toBe('answered');
    if (precedence.status !== 'answered') throw new Error('unreachable');
    // Answered against the block the client is actually looking at, recovered
    // from where it sits in the DM rather than from the tail.
    expect(precedence.questionMessageId).toBe('m2');
    expect(precedence.questionMessageBody).toBe(QUESTION_MESSAGE_BODY);
  });

  it('takes the answer when the park has no delivered message at all', async () => {
    // Regeneration had not landed, or its message was never written. The park
    // is still the record, so the block is derived from it and the answer
    // routes onto the same negotiation ref.
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps({
      getSessionMessages: async () => [{ id: 'm1', role: 'assistant', content: EDIT_CONFIRMATION }],
    }));

    expect(precedence.status).toBe('answered');
    if (precedence.status !== 'answered') throw new Error('unreachable');
    expect(precedence.questionMessageId).toBe(derivedQuestionMessageId(INTENT_ID));
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

  it("does not run at all when nothing is parked on this user's side", async () => {
    // The only thing that closes a question. The DM is not even read: the
    // parked read is both the authority and the cheap short-circuit.
    let routed = false;
    let sessionRead = false;
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps({
      readParkedNegotiations: async () => [],
      getSessionMessages: async () => { sessionRead = true; return sessionMessages(); },
      answerRouter: { route: async () => { routed = true; throw new Error('must not route'); } },
    }));

    expect(precedence).toEqual({ status: 'no_open_question' });
    expect(routed).toBe(false);
    expect(sessionRead).toBe(false);
  });

  it('does not run for a stale question-message whose negotiations have resolved', async () => {
    // The other direction of the same predicate: the message is still sitting
    // there, newest and parseable, but nothing is parked behind it. Answering
    // it would resume nothing, so the reply is ordinary conversation.
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps({
      readParkedNegotiations: async () => [],
    }));

    expect(precedence).toEqual({ status: 'no_open_question' });
  });

  it('falls through, not closed, when the evaluator is unavailable', async () => {
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps({
      answerRouter: { route: async () => { throw new Error('provider down'); } },
    }));

    expect(precedence).toEqual({ status: 'unavailable', questionMessageId: 'm2' });
  });

  it('still offers the reply to the evaluator when the DM read fails', async () => {
    // A DM that cannot be read is a rendering failure, not a settled park. The
    // block is derived from the parked set and the answer is still taken —
    // losing the client's answer is the worse failure by a distance.
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps({
      getSessionMessages: async () => { throw new Error('db down'); },
    }));

    expect(precedence.status).toBe('answered');
  });

  it('falls through when the parked read itself fails', async () => {
    // Openness is unknowable, so the turn proceeds as an ordinary one: the
    // orchestrator still runs, and it carries the tool to route explicitly.
    const precedence = await evaluateQuestionAnswerPrecedence(REPLY, deps({
      readParkedNegotiations: async () => { throw new Error('db down'); },
    }));

    expect(precedence).toEqual({ status: 'no_open_question' });
  });

  it('ignores an empty reply without touching the parked set', async () => {
    let read = false;
    const precedence = await evaluateQuestionAnswerPrecedence(
      { ...REPLY, replyText: '   ' },
      deps({ readParkedNegotiations: async () => { read = true; return [park()]; } }),
    );

    expect(precedence).toEqual({ status: 'no_open_question' });
    expect(read).toBe(false);
  });
});
