import { describe, expect, it } from 'vitest';

import { contactTurns, deriveSectionLabel, extractTurn, formatRelativeTime, formatSectionDate, groupTurnsBySession, outcomeChipVariant, roleChipLabel, roleLabel, terminalTurnAuthor, verbFor, viewerRoleLabel, type TranscriptTurn } from '@/components/negotiations/negotiation-turns';
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
  it('prefers the data message and captures verb + suggested roles', () => {
    const turn = extractTurn(message([
      {
        kind: 'data',
        data: {
          verb: 'counter',
          message: 'Proposing a connection.',
          assessment: { reasoning: 'hidden', suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } },
        },
      },
    ]));
    expect(turn).toMatchObject({
      verb: 'counter',
      pauseReason: null,
      chipKey: 'counter',
      text: 'Proposing a connection.',
      suggestedRoles: { ownUser: 'agent', otherUser: 'patient' },
    });
  });

  it('falls back to assessment reasoning when there is no message', () => {
    const turn = extractTurn(message([
      { kind: 'data', data: { verb: 'counter', assessment: { reasoning: 'Bandwidth confirmed.' } } },
    ]));
    expect(turn?.text).toBe('Bandwidth confirmed.');
    expect(turn?.suggestedRoles).toBeNull();
  });

  it('falls back to a text part', () => {
    const turn = extractTurn(message([{ kind: 'text', text: 'Hello there' }]));
    expect(turn?.text).toBe('Hello there');
    expect(turn?.verb).toBeNull();
  });

  it('drops messages without visible text', () => {
    expect(extractTurn(message([]))).toBeNull();
  });

  it('reads a needs_principal pause payload into pauseReason/pausePayload and derives fallback text', () => {
    const turn = extractTurn(message([
      { kind: 'data', data: { verb: 'pause', reason: 'needs_principal', payload: { question: 'What timeline works?' } } },
    ]));
    expect(turn).toMatchObject({
      verb: 'pause',
      pauseReason: 'needs_principal',
      pausePayload: { question: 'What timeline works?' },
      chipKey: 'needs_principal',
      text: 'What timeline works?',
    });
  });

  it('reads a ready_for_verdict pause, falling back to its reasoning for text', () => {
    const turn = extractTurn(message([
      { kind: 'data', data: { verb: 'pause', reason: 'ready_for_verdict', payload: { recommendation: 'pending', reasoning: 'Terms converged.' } } },
    ]));
    expect(turn).toMatchObject({
      pauseReason: 'ready_for_verdict',
      chipKey: 'ready_for_verdict',
      text: 'Terms converged.',
    });
  });

  it('reads a counterparty_silent pause (no payload) with a fixed fallback text', () => {
    const turn = extractTurn(message([
      { kind: 'data', data: { verb: 'pause', reason: 'counterparty_silent' } },
    ]));
    expect(turn).toMatchObject({
      pauseReason: 'counterparty_silent',
      pausePayload: null,
      chipKey: 'counterparty_silent',
    });
    expect(turn?.text.length).toBeGreaterThan(0);
  });
});

describe('verbFor', () => {
  it('maps continue verbs and pause reasons to the §2.3 palette', () => {
    expect(verbFor('outreach')?.color).toBe('text-[#35799C]');
    expect(verbFor('counter')?.color).toBe('text-amber-600');
    expect(verbFor('question')?.color).toBe('text-[#35799C]');
    expect(verbFor('needs_principal')?.label).toBe('ASKED YOU');
    expect(verbFor('ready_for_verdict')).toBeTruthy();
    expect(verbFor('counterparty_silent')).toBeTruthy();
  });

  it('returns null without a key and a neutral fallback for unknown ones', () => {
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

function turn(chipKey: string | null, overrides: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return {
    id: 't1',
    sessionId: 's1',
    senderId: 'agent:own',
    createdAt: '2026-07-24T12:00:00.000Z',
    verb: chipKey === 'needs_principal' || chipKey === 'ready_for_verdict' || chipKey === 'counterparty_silent' ? 'pause' : chipKey,
    pauseReason: chipKey === 'needs_principal' || chipKey === 'ready_for_verdict' || chipKey === 'counterparty_silent' ? chipKey : null,
    pausePayload: null,
    chipKey,
    text: 'text',
    suggestedRoles: null,
    ...overrides,
  };
}

describe('contactTurns', () => {
  it('drops needs_principal pauses — a private agent pause is not contact with the counterparty', () => {
    const turns = [turn('needs_principal')];
    expect(contactTurns(turns)).toEqual([]);
  });

  it('keeps every other turn', () => {
    const turns = [turn('outreach'), turn('counter'), turn('ready_for_verdict')];
    expect(contactTurns(turns)).toEqual(turns);
  });

  it('excludes only the needs_principal pauses from a mixed transcript', () => {
    const outreach = turn('outreach');
    const turns = [turn('needs_principal'), outreach];
    expect(contactTurns(turns)).toEqual([outreach]);
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
    turn('outreach', { id: '1', sessionId: null, createdAt: '', suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } }),
    turn('counter', { id: '2', sessionId: null, senderId: 'agent:other', createdAt: '', suggestedRoles: { ownUser: 'patient', otherUser: 'agent' } }),
  ];

  it('reads the viewer role from the latest role-suggesting turn', () => {
    expect(viewerRoleLabel(turns, 'agent:own')).toBe('Helper');
  });

  it('returns null when no turn suggested roles', () => {
    expect(viewerRoleLabel([{ ...turns[0], suggestedRoles: null }], 'agent:own')).toBeNull();
  });
});

describe('terminalTurnAuthor', () => {
  // A negotiation no longer ends via a turn — resolve is a separate verdict
  // write, not part of the transcript. This always returns null now; see the
  // function's own doc comment for why a guess here is worse than silence.
  it('always returns null — termination is not transcript-derivable any more', () => {
    expect(terminalTurnAuthor([
      turn('outreach'),
      turn('ready_for_verdict', { senderId: 'agent:other' }),
    ], 'agent:own')).toBeNull();
    expect(terminalTurnAuthor([], null)).toBeNull();
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
  const base = { senderId: 'agent:a', createdAt: '2025-01-01T00:00:00Z', verb: null, pauseReason: null, pausePayload: null, chipKey: null, text: 'x', suggestedRoles: null };

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

describe('every protocol pause reason survives the thread', () => {
  // A reason the union does not know is dropped by `isPauseReason`, so the
  // pause disappears from the transcript the viewer is reading — no error,
  // no fallback, just a missing turn.
  it.each(['counterparty_silent', 'needs_principal', 'ready_for_verdict', 'turn_cap', 'open_failed'] as const)(
    'renders a %s pause',
    (reason) => {
      const turn = extractTurn({
        id: 'm-1',
        sessionId: null,
        senderId: 'agent:alice',
        createdAt: '2026-08-24T00:00:00.000Z',
        parts: [{ kind: 'data', data: { verb: 'pause', reason } }],
      } as never);
      expect(turn).not.toBeNull();
      expect(turn!.pauseReason).toBe(reason);
      expect(turn!.text.length).toBeGreaterThan(0);
      expect(verbFor(turn!.chipKey)!.label).not.toBe('');
    },
  );
});

