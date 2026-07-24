import { describe, expect, it } from 'vitest';

import { deriveSectionLabel, extractTurn, formatRelativeTime, formatSectionDate, groupTurnsBySession, outcomeChipVariant, roleChipLabel, roleLabel, verbFor, viewerRoleLabel, type TranscriptTurn } from '@/components/negotiations/negotiation-turns';
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

// ─── IND-570: section label helpers ─────────────────────────────────────────

describe('outcomeChipVariant', () => {
  it('maps terminal statuses to display props', () => {
    expect(outcomeChipVariant('accepted')).toMatchObject({ label: 'Accepted', color: 'text-emerald-700' });
    expect(outcomeChipVariant('rejected')).toMatchObject({ label: 'Rejected', color: 'text-red-700' });
    expect(outcomeChipVariant('stalled')).toMatchObject({ label: 'Stalled', color: 'text-gray-600' });
    expect(outcomeChipVariant('expired')).toMatchObject({ label: 'Expired', color: 'text-amber-700' });
  });

  it('returns null for non-terminal or unknown statuses', () => {
    expect(outcomeChipVariant(null)).toBeNull();
    expect(outcomeChipVariant(undefined)).toBeNull();
    expect(outcomeChipVariant('pending')).toBeNull();
    expect(outcomeChipVariant('negotiating')).toBeNull();
    expect(outcomeChipVariant('latent')).toBeNull();
  });
});

describe('formatSectionDate', () => {
  it('formats as "Mon D" (e.g. Jun 26)', () => {
    // Use a fixed UTC date; toLocaleString in en-US gives e.g. "Jun 26"
    const result = formatSectionDate('2025-06-26T10:00:00.000Z');
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    expect(result).toContain('26');
  });

  it('returns empty for unparseable dates', () => {
    expect(formatSectionDate('not-a-date')).toBe('');
  });
});

describe('deriveSectionLabel', () => {
  const createdAt = '2025-06-26T10:00:00.000Z';

  it('returns latestSectionTitle for the latest section', () => {
    expect(deriveSectionLabel({
      isLatest: true,
      firstTurnCreatedAt: createdAt,
      opportunityTitle: 'Old opp',
      opportunityStatus: 'rejected',
      latestSectionTitle: 'GEO consultancy search',
    })).toBe('GEO consultancy search');
  });

  it('falls back to "Current negotiation" when no latest title is provided', () => {
    expect(deriveSectionLabel({
      isLatest: true,
      firstTurnCreatedAt: createdAt,
      opportunityTitle: null,
      opportunityStatus: null,
      latestSectionTitle: null,
    })).toBe('Current negotiation');
  });

  it('builds attributed label for older sections with title and outcome', () => {
    const label = deriveSectionLabel({
      isLatest: false,
      firstTurnCreatedAt: createdAt,
      opportunityTitle: 'GEO consultancy search',
      opportunityStatus: 'rejected',
      latestSectionTitle: null,
    });
    expect(label).toContain('GEO consultancy search');
    expect(label).toContain('Rejected');
    expect(label).toContain('26'); // day of month
  });

  it('omits outcome chip segment when status has no chip variant', () => {
    const label = deriveSectionLabel({
      isLatest: false,
      firstTurnCreatedAt: createdAt,
      opportunityTitle: 'Interesting project',
      opportunityStatus: 'pending', // no chip
      latestSectionTitle: null,
    });
    expect(label).toContain('Interesting project');
    expect(label).not.toContain('Pending');
    // date still present
    expect(label).toContain('26');
  });

  it('uses legacy fallback for unattributed older sections', () => {
    const label = deriveSectionLabel({
      isLatest: false,
      firstTurnCreatedAt: '2025-06-01T00:00:00.000Z',
      opportunityTitle: null,
      opportunityStatus: null,
      latestSectionTitle: null,
    });
    expect(label).toMatch(/Earlier negotiation/);
    expect(label).toContain('Jun');
    expect(label).toContain('2025');
  });

  it('handles null firstTurnCreatedAt gracefully', () => {
    const label = deriveSectionLabel({
      isLatest: false,
      firstTurnCreatedAt: null,
      opportunityTitle: 'Solo opportunity',
      opportunityStatus: 'accepted',
      latestSectionTitle: null,
    });
    expect(label).toContain('Solo opportunity');
    expect(label).toContain('Accepted');
    // no date segment when null
    const parts = label.split(' · ');
    expect(parts).toHaveLength(2);
  });
});

describe('groupTurnsBySession', () => {
  const base = { senderId: 'agent:a', createdAt: '2025-01-01T00:00:00Z', action: null, text: 'x', suggestedRoles: null };

  it('groups consecutive turns with the same sessionId together', () => {
    const turns: TranscriptTurn[] = [
      { id: '1', sessionId: 's1', ...base },
      { id: '2', sessionId: 's1', ...base },
      { id: '3', sessionId: 's2', ...base },
    ];
    const groups = groupTurnsBySession(turns);
    expect(groups).toHaveLength(2);
    expect(groups[0].sessionId).toBe('s1');
    expect(groups[0].turns).toHaveLength(2);
    expect(groups[1].sessionId).toBe('s2');
    expect(groups[1].turns).toHaveLength(1);
  });

  it('returns a single group for turns with null sessionId', () => {
    const turns: TranscriptTurn[] = [
      { id: '1', sessionId: null, ...base },
      { id: '2', sessionId: null, ...base },
    ];
    expect(groupTurnsBySession(turns)).toHaveLength(1);
  });

  it('returns an empty array for empty input', () => {
    expect(groupTurnsBySession([])).toHaveLength(0);
  });
});
