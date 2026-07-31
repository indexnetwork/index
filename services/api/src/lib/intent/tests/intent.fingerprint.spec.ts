import { describe, expect, it } from 'bun:test';

import { buildFullIntentText, buildIntentSnippet, canApplyExpectedIntentUpdate, computeIntentFingerprint } from '../intent.fingerprint';

describe('intent fingerprint', () => {
  it('normalizes the full payload and summary', () => {
    expect(computeIntentFingerprint(' Find   collaborators ', ' Hands-on\npeople '))
      .toBe(computeIntentFingerprint('Find collaborators', 'Hands-on people'));
    expect(buildFullIntentText(' Find   collaborators ', ' Hands-on\npeople '))
      .toBe('Find collaborators (Hands-on people)');
  });

  it('preserves field boundaries when display text would collide', () => {
    expect(buildFullIntentText('Find collaborators', 'local'))
      .toBe(buildFullIntentText('Find collaborators (local)', null));
    expect(computeIntentFingerprint('Find collaborators', 'local'))
      .not.toBe(computeIntentFingerprint('Find collaborators (local)', null));
  });

  it('is stable across pause and resume because lifecycle fields are excluded', () => {
    const paused = {
      payload: 'Find collaborators',
      summary: 'Hands-on people',
      status: 'PAUSED',
      updatedAt: '2026-07-15T10:00:00.000Z',
    };
    const resumed = {
      ...paused,
      status: 'ACTIVE',
      updatedAt: '2026-07-15T11:00:00.000Z',
    };
    expect(computeIntentFingerprint(paused.payload, paused.summary))
      .toBe(computeIntentFingerprint(resumed.payload, resumed.summary));
  });

  it('keeps the display snippet bounded without weakening the full fingerprint', () => {
    const intentText = `Find ${'specialized collaborators '.repeat(20)}`;
    expect(buildIntentSnippet(intentText)).toHaveLength(160);
    expect(computeIntentFingerprint(intentText)).not.toBe(computeIntentFingerprint(buildIntentSnippet(intentText)));
  });

  it('requires matching owner, active lifecycle, and material fingerprint for guarded writes', () => {
    const active = {
      payload: 'Find collaborators',
      summary: 'Hands-on people',
      userId: 'owner-1',
      status: 'ACTIVE',
      archivedAt: null,
    };
    const fingerprint = computeIntentFingerprint(active.payload, active.summary);
    expect(canApplyExpectedIntentUpdate(active, fingerprint, 'owner-1')).toBe(true);
    expect(canApplyExpectedIntentUpdate({ ...active, status: null }, fingerprint, 'owner-1')).toBe(true);
    expect(canApplyExpectedIntentUpdate({ ...active, status: 'PAUSED' }, fingerprint, 'owner-1')).toBe(false);
    expect(canApplyExpectedIntentUpdate({ ...active, archivedAt: new Date() }, fingerprint, 'owner-1')).toBe(false);
    expect(canApplyExpectedIntentUpdate(active, fingerprint, 'owner-2')).toBe(false);
    expect(canApplyExpectedIntentUpdate(active, 'stale-fingerprint', 'owner-1')).toBe(false);
    expect(canApplyExpectedIntentUpdate(active, fingerprint)).toBe(false);
  });

  it('enforces an owner-only expectation even without a fingerprint', () => {
    const intent = {
      payload: 'Find collaborators',
      summary: null,
      userId: 'owner-1',
      status: 'PAUSED',
      archivedAt: new Date(),
    };

    expect(canApplyExpectedIntentUpdate(intent, undefined, 'owner-1')).toBe(true);
    expect(canApplyExpectedIntentUpdate(intent, undefined, 'owner-2')).toBe(false);
  });

  it('preserves lifecycle-agnostic ordinary updates when no expectation is supplied', () => {
    expect(canApplyExpectedIntentUpdate({
      payload: 'Find collaborators',
      summary: null,
      userId: 'owner-1',
      status: 'PAUSED',
      archivedAt: new Date(),
    })).toBe(true);
  });
});
