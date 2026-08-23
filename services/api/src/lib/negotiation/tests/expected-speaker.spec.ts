import { describe, expect, it } from 'bun:test';

import { expectedNegotiationSpeaker } from '../expected-speaker';

const metadata = { sourceUserId: 'source', candidateUserId: 'candidate' };
const turn = (senderId: string, data: unknown) => ({
  senderId,
  parts: [{ kind: 'data', data }],
});
const continueTurn = { verb: 'counter', message: 'm', reasoning: 'r' };

describe('expectedNegotiationSpeaker (host-side mirror of NegotiationGraph.nextSpeaker)', () => {
  it('the initiator opens when there are no turns yet', () => {
    expect(expectedNegotiationSpeaker({ ...metadata, initiatorUserId: 'source' }, [])).toBe('source');
  });

  it('falls back to sourceUserId as the initiator when initiatorUserId is absent', () => {
    expect(expectedNegotiationSpeaker(metadata, [])).toBe('source');
  });

  it('alternates seats across ordinary continuing turns', () => {
    expect(expectedNegotiationSpeaker(metadata, [
      turn('agent:source', continueTurn),
    ])).toBe('candidate');
    expect(expectedNegotiationSpeaker(metadata, [
      turn('agent:source', continueTurn),
      turn('agent:candidate', continueTurn),
    ])).toBe('source');
  });

  it('retries the same speaker after that speaker pauses', () => {
    expect(expectedNegotiationSpeaker(metadata, [
      turn('agent:source', continueTurn),
      turn('agent:candidate', { verb: 'pause', reason: 'needs_principal', payload: { question: 'q' } }),
    ])).toBe('candidate');
    expect(expectedNegotiationSpeaker(metadata, [
      turn('agent:candidate', { verb: 'pause', reason: 'counterparty_silent' }),
    ])).toBe('candidate');
  });

  it('returns undefined when neither participant id is present in metadata', () => {
    expect(expectedNegotiationSpeaker({}, [])).toBeUndefined();
  });
});
