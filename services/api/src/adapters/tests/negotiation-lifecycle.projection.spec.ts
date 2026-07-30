/**
 * IND-610 — hermetic cover for the outreach-gate privacy boundary.
 *
 * No database, no credentials, no network: the projection is pure, so the
 * guarantee "a non-owner receives no screenDecision fields" is proven here on
 * every run rather than only in the DB-backed adapter spec, which needs a
 * disposable database that CI does not provision.
 */
import { describe, it, expect } from 'bun:test';

import { projectOwnerScreenDecision, readInitiatorUserId } from '../negotiation-lifecycle.projection';

const OWNER = 'user-owner';
const COUNTERPART = 'user-counterpart';

const screenMetadata = (overrides: Record<string, unknown> = {}) => ({
  type: 'negotiation',
  sourceUserId: OWNER,
  candidateUserId: COUNTERPART,
  initiatorUserId: OWNER,
  // Deliberately noisy: internal keys that must never reach any viewer.
  turnContext: { secretInternalNote: 'do-not-leak' },
  screenDecision: {
    decision: 'pass',
    reasoning: 'They are raising a round, not hiring.',
    mode: 'enforce',
    outreachAngle: null,
    evidence: {
      counterpartyPremiseFit: 'Fundraising focus.',
      intentAlignment: 'No overlap with your open role.',
      memoryHints: 'internal-memory-hint',
    },
    screenedAt: '2026-07-24T11:00:00.000Z',
    durationMs: 90,
  },
  ...overrides,
});

const screenedOutOutcome = { reason: 'screened_out', reasoning: 'They are raising a round, not hiring.' };

describe('projectOwnerScreenDecision — owner gate (IND-610)', () => {
  it('gives the initiator the named screen fields', () => {
    expect(projectOwnerScreenDecision(screenMetadata(), screenedOutOutcome, OWNER)).toEqual({
      source: 'screen',
      decision: 'pass',
      reasoning: 'They are raising a round, not hiring.',
      counterpartyPremiseFit: 'Fundraising focus.',
      intentAlignment: 'No overlap with your open role.',
      screenedAt: '2026-07-24T11:00:00.000Z',
    });
  });

  it('gives a non-owner viewer nothing at all', () => {
    expect(projectOwnerScreenDecision(screenMetadata(), screenedOutOutcome, COUNTERPART)).toBeNull();
    expect(projectOwnerScreenDecision(screenMetadata(), screenedOutOutcome, 'unrelated-user')).toBeNull();
  });

  it('fails closed on a missing or empty viewer id', () => {
    // An unauthenticated/blank viewer must never match a blank initiator.
    expect(projectOwnerScreenDecision(screenMetadata(), screenedOutOutcome, null)).toBeNull();
    expect(projectOwnerScreenDecision(screenMetadata(), screenedOutOutcome, undefined)).toBeNull();
    expect(projectOwnerScreenDecision(screenMetadata(), screenedOutOutcome, '')).toBeNull();
    expect(projectOwnerScreenDecision(
      screenMetadata({ initiatorUserId: '', sourceUserId: '' }),
      screenedOutOutcome,
      '',
    )).toBeNull();
  });

  it('falls back to sourceUserId for tasks written before initiatorUserId existed', () => {
    const legacy = screenMetadata();
    delete (legacy as Record<string, unknown>).initiatorUserId;
    expect(readInitiatorUserId(legacy)).toBe(OWNER);
    expect(projectOwnerScreenDecision(legacy, screenedOutOutcome, OWNER)).not.toBeNull();
    expect(projectOwnerScreenDecision(legacy, screenedOutOutcome, COUNTERPART)).toBeNull();
  });

  it('projects named fields only — never the metadata blob', () => {
    const projected = projectOwnerScreenDecision(screenMetadata(), screenedOutOutcome, OWNER);
    expect(Object.keys(projected ?? {}).sort()).toEqual([
      'counterpartyPremiseFit',
      'decision',
      'intentAlignment',
      'reasoning',
      'screenedAt',
      'source',
    ]);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('do-not-leak');
    expect(serialized).not.toContain('internal-memory-hint');
    expect(serialized).not.toContain('durationMs');
    expect(serialized).not.toContain('candidateUserId');
  });
});

describe('projectOwnerScreenDecision — which reasoning is the honest one', () => {
  it('uses the outcome reasoning when the refusal happened at the opening turn', () => {
    // A turn-0 withdraw leaves no screenDecision behind, only the artifact.
    const metadata = { initiatorUserId: OWNER, sourceUserId: OWNER };
    expect(projectOwnerScreenDecision(
      metadata,
      { reason: 'screened_out', reasoning: 'Not worth spending your name on this one.' },
      OWNER,
    )).toEqual({
      source: 'outcome',
      decision: 'pass',
      reasoning: 'Not worth spending your name on this one.',
      counterpartyPremiseFit: null,
      intentAlignment: null,
      screenedAt: null,
    });
  });

  it('prefers the opening-turn reasoning over a screen record that let the outreach through', () => {
    // The screen said reach_out; the agent then refused on its opening turn.
    // Showing the screen's positive reasoning would misdescribe the refusal.
    const metadata = screenMetadata({
      screenDecision: {
        decision: 'reach_out',
        reasoning: 'Looks like a strong fit.',
        mode: 'shadow',
        evidence: { counterpartyPremiseFit: 'Fit.', intentAlignment: 'Aligned.' },
        screenedAt: '2026-07-24T11:00:00.000Z',
      },
    });
    expect(projectOwnerScreenDecision(
      metadata,
      { reason: 'screened_out', reasoning: 'On reflection, their ask is unrelated.' },
      OWNER,
    )).toMatchObject({ source: 'outcome', reasoning: 'On reflection, their ask is unrelated.' });
  });

  it('keeps the screen record when the screen itself is what blocked', () => {
    expect(projectOwnerScreenDecision(screenMetadata(), screenedOutOutcome, OWNER))
      .toMatchObject({ source: 'screen' });
  });

  it('still reports a reach_out screen on a negotiation that was never screened out', () => {
    const metadata = screenMetadata({
      screenDecision: {
        decision: 'reach_out',
        reasoning: 'Strong overlap on ML tooling.',
        mode: 'enforce',
        evidence: { counterpartyPremiseFit: 'Seeks ML help.', intentAlignment: 'Same shape.' },
        screenedAt: '2026-07-24T11:00:00.000Z',
      },
    });
    expect(projectOwnerScreenDecision(metadata, { reason: null, reasoning: null }, OWNER))
      .toMatchObject({ source: 'screen', decision: 'reach_out' });
  });

  it('never borrows reasoning from a non-screened_out outcome', () => {
    // turn_cap / ordinary declines carry counterparty-visible dialogue
    // reasoning; it must not be relabelled as an outreach-gate decision.
    expect(projectOwnerScreenDecision(
      { initiatorUserId: OWNER },
      { reason: 'turn_cap', reasoning: 'They would not budge on scope.' },
      OWNER,
    )).toBeNull();
    expect(projectOwnerScreenDecision(
      { initiatorUserId: OWNER },
      { reason: null, reasoning: 'Agent decided against it.' },
      OWNER,
    )).toBeNull();
  });

  it('returns null rather than an empty card when there is no reasoning anywhere', () => {
    expect(projectOwnerScreenDecision({ initiatorUserId: OWNER }, { reason: 'screened_out', reasoning: '  ' }, OWNER))
      .toBeNull();
    expect(projectOwnerScreenDecision({ initiatorUserId: OWNER }, null, OWNER)).toBeNull();
  });
});

describe('projectOwnerScreenDecision — malformed input', () => {
  it('ignores a screenDecision that is not a well-formed record', () => {
    for (const bad of [null, 'pass', 42, [], { decision: 'maybe' }, { reasoning: 'no decision' }]) {
      expect(projectOwnerScreenDecision(
        { initiatorUserId: OWNER, screenDecision: bad },
        { reason: null, reasoning: null },
        OWNER,
      )).toBeNull();
    }
  });

  it('drops non-string evidence rather than rendering it', () => {
    const projected = projectOwnerScreenDecision(
      {
        initiatorUserId: OWNER,
        screenDecision: {
          decision: 'pass',
          reasoning: 'Passed.',
          evidence: { counterpartyPremiseFit: { nested: 'object' }, intentAlignment: '   ' },
        },
      },
      screenedOutOutcome,
      OWNER,
    );
    expect(projected).toMatchObject({ counterpartyPremiseFit: null, intentAlignment: null });
  });
});
