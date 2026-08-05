import { describe, expect, it } from 'bun:test';

import { MATRIX_ROWS } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.policy.js';
import { AB_ALLOWED_EVIDENCE, abConfigDeltas, abSlotCaseId, buildAbSlotScoreInput, invokeAbDiscoveryGraph, parseAbChildArgs, selectAbSideSlots } from '../discovery.main';
import { buildAbPlan, type AbSide, type AbSlot } from '../discovery.plan';

import type { HistoricalMatrixFixture } from '../discovery-env-matrix.shared';

const testCase = (id: string): HistoricalMatrixFixture => ({
  id, description: id, networkContext: 'ctx', sourceUserId: 'u1', expectedUserId: 'u2',
  excludedUserIds: [], participants: [],
});

/** A fixture complete enough for `databaseCase` to map its participant ids. */
const seedableCase = (id: string): HistoricalMatrixFixture => ({
  ...testCase(id),
  participants: ['u1', 'u2'].map((participantId) => ({
    id: participantId,
    profileText: `${id} ${participantId} profile`,
    location: 'fixture city',
    interests: [],
    skills: [],
    intent: { text: `${id} ${participantId} intent` },
  })),
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
  it('lists every evidence kind, which is what makes it a relaxation of the row gate', () => {
    expect([...AB_ALLOWED_EVIDENCE].sort()).toEqual(['intent', 'premise', 'user_context']);
  });

  // The seam `scoreMatrixSlot` takes this through is `any`-typed, so a fourth
  // evidence kind added to MATRIX_ROWS would not fail to compile here; it would
  // fail `allowed_evidence` on every A/B slot citing it, 40 minutes into a live
  // run. Fail in a second here instead.
  it('covers every evidence kind the matrix rows allow, or a new kind would fail every slot citing it', () => {
    const matrixEvidence = new Set<string>(MATRIX_ROWS.flatMap((row) => [...row.allowedEvidence]));
    const allowed = new Set<string>(AB_ALLOWED_EVIDENCE);
    expect([...matrixEvidence].filter((kind) => !allowed.has(kind))).toEqual([]);
  });
});

describe('buildAbSlotScoreInput', () => {
  const scored = {
    candidates: [{ id: 'u2', finalRank: 1, evidenceTypes: ['intent' as const], evidenceIds: {} }],
    rawCandidates: [{ id: 'u2', retrievalRank: 1, evidenceTypes: ['intent' as const], evidenceIds: {} }],
    evaluatorTraces: [{ id: 'u2', retrievalRank: 1, evaluatorReturned: true, evaluatorScore: 90, finalIncluded: true, finalRank: 1 }],
    completed: true,
  };
  const failed = { candidates: [], completed: false };
  const slot = (side: AbSide, repetition = 0): AbSlot => ({ matrixCase: seedableCase('c1'), side, repetition });

  it('states the allowed evidence on a scored slot, without which every candidate-bearing slot throws on an unknown row', () => {
    expect(buildAbSlotScoreInput(slot(sideA), scored).allowedEvidence).toBe(AB_ALLOWED_EVIDENCE);
  });

  it('states the allowed evidence on a failed slot too, so the fallback cannot drift from the scored path', () => {
    expect(buildAbSlotScoreInput(slot(sideB), failed).allowedEvidence).toBe(AB_ALLOWED_EVIDENCE);
  });

  it('scores the slot against the side, not a matrix row, and names the repetition one-based', () => {
    const input = buildAbSlotScoreInput(slot(sideB, 2), scored);
    expect(input.rowId).toBe('b');
    expect(input.repetition).toBe(2);
    expect(input.caseId).toBe('c1/b/r3');
  });

  it('records the side configuration as sorted deltas on a scored slot', () => {
    const side: AbSide = { id: 'a', config: { NEGOTIATION_MAX_TURNS_CHAT: '6', DISCOVERY_ALLOWED_TYPES: 'intent' } };
    expect(buildAbSlotScoreInput(slot(side), scored).configDeltas).toEqual([
      { key: 'DISCOVERY_ALLOWED_TYPES', before: null, after: 'intent' },
      { key: 'NEGOTIATION_MAX_TURNS_CHAT', before: null, after: '6' },
    ]);
  });

  it('records the side configuration on a failed slot too, so a failure says which configuration produced it', () => {
    const side: AbSide = { id: 'b', config: { NEGOTIATION_MAX_TURNS_CHAT: '6', DISCOVERY_ALLOWED_TYPES: 'intent,profile' } };
    expect(buildAbSlotScoreInput(slot(side), failed).configDeltas).toEqual([
      { key: 'DISCOVERY_ALLOWED_TYPES', before: null, after: 'intent,profile' },
      { key: 'NEGOTIATION_MAX_TURNS_CHAT', before: null, after: '6' },
    ]);
  });

  it('still states the allowed evidence when the configuration is empty and there are no deltas', () => {
    const input = buildAbSlotScoreInput(slot({ id: 'a', config: {} }), scored);
    expect(input.configDeltas).toEqual([]);
    expect(input.allowedEvidence).toBe(AB_ALLOWED_EVIDENCE);
  });

  it('carries the outcome through and maps participant ids to their protected-base ids', () => {
    const input = buildAbSlotScoreInput(slot(sideA), scored);
    expect(input.candidates).toBe(scored.candidates);
    expect(input.rawCandidates).toBe(scored.rawCandidates);
    expect(input.evaluatorTraces).toBe(scored.evaluatorTraces);
    expect(input.completed).toBe(true);
    expect(input.matrixCase.id).toBe('c1');
    expect(input.matrixCase.sourceUserId).toMatch(/^eval-discovery-matrix-user-/);
    expect(input.matrixCase.expectedUserId).not.toBe(input.matrixCase.sourceUserId);
  });

  it('omits the diagnostic fields a failed slot has none of, exactly as the fallback did inline', () => {
    const input = buildAbSlotScoreInput(slot(sideA), failed);
    expect(input.candidates).toEqual([]);
    expect(input.completed).toBe(false);
    expect(Object.keys(input).includes('rawCandidates')).toBe(false);
    expect(Object.keys(input).includes('evaluatorTraces')).toBe(false);
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
