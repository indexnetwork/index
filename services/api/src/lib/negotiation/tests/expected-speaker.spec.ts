import { describe, expect, it } from 'bun:test';
import { expectedNegotiationSpeaker as protocolExpectedNegotiationSpeaker } from '@indexnetwork/protocol';

import { expectedNegotiationSpeaker } from '../expected-speaker';

const metadata = { sourceUserId: 'source', candidateUserId: 'candidate' };
const message = (senderId: string, action: string) => ({
  senderId,
  parts: [{ kind: 'data', data: { action } }],
});

describe('expectedNegotiationSpeaker canonical role seam', () => {
  it('delegates to the protocol capability implementation', () => {
    expect(expectedNegotiationSpeaker).toBe(protocolExpectedNegotiationSpeaker);
  });

  it('starts with source and alternates across ordinary bilateral turns', () => {
    expect(expectedNegotiationSpeaker(metadata, [])).toBe('source');
    expect(expectedNegotiationSpeaker(metadata, [message('agent:source', 'outreach')])).toBe('candidate');
    expect(expectedNegotiationSpeaker(metadata, [
      message('agent:source', 'outreach'),
      message('agent:candidate', 'counter'),
    ])).toBe('source');
  });

  it.each(['source', 'candidate'] as const)(
    'retains the %s consulting executor floor after ask_user settlement noise',
    (speaker) => {
      expect(expectedNegotiationSpeaker(metadata, [
        message(speaker === 'source' ? 'agent:candidate' : 'agent:source', 'counter'),
        message(`agent:${speaker}`, 'ask_user'),
        { senderId: 'user:owner', parts: [{ kind: 'data', data: { action: 'answer' } }] },
        { senderId: 'system:index', parts: [] },
      ])).toBe(speaker);
    },
  );

  it('alternates again after the settlement-bound successor persists a normal turn', () => {
    expect(expectedNegotiationSpeaker(metadata, [
      message('agent:candidate', 'counter'),
      message('agent:source', 'ask_user'),
      message('agent:source', 'counter'),
    ])).toBe('candidate');
  });

  it('does not let an unrelated ask_user sender retain either participant floor', () => {
    expect(expectedNegotiationSpeaker(metadata, [
      message('agent:source', 'counter'),
      message('agent:unrelated', 'ask_user'),
    ])).toBe('candidate');
  });

  it('fails closed for malformed or duplicate participant roles', () => {
    expect(expectedNegotiationSpeaker({}, [])).toBeNull();
    expect(expectedNegotiationSpeaker({ sourceUserId: '   ', candidateUserId: 'candidate' }, [])).toBeNull();
    expect(expectedNegotiationSpeaker({ sourceUserId: 'same', candidateUserId: 'same' }, [])).toBeNull();
  });
});
