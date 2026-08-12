import { describe, expect, it } from 'bun:test';

import { expectedNegotiationSpeaker } from '../domain/negotiation.expected-speaker.js';

const participants = { sourceUserId: 'source', candidateUserId: 'candidate' };
const turn = (senderId: string, action?: string) => ({
  senderId,
  parts: action === undefined ? [] : [{ kind: 'data', data: { action } }],
});

describe('expectedNegotiationSpeaker', () => {
  it('defaults to the source only for valid, distinct participants', () => {
    expect(expectedNegotiationSpeaker(participants, [])).toBe('source');
    expect(expectedNegotiationSpeaker({ sourceUserId: '', candidateUserId: 'candidate' }, [])).toBeNull();
    expect(expectedNegotiationSpeaker({ sourceUserId: '   ', candidateUserId: 'candidate' }, [])).toBeNull();
    expect(expectedNegotiationSpeaker({ sourceUserId: 'same', candidateUserId: 'same' }, [])).toBeNull();
    expect(expectedNegotiationSpeaker({}, [])).toBeNull();
  });

  it('alternates after the latest ordinary canonical bilateral message', () => {
    expect(expectedNegotiationSpeaker(participants, [turn('agent:source', 'outreach')])).toBe('candidate');
    expect(expectedNegotiationSpeaker(participants, [
      turn('agent:source', 'outreach'),
      turn('agent:candidate', 'counter'),
    ])).toBe('source');
  });

  it.each(['source', 'candidate'] as const)(
    'retains the %s sender floor for an ask_user consultation successor',
    (speaker) => {
      expect(expectedNegotiationSpeaker(participants, [
        turn(`agent:${speaker === 'source' ? 'candidate' : 'source'}`, 'counter'),
        turn(`agent:${speaker}`, 'ask_user'),
      ])).toBe(speaker);
    },
  );

  it('ignores unrelated and system settlement noise after the latest canonical message', () => {
    expect(expectedNegotiationSpeaker(participants, [
      turn('agent:source', 'ask_user'),
      turn('user:source', 'answer'),
      turn('system:index'),
      turn('agent:unrelated', 'ask_user'),
    ])).toBe('source');
  });

  it('treats a canonical message with malformed action data as an ordinary bilateral message', () => {
    expect(expectedNegotiationSpeaker(participants, [turn('agent:source')])).toBe('candidate');
  });
});
