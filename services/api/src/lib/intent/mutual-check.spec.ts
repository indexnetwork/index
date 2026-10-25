import { describe, expect, test } from 'bun:test';

import { bothYes, poolFor } from './mutual-check.policy';

describe('mutual check', () => {
  test('a mutuals_only intent is checked against visible and mutual assignments', () => {
    expect(poolFor('mutuals_only')).toEqual(['networks_only', 'mutuals_only']);
  });

  test('a networks_only intent is checked only against mutuals_only', () => {
    expect(poolFor('networks_only')).toEqual(['mutuals_only']);
  });

  test('a pair opens only when both directions say yes', () => {
    expect(bothYes(true, true)).toBe(true);
    expect(bothYes(true, false)).toBe(false);
    expect(bothYes(false, true)).toBe(false);
  });
});
