/**
 * Question-message close-out queue — what remains of the regeneration spine
 * after the intent-agent collapse
 * (docs/plans/2026-08-21-holistic-intent-agent.md): authoring and answer
 * consumption moved to the IntentAgent; this queue only closes out LEGACY
 * blocks whose parked set emptied. Deps are injected — no database, Redis,
 * or model is touched.
 */
import { describe, expect, it } from 'bun:test';

import { parseQuestionMessage, serializeQuestionMessage } from '@indexnetwork/protocol';

import { QUESTION_MESSAGE_CLOSED_BODY, QuestionMessageQueue, questionMessageJobId } from '../question-message.queue';
import type { QuestionMessageChatSessions } from '../question-message.queue';
import type { ParkedNegotiation } from '../../adapters/parked-negotiation.reader.adapter';

const USER_ID = 'user-1';
const INTENT_ID = 'intent-1';
const OPP_A = '11111111-1111-4111-8111-111111111111';

const OPEN_BODY = serializeQuestionMessage('One question.', {
  version: 1,
  questions: [{ prompt: 'Still relevant?', opportunityId: OPP_A }],
});

function park(opportunityId: string): ParkedNegotiation {
  return {
    opportunityId,
    kind: 'mid_flight',
    transcript: [],
    parkedAt: new Date(1000),
  };
}

interface Harness {
  queue: QuestionMessageQueue;
  updated: Array<{ messageId: string; content: string }>;
  finds: number;
}

function build(options: {
  parked?: ParkedNegotiation[];
  session?: { id: string } | null;
  newest?: { id: string; role: 'user' | 'assistant' | 'system'; content: string } | null;
  updateResult?: boolean;
}): Harness {
  const updated: Harness['updated'] = [];
  const harness: Harness = { queue: undefined as never, updated, finds: 0 };
  const chatSessions: QuestionMessageChatSessions = {
    findNegotiatorIntentSession: async () => {
      harness.finds += 1;
      return options.session === undefined ? { id: 'session-1' } : options.session;
    },
    getNewestMessage: async () => options.newest ?? null,
    updateQuestionMessageInPlace: async (params) => {
      updated.push({ messageId: params.messageId, content: params.content });
      return options.updateResult ?? true;
    },
  };
  harness.queue = new QuestionMessageQueue({
    parkedSet: { readParkedNegotiations: async () => options.parked ?? [] },
    chatSessions,
  });
  return harness;
}

describe('questionMessageJobId', () => {
  it('keys the singleton per scope with dashes only', () => {
    expect(questionMessageJobId(USER_ID, INTENT_ID)).toBe(`question-message.${USER_ID}.${INTENT_ID}`);
  });
});

describe('close_out_question_message', () => {
  it('rewrites an open legacy block to the fixed closed prose once the parked set empties', async () => {
    const harness = build({
      parked: [],
      newest: { id: 'message-open', role: 'assistant', content: OPEN_BODY },
    });
    await harness.queue.processJob('close_out_question_message', { userId: USER_ID, intentId: INTENT_ID });
    expect(harness.updated).toEqual([{ messageId: 'message-open', content: QUESTION_MESSAGE_CLOSED_BODY }]);
    expect(parseQuestionMessage(QUESTION_MESSAGE_CLOSED_BODY)).toBeNull();
  });

  it('leaves everything alone while anything is still parked — the agent owns the ask now', async () => {
    const harness = build({
      parked: [park(OPP_A)],
      newest: { id: 'message-open', role: 'assistant', content: OPEN_BODY },
    });
    await harness.queue.processJob('close_out_question_message', { userId: USER_ID, intentId: INTENT_ID });
    expect(harness.updated).toHaveLength(0);
    // The DM is never even read: the parked set decided.
    expect(harness.finds).toBe(0);
  });

  it('never conjures a conversation for a signal whose DM does not exist', async () => {
    const harness = build({ parked: [], session: null });
    await harness.queue.processJob('close_out_question_message', { userId: USER_ID, intentId: INTENT_ID });
    expect(harness.updated).toHaveLength(0);
  });

  it('touches nothing when the newest message is a reply or plain prose', async () => {
    for (const newest of [
      { id: 'm', role: 'user' as const, content: 'thanks!' },
      { id: 'm', role: 'assistant' as const, content: 'Plain prose, no block.' },
      null,
    ]) {
      const harness = build({ parked: [], newest });
      await harness.queue.processJob('close_out_question_message', { userId: USER_ID, intentId: INTENT_ID });
      expect(harness.updated).toHaveLength(0);
    }
  });

  it('accepts a reply losing the newest race — the reply wins, nothing retries', async () => {
    const harness = build({
      parked: [],
      newest: { id: 'message-open', role: 'assistant', content: OPEN_BODY },
      updateResult: false,
    });
    await expect(
      harness.queue.processJob('close_out_question_message', { userId: USER_ID, intentId: INTENT_ID }),
    ).resolves.toBeUndefined();
  });

  it('still services jobs queued under the pre-collapse name', async () => {
    const harness = build({
      parked: [],
      newest: { id: 'message-open', role: 'assistant', content: OPEN_BODY },
    });
    await harness.queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });
    expect(harness.updated).toHaveLength(1);
  });
});
