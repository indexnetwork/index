import { describe, expect, it } from 'bun:test';

import { AB_DEFAULT_REPETITIONS, AB_EXIT_INSUFFICIENT_EVIDENCE, AB_MAX_REPETITIONS, abChildTimeoutMs, abSelectionFilters, formatAbRunArgs, parseAbRunArgs, resolveAbCases, resolveAbRunOutcome } from '../discovery-ab.main';
import { buildAbPlan, type AbSide } from '../discovery-ab.plan';

import type { MatrixSlotResult } from '../discovery-env-matrix.main';
import type { HistoricalMatrixFixture } from '../discovery-env-matrix.shared';

const testCase = (id: string): HistoricalMatrixFixture => ({
  id, description: id, networkContext: 'ctx', sourceUserId: 'u1', expectedUserId: 'u2',
  excludedUserIds: [], participants: [],
});
const corpus = [testCase('c1'), testCase('c2'), testCase('c3')];

const sides: [AbSide, AbSide] = [
  { id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent', DISCOVERY_SOURCE_PREMISE_LIMIT: '40' } },
  { id: 'b', config: { DISCOVERY_ALLOWED_TYPES: 'intent,profile', DISCOVERY_SOURCE_PREMISE_LIMIT: '5' } },
];
const configArgs = [
  '--a', 'DISCOVERY_ALLOWED_TYPES=intent', '--a', 'DISCOVERY_SOURCE_PREMISE_LIMIT=40',
  '--b', 'DISCOVERY_ALLOWED_TYPES=intent,profile', '--b', 'DISCOVERY_SOURCE_PREMISE_LIMIT=5',
];

describe('parseAbRunArgs', () => {
  it('reads a shared selection and one configuration per side', () => {
    expect(parseAbRunArgs(['--case', 'c1', '--runs', '2', ...configArgs])).toEqual({
      caseIds: ['c1'],
      repetitions: 2,
      sides,
      force: false,
    });
  });

  it('defaults to the full corpus at three repetitions, which is what makes flakiness visible', () => {
    const selection = parseAbRunArgs(configArgs);
    expect(selection.caseIds).toEqual([]);
    expect(selection.repetitions).toBe(AB_DEFAULT_REPETITIONS);
    expect(selection.force).toBe(false);
  });

  it('accepts a repeated --case and keeps the operator ordering', () => {
    expect(parseAbRunArgs(['--case', 'c3', '--case', 'c1', ...configArgs]).caseIds).toEqual(['c3', 'c1']);
  });

  it('reads --force, the only consent to replace an existing artifact', () => {
    expect(parseAbRunArgs([...configArgs, '--force']).force).toBe(true);
  });

  it('produces sides a plan will accept', () => {
    const selection = parseAbRunArgs(['--runs', '1', ...configArgs]);
    expect(buildAbPlan([testCase('c1')], selection.sides, selection.repetitions)).toHaveLength(2);
  });

  it.each([
    [['--case', '--runs', '1', ...configArgs], /--case requires a value/],
    [['--case', 'c1', '--case', 'c1', ...configArgs], /same case twice/],
    [['--runs', '0', ...configArgs], /--runs must be a positive integer/],
    [['--runs', 'two', ...configArgs], /--runs must be a positive integer/],
    [['--runs', '-1', ...configArgs], /--runs must be a positive integer \(received -1\)/],
    [['--runs', ...configArgs], /--runs requires a value/],
    [['--runs', '1', '--runs', '2', ...configArgs], /at most once/],
    [[...configArgs, '--runs', String(AB_MAX_REPETITIONS + 1)], /must not exceed/],
    [['--b', 'DISCOVERY_ALLOWED_TYPES=intent'], /Side a has no configuration/],
    [['--a', 'DISCOVERY_ALLOWED_TYPES=intent'], /Side b has no configuration/],
    [['--a', 'DISCOVERY_ALLOWED_TYPES', '--b', 'DISCOVERY_ALLOWED_TYPES=x'], /--a expects KEY=VALUE/],
    [['--a', 'X=1', '--a', 'X=2', '--b', 'X=3'], /--a sets X twice/],
    [['--a', '--b', 'X=1'], /--a requires a value/],
  ])('refuses %p', (args, message) => {
    expect(() => parseAbRunArgs(args)).toThrow(message);
  });

  it('cannot be tricked into writing through an object prototype', () => {
    const selection = parseAbRunArgs(['--a', '__proto__=polluted', '--b', '__proto__=other']);
    expect(Object.getPrototypeOf(selection.sides[0].config)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('formatAbRunArgs', () => {
  it('round-trips, so both children plan from exactly what the parent parsed', () => {
    const selection = parseAbRunArgs(['--case', 'c2', '--runs', '2', ...configArgs, '--force']);
    // --force is deliberately not forwarded: only the parent writes an artifact.
    expect(parseAbRunArgs(formatAbRunArgs(selection))).toEqual({ ...selection, force: false });
  });

  it('is independent of the order the operator typed the flags in', () => {
    const typed = parseAbRunArgs(['--b', 'DISCOVERY_SOURCE_PREMISE_LIMIT=5', '--a', 'DISCOVERY_SOURCE_PREMISE_LIMIT=40',
      '--b', 'DISCOVERY_ALLOWED_TYPES=intent,profile', '--a', 'DISCOVERY_ALLOWED_TYPES=intent']);
    expect(formatAbRunArgs(typed)).toEqual(formatAbRunArgs(parseAbRunArgs(configArgs)));
  });

  it('states the repetition count explicitly, so a default change cannot split the two children', () => {
    expect(formatAbRunArgs(parseAbRunArgs(configArgs))).toContain('--runs');
  });
});

describe('resolveAbCases', () => {
  it('runs the whole corpus when no case is named', () => {
    expect(resolveAbCases(corpus, []).map((entry) => entry.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('resolves named cases in the order they were named', () => {
    expect(resolveAbCases(corpus, ['c3', 'c1']).map((entry) => entry.id)).toEqual(['c3', 'c1']);
  });

  it('refuses an unknown case rather than silently running fewer', () => {
    expect(() => resolveAbCases(corpus, ['c9'])).toThrow(/Unknown discovery A\/B case: c9/);
  });
});

describe('abSelectionFilters', () => {
  it('reports an unfiltered run as having no filters, which is what fullCorpus means', () => {
    expect(abSelectionFilters([])).toEqual({});
  });

  it('records every named case, because a filtered artifact must say what it left out', () => {
    expect(abSelectionFilters(['c1', 'c2'])).toEqual({ case: 'c1,c2' });
  });
});

describe('abChildTimeoutMs', () => {
  it('bounds a side by the work it may legitimately do, not by a fixed guess', () => {
    // Five slots is what a matrix child owns, and its watchdog is 50 minutes.
    expect(abChildTimeoutMs(5)).toBe(3_015_000);
    expect(abChildTimeoutMs(15)).toBeGreaterThan(abChildTimeoutMs(5));
  });

  it('refuses a side with no slots', () => {
    expect(() => abChildTimeoutMs(0)).toThrow(/at least one slot/);
  });
});

const slot = (rowId: 'a' | 'b', caseId: string, runs: number, passes: number): MatrixSlotResult => ({
  caseId, rule: rowId, rowId, repetition: 0, runs, passes,
  passRate: runs === 0 ? 0 : passes / runs, flaky: false,
});

describe('resolveAbRunOutcome', () => {
  const complete = [
    slot('a', 'c1/a/r1', 1, 1), slot('a', 'c2/a/r1', 1, 0),
    slot('b', 'c1/b/r1', 1, 1), slot('b', 'c2/b/r1', 1, 1),
  ];

  it('reports both sides when every planned slot was scored', () => {
    const outcome = resolveAbRunOutcome({ slots: complete, sides, expectedSlotsPerSide: 2 });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.incompleteSides).toEqual([]);
    expect(outcome.verdict).toEqual([
      { sideId: 'a', passes: 1, runs: 2, passRate: 0.5 },
      { sideId: 'b', passes: 2, runs: 2, passRate: 1 },
    ]);
    expect(outcome.summary).toContain('side a 1/2');
    expect(outcome.summary).toContain('side b 2/2');
  });

  it('reports no verdict and exits non-zero when one side has a failed slot', () => {
    const slots = [complete[0]!, complete[1]!, complete[2]!, slot('b', 'c2/b/r1', 0, 0)];
    const outcome = resolveAbRunOutcome({ slots, sides, expectedSlotsPerSide: 2 });
    expect(outcome.verdict).toBeNull();
    expect(outcome.exitCode).toBe(AB_EXIT_INSUFFICIENT_EVIDENCE);
    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.incompleteSides).toEqual(['b']);
    expect(outcome.summary).toContain('no verdict');
    expect(outcome.summary).toContain('side b scored 1/2 slot(s), 1 failed');
  });

  it('reports no verdict when a side returned fewer slots than it was planned', () => {
    const outcome = resolveAbRunOutcome({ slots: complete.slice(0, 3), sides, expectedSlotsPerSide: 2 });
    expect(outcome.verdict).toBeNull();
    expect(outcome.exitCode).toBe(AB_EXIT_INSUFFICIENT_EVIDENCE);
    expect(outcome.incompleteSides).toEqual(['b']);
  });

  it('reports no verdict when a side produced nothing at all, rather than a one-sided result', () => {
    const outcome = resolveAbRunOutcome({ slots: complete.slice(0, 2), sides, expectedSlotsPerSide: 2 });
    expect(outcome.verdict).toBeNull();
    expect(outcome.sides.find((entry) => entry.sideId === 'b')).toMatchObject({ produced: 0, scored: 0, complete: false });
    expect(outcome.summary).toContain('side b scored 0/2');
  });

  it('names both sides when both failed', () => {
    const slots = [slot('a', 'c1/a/r1', 0, 0), slot('b', 'c1/b/r1', 0, 0)];
    const outcome = resolveAbRunOutcome({ slots, sides, expectedSlotsPerSide: 1 });
    expect(outcome.incompleteSides).toEqual(['a', 'b']);
    expect(outcome.summary).toContain('side a');
    expect(outcome.summary).toContain('side b');
  });

  it('counts only scored runs, so a failed slot is a failure rather than a zero', () => {
    const slots = [slot('a', 'c1/a/r1', 1, 1), slot('a', 'c2/a/r1', 0, 0), slot('b', 'c1/b/r1', 1, 1), slot('b', 'c2/b/r1', 1, 1)];
    const outcome = resolveAbRunOutcome({ slots, sides, expectedSlotsPerSide: 2 });
    expect(outcome.sides[0]).toMatchObject({ sideId: 'a', scored: 1, failed: 1, passes: 1 });
    expect(outcome.verdict).toBeNull();
  });
});
