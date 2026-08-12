import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { expectedNegotiationSpeaker as protocolExpectedNegotiationSpeaker } from '@indexnetwork/protocol';

import { expectedNegotiationSpeaker as apiExpectedNegotiationSpeaker } from '../../lib/negotiation/expected-speaker';

const adapterSource = readFileSync(new URL('../conversation.database.adapter.ts', import.meta.url), 'utf8');
const pickupStart = adapterSource.indexOf('async pickupNegotiationAtomically');
const pickupEnd = adapterSource.indexOf('\n  async ', pickupStart + 1);
const pickupSource = adapterSource.slice(pickupStart, pickupEnd < 0 ? undefined : pickupEnd);

const turn = (senderId: string, action?: string) => ({
  senderId,
  parts: action === undefined ? [] : [{ kind: 'data', data: { action } }],
});

const raceFixtures = [
  {
    label: 'missing participant',
    participants: { sourceUserId: '', candidateUserId: 'candidate' },
    messages: [],
    winner: null,
  },
  {
    label: 'duplicate participants',
    participants: { sourceUserId: 'same', candidateUserId: 'same' },
    messages: [],
    winner: null,
  },
  {
    label: 'valid no-history source fallback',
    participants: { sourceUserId: 'source', candidateUserId: 'candidate' },
    messages: [],
    winner: 'source',
  },
  {
    label: 'ordinary source turn alternates',
    participants: { sourceUserId: 'source', candidateUserId: 'candidate' },
    messages: [turn('agent:source', 'counter')],
    winner: 'candidate',
  },
  {
    label: 'source ask_user retains source',
    participants: { sourceUserId: 'source', candidateUserId: 'candidate' },
    messages: [turn('agent:source', 'ask_user'), turn('system:index', 'settled')],
    winner: 'source',
  },
  {
    label: 'candidate ask_user retains candidate',
    participants: { sourceUserId: 'source', candidateUserId: 'candidate' },
    messages: [turn('agent:candidate', 'ask_user'), turn('user:candidate', 'answer')],
    winner: 'candidate',
  },
  {
    label: 'unrelated ask_user does not win the race',
    participants: { sourceUserId: 'source', candidateUserId: 'candidate' },
    messages: [turn('agent:source', 'counter'), turn('agent:unrelated', 'ask_user')],
    winner: 'candidate',
  },
] as const;

describe('atomic negotiation pickup speaker SQL parity', () => {
  it('keeps the API seam delegated to the protocol capability', () => {
    expect(apiExpectedNegotiationSpeaker).toBe(protocolExpectedNegotiationSpeaker);
  });

  it('places explicit participant validity guards before owner and canonical-speaker predicates', () => {
    const validIndex = pickupSource.indexOf('const validParticipantsWhere');
    const participantIndex = pickupSource.indexOf('const participantWhere');
    const speakerIndex = pickupSource.indexOf('const expectedSpeakerWhere');

    expect(validIndex).toBeGreaterThan(-1);
    expect(validIndex).toBeLessThan(participantIndex);
    expect(participantIndex).toBeLessThan(speakerIndex);
    expect(pickupSource).toContain("NULLIF(BTRIM(${schema.tasks.metadata}->>'sourceUserId'), '') IS NOT NULL");
    expect(pickupSource).toContain("NULLIF(BTRIM(${schema.tasks.metadata}->>'candidateUserId'), '') IS NOT NULL");
    expect(pickupSource).toContain("${schema.tasks.metadata}->>'sourceUserId' <> ${schema.tasks.metadata}->>'candidateUserId'");
    expect(pickupSource).toContain('WHEN ${validParticipantsWhere} THEN COALESCE((');
  });

  it('pins canonical action, unrelated-message filtering, no-history fallback, and guarded query order', () => {
    expect(pickupSource).toContain("WHEN latest_speaker.action = 'ask_user'");
    expect(pickupSource).toContain("speaker_message.sender_id IN (");
    expect(pickupSource).toContain('ORDER BY speaker_message.created_at DESC, speaker_message.id DESC');
    expect(pickupSource).toContain("), ${schema.tasks.metadata}->>'sourceUserId' = ${input.ownerId})");
    expect(pickupSource.match(/validParticipantsWhere,\s+participantWhere,\s+expectedSpeakerWhere,/g) ?? []).toHaveLength(2);
  });

  it.each(raceFixtures)('admits only the guarded $label winner', ({ participants, messages, winner }) => {
    const source = participants.sourceUserId;
    const candidate = participants.candidateUserId;
    const contenders = [...new Set([source, candidate].filter((id) => id.length > 0))];
    const winners = contenders.filter((ownerId) =>
      apiExpectedNegotiationSpeaker(participants, messages) === ownerId);

    expect(winners).toEqual(winner ? [winner] : []);
  });
});
