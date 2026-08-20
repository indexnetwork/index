import { describe, expect, test } from 'bun:test';

import { questionBlockFixture, questionMessageFixture, questionProseFixture } from '@indexnetwork/protocol/question-block/fixture';
import { parseQuestionMessage, serializeQuestionMessage } from '@indexnetwork/protocol';
import type { QuestionBlock } from '@indexnetwork/protocol';

import type { ParkedNegotiation } from '../../../adapters/parked-negotiation.reader.adapter';
import { UNRENDERABLE_PARK_PROMPT, derivedQuestionMessageId, openQuestionBlock, questionBlockRefs, readOpenQuestionMessages, readOpenQuestionsForIntent } from '../open-question-message';

const PRIMARY = questionBlockFixture.questions[0].opportunityId;
const ALSO_UNBLOCKS = questionBlockFixture.questions[0].alsoUnblocks![0];
const SECOND = questionBlockFixture.questions[1].opportunityId;

const CLOSED_OUT_BODY = 'Those questions are settled — nothing here for you to answer right now.';

function parked(...opportunityIds: string[]) {
  return opportunityIds.map((opportunityId) => ({ opportunityId }));
}

describe('openQuestionBlock', () => {
  test('a block referencing a still-parked negotiation is open', () => {
    const open = openQuestionBlock({ id: 'msg-1', content: questionMessageFixture }, parked(SECOND));
    expect(open?.id).toBe('msg-1');
    expect(open?.block.questions).toHaveLength(2);
  });

  test('an `alsoUnblocks` ref alone keeps the block open', () => {
    expect(openQuestionBlock({ id: 'msg-1', content: questionMessageFixture }, parked(ALSO_UNBLOCKS))).not.toBeNull();
  });

  test('a block whose refs all resolved is closed', () => {
    expect(openQuestionBlock({ id: 'msg-1', content: questionMessageFixture }, parked('some-other-negotiation'))).toBeNull();
    expect(openQuestionBlock({ id: 'msg-1', content: questionMessageFixture }, [])).toBeNull();
  });

  test('prose with no block — the close-out — is never open', () => {
    expect(openQuestionBlock({ id: 'msg-1', content: CLOSED_OUT_BODY }, parked(PRIMARY))).toBeNull();
    expect(openQuestionBlock(null, parked(PRIMARY))).toBeNull();
  });

  test('refs are primaries plus alsoUnblocks', () => {
    expect([...questionBlockRefs(questionBlockFixture.questions)].sort())
      .toEqual([PRIMARY, ALSO_UNBLOCKS, SECOND].sort());
  });
});

describe('readOpenQuestionMessages', () => {
  function reader(input: {
    messages: Array<{ intentId: string; messageId: string; content: string }>;
    parkedByIntent: Record<string, string[]>;
    onParkedRead?: (intentId: string) => void;
  }) {
    return readOpenQuestionMessages('user-1', {
      listNewestAgentMessages: async () => input.messages,
      readParkedNegotiations: async (_userId, intentId) => {
        input.onParkedRead?.(intentId);
        return parked(...(input.parkedByIntent[intentId] ?? []));
      },
    });
  }

  test('a parked set under an open question-message yields one entry per signal', async () => {
    const open = await reader({
      messages: [{ intentId: 'intent-1', messageId: 'msg-1', content: questionMessageFixture }],
      parkedByIntent: { 'intent-1': [PRIMARY] },
    });

    expect(open).toEqual([{ intentId: 'intent-1', messageId: 'msg-1', questionCount: 2 }]);
  });

  test('an answered question-message disappears as its refs unpark', async () => {
    // The answer resumed the negotiation, so the regeneration pruned that
    // question; the remaining block still asks about a parked one.
    const pruned = serializeQuestionMessage(questionProseFixture, {
      version: 1,
      questions: [questionBlockFixture.questions[1]],
    });

    const stillOpen = await reader({
      messages: [{ intentId: 'intent-1', messageId: 'msg-2', content: pruned }],
      parkedByIntent: { 'intent-1': [SECOND] },
    });
    expect(stillOpen).toEqual([{ intentId: 'intent-1', messageId: 'msg-2', questionCount: 1 }]);

    // Every question answered: nothing is parked any more.
    const answered = await reader({
      messages: [{ intentId: 'intent-1', messageId: 'msg-2', content: pruned }],
      parkedByIntent: {},
    });
    expect(answered).toEqual([]);
  });

  test('a closed-out message is absent, and costs no parked-set read', async () => {
    const parkedReads: string[] = [];
    const open = await reader({
      messages: [{ intentId: 'intent-1', messageId: 'msg-3', content: CLOSED_OUT_BODY }],
      parkedByIntent: { 'intent-1': [PRIMARY] },
      onParkedRead: (intentId) => parkedReads.push(intentId),
    });

    expect(open).toEqual([]);
    expect(parkedReads).toEqual([]);
  });

  test('a signal with no negotiator DM contributes nothing', async () => {
    expect(await reader({ messages: [], parkedByIntent: { 'intent-1': [PRIMARY] } })).toEqual([]);
  });

  test('one unreadable signal does not drop the others', async () => {
    const open = await readOpenQuestionMessages('user-1', {
      listNewestAgentMessages: async () => [
        { intentId: 'intent-broken', messageId: 'msg-1', content: questionMessageFixture },
        { intentId: 'intent-2', messageId: 'msg-2', content: questionMessageFixture },
      ],
      readParkedNegotiations: async (_userId, intentId) => {
        if (intentId === 'intent-broken') throw new Error('parked read failed');
        return parked(PRIMARY);
      },
    });

    expect(open.map(({ intentId }) => intentId)).toEqual(['intent-2']);
  });

  test('an empty user id reads nothing', async () => {
    expect(await readOpenQuestionMessages('')).toEqual([]);
  });
});

/**
 * Openness = parked (the 2026-08-20 21:11 incident).
 *
 * The question was delivered at 20:21 and an edit-confirmation landed at
 * 20:24, so the question stopped being the newest agent message. Its task
 * stayed `input_required` until well past 21:11, when the client answered it —
 * and every lane resolved "nothing open" off message recency. These pin the
 * replacement predicate: the park is the record, the message is its rendering,
 * and the rendering is RECOVERED (searched back for, or derived) rather than
 * required to be at the tail.
 */
describe('readOpenQuestionsForIntent', () => {
  const USER_ID = 'user-1';
  const INTENT_ID = 'intent-1';
  const TIMING = '6d8b07ef-7fa8-4968-80d9-6af0ce364d27';
  const BUDGET = '7f3d2c1b-8a90-4e5f-b6c7-d8e9f0a1b2c3';

  const DELIVERED_BLOCK: QuestionBlock = {
    version: 1,
    questions: [{
      prompt: 'When could you meet?',
      opportunityId: TIMING,
      dimension: 'Timing: This week',
    }],
  };
  const DELIVERED_BODY = serializeQuestionMessage('One conversation is waiting on you.', DELIVERED_BLOCK);
  const EDIT_CONFIRMATION = 'Updated your signal to say you are open to remote.';

  function park(overrides: Partial<ParkedNegotiation> = {}): ParkedNegotiation {
    return {
      opportunityId: TIMING,
      kind: 'mid_flight',
      transcript: [],
      parkedAt: new Date('2026-08-20T20:20:00Z'),
      ...overrides,
    };
  }

  function resolve(input: {
    parked?: ParkedNegotiation[];
    messages?: Array<{ id: string; role: string; content: string }>;
    session?: { id: string } | null;
    onSessionRead?: () => void;
  }) {
    return readOpenQuestionsForIntent(USER_ID, INTENT_ID, {
      readParkedNegotiations: async () => input.parked ?? [],
      findSession: async () => {
        input.onSessionRead?.();
        return input.session === undefined ? { id: 'session-1' } : input.session;
      },
      getSessionMessages: async () => input.messages ?? [],
    });
  }

  test('a question buried under later agent messages is still open — the incident', async () => {
    const open = await resolve({
      parked: [park()],
      messages: [
        { id: 'm1', role: 'user', content: 'How is it going?' },
        { id: 'm2', role: 'assistant', content: DELIVERED_BODY },
        { id: 'm3', role: 'assistant', content: EDIT_CONFIRMATION },
        { id: 'm4', role: 'assistant', content: 'Still working on it.' },
      ],
    });

    // Recovered from the delivered message, wherever it sits in the DM: the
    // client is answering the block they can actually see.
    expect(open?.source).toBe('delivered');
    expect(open?.messageId).toBe('m2');
    expect(open?.body).toBe(DELIVERED_BODY);
    expect(open?.questions).toEqual([{ position: 1, label: 'Timing: This week', opportunityId: TIMING }]);
  });

  test('a park whose message was never delivered is open on a derived block', async () => {
    const open = await resolve({
      parked: [park({
        dimension: 'Timing: This week',
        dimensionKind: 'hard_constraint',
        answerhood: { ok_when: 'a meeting inside this week works', conflict_when: 'nothing works before next month' },
      })],
      messages: [{ id: 'm1', role: 'assistant', content: EDIT_CONFIRMATION }],
    });

    expect(open?.source).toBe('derived');
    expect(open?.messageId).toBe(derivedQuestionMessageId(INTENT_ID));
    expect(open?.questions).toEqual([{ position: 1, label: 'Timing: This week', opportunityId: TIMING }]);
    // Derived through the same derivation the message author uses, so the
    // prompt names the dimension and the answerhood map becomes the options.
    expect(open?.block.questions[0].prompt).toContain('Timing: This week');
    expect(open?.block.questions[0].options).toEqual([
      { label: 'a meeting inside this week works', description: expect.any(String) },
      { label: 'nothing works before next month', description: expect.any(String) },
    ]);
    // The body is a real question-message body: consumption parses it.
    expect(parseQuestionMessage(open!.body)?.block).toEqual(open!.block);
  });

  test('a park with neither an authored question nor a dimension is open on fixed copy', async () => {
    // A policy-inferred consultation or a pre-checklist post-stall gap. There
    // is nothing to render, and dropping it would put the park back outside
    // every answer lane — the exact hole this module closes.
    const open = await resolve({ parked: [park()], messages: [] });

    expect(open?.source).toBe('derived');
    expect(open?.block.questions[0].prompt).toBe(UNRENDERABLE_PARK_PROMPT);
    expect(open?.block.questions[0].opportunityId).toBe(TIMING);
  });

  test('nothing parked is closed, even with a question-message sitting newest', async () => {
    // The other direction, and it must hold just as hard: a delivered message
    // whose parks have all resolved is a stale RENDERING. Answering it resumes
    // nothing, so the reply is ordinary conversation.
    let sessionRead = false;
    const open = await resolve({
      parked: [],
      messages: [{ id: 'm2', role: 'assistant', content: DELIVERED_BODY }],
      onSessionRead: () => { sessionRead = true; },
    });

    expect(open).toBeNull();
    // And the parked read short-circuits before the DM is touched at all.
    expect(sessionRead).toBe(false);
  });

  test('an expired ask window is closed', async () => {
    // Expiry is a state change on the task, not a separate clock here: the
    // expiry worker moves the exact task out of `input_required`, so the park
    // leaves the parked set and the question closes with it.
    expect(await resolve({ parked: [], messages: [{ id: 'm2', role: 'assistant', content: DELIVERED_BODY }] }))
      .toBeNull();
  });

  test('a delivered block referencing only resolved negotiations does not shadow a live park', async () => {
    const open = await resolve({
      parked: [park({ opportunityId: BUDGET, dimension: 'Budget' })],
      messages: [{ id: 'm2', role: 'assistant', content: DELIVERED_BODY }],
    });

    expect(open?.source).toBe('derived');
    expect(open?.questions).toEqual([{ position: 1, label: 'Budget', opportunityId: BUDGET }]);
  });

  test('a DM that cannot be read degrades to the derived block, never to closed', async () => {
    const open = await readOpenQuestionsForIntent(USER_ID, INTENT_ID, {
      readParkedNegotiations: async () => [park({ dimension: 'Timing: This week' })],
      findSession: async () => { throw new Error('db down'); },
    });

    expect(open?.source).toBe('derived');
    expect(open?.sessionId).toBeNull();
    expect(open?.questions).toHaveLength(1);
  });

  test('a signal with no DM is still open — the park does not need a conversation', async () => {
    const open = await resolve({ parked: [park({ dimension: 'Budget' })], session: null });

    expect(open?.source).toBe('derived');
    expect(open?.sessionId).toBeNull();
  });

  test('every question of a delivered block is numbered as delivered', async () => {
    // Only one of the two is still parked; both are listed, because the
    // numbers must line up with what the client is looking at. Answering the
    // resolved one simply consumes to nothing.
    const twoQuestions = serializeQuestionMessage('Two conversations are waiting on you.', {
      version: 1,
      questions: [
        DELIVERED_BLOCK.questions[0],
        { prompt: 'What budget range works?', opportunityId: BUDGET, dimension: 'Budget' },
      ],
    });

    const open = await resolve({
      parked: [park({ opportunityId: BUDGET })],
      messages: [{ id: 'm2', role: 'assistant', content: twoQuestions }],
    });

    expect(open?.questions).toEqual([
      { position: 1, label: 'Timing: This week', opportunityId: TIMING },
      { position: 2, label: 'Budget', opportunityId: BUDGET },
    ]);
  });

  test('an empty scope reads nothing', async () => {
    expect(await readOpenQuestionsForIntent('', INTENT_ID)).toBeNull();
    expect(await readOpenQuestionsForIntent(USER_ID, '')).toBeNull();
  });
});
