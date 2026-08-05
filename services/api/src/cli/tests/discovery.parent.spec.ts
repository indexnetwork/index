import path from 'node:path';

import { describe, expect, it } from 'bun:test';

import { AB_EXIT_PREFLIGHT_REFUSED, AB_EXIT_SPENT_WITHOUT_ARTIFACT, AbSpentRunError, describeAbFailure } from '../discovery.contract';
import { AB_DEFAULT_REPETITIONS, AB_EXIT_INSUFFICIENT_EVIDENCE, AB_MAX_REPETITIONS, abChildTimeoutMs, abRunReportPath, abRunShape, abSelectionFilters, finalizeAbChildArtifacts, formatAbRunArgs, parseAbRunArgs, resolveAbCases, resolveAbRunOutcome, withAbSpendAccounting } from '../discovery.main';
import { buildAbPlan, type AbSide } from '../discovery.plan';

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

  it('reads --report as the artifact destination, and leaves it unset otherwise', () => {
    expect(parseAbRunArgs([...configArgs, '--report', '/tmp/discovery-report.json']).reportPath)
      .toBe('/tmp/discovery-report.json');
    expect(parseAbRunArgs(configArgs).reportPath).toBeUndefined();
  });

  it('resolves a relative --report against the working directory, since the run report is written later', () => {
    expect(parseAbRunArgs([...configArgs, '--report', 'runs/out.json']).reportPath)
      .toBe(path.resolve(process.cwd(), 'runs/out.json'));
  });

  /**
   * A directory cannot be refused later. The write plan asks only whether the
   * output exists *as a file*, which a directory does not, so a mistyped
   * destination would sail through pre-flight and fail at the write — after both
   * branches were reset and both sides were paid for, reporting a spend (exit 4)
   * for what is a typo. Refusing it here keeps it in the pre-flight refusal
   * (exit 2) the contract promises costs nothing.
   */
  it('refuses a --report naming an existing directory, since that failure would otherwise land after the spend', () => {
    expect(() => parseAbRunArgs([...configArgs, '--report', import.meta.dir]))
      .toThrow(`--report must name a file to write, but ${import.meta.dir} is an existing directory`);
  });

  it('still accepts a --report naming an existing file, which is the write plan\'s to refuse without --force', () => {
    const existingFile = path.resolve(import.meta.dir, 'discovery.parent.spec.ts');
    expect(parseAbRunArgs([...configArgs, '--report', existingFile]).reportPath).toBe(existingFile);
  });

  it('produces sides a plan will accept', () => {
    const selection = parseAbRunArgs(['--runs', '1', ...configArgs]);
    expect(buildAbPlan([testCase('c1')], selection.sides, selection.repetitions)).toHaveLength(2);
  });

  it('parses --env into a single side a', () => {
    const selection = parseAbRunArgs(['--runs', '1', '--env', 'DISCOVERY_ALLOWED_TYPES=intent']);
    expect(selection.sides).toHaveLength(1);
    expect(selection.sides[0]).toEqual({ id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent' } });
  });

  it('plans one slot per case per repetition for a single run, not two', () => {
    // The whole point of the shape: half the invocations, half the branches.
    const selection = parseAbRunArgs(['--runs', '2', '--env', 'DISCOVERY_ALLOWED_TYPES=intent']);
    const plan = buildAbPlan([testCase('c1'), testCase('c2')], selection.sides, selection.repetitions);
    expect(plan).toHaveLength(4);
    expect(new Set(plan.map((slot) => slot.side.id))).toEqual(new Set(['a']));
  });

  it('accepts a single run whose one key would be asymmetric in a pair', () => {
    // Symmetry and difference are rules about a comparison. Applied to one side
    // they would refuse every valid single run, since there is no other side to
    // match keys with.
    const selection = parseAbRunArgs(['--env', 'DISCOVERY_ALLOWED_TYPES=intent']);
    expect(() => buildAbPlan([testCase('c1')], selection.sides, 1)).not.toThrow();
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
    // The two ways of asking for neither shape or both. Both refusals are
    // pre-flight and cost nothing, which is the point: a run that guessed would
    // reset a branch first and be wrong afterwards.
    [['--runs', '1'], /needs a configuration/],
    [['--case', 'c1'], /--env KEY=VALUE to measure one/],
    [['--env', 'X=1', '--a', 'Y=2', '--b', 'Y=3'], /pass one shape or the other/],
    [['--env', 'X=1', '--b', 'Y=2'], /pass one shape or the other/],
    [['--env', 'DISCOVERY_ALLOWED_TYPES'], /--env expects KEY=VALUE/],
    [['--env', 'X=1', '--env', 'X=2'], /--env sets X twice/],
    [['--env'], /--env requires a value/],
    [[...configArgs, '--report'], /--report requires a value/],
    [[...configArgs, '--report', '   '], /--report requires a value/],
    [[...configArgs, '--report', '/tmp/a.json', '--report', '/tmp/b.json'], /--report may be given at most once/],
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

  it('round-trips a single run as --env, not as a pair with a missing side', () => {
    // The child re-parses these arguments and re-plans from them. Rendering a
    // single run as --a would have it plan a comparison whose side b never
    // existed, and the plan would refuse it after the branch was already reset.
    const selection = parseAbRunArgs(['--case', 'c2', '--runs', '2', '--env', 'DISCOVERY_ALLOWED_TYPES=intent']);
    const rendered = formatAbRunArgs(selection);
    expect(rendered).toContain('--env');
    expect(rendered).not.toContain('--a');
    expect(rendered).not.toContain('--b');
    expect(parseAbRunArgs(rendered)).toEqual({ ...selection, force: false });
  });

  it('is independent of the order the operator typed the flags in', () => {
    const typed = parseAbRunArgs(['--b', 'DISCOVERY_SOURCE_PREMISE_LIMIT=5', '--a', 'DISCOVERY_SOURCE_PREMISE_LIMIT=40',
      '--b', 'DISCOVERY_ALLOWED_TYPES=intent,profile', '--a', 'DISCOVERY_ALLOWED_TYPES=intent']);
    expect(formatAbRunArgs(typed)).toEqual(formatAbRunArgs(parseAbRunArgs(configArgs)));
  });

  it('states the repetition count explicitly, so a default change cannot split the two children', () => {
    expect(formatAbRunArgs(parseAbRunArgs(configArgs))).toContain('--runs');
  });

  it('does not forward --report: a child writes its own --child-output, never the run report', () => {
    const selection = parseAbRunArgs([...configArgs, '--report', '/tmp/discovery-report.json']);
    expect(formatAbRunArgs(selection)).not.toContain('--report');
    expect(parseAbRunArgs(formatAbRunArgs(selection)).reportPath).toBeUndefined();
  });
});

/**
 * The single line the flag exists for: without it `--report` parses fine and is
 * then ignored, which no other test in this file can see, because they all stop
 * at the parsed selection.
 */
describe('abRunReportPath', () => {
  const stamp = '2026-08-04T00-00-00-000Z';

  it('writes where --report named, verbatim', () => {
    expect(abRunReportPath({ reportPath: '/srv/eval-ops/.ops-runs/run-7/report.json' }, stamp))
      .toBe('/srv/eval-ops/.ops-runs/run-7/report.json');
  });

  it('names its own timestamped file under the runs directory when --report was absent', () => {
    // Restated from the harness's own layout rather than imported, so moving the
    // runs directory has to be a deliberate edit here too.
    expect(abRunReportPath({}, stamp))
      .toBe(path.resolve(import.meta.dir, '../../../eval/discovery/runs', `${stamp}.json`));
  });

  it('takes the destination from a real parsed selection, not just a hand-built one', () => {
    const chosen = parseAbRunArgs([...configArgs, '--report', '/tmp/discovery-chosen.json']);
    expect(abRunReportPath(chosen, stamp)).toBe('/tmp/discovery-chosen.json');
    expect(abRunReportPath(parseAbRunArgs(configArgs), stamp)).not.toBe('/tmp/discovery-chosen.json');
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
    expect(() => resolveAbCases(corpus, ['c9'])).toThrow(/Unknown discovery case: c9/);
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

  it('scores a single run without inventing a side it never had', () => {
    const outcome = resolveAbRunOutcome({
      slots: [complete[0]!, complete[1]!],
      sides: [sides[0]],
      expectedSlotsPerSide: 2,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.verdict).toEqual([{ sideId: 'a', passes: 1, runs: 2, passRate: 0.5 }]);
    expect(outcome.summary).toContain('side a 1/2');
    // No "vs": there is nothing to be versus.
    expect(outcome.summary).not.toContain('vs');
    expect(outcome.summary).not.toContain('side b');
  });

  it('withholds a verdict from an incomplete single run, naming the real reason', () => {
    // "A comparison with one side missing is not a comparison" would be false
    // here — nothing is missing a side. What is wrong is that a pass rate over
    // the slots that happened to succeed states no denominator.
    const outcome = resolveAbRunOutcome({
      slots: [complete[0]!, slot('a', 'c2/a/r1', 0, 0)],
      sides: [sides[0]],
      expectedSlotsPerSide: 2,
    });
    expect(outcome.verdict).toBeNull();
    expect(outcome.exitCode).toBe(AB_EXIT_INSUFFICIENT_EVIDENCE);
    expect(outcome.summary).toContain('states no denominator');
    expect(outcome.summary).not.toContain('comparison');
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

  it('gives an incomplete run a different code to a failure that wrote nothing at all', () => {
    const slots = [slot('a', 'c1/a/r1', 1, 1), slot('b', 'c1/b/r1', 0, 0)];
    const incomplete = resolveAbRunOutcome({ slots, sides, expectedSlotsPerSide: 1 });
    // 3 says the artifact is on disk and says nothing; 4 says there is no artifact.
    expect(incomplete.exitCode).toBe(AB_EXIT_INSUFFICIENT_EVIDENCE);
    expect(incomplete.exitCode).not.toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
  });
});

/**
 * This is the wrapper `runAbParent` runs its whole body through, so what it
 * decides is what the operator's exit code is.
 */
describe('abRunShape', () => {
  /**
   * The mapping the cost messages depend on. It is exported and pinned here
   * because its only caller sits inside `runAbComparison`, which needs live
   * Neon credentials and two branch resets to reach — so a deleted assignment
   * there would otherwise be invisible, and would turn every single-run failure
   * report into a claim that two branches were overwritten.
   */
  it('maps each selection to what it actually resets', () => {
    expect(abRunShape(sides)).toBe('pair');
    expect(abRunShape([sides[0]])).toBe('single');
  });

  it('agrees with what the parser produces for each shape of argv', () => {
    expect(abRunShape(parseAbRunArgs(configArgs).sides)).toBe('pair');
    expect(abRunShape(parseAbRunArgs(['--env', 'DISCOVERY_ALLOWED_TYPES=intent']).sides)).toBe('single');
  });
});

describe('withAbSpendAccounting', () => {
  it('passes a successful run through untouched', async () => {
    await expect(withAbSpendAccounting(async () => undefined)).resolves.toBeUndefined();
  });

  it('carries the shape into the cost report, so a single run is not reported as two branches', async () => {
    const thrown = await withAbSpendAccounting(async (progress) => {
      progress.shape = abRunShape(parseAbRunArgs(['--env', 'DISCOVERY_ALLOWED_TYPES=intent']).sides);
      progress.stage = 'reset';
      throw new Error('boom');
    }).catch((error: unknown) => error);
    const report = describeAbFailure(thrown);
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    expect(report.message).toContain('eval-ab-a');
    expect(report.message).not.toContain('eval-ab-b');
  });

  it('leaves a failure before the first reset as the pre-flight refusal it is', async () => {
    const refusal = new Error('--runs must be a positive integer (received 0)');
    const thrown = await withAbSpendAccounting(async () => { throw refusal; }).catch((error: unknown) => error);
    expect(thrown).toBe(refusal);
    expect(describeAbFailure(thrown).exitCode).toBe(AB_EXIT_PREFLIGHT_REFUSED);
  });

  /**
   * The reset loop is the likeliest place to fail after attestation, and inside
   * it nothing may have been overwritten yet. The stage that reports it must
   * not claim both branches were.
   */
  it('hedges a failure inside the reset loop, which may have overwritten nothing at all', async () => {
    const thrown = await withAbSpendAccounting(async (progress) => {
      progress.stage = 'resetting';
      // The first restore refused: side b was never even requested.
      throw new Error('Neon control-plane reset failed with status 500');
    }).catch((error: unknown) => error);
    const report = describeAbFailure(thrown);
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    expect(report.message).toContain('one or both branches may have been overwritten');
    expect(report.message).not.toContain('both branches were overwritten');
    expect(report.message).not.toContain('status 500');
  });

  it('reports a failure after the branches were reset as a mutation, not a refusal', async () => {
    const thrown = await withAbSpendAccounting(async (progress) => {
      progress.stage = 'reset';
      throw new Error('mkdtemp failed');
    }).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(AbSpentRunError);
    expect(describeAbFailure(thrown)).toMatchObject({ exitCode: AB_EXIT_SPENT_WITHOUT_ARTIFACT });
    expect(describeAbFailure(thrown).message).toContain('after resetting the A/B branches');
  });

  it('reports a failure after a side was spawned as a spend with no run report', async () => {
    const thrown = await withAbSpendAccounting(async (progress) => {
      progress.stage = 'reset';
      progress.stage = 'spawned';
      // The dead-child case: supervision aborts and nothing was written.
      throw new Error('Discovery child exited with code 1');
    }).catch((error: unknown) => error);
    const report = describeAbFailure(thrown);
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    // Hedged: a side that died at its own gate spent nothing, and this process
    // cannot tell that case from a side that ran for forty minutes.
    expect(report.message).toContain('provider spend and wall-clock time may already be gone');
    expect(report.message).toContain('No run report was written');
    // The temp directory the `finally` retains is named in the console line
    // printed just before this one; the message must not deny it.
    expect(report.message).not.toContain('nothing of this run survives');
    // The underlying failure text is never printed; only kept as a cause.
    expect(report.message).not.toContain('exited with code 1');
  });

  /**
   * The console formatting and the temp-directory cleanup both run after
   * `writeRunReport`. A run whose artifact is on disk - including a wholly
   * successful one whose cleanup hit EBUSY - must not be told nothing survived.
   */
  it('names the artifact when the failure came after it was written', async () => {
    const runPath = '/repo/eval/discovery/runs/2026-08-04T00-00-00-000Z.json';
    const thrown = await withAbSpendAccounting(async (progress) => {
      progress.stage = 'reset';
      progress.stage = 'spawned';
      progress.artifactPath = runPath;
      progress.stage = 'written';
      throw new Error('EBUSY: resource busy or locked, rm /tmp/discovery-x');
    }).catch((error: unknown) => error);
    const report = describeAbFailure(thrown);
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    expect(report.message).toContain(runPath);
    expect(report.message).toContain('The artifact on disk is real');
    expect(report.message).not.toContain('nothing of this run survives');
    expect(report.message).not.toContain('EBUSY');
  });
});

describe('finalizeAbChildArtifacts', () => {
  const fakeFs = (entries: string[] | Error) => {
    const removed: string[] = [];
    return {
      removed,
      fs: {
        readdir: (async () => {
          if (entries instanceof Error) throw entries;
          return entries;
        }) as never,
        rm: (async (target: string) => { removed.push(target); }) as never,
      },
    };
  };
  const warnings: string[] = [];
  const logger = { warn: (message: string) => { warnings.push(message); } };

  it('removes the directory when the run succeeded', async () => {
    const { fs, removed } = fakeFs(['a.json', 'b.json']);
    warnings.length = 0;
    await finalizeAbChildArtifacts('/tmp/discovery-x', true, fs, logger);
    expect(removed).toEqual(['/tmp/discovery-x']);
    expect(warnings).toEqual([]);
  });

  it('names this harness, not the matrix, and says how many artifacts it kept', async () => {
    const { fs, removed } = fakeFs(['b.json', 'a.json']);
    warnings.length = 0;
    await finalizeAbChildArtifacts('/tmp/discovery-y', false, fs, logger);
    expect(removed).toEqual([]);
    expect(warnings[0]).toContain('Discovery retained 2 child artifact(s)');
    expect(warnings[0]).toContain('/tmp/discovery-y: a.json, b.json');
    expect(warnings[0]).not.toContain('matrix');
  });

  it('does not promise artifacts that are not there, which is the usual dead-child case', async () => {
    const { fs, removed } = fakeFs([]);
    warnings.length = 0;
    await finalizeAbChildArtifacts('/tmp/discovery-z', false, fs, logger);
    expect(warnings).toEqual(['Discovery kept no child artifacts: neither side wrote one before the run failed']);
    expect(removed).toEqual(['/tmp/discovery-z']);
  });

  it('reports rather than throws when the directory cannot be read', async () => {
    const { fs } = fakeFs(new Error('ENOENT'));
    warnings.length = 0;
    await expect(finalizeAbChildArtifacts('/tmp/discovery-gone', false, fs, logger)).resolves.toBeUndefined();
    expect(warnings[0]).toContain('kept no child artifacts');
  });
});
