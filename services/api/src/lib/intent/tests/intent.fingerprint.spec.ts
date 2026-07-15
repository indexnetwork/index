import { describe, expect, it } from 'bun:test';

import { buildFullIntentText, buildIntentSnippet, computeIntentFingerprint } from '../intent.fingerprint';

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
});
