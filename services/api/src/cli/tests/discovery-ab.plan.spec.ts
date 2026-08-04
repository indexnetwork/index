import { describe, expect, it } from 'bun:test';

import { buildAbPlan, configDiff, type AbSide } from '../discovery-ab.plan';
import type { HistoricalMatrixFixture } from '../discovery-env-matrix.shared';

const testCase = (id: string): HistoricalMatrixFixture => ({
  id, description: id, networkContext: 'ctx', sourceUserId: 'u1', expectedUserId: 'u2',
  excludedUserIds: [], participants: [],
});

const sideA: AbSide = { id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent' } };
const sideB: AbSide = { id: 'b', config: { DISCOVERY_ALLOWED_TYPES: 'intent,profile' } };

describe('buildAbPlan', () => {
  it('produces cases x repetitions x two sides', () => {
    const plan = buildAbPlan([testCase('c1'), testCase('c2')], [sideA, sideB], 3);
    expect(plan).toHaveLength(12);
    expect(plan.filter((slot) => slot.side.id === 'a')).toHaveLength(6);
    expect(plan.filter((slot) => slot.side.id === 'b')).toHaveLength(6);
  });

  it('gives both sides identical case and repetition coverage', () => {
    const plan = buildAbPlan([testCase('c1'), testCase('c2')], [sideA, sideB], 2);
    const coverage = (side: string) => plan
      .filter((slot) => slot.side.id === side)
      .map((slot) => `${slot.matrixCase.id}/r${slot.repetition}`)
      .sort();
    expect(coverage('a')).toEqual(coverage('b'));
  });

  it('refuses identical configurations, which would spend a run measuring noise', () => {
    expect(() => buildAbPlan([testCase('c1')], [sideA, { id: 'b', config: sideA.config }], 1))
      .toThrow(/identical/i);
  });

  it('refuses a flag the graph cannot reach', () => {
    expect(() => buildAbPlan([testCase('c1')], [sideA, { id: 'b', config: { POOL_QUESTIONS_MODE: 'on' } }], 1))
      .toThrow(/POOL_QUESTIONS_MODE/);
  });

  it('refuses a key set present on one side only, because the omitted side takes the graph default', () => {
    expect(() => buildAbPlan(
      [testCase('c1')],
      [{ id: 'a', config: {} }, { id: 'b', config: { DISCOVERY_ALLOWED_TYPES: 'intent,profile' } }],
      1,
    )).toThrow(/DISCOVERY_ALLOWED_TYPES/);
  });

  it('accepts that same comparison once both sides state the key explicitly', () => {
    const plan = buildAbPlan(
      [testCase('c1')],
      [{ id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent' } }, { id: 'b', config: { DISCOVERY_ALLOWED_TYPES: 'intent,profile' } }],
      1,
    );
    expect(plan).toHaveLength(2);
  });

  it('refuses two sides sharing an id, which would collapse into one row downstream', () => {
    expect(() => buildAbPlan([testCase('c1')], [sideA, { id: 'a', config: sideB.config }], 1))
      .toThrow(/'a' then 'a'/);
  });

  it('refuses sides given in the reverse order, which would file b under the a column', () => {
    expect(() => buildAbPlan([testCase('c1')], [sideB, sideA], 1)).toThrow(/'b' then 'a'/);
  });

  it('refuses a non-positive repetition count', () => {
    expect(() => buildAbPlan([testCase('c1')], [sideA, sideB], 0)).toThrow(/repetition/i);
  });

  it('refuses an empty case selection', () => {
    expect(() => buildAbPlan([], [sideA, sideB], 1)).toThrow(/case/i);
  });
});

describe('configDiff', () => {
  it('reports differing, added and removed keys with null for absent', () => {
    expect(configDiff(
      { DISCOVERY_ALLOWED_TYPES: 'intent', DISCOVERY_SOURCE_PREMISE_LIMIT: '40' },
      { DISCOVERY_ALLOWED_TYPES: 'profile', NEGOTIATION_MAX_TURNS_CHAT: '6' },
    )).toEqual([
      { key: 'DISCOVERY_ALLOWED_TYPES', a: 'intent', b: 'profile' },
      { key: 'DISCOVERY_SOURCE_PREMISE_LIMIT', a: '40', b: null },
      { key: 'NEGOTIATION_MAX_TURNS_CHAT', a: null, b: '6' },
    ]);
  });

  it('omits keys the two sides agree on, because they explain no difference', () => {
    expect(configDiff(
      { DISCOVERY_ALLOWED_TYPES: 'intent' },
      { DISCOVERY_ALLOWED_TYPES: 'intent', NEGOTIATION_MAX_TURNS_CHAT: '6' },
    )).toEqual([{ key: 'NEGOTIATION_MAX_TURNS_CHAT', a: null, b: '6' }]);
  });
});
