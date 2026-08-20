/**
 * Hermetic cover for the person-row rollup: which task session represents a
 * counterparty conversation to a viewer. No database — the rule is pure, so
 * "a live pairing is never shadowed by a later dead one" is proven on every
 * run, not only in the DB-backed adapter spec.
 */
import { describe, expect, it } from 'bun:test';

import { isNegotiationSessionVisibleTo, negotiationSessionLiveness, selectRepresentedNegotiationSession, type NegotiationSessionCandidate } from '../negotiation-session-rollup.projection';

const VIEWER = 'user-viewer';
const COUNTERPART = 'user-counterpart';

function session(
  taskId: string,
  input: Partial<Omit<NegotiationSessionCandidate, 'taskId'>> & { initiatorUserId?: string } = {},
): NegotiationSessionCandidate {
  return {
    taskId,
    state: input.state ?? 'completed',
    opportunityStatus: input.opportunityStatus ?? null,
    outcome: input.outcome ?? null,
    metadata: input.metadata ?? { type: 'negotiation', initiatorUserId: input.initiatorUserId ?? VIEWER },
    createdAt: input.createdAt ?? '2026-08-20T15:00:00.000Z',
  };
}

const PENDING_OLDER = session('pending-older', {
  state: 'completed',
  opportunityStatus: 'pending',
  outcome: { hasOpportunity: true, reason: null },
  createdAt: '2026-08-20T15:28:00.000Z',
});
const SCREENED_NEWER = session('screened-newer', {
  state: 'completed',
  opportunityStatus: 'rejected',
  outcome: { hasOpportunity: false, reason: 'screened_out' },
  createdAt: '2026-08-20T15:29:00.000Z',
});
const DECLINED_NEWER = session('declined-newer', {
  state: 'completed',
  opportunityStatus: 'rejected',
  outcome: { hasOpportunity: false, reason: null },
  createdAt: '2026-08-20T15:30:00.000Z',
});
const WORKING = session('working', { state: 'working', opportunityStatus: 'negotiating', createdAt: '2026-08-20T15:10:00.000Z' });

describe('negotiationSessionLiveness', () => {
  it.each([
    ['pending opportunity, task completed', { state: 'completed', opportunityStatus: 'pending' }, 'awaiting_approval'],
    ['agents agreed, opportunity not yet pending', { state: 'completed', opportunityStatus: 'negotiating', outcome: { hasOpportunity: true, reason: null } }, 'awaiting_approval'],
    ['parked on a human', { state: 'input_required', opportunityStatus: 'negotiating' }, 'parked'],
    ['working', { state: 'working', opportunityStatus: 'negotiating' }, 'in_progress'],
    ['submitted, no opportunity row yet', { state: 'submitted', opportunityStatus: null }, 'in_progress'],
    ['latent opportunity', { state: 'completed', opportunityStatus: 'latent' }, 'in_progress'],
    ['screened out', { state: 'completed', opportunityStatus: 'rejected', outcome: { hasOpportunity: false, reason: 'screened_out' } }, 'resolved'],
    ['declined', { state: 'completed', opportunityStatus: 'negotiating', outcome: { hasOpportunity: false, reason: null } }, 'resolved'],
    ['accepted', { state: 'completed', opportunityStatus: 'accepted' }, 'resolved'],
    ['stalled on turn cap', { state: 'completed', opportunityStatus: 'negotiating', outcome: { hasOpportunity: false, reason: 'turn_cap' } }, 'resolved'],
    ['expired', { state: 'completed', opportunityStatus: 'expired' }, 'resolved'],
    ['agent error', { state: 'failed', opportunityStatus: 'stalled', outcome: { hasOpportunity: false, reason: 'agent_error' } }, 'resolved'],
    ['terminal opportunity beats a stale parked task', { state: 'input_required', opportunityStatus: 'rejected' }, 'resolved'],
    ['terminal opportunity beats a stale pending-looking outcome', { state: 'completed', opportunityStatus: 'accepted', outcome: { hasOpportunity: true, reason: null } }, 'resolved'],
  ] as const)('%s → %s', (_name, input, expected) => {
    expect(negotiationSessionLiveness({ outcome: null, ...input })).toBe(expected);
  });
});

describe('selectRepresentedNegotiationSession', () => {
  it('lets an older pending approval represent the pair over a newer screened-out pairing', () => {
    // Hye-jin ↔ Deniz on the sandbox: outreach → accept at 15:28, screened out
    // at 15:29. The rail read "No match · 0 your move" while Radar said
    // "Awaiting you · 1".
    expect(selectRepresentedNegotiationSession([SCREENED_NEWER, PENDING_OLDER], VIEWER)?.taskId).toBe('pending-older');
    expect(selectRepresentedNegotiationSession([PENDING_OLDER, SCREENED_NEWER], VIEWER)?.taskId).toBe('pending-older');
  });

  it('lets a live negotiation represent the pair over a newer declined one', () => {
    expect(selectRepresentedNegotiationSession([DECLINED_NEWER, WORKING], VIEWER)?.taskId).toBe('working');
  });

  it('ranks a pending approval above a parked task, whichever is newer', () => {
    const parkedNewer = session('parked-newer', { state: 'input_required', opportunityStatus: 'negotiating', createdAt: '2026-08-20T16:00:00.000Z' });
    expect(selectRepresentedNegotiationSession([parkedNewer, PENDING_OLDER], VIEWER)?.taskId).toBe('pending-older');
    expect(selectRepresentedNegotiationSession([parkedNewer, WORKING], VIEWER)?.taskId).toBe('parked-newer');
  });

  it('keeps recency as the tie-break within a tier (all resolved → newest created)', () => {
    expect(selectRepresentedNegotiationSession([SCREENED_NEWER, DECLINED_NEWER], VIEWER)?.taskId).toBe('declined-newer');
    const sameInstantA = session('a', { opportunityStatus: 'rejected', createdAt: '2026-08-20T15:00:00.000Z' });
    const sameInstantB = session('b', { opportunityStatus: 'rejected', createdAt: '2026-08-20T15:00:00.000Z' });
    expect(selectRepresentedNegotiationSession([sameInstantA, sameInstantB], VIEWER)?.taskId).toBe('b');
    expect(selectRepresentedNegotiationSession([sameInstantB, sameInstantA], VIEWER)?.taskId).toBe('b');
  });

  it('never lets a screened-out gate represent the pair to the counterparty, and falls back to what they may see', () => {
    expect(isNegotiationSessionVisibleTo(SCREENED_NEWER, VIEWER)).toBe(true);
    expect(isNegotiationSessionVisibleTo(SCREENED_NEWER, COUNTERPART)).toBe(false);
    expect(isNegotiationSessionVisibleTo(DECLINED_NEWER, COUNTERPART)).toBe(true);

    expect(selectRepresentedNegotiationSession([SCREENED_NEWER], COUNTERPART)).toBeNull();
    expect(selectRepresentedNegotiationSession([SCREENED_NEWER, DECLINED_NEWER], COUNTERPART)?.taskId).toBe('declined-newer');
    // The initiator's own view is unchanged by the privacy rule.
    expect(selectRepresentedNegotiationSession([SCREENED_NEWER], VIEWER)?.taskId).toBe('screened-newer');
  });

  it('returns null for no candidates', () => {
    expect(selectRepresentedNegotiationSession([], VIEWER)).toBeNull();
  });
});
