import { describe, expect, it } from 'bun:test';

import { AB_ALLOWED_EVIDENCE, abConfigDeltas, abSlotCaseId, invokeAbDiscoveryGraph, parseAbChildArgs, selectAbSideSlots } from '../discovery-ab.main';
import { buildAbPlan, type AbSide, type AbSlot } from '../discovery-ab.plan';

import type { HistoricalMatrixFixture } from '../discovery-env-matrix.shared';

const testCase = (id: string): HistoricalMatrixFixture => ({
  id, description: id, networkContext: 'ctx', sourceUserId: 'u1', expectedUserId: 'u2',
  excludedUserIds: [], participants: [],
});

const sideA: AbSide = { id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent' } };
const sideB: AbSide = { id: 'b', config: { DISCOVERY_ALLOWED_TYPES: 'intent,profile' } };

describe('abSlotCaseId', () => {
  it('reports repetitions one-based, matching the matrix harness', () => {
    const plan = buildAbPlan([testCase('c1')], [sideA, sideB], 2);
    expect(plan.map(abSlotCaseId)).toEqual([
      'c1/a/r1', 'c1/b/r1', 'c1/a/r2', 'c1/b/r2',
    ]);
  });

  it('names the side, so a slot is attributable to the configuration that produced it', () => {
    expect(abSlotCaseId({ matrixCase: testCase('historical/case'), side: sideB, repetition: 0 })).toBe('historical/case/b/r1');
  });
});

describe('abConfigDeltas', () => {
  it('records every key of the side configuration as an applied value', () => {
    expect(abConfigDeltas({ DISCOVERY_ALLOWED_TYPES: 'intent', DISCOVERY_SOURCE_PREMISE_LIMIT: '5' })).toEqual([
      { key: 'DISCOVERY_ALLOWED_TYPES', before: null, after: 'intent' },
      { key: 'DISCOVERY_SOURCE_PREMISE_LIMIT', before: null, after: '5' },
    ]);
  });

  it('is independent of the order the operator typed the flags in', () => {
    expect(abConfigDeltas({ NEGOTIATION_MAX_TURNS_CHAT: '6', DISCOVERY_ALLOWED_TYPES: 'intent' }))
      .toEqual(abConfigDeltas({ DISCOVERY_ALLOWED_TYPES: 'intent', NEGOTIATION_MAX_TURNS_CHAT: '6' }));
  });

  it('records an empty configuration as no deltas rather than inventing one', () => {
    expect(abConfigDeltas({})).toEqual([]);
  });
});

describe('selectAbSideSlots', () => {
  const plan = buildAbPlan([testCase('c1'), testCase('c2')], [sideA, sideB], 3);

  it('keeps only the slots of the requested side, in plan order', () => {
    const selection = selectAbSideSlots('b', plan);
    expect(selection.side).toBe(sideB);
    expect(selection.slots).toHaveLength(6);
    expect(selection.slots.every((slot) => slot.side.id === 'b')).toBe(true);
    expect(selection.slots.map(abSlotCaseId)).toEqual(['c1/b/r1', 'c1/b/r2', 'c1/b/r3', 'c2/b/r1', 'c2/b/r2', 'c2/b/r3']);
  });

  it('gives each side the same case and repetition coverage', () => {
    const strip = (slots: readonly AbSlot[]): string[] => slots.map((slot) => `${slot.matrixCase.id}/r${slot.repetition}`);
    expect(strip(selectAbSideSlots('a', plan).slots)).toEqual(strip(selectAbSideSlots('b', plan).slots));
  });

  it('refuses a side with no slots rather than writing an empty artifact', () => {
    expect(() => selectAbSideSlots('a', selectAbSideSlots('b', plan).slots)).toThrow(/owns no slots/);
  });

  it('refuses two configurations under one side id, which this process cannot run', () => {
    const conflicting: AbSlot[] = [
      { matrixCase: testCase('c1'), side: sideA, repetition: 0 },
      { matrixCase: testCase('c1'), side: { id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'profile' } }, repetition: 1 },
    ];
    expect(() => selectAbSideSlots('a', conflicting)).toThrow(/more than one configuration/);
  });

  it('accepts an equal configuration supplied as a different object', () => {
    const equivalent: AbSlot[] = [
      { matrixCase: testCase('c1'), side: sideA, repetition: 0 },
      { matrixCase: testCase('c1'), side: { id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent' } }, repetition: 1 },
    ];
    expect(selectAbSideSlots('a', equivalent).slots).toHaveLength(2);
  });
});

describe('parseAbChildArgs', () => {
  it('reads the child invocation contract', () => {
    expect(parseAbChildArgs(['--side', 'b', '--child-output', '/tmp/side-b.json']))
      .toEqual({ sideId: 'b', outputPath: '/tmp/side-b.json' });
  });

  it.each([
    [['--child-output', '/tmp/x.json'], /--side must be exactly a or b/],
    [['--side', '--child-output', '/tmp/x.json'], /--side must be exactly a or b/],
    [['--side', 'c', '--child-output', '/tmp/x.json'], /--side must be exactly a or b/],
    [['--side', 'a'], /--child-output/],
    [['--side', 'a', '--child-output'], /--child-output/],
    [['--side', 'a', '--child-output', '--force'], /--child-output/],
  ])('refuses %p', (args, message) => {
    expect(() => parseAbChildArgs(args)).toThrow(message);
  });
});

describe('AB_ALLOWED_EVIDENCE', () => {
  it('states plainly that A/B does not gate evidence per configuration', () => {
    expect([...AB_ALLOWED_EVIDENCE].sort()).toEqual(['intent', 'premise', 'user_context']);
  });
});

describe('invokeAbDiscoveryGraph', () => {
  const runtime = { sourceUserId: 'user-1', networkId: 'network-1', triggerIntentId: 'intent-1' };

  it('runs the graph inside the side configuration and restores the environment afterwards', async () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'intent';
    delete process.env.DISCOVERY_SOURCE_PREMISE_LIMIT;
    const observed: Array<Record<string, string | undefined>> = [];
    const calls: unknown[] = [];
    const signals: Array<AbortSignal | undefined> = [];
    const controller = new AbortController();
    const graph = {
      invoke: async (input: unknown, config?: { signal?: AbortSignal }) => {
        calls.push(input);
        signals.push(config?.signal);
        observed.push({
          DISCOVERY_ALLOWED_TYPES: process.env.DISCOVERY_ALLOWED_TYPES,
          DISCOVERY_SOURCE_PREMISE_LIMIT: process.env.DISCOVERY_SOURCE_PREMISE_LIMIT,
        });
        return { candidates: [] };
      },
    };

    await invokeAbDiscoveryGraph(
      graph,
      runtime,
      { DISCOVERY_ALLOWED_TYPES: 'intent,profile', DISCOVERY_SOURCE_PREMISE_LIMIT: '5' },
      controller.signal,
    );

    expect(calls).toEqual([{ userId: 'user-1', networkId: 'network-1', triggerIntentId: 'intent-1', options: { minScore: 50 } }]);
    expect(signals).toEqual([controller.signal]);
    expect(observed).toEqual([{ DISCOVERY_ALLOWED_TYPES: 'intent,profile', DISCOVERY_SOURCE_PREMISE_LIMIT: '5' }]);
    expect(process.env.DISCOVERY_ALLOWED_TYPES).toBe('intent');
    expect(process.env.DISCOVERY_SOURCE_PREMISE_LIMIT).toBeUndefined();
  });

  it('restores the environment when the graph fails, so the next slot is not contaminated', async () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'intent';
    const graph = { invoke: async () => { throw new Error('graph failed'); } };

    await expect(invokeAbDiscoveryGraph(graph, runtime, { DISCOVERY_ALLOWED_TYPES: 'profile' }))
      .rejects.toThrow('graph failed');
    expect(process.env.DISCOVERY_ALLOWED_TYPES).toBe('intent');
  });

  it('refuses a configuration naming a flag the graph cannot read', async () => {
    const graph = { invoke: async () => ({}) };
    await expect(invokeAbDiscoveryGraph(graph, runtime, { POOL_QUESTIONS_MODE: 'on' }))
      .rejects.toThrow(/POOL_QUESTIONS_MODE/);
  });
});
