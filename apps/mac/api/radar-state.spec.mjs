import { describe, expect, it } from 'bun:test';

import { applyRadarPeople, sameRadarPeople } from './radar-state.mjs';

function person(overrides = {}) {
  return {
    id: 'opp-1',
    name: 'Yankı',
    blurb: 'wildlife photography',
    status: 'ready',
    score: 0.8,
    hidden: false,
    ...overrides,
  };
}

describe('sameRadarPeople', () => {
  it('treats identical display fields as unchanged even when object identity differs', () => {
    const prev = [person()];
    const next = [person()];
    expect(sameRadarPeople(prev, next)).toBe(true);
  });

  it('detects status, score, name, or blurb changes', () => {
    const prev = [person()];
    expect(sameRadarPeople(prev, [person({ status: 'accepted' })])).toBe(false);
    expect(sameRadarPeople(prev, [person({ score: 0.9 })])).toBe(false);
    expect(sameRadarPeople(prev, [person({ name: 'Other' })])).toBe(false);
    expect(sameRadarPeople(prev, [person({ blurb: 'new blurb' })])).toBe(false);
  });

  it('detects membership changes', () => {
    expect(sameRadarPeople([person()], [])).toBe(false);
    expect(sameRadarPeople([], [person()])).toBe(false);
    expect(sameRadarPeople([person()], [person({ id: 'opp-2' })])).toBe(false);
  });
});

describe('applyRadarPeople', () => {
  it('keeps the previous array reference when nothing meaningful changed', () => {
    const prev = [person()];
    const next = [person({ source: { fresh: true } })];
    expect(applyRadarPeople(prev, next)).toBe(prev);
  });

  it('returns the next list when membership or display fields change', () => {
    const prev = [person()];
    const next = [person({ status: 'accepted' })];
    expect(applyRadarPeople(prev, next)).toBe(next);
  });
});
