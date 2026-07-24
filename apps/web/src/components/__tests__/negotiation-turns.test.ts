import { describe, expect, it } from 'vitest';

import { extractTurn, formatRelativeTime, roleChipLabel, roleLabel, verbFor, viewerRoleLabel, type TranscriptTurn } from '@/components/negotiations/negotiation-turns';
import type { ConversationMessage } from '@/services/conversation';

function message(parts: unknown[], overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    senderId: 'agent:own',
    role: 'agent',
    parts,
    createdAt: '2026-07-24T12:00:00.000Z',
    ...overrides,
  };
}

describe('extractTurn', () => {
  it('prefers the data message and captures action + suggested roles', () => {
    const turn = extractTurn(message([
      {
        kind: 'data',
        data: {
          action: 'propose',
          message: 'Proposing a connection.',
          assessment: { reasoning: 'hidden', suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } },
        },
      },
    ]));
    expect(turn).toMatchObject({
      action: 'propose',
      text: 'Proposing a connection.',
      suggestedRoles: { ownUser: 'agent', otherUser: 'patient' },
    });
  });

  it('falls back to assessment reasoning when there is no message', () => {
    const turn = extractTurn(message([
      { kind: 'data', data: { action: 'counter', assessment: { reasoning: 'Bandwidth confirmed.' } } },
    ]));
    expect(turn?.text).toBe('Bandwidth confirmed.');
    expect(turn?.suggestedRoles).toBeNull();
  });

  it('falls back to a text part', () => {
    const turn = extractTurn(message([{ kind: 'text', text: 'Hello there' }]));
    expect(turn?.text).toBe('Hello there');
    expect(turn?.action).toBeNull();
  });

  it('drops messages without visible text', () => {
    expect(extractTurn(message([{ kind: 'data', data: { action: 'accept' } }]))).toBeNull();
    expect(extractTurn(message([]))).toBeNull();
  });
});

describe('verbFor', () => {
  it('maps actions to the §2.3 palette', () => {
    expect(verbFor('propose')).toMatchObject({ label: 'PROPOSED', color: 'text-blue-600' });
    expect(verbFor('counter')?.color).toBe('text-amber-600');
    expect(verbFor('question')?.color).toBe('text-[#35799C]');
    expect(verbFor('accept')?.color).toBe('text-emerald-600');
    expect(verbFor('decline')?.color).toBe('text-red-600');
    expect(verbFor('withdraw')?.color).toBe('text-red-600');
  });

  it('returns null without an action and a neutral fallback for unknown ones', () => {
    expect(verbFor(null)).toBeNull();
    expect(verbFor('mystery_move')).toMatchObject({ label: 'MYSTERY MOVE', color: 'text-gray-500' });
  });
});

describe('roleLabel', () => {
  it('uses Helper/Seeker/Peer vocabulary, never agent/patient', () => {
    expect(roleLabel('agent')).toBe('Helper');
    expect(roleLabel('patient')).toBe('Seeker');
    expect(roleLabel('peer')).toBe('Peer');
  });
});

describe('roleChipLabel', () => {
  it('labels roles viewer-first from the sender perspective', () => {
    expect(roleChipLabel({ ownUser: 'agent', otherUser: 'patient' }, true, 'Dan'))
      .toBe('you → Helper · Dan → Seeker');
  });

  it('flips the mapping when the counterpart authored the turn', () => {
    expect(roleChipLabel({ ownUser: 'patient', otherUser: 'agent' }, false, 'Dan'))
      .toBe('you → Helper · Dan → Seeker');
  });

  it('returns null when no roles were suggested', () => {
    expect(roleChipLabel(null, true, 'Dan')).toBeNull();
    expect(roleChipLabel({}, true, 'Dan')).toBeNull();
  });
});

describe('viewerRoleLabel', () => {
  const turns: TranscriptTurn[] = [
    { id: '1', sessionId: null, senderId: 'agent:own', createdAt: '', action: 'propose', text: 'x', suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } },
    { id: '2', sessionId: null, senderId: 'agent:other', createdAt: '', action: 'accept', text: 'y', suggestedRoles: { ownUser: 'patient', otherUser: 'agent' } },
  ];

  it('reads the viewer role from the latest role-suggesting turn', () => {
    expect(viewerRoleLabel(turns, 'agent:own')).toBe('Helper');
  });

  it('returns null when no turn suggested roles', () => {
    expect(viewerRoleLabel([{ ...turns[0], suggestedRoles: null }], 'agent:own')).toBeNull();
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-24T12:00:00.000Z').getTime();

  it('formats relative buckets', () => {
    expect(formatRelativeTime('2026-07-24T11:59:40.000Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-07-24T11:55:00.000Z', now)).toBe('5m ago');
    expect(formatRelativeTime('2026-07-24T09:00:00.000Z', now)).toBe('3h ago');
    expect(formatRelativeTime('2026-07-22T12:00:00.000Z', now)).toBe('2d ago');
    expect(formatRelativeTime('2026-03-24T12:00:00.000Z', now)).toBe('4mo ago');
  });

  it('ticks forward with `now`', () => {
    const created = '2026-07-24T11:59:40.000Z';
    expect(formatRelativeTime(created, now)).toBe('just now');
    expect(formatRelativeTime(created, now + 30_000)).toBe('just now');
    expect(formatRelativeTime(created, now + 90_000)).toBe('1m ago');
  });

  it('returns empty for unparseable timestamps', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('');
  });
});
