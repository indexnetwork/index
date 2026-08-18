import { describe, expect, test } from 'bun:test';

import { questionBlockFixture, questionMessageFixture, questionProseFixture } from '@indexnetwork/protocol/question-block/fixture';
import { serializeQuestionMessage } from '@indexnetwork/protocol';

import { openQuestionBlock, questionBlockRefs, readOpenQuestionMessages } from '../open-question-message';

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
