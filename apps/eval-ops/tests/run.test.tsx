import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { parseEvalArtifact } from '../../../packages/protocol/eval/shared/artifact';
import { Run } from '../src/routes/Run';
import type { Artifact, ArtifactCase, ArtifactConfigDelta, ArtifactRule, RunRecord } from '../src/api/client';
import { DISCOVERY_AB_RUN_REPORT } from './fixtures/discovery-ab-run-report';

const RUN: RunRecord = {
  id: 'run-1',
  status: 'running',
  spec: { kind: 'eval', harness: 'matching', profile: 'default', flags: { runs: 3 } },
  argv: ['bun', 'run', 'eval:matching', '--', '--runs', '3'],
  env: {},
  profileFingerprint: 'abc',
  experimental: false,
  workload: 120,
  exitCode: null,
  artifactPath: null,
  createdAt: '2026-07-30T10:00:00.000Z',
  startedAt: '2026-07-30T10:00:01.000Z',
  endedAt: null,
  pid: 12345,
};

const HEADER = 'Running 2 case(s) × 1 run(s) against google/gemini-2.5-flash…\n';

class MockEventSource {
  /**
   * Tracks close() so a test can prove the page stops listening. A real browser
   * EventSource reconnects roughly every 3s after the server closes the stream,
   * and the server replays the log from byte 0 each time, so failing to close is
   * an infinite re-render loop rather than a cosmetic leak.
   */
  closed = false;

  private listeners: Map<string, Set<(event: MessageEvent | Event) => void>> = new Map();

  addEventListener(event: string, handler: (event: MessageEvent | Event) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  close() {
    this.closed = true;
  }

  // Test helper to trigger events
  _emit(event: string, data: unknown) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const messageEvent = new MessageEvent(event, {
        data: JSON.stringify(data),
      });
      handlers.forEach((handler) => handler(messageEvent));
    }
  }

  /** Fires a bare error event, as EventSource does when a stream closes or fails. */
  _emitError() {
    const handlers = this.listeners.get('error');
    if (handlers) {
      handlers.forEach((handler) => handler(new Event('error')));
    }
  }
}

let mockEventSource: MockEventSource;

beforeEach(() => {
  mockEventSource = new MockEventSource();
  // Stub EventSource constructor to return our mock instance
  vi.stubGlobal('EventSource', class {
    constructor() {
      return mockEventSource;
    }
  } as never);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/compare')) {
      return new Response(JSON.stringify({ compatible: false, reason: 'different harness' }));
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderRun(runData: RunRecord) {
  const router = createMemoryRouter(
    [
      {
        path: '/r/:runId',
        element: <Run />,
      },
    ],
    {
      initialEntries: ['/r/run-1'],
    }
  );
  render(<RouterProvider router={router} />);
  // Emit initial status after a tick to let the component mount and subscribe
  setTimeout(() => mockEventSource._emit('status', runData), 0);
}

describe('Run', () => {
  it('shows the exact argv that was spawned', async () => {
    renderRun(RUN);
    expect(await screen.findByText(/eval:matching.*--runs.*3/)).toBeInTheDocument();
  });

  it('marks an experimental run and explains why it is not diffed', async () => {
    const expRun: RunRecord = {
      ...RUN,
      experimental: true,
      spec: { kind: 'eval', harness: 'matching', profile: 'claude-evaluator', flags: {} },
    };
    renderRun(expRun);
    expect(await screen.findByText(/Experimental configuration/)).toBeInTheDocument();
    expect(await screen.findByText(/not compared to the committed baseline/i)).toBeInTheDocument();
  });

  it('shows the exit code and status for a finished run', async () => {
    const finishedRun: RunRecord = { ...RUN, status: 'regression', exitCode: 1, endedAt: '2026-07-30T10:00:10.000Z' };
    renderRun(finishedRun);
    expect(await screen.findByText(/regression/)).toBeInTheDocument();
    expect(await screen.findByText(/exit 1/)).toBeInTheDocument();
  });

  it('offers cancel only while running', async () => {
    const passedRun: RunRecord = { ...RUN, status: 'passed', exitCode: 0, endedAt: '2026-07-30T10:00:10.000Z' };
    renderRun(passedRun);
    await screen.findByText(/● passed/);
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('accumulates log chunks and resets on reconnect', async () => {
    renderRun(RUN);
    // Wait for the component to mount
    await screen.findByText(/run-1/);
    
    // Emit some log chunks
    mockEventSource._emit('log', 'first chunk');
    mockEventSource._emit('log', ' second chunk');
    mockEventSource._emit('log', ' third chunk');
    
    // Log should be accumulated
    await screen.findByText(/first chunk second chunk third chunk/);
    
    // Simulate a reconnect by triggering error event
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorHandlers = (mockEventSource as any).listeners.get('error');
    if (errorHandlers) {
      errorHandlers.forEach((handler: (event: Event) => void) => {
        handler(new Event('error'));
      });
    }
    
    // After error/reconnect, log should be reset
    // Emit new log chunk
    mockEventSource._emit('log', 'after reconnect');
    
    // Should only show the new chunk, not the accumulated old ones
    const logView = await screen.findByText(/after reconnect/);
    expect(logView.textContent).not.toContain('first chunk');
  });

  it('stops listening once the run reaches a terminal status', async () => {
    const passedRun: RunRecord = {
      ...RUN,
      status: 'passed',
      exitCode: 0,
      endedAt: '2026-07-30T10:00:10.000Z',
    };
    renderRun(passedRun);
    await screen.findByText(/● passed/);

    // The server closes the stream after a terminal status. Left open, the
    // browser reconnects every ~3s and replays the whole log forever.
    expect(mockEventSource.closed).toBe(true);
  });

  it('keeps listening while a run is still in flight', async () => {
    renderRun(RUN);
    await screen.findByText(/● running/);

    expect(mockEventSource.closed).toBe(false);
  });

  it('does not clear the log when the stream closes after a terminal status', async () => {
    const passedRun: RunRecord = {
      ...RUN,
      status: 'passed',
      exitCode: 0,
      endedAt: '2026-07-30T10:00:10.000Z',
    };
    renderRun(passedRun);
    await screen.findByText(/● passed/);

    mockEventSource._emit('log', 'harness output');
    await screen.findByText(/harness output/);

    // A close-induced error must not wipe the log an operator is reading.
    mockEventSource._emitError();

    expect(screen.getByText(/harness output/)).toBeInTheDocument();
  });

  it('reports an unresolvable run id instead of loading forever', async () => {
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: '/r/:runId', element: <Run /> }], {
          initialEntries: ['/r/not-a-run'],
        })}
      />,
    );

    // No status frame ever arrives: the server 404s an unknown id, so
    // EventSource reports an error straight away.
    mockEventSource._emitError();

    expect(await screen.findByText(/No run with id/)).toBeInTheDocument();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });
  it('renders structured progress from real harness output, raw log behind a toggle', async () => {
    renderRun(RUN);
    await screen.findByText(/run-1/);

    // The real format: case start, a multi-line debug dump on the same logical
    // line, and the score alone on its own line afterwards.
    mockEventSource._emit('log', HEADER);
    mockEventSource._emit('log', '  is_a/identity-basic … [OpportunityEvaluator:invokeEntityBundle] Done {\n  total: 1,\n}\n');
    mockEventSource._emit('log', '1/1\n');
    mockEventSource._emit('log', '  location/known-mismatch … [OpportunityEvaluator:invokeEntityBundle] Done {\n');

    // The progress frame leads: position, tally, the finished row, and the
    // in-flight case called out instead of a silent ellipsis.
    expect(await screen.findByText('1/2 cases')).toBeInTheDocument();
    expect(screen.getByText(/● running location\/known-mismatch/)).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(screen.getByText('passed')).toBeInTheDocument();

    // The raw debug dump is one click away, not the primary view.
    expect(screen.queryByText(/total: 1,/)).toBeNull();
    fireEvent.click(screen.getByText('show raw output'));
    expect(await screen.findByText(/total: 1,/)).toBeInTheDocument();
  });

  it('keeps the plain log frame for output that is not a harness run', async () => {
    renderRun(RUN);
    await screen.findByText(/run-1/);

    mockEventSource._emit('log', 'Usage: eval:matching [flags]\n');

    expect(await screen.findByText(/Usage: eval:matching/)).toBeInTheDocument();
    expect(screen.queryByText('show raw output')).toBeNull();
  });

  it('summarises the resolved overrides in the header', async () => {
    const overridden: RunRecord = {
      ...RUN,
      env: {
        EVAL_MODEL_OVERRIDES: JSON.stringify({ opportunityEvaluator: 'anthropic/claude-sonnet-4' }),
        RUN_OPPORTUNITY_EVAL_IN_PARALLEL: 'true',
        OPENROUTER_FALLBACK_MODEL: 'none',
      },
    };
    renderRun(overridden);
    expect(
      await screen.findByText(/opportunityEvaluator → anthropic\/claude-sonnet-4/),
    ).toBeInTheDocument();
    expect(screen.getByText(/RUN_OPPORTUNITY_EVAL_IN_PARALLEL=true/)).toBeInTheDocument();
    // renderRun's internal pin is bookkeeping, not operator signal.
    expect(screen.queryByText(/OPENROUTER_FALLBACK_MODEL/)).toBeNull();
  });

  it('renders no overrides summary for a default run', async () => {
    renderRun(RUN);
    await screen.findByText(/run-1/);
    expect(screen.queryByText(/overrides:/)).toBeNull();
  });

  it('survives a malformed EVAL_MODEL_OVERRIDES value', async () => {
    const corrupt: RunRecord = { ...RUN, env: { EVAL_MODEL_OVERRIDES: '{not json' } };
    renderRun(corrupt);
    expect(await screen.findByText(/run-1/)).toBeInTheDocument();
    expect(screen.getByText(/EVAL_MODEL_OVERRIDES \(unparseable\)/)).toBeInTheDocument();
  });
});

/**
 * The finished discovery-ab run, read.
 *
 * Every fixture below is assembled by `buildAbReport` from the rows of the real
 * artifact in tests/fixtures/discovery-ab-run-report.ts, and every one of them is
 * asserted to survive the ops server's own `parseEvalArtifact` (the last test in
 * this file). That assertion is the point: a fixture the server would reject is
 * a page designed against output that cannot exist, which is the failure this
 * app keeps having. Hand-mutated fixtures drifted exactly that way — completeness
 * counters left at 2/2/2 for twelve rows, an execution block still holding two
 * runs, a failed attempt with no sanitized error — so the bookkeeping is derived
 * here instead of copied.
 */
const AB_RUN: RunRecord = {
  id: 'run-1',
  status: 'passed',
  spec: {
    kind: 'eval',
    harness: 'discovery-ab',
    profile: 'default',
    flags: { runs: 1, case: 'historical/builder-and-operator' },
    sides: {
      a: { DISCOVERY_ALLOWED_TYPES: 'intent' },
      b: { DISCOVERY_ALLOWED_TYPES: 'intent,profile' },
    },
  },
  argv: [
    'bun', 'run', 'eval:discovery-ab', '--',
    '--case', 'historical/builder-and-operator', '--runs', '1',
    '--a', 'DISCOVERY_ALLOWED_TYPES=intent',
    '--b', 'DISCOVERY_ALLOWED_TYPES=intent,profile',
  ],
  env: {},
  profileFingerprint: 'abc',
  experimental: false,
  workload: 2,
  exitCode: 0,
  artifactPath: '.ops-runs/run-1/report.json',
  createdAt: '2026-08-04T18:17:55.461Z',
  startedAt: '2026-08-04T18:18:02.406Z',
  endedAt: '2026-08-04T18:19:06.257Z',
  pid: 4242,
};

/** Serves the run's artifact and 404s everything else, as an unknown route does. */
function stubArtifactFetch(report: unknown) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/artifacts/')) return new Response(JSON.stringify(report));
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function abReport(): Artifact {
  return structuredClone(DISCOVERY_AB_RUN_REPORT);
}

const BUILDER = 'historical/builder-and-operator';
const CO_RESEARCHERS = 'historical/co-researchers-structure';
const CASE_A = `${BUILDER}/a/r1`;
const CASE_B = `${BUILDER}/b/r1`;

function caseRow(report: Artifact, caseId: string): ArtifactCase {
  const row = report.payload.cases.find((entry) => entry.caseId === caseId);
  if (row === undefined) throw new Error(`fixture has no case ${caseId}`);
  return row;
}

/** The execution evidence the app's `Artifact` type does not name but the server serves. */
interface ExecutionRun {
  runId: string;
  caseId: string;
  runIndex: number;
  outcome: string;
  recovered: boolean;
  attempts: Array<Record<string, unknown>>;
}

function executionOf(report: Artifact): { policy: string; runs: ExecutionRun[] } {
  return (report as unknown as { execution: { policy: string; runs: ExecutionRun[] } }).execution;
}

function executionRun(report: Artifact, caseId: string): ExecutionRun {
  const run = executionOf(report).runs.find((entry) => entry.caseId === caseId);
  if (run === undefined) throw new Error(`fixture has no execution run for ${caseId}`);
  return run;
}

/** One case row to build, in the terms the engine files one. */
interface AbRowSpec {
  /** The case as it was selected; `abSlotCaseId` adds the side and repetition. */
  caseId: string;
  side: 'a' | 'b';
  /** 1-based, exactly as `<case>/<side>/r<n>` numbers them. */
  repetition: number;
  /**
   * `passed` and `failed` are scored slots. `unscored` is a slot whose run never
   * produced a terminal output, which the envelope schema requires to count no
   * runs, hold no scoredRunIds, and carry a failed attempt with a sanitized
   * error — the engine's own exit-3 shape.
   */
  outcome: 'passed' | 'failed' | 'unscored';
  /** Replaces the side's real configDeltas; null files a row carrying none. */
  configDeltas?: ArtifactConfigDelta[] | null;
  /** Replaces the real retrieval outcome; null files a row recording none. */
  retrieval?: { targetRank: number | null; evidenceTypes: string[] } | null;
  /** Files the row under an id the `<case>/<side>/r<n>` scheme cannot produce. */
  literalCaseId?: string;
}

/** The mean of a set of case rates — the definition `buildScorecard` rolls up with. */
function meanRate(rows: readonly ArtifactCase[]): number {
  if (rows.length === 0) return 0;
  return rows.reduce((total, row) => total + row.passRate, 0) / rows.length;
}

/** Each side's roll-up over exactly the rows it owns. */
function rulesFor(cases: readonly ArtifactCase[]): ArtifactRule[] {
  const rules: ArtifactRule[] = [];
  for (const side of ['a', 'b'] as const) {
    const members = cases.filter((row) => row.rule === side);
    if (members.length === 0) continue;
    rules.push({
      rule: side,
      caseCount: members.length,
      passRate: meanRate(members.filter((row) => row.runs > 0)),
    });
  }
  return rules;
}

/**
 * What `scoreMatrixSlot` writes for a slot that returned no target.
 *
 * The target is absent, every candidate-dependent check passes vacuously, and
 * the judge is never invoked. `completion` is the one difference between a slot
 * that ran and found nothing and a slot that never finished.
 */
function missedSlot(completed: boolean): Record<string, unknown> {
  return {
    passed: false,
    targetRank: null,
    evidenceTypes: [],
    candidates: [],
    rawCandidates: [],
    evaluatorTraces: [],
    judge: null,
    assertions: [
      { kind: 'target_returned', passed: false, detail: 'expected_target_not_returned: eval-discovery-matrix-user-fe7f5c1b5049fb5467759af4' },
      { kind: 'excluded_absent', passed: true, detail: 'excluded targets absent' },
      { kind: 'fixture_ownership', passed: true, detail: 'all candidates are fixture-owned' },
      { kind: 'allowed_evidence', passed: true, detail: 'all evidence types are allowed' },
      { kind: 'completion', passed: completed, detail: completed ? 'slot completed' : 'slot_incomplete' },
      { kind: 'judge', passed: false, detail: 'not_run: deterministic assertions failed' },
    ],
  };
}

/**
 * Builds a discovery-ab artifact from a list of case rows.
 *
 * Row *contents* are the real artifact's — assertions, candidates, evaluator
 * traces, configDeltas and retrieval outcomes are copied from the side's own row
 * unless a spec overrides them. Row *bookkeeping* is derived rather than copied:
 * every row gets its own execution run, `scoredRunIds` follows the successful
 * runs, the rules roll up over the rows each side owns, `aggregatePassRate` is
 * the mean of the scored rates and `completeness` is recomputed from both. Those
 * are the fields the envelope schema cross-checks, so deriving them is what makes
 * every fixture below an artifact the server would actually serve.
 */
function buildAbReport(specs: readonly AbRowSpec[]): Artifact {
  const report = abReport();
  const sourceRow: Record<'a' | 'b', ArtifactCase> = {
    a: caseRow(report, CASE_A),
    b: caseRow(report, CASE_B),
  };
  const sourceRun: Record<'a' | 'b', ExecutionRun> = {
    a: executionRun(report, CASE_A),
    b: executionRun(report, CASE_B),
  };

  const cases: ArtifactCase[] = [];
  const runs: ExecutionRun[] = [];

  for (const spec of specs) {
    const caseId = spec.literalCaseId ?? `${spec.caseId}/${spec.side}/r${spec.repetition}`;
    const runId = `${encodeURIComponent(caseId)}::run:1`;
    const scored = spec.outcome !== 'unscored';
    const passed = spec.outcome === 'passed';

    const row: ArtifactCase = {
      ...structuredClone(sourceRow[spec.side]),
      caseId,
      // One successful terminal run per repetition row, or none at all: the
      // envelope pins `runs` at 1 whatever `--runs` was, so no row can ever hold
      // two — which is why no row can ever carry `flaky: true` either.
      runs: scored ? 1 : 0,
      passes: passed ? 1 : 0,
      passRate: passed ? 1 : 0,
      flaky: false,
    };
    Object.assign(row, {
      scoredRunIds: scored ? [runId] : [],
      repetition: spec.repetition - 1,
    });
    if (!passed) Object.assign(row, missedSlot(scored));
    if (spec.configDeltas === null) delete row.configDeltas;
    else if (spec.configDeltas !== undefined) row.configDeltas = spec.configDeltas;
    if (spec.retrieval === null) {
      delete row.targetRank;
      delete row.evidenceTypes;
    } else if (spec.retrieval !== undefined) {
      row.targetRank = spec.retrieval.targetRank;
      row.evidenceTypes = spec.retrieval.evidenceTypes;
    }
    cases.push(row);

    const attempt = structuredClone(sourceRun[spec.side].attempts[0]!);
    Object.assign(attempt, { attemptId: `${runId}::attempt:1`, runId });
    if (!scored) {
      Object.assign(attempt, {
        outcome: 'failure',
        error: { class: 'Error', message: 'discovery A/B slot did not complete' },
      });
    }
    runs.push({
      runId,
      caseId,
      runIndex: 0,
      outcome: scored ? 'success' : 'failed',
      recovered: false,
      attempts: [attempt],
    });
  }

  report.payload.cases = cases;
  report.payload.rules = rulesFor(cases);
  report.payload.aggregatePassRate = meanRate(cases.filter((row) => row.runs > 0));
  executionOf(report).runs = runs;
  report.completeness = {
    caseCount: cases.length,
    ruleCount: report.payload.rules.length,
    totalRuns: cases.reduce((total, row) => total + row.runs, 0),
    totalPasses: cases.reduce((total, row) => total + row.passes, 0),
    flakyCaseCount: cases.filter((row) => row.flaky).length,
    requestedRuns: runs.length,
    completedRuns: runs.filter((run) => run.outcome === 'success').length,
    failedRuns: runs.filter((run) => run.outcome !== 'success').length,
    recoveredRuns: runs.filter((run) => run.recovered).length,
    totalAttempts: runs.reduce((total, run) => total + run.attempts.length, 0),
    complete: runs.every((run) => run.outcome === 'success'),
  };
  return report;
}

const REPETITIONS = [1, 2, 3];

/**
 * The same run at `--runs 3` over two cases.
 *
 * `historical/builder-and-operator` is where the sides part on score — side a
 * passes all three repetitions, side b one of three, which is what makes side b
 * flaky on it. `historical/co-researchers-structure` is where they agree on
 * everything: same rate, same rank, same evidence.
 */
function withRepetitions(): Artifact {
  return buildAbReport([
    ...REPETITIONS.map((r): AbRowSpec => ({ caseId: BUILDER, side: 'a', repetition: r, outcome: 'passed' })),
    ...REPETITIONS.map((r): AbRowSpec => ({
      caseId: BUILDER, side: 'b', repetition: r, outcome: r === 1 ? 'passed' : 'failed',
    })),
    ...REPETITIONS.map((r): AbRowSpec => ({ caseId: CO_RESEARCHERS, side: 'a', repetition: r, outcome: 'passed' })),
    ...REPETITIONS.map((r): AbRowSpec => ({
      caseId: CO_RESEARCHERS,
      side: 'b',
      repetition: r,
      outcome: 'passed',
      // Side b's extra allowed type changed nothing for this case: same rank,
      // same evidence. That is what "same" is allowed to mean.
      retrieval: { targetRank: 1, evidenceTypes: ['intent'] },
    })),
  ]);
}

/** Side b beats side a — the one outcome an operator is hoping to read. */
function bHigherReport(): Artifact {
  return buildAbReport([
    ...REPETITIONS.map((r): AbRowSpec => ({
      caseId: BUILDER, side: 'a', repetition: r, outcome: r === 1 ? 'passed' : 'failed',
    })),
    ...REPETITIONS.map((r): AbRowSpec => ({ caseId: BUILDER, side: 'b', repetition: r, outcome: 'passed' })),
  ]);
}

/**
 * The engine's exit-3 outcome: the artifact is real and on disk, but side b's
 * slot never produced a scored output.
 */
function incompleteReport(): Artifact {
  return buildAbReport([
    { caseId: BUILDER, side: 'a', repetition: 1, outcome: 'passed' },
    { caseId: BUILDER, side: 'b', repetition: 1, outcome: 'unscored' },
  ]);
}

/**
 * A flag side b names and side a does not.
 *
 * The launch form refuses this pair (`abSideIssues` requires the two sides to
 * name the same keys), but the engine's own CLI does not — `assertAbEnvConfig`
 * only checks each value is non-blank — so an artifact written by a direct
 * `bun run eval:discovery-ab` invocation can hold it.
 */
function asymmetricConfigReport(): Artifact {
  return buildAbReport([
    { caseId: BUILDER, side: 'a', repetition: 1, outcome: 'passed', configDeltas: [] },
    { caseId: BUILDER, side: 'b', repetition: 1, outcome: 'passed' },
  ]);
}

/** Side b produced no rows at all, so nothing on disk says what it was. */
function oneSidedReport(): Artifact {
  return buildAbReport([{ caseId: BUILDER, side: 'a', repetition: 1, outcome: 'passed' }]);
}

/**
 * Side a's rows disagree about its own configuration.
 *
 * `assertAbConfigProvenance` fails the run before such an artifact can be
 * written, so this is not something the engine produces — which is exactly why
 * the view must report it rather than pick one of the two values and state a
 * configuration that was never run.
 */
function inconsistentSideReport(): Artifact {
  return buildAbReport([
    {
      caseId: BUILDER, side: 'a', repetition: 1, outcome: 'passed',
      configDeltas: [{ key: 'DISCOVERY_ALLOWED_TYPES', before: null, after: 'intent' }],
    },
    {
      caseId: BUILDER, side: 'a', repetition: 2, outcome: 'passed',
      configDeltas: [{ key: 'DISCOVERY_ALLOWED_TYPES', before: null, after: 'profile' }],
    },
    { caseId: BUILDER, side: 'b', repetition: 1, outcome: 'passed' },
    { caseId: BUILDER, side: 'b', repetition: 2, outcome: 'passed' },
  ]);
}

/**
 * Rows carrying only what the shared case schema requires: no configuration and
 * no retrieval outcome. Another artifact this harness cannot write, and another
 * one the view must not fill in for.
 */
function bareRowsReport(): Artifact {
  return buildAbReport([
    { caseId: BUILDER, side: 'a', repetition: 1, outcome: 'passed', configDeltas: null, retrieval: null },
    { caseId: BUILDER, side: 'b', repetition: 1, outcome: 'passed', configDeltas: null, retrieval: null },
  ]);
}

/** A row filed under an id the `<case>/<side>/r<n>` scheme cannot produce. */
function unpairedRowsReport(): Artifact {
  return buildAbReport([
    { caseId: BUILDER, side: 'a', repetition: 1, outcome: 'passed' },
    { caseId: BUILDER, side: 'b', repetition: 1, outcome: 'passed' },
    { caseId: BUILDER, side: 'a', repetition: 1, outcome: 'passed', literalCaseId: BUILDER },
  ]);
}

describe('Run · discovery-ab', () => {
  it('shows both sides with their pass rates, saying which is read against which', async () => {
    stubArtifactFetch(withRepetitions());
    renderRun(AB_RUN);

    const sideA = await screen.findByTestId('ab-side-a');
    expect(sideA.textContent).toContain('side a');
    expect(sideA.textContent).toContain('reference');
    expect(sideA.textContent).toContain('100.0%');

    const sideB = screen.getByTestId('ab-side-b');
    expect(sideB.textContent).toContain('side b');
    expect(sideB.textContent).toContain('candidate');
    expect(sideB.textContent).toContain('66.7%');
    // Repetitions are rows, not cases: 12 rows over 2 cases.
    expect(sideB.textContent).toContain('4/6 case-runs passed across 2 case(s)');

    // The gap between the two, in the direction the engine reads them.
    expect(screen.getByText(/difference \(B − A\)/)).toBeInTheDocument();
    expect(screen.getByText('-33.3%')).toHaveClass('text-term-red');
  });

  it('derives the configuration difference from the two sides’ case rows', async () => {
    // The artifact carries no run-level configuration: the strict schemas leave
    // it nowhere to live, so per-case configDeltas is the only record.
    expect(Object.keys(DISCOVERY_AB_RUN_REPORT)).not.toContain('configDiff');
    expect(Object.keys(DISCOVERY_AB_RUN_REPORT)).not.toContain('configs');

    stubArtifactFetch(abReport());
    renderRun(AB_RUN);

    const row = await screen.findByTestId('ab-config-DISCOVERY_ALLOWED_TYPES');
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]!.textContent).toBe('DISCOVERY_ALLOWED_TYPES');
    expect(cells[1]!.textContent).toBe('intent');
    expect(cells[2]!.textContent).toBe('intent,profile');
  });

  it('tells a case the sides scored differently from one they agreed on', async () => {
    stubArtifactFetch(withRepetitions());
    renderRun(AB_RUN);

    const differing = await screen.findByTestId(`ab-case-${BUILDER}`);
    expect(differing.textContent).toContain('100.0% (3/3)');
    expect(differing.textContent).toContain('33.3% (1/3)');
    expect(within(differing).getByText(/B lower/)).toHaveClass('text-term-red');

    // Same rate, same rank, same evidence: everything the artifact measured
    // agrees, which is the only thing allowed to read as no difference.
    const agreeing = screen.getByTestId(`ab-case-${CO_RESEARCHERS}`);
    expect(within(agreeing).getByText('same score, found the same way')).toBeInTheDocument();
    expect(within(agreeing).queryByText(/B (higher|lower)/)).toBeNull();
  });

  it('reads the real run’s equal pass rates as the retrieval difference the artifact records', async () => {
    // The artifact this renders is the first live run. Both sides pass every
    // repetition, so pass rates alone say the flag changed nothing — while the
    // rows record the target being found through different evidence, which is
    // the outcome measure this harness exists to move.
    const real = abReport();
    expect(caseRow(real, CASE_A).passRate).toBe(caseRow(real, CASE_B).passRate);
    expect(caseRow(real, CASE_A).evidenceTypes).toEqual(['intent']);
    expect(caseRow(real, CASE_B).evidenceTypes).toEqual(['premise']);
    expect(caseRow(real, CASE_A).targetRank).toBe(1);
    expect(caseRow(real, CASE_B).targetRank).toBe(1);

    stubArtifactFetch(real);
    renderRun(AB_RUN);

    const pair = await screen.findByTestId(`ab-case-${BUILDER}`);
    expect(within(pair).getByText('rank 1 · via intent')).toBeInTheDocument();
    expect(within(pair).getByText('rank 1 · via premise')).toBeInTheDocument();

    // Named as what it is: the scores agreed, the retrieval did not. Never as a
    // scoring difference, which is what a signed percentage would claim.
    const verdict = within(pair).getByText('same score, found differently');
    expect(verdict).toHaveClass('text-term-cyan');
    expect(within(pair).queryByText(/B (higher|lower)/)).toBeNull();
    expect(within(pair).queryByText(/^same$/)).toBeNull();
  });

  it('caveats a run whose cases ran once per side, where a difference is one coin flip', async () => {
    stubArtifactFetch(abReport());
    renderRun(AB_RUN);

    const caveat = await screen.findByTestId('ab-noise-floor');
    expect(caveat.textContent).toContain('Each case ran 1 time(s) per side');
    expect(caveat).toHaveClass('text-term-yellow');
    // Said once, where it applies — not repeated on every row.
    expect(screen.getAllByTestId('ab-noise-floor')).toHaveLength(1);
  });

  it('does not caveat a run with enough repetitions to distinguish a case difference', async () => {
    stubArtifactFetch(withRepetitions());
    renderRun(AB_RUN);

    await screen.findByTestId('ab-side-a');
    expect(screen.queryByTestId('ab-noise-floor')).toBeNull();
  });

  it('reads a case side b won as an improvement, in both the sign and the words', async () => {
    stubArtifactFetch(bHigherReport());
    renderRun(AB_RUN);

    const pair = await screen.findByTestId(`ab-case-${BUILDER}`);
    const verdict = within(pair).getByText('+66.7% · B higher');
    expect(verdict).toHaveClass('text-term-green');
    expect(within(pair).queryByText(/B lower/)).toBeNull();

    // And the same direction at the top of the page.
    const total = screen.getByText('+66.7%');
    expect(total).toHaveClass('text-term-green');
  });

  it('marks a case a side was flaky on, which no single row can say', async () => {
    const report = withRepetitions();
    // The artifact itself calls nothing flaky: a repetition row has one run, and
    // the schema defines flaky as passing some runs and failing others. The mark
    // is only there if the view derives it across the repetitions.
    expect(report.payload.cases.some((row) => row.flaky)).toBe(false);

    stubArtifactFetch(report);
    renderRun(AB_RUN);

    const flaky = await screen.findByTestId(`ab-case-${BUILDER}`);
    expect(within(flaky).getByText(/flaky on B/)).toBeInTheDocument();

    const steady = screen.getByTestId(`ab-case-${CO_RESEARCHERS}`);
    expect(within(steady).queryByText(/flaky/)).toBeNull();
  });

  it('reports no verdict, not a comparison, when the run did not complete', async () => {
    stubArtifactFetch(incompleteReport());
    renderRun({ ...AB_RUN, status: 'insufficient-evidence', exitCode: 3 });

    expect(await screen.findByText(/No verdict/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 case-run\(s\) completed and 1 failed/)).toBeInTheDocument();

    // Side b scored nothing and side a scored 100%, and neither number is
    // presented: half a comparison is not a comparison.
    expect(screen.queryByTestId('ab-side-a')).toBeNull();
    expect(screen.queryByTestId('ab-side-b')).toBeNull();
    expect(screen.queryByTestId(`ab-case-${BUILDER}`)).toBeNull();
    expect(screen.queryByText(/difference \(B − A\)/)).toBeNull();

    // What was configured is still a fact of the run.
    expect(screen.getByTestId('ab-config-DISCOVERY_ALLOWED_TYPES')).toBeInTheDocument();
  });

  it('shows a flag one side never recorded as unset, not as the other side’s value', async () => {
    stubArtifactFetch(asymmetricConfigReport());
    renderRun(AB_RUN);

    const row = await screen.findByTestId('ab-config-DISCOVERY_ALLOWED_TYPES');
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]!.textContent).toBe('unset');
    expect(cells[2]!.textContent).toBe('intent,profile');
  });

  it('says a side that scored no rows was not recorded, rather than unset', async () => {
    stubArtifactFetch(oneSidedReport());
    renderRun(AB_RUN);

    // No side b at all, so there is no pair and no verdict …
    expect(await screen.findByText(/No verdict/)).toBeInTheDocument();
    expect(screen.getByText(/holds no side b/)).toBeInTheDocument();

    // … and nothing on disk says what side b was configured to do. Saying
    // "unset" would state a configuration the run never recorded.
    const row = screen.getByTestId('ab-config-DISCOVERY_ALLOWED_TYPES');
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]!.textContent).toBe('intent');
    expect(cells[2]!.textContent).toBe('not recorded — this side scored no rows');
  });

  it('reports rows that disagree instead of picking one of their values', async () => {
    stubArtifactFetch(inconsistentSideReport());
    renderRun(AB_RUN);

    const row = await screen.findByTestId('ab-config-DISCOVERY_ALLOWED_TYPES');
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]!.textContent).toBe('rows disagree: intent, profile');
    expect(within(row).getByText(/rows disagree/)).toHaveClass('text-term-yellow');
    expect(cells[2]!.textContent).toBe('intent,profile');
  });

  it('says when no row records a configuration or a retrieval outcome at all', async () => {
    stubArtifactFetch(bareRowsReport());
    renderRun(AB_RUN);

    expect(await screen.findByText(/No case row records a configuration/)).toBeInTheDocument();
    expect(screen.queryByTestId('ab-config-DISCOVERY_ALLOWED_TYPES')).toBeNull();

    // Nothing to have found differently: the scores agreed and nothing else was
    // measured, so the verdict claims only the score.
    const pair = screen.getByTestId(`ab-case-${BUILDER}`);
    expect(within(pair).getByText('same')).toBeInTheDocument();
    expect(within(pair).queryByText(/found the same way/)).toBeNull();
    expect(within(pair).queryByText(/rank/)).toBeNull();
  });

  it('names the rows it could not pair instead of dropping them from the comparison', async () => {
    stubArtifactFetch(unpairedRowsReport());
    renderRun(AB_RUN);

    expect(await screen.findByText(/1 case row\(s\) name no side of this run/)).toBeInTheDocument();
    expect(screen.getByText(BUILDER, { selector: 'span' })).toBeInTheDocument();
  });

  it('never compares this harness to a baseline, and never asks for one', async () => {
    const fetchMock = stubArtifactFetch(withRepetitions());
    renderRun(AB_RUN);
    await screen.findByTestId('ab-side-a');

    // Two arbitrary configurations have no committed baseline and never will.
    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.filter((url) => url === '/api/artifacts')).toEqual([]);
    expect(requested.filter((url) => url.startsWith('/api/compare'))).toEqual([]);
    expect(screen.queryByText(/baseline diff/)).toBeNull();
    expect(screen.queryByText(/aggregate pass rate/)).toBeNull();
  });
});

describe('Run · discovery-ab fixtures', () => {
  /**
   * Every fixture this file renders, read back through the ops server's own
   * parser.
   *
   * A fixture the server would reject is a page designed against output that
   * cannot exist. This is the assertion that stops that coming back: it fails on
   * a completeness counter left stale, an execution block that lost a run, a
   * failed attempt with no sanitized error, or an aggregate that is not the mean
   * of the case rates — every one of which a hand-mutated fixture here had.
   */
  it('are all artifacts the ops server would serve', () => {
    const fixtures: Array<[string, Artifact]> = [
      ['the real run', abReport()],
      ['withRepetitions', withRepetitions()],
      ['bHigherReport', bHigherReport()],
      ['incompleteReport', incompleteReport()],
      ['asymmetricConfigReport', asymmetricConfigReport()],
      ['oneSidedReport', oneSidedReport()],
      ['inconsistentSideReport', inconsistentSideReport()],
      ['bareRowsReport', bareRowsReport()],
      ['unpairedRowsReport', unpairedRowsReport()],
    ];

    for (const [name, fixture] of fixtures) {
      expect(
        () => parseEvalArtifact(fixture, { expectedType: 'index-eval/run-report' }),
        name,
      ).not.toThrow();
    }
  });
});
