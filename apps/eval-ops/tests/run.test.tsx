import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { Run } from '../src/routes/Run';
import type { Artifact, ArtifactCase, RunRecord } from '../src/api/client';
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
 * Every fixture below starts from the real artifact in
 * tests/fixtures/discovery-ab-run-report.ts and changes only outcome fields, so
 * what these tests render is the shape the browser really receives — including
 * the absence of any run-level configuration block, which is why the view has to
 * derive the difference from the case rows.
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

const CASE_A = 'historical/builder-and-operator/a/r1';
const CASE_B = 'historical/builder-and-operator/b/r1';

function caseRow(report: Artifact, caseId: string): ArtifactCase {
  const row = report.payload.cases.find((entry) => entry.caseId === caseId);
  if (row === undefined) throw new Error(`fixture has no case ${caseId}`);
  return row;
}

/**
 * A repetition row, copied from a real one.
 *
 * A repetition is a case row of its own — `<case>/<side>/r<n>` with exactly one
 * successful run, because the schema defines a row's `runs` as the number of
 * successful terminal runs for that id and `buildAbArtifactMeta` pins the
 * envelope's `runs` at 1 whatever `--runs` was. That is why no row in a
 * discovery-ab artifact can ever carry `flaky: true`.
 */
function repetitionRow(source: ArtifactCase, caseId: string, side: string, repetition: number, passed: boolean): ArtifactCase {
  const id = `${caseId}/${side}/r${repetition}`;
  const row: ArtifactCase = {
    ...structuredClone(source),
    caseId: id,
    runs: 1,
    passes: passed ? 1 : 0,
    passRate: passed ? 1 : 0,
    flaky: false,
  };
  Object.assign(row, { scoredRunIds: [`${encodeURIComponent(id)}::run:1`], repetition: repetition - 1 });
  if (passed) return row;
  // Exactly what scoreMatrixSlot writes for a slot that completed and returned
  // nothing: the target is absent, every candidate-dependent check passes
  // vacuously, and the judge is never invoked.
  Object.assign(row, {
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
      { kind: 'completion', passed: true, detail: 'slot completed' },
      { kind: 'judge', passed: false, detail: 'not_run: deterministic assertions failed' },
    ],
  });
  return row;
}

/**
 * The same run with `--runs 3` and a second case, as the engine would file it:
 * one row per case per side per repetition.
 *
 * `historical/builder-and-operator` is where the sides part — side a passes all
 * three repetitions, side b passes one of the three, which is what makes side b
 * flaky on it. `historical/co-researchers-structure` is where they agree.
 */
function withRepetitions(report: Artifact): Artifact {
  const sourceA = caseRow(report, CASE_A);
  const sourceB = caseRow(report, CASE_B);
  report.payload.cases = [
    ...[1, 2, 3].map((r) => repetitionRow(sourceA, 'historical/builder-and-operator', 'a', r, true)),
    ...[1, 2, 3].map((r) => repetitionRow(sourceB, 'historical/builder-and-operator', 'b', r, r === 1)),
    ...[1, 2, 3].map((r) => repetitionRow(sourceA, 'historical/co-researchers-structure', 'a', r, true)),
    ...[1, 2, 3].map((r) => repetitionRow(sourceB, 'historical/co-researchers-structure', 'b', r, true)),
  ];
  // Rules are the mean over the rows a side owns (`buildScorecard`), which for
  // one-run rows is that side's pass count over its row count.
  report.payload.rules = [
    { rule: 'a', caseCount: 6, passRate: 1 },
    { rule: 'b', caseCount: 6, passRate: 4 / 6 },
  ];
  report.payload.aggregatePassRate = 10 / 12;
  return report;
}

/**
 * The engine's exit-3 outcome: the artifact is on disk and real, but side b's
 * slot exhausted its attempts.
 *
 * Its execution run is a failure, so the row counts no runs at all — the schema
 * requires a case's `runs` to count only successful terminal runs and its
 * `scoredRunIds` to be exactly those runs — and `summarizeExecution` records
 * `completedRuns` short of `requestedRuns`, which is what makes
 * `completeness.complete` false. The row's own contents are what
 * `scoreMatrixSlot` writes for a slot that did not complete.
 */
function incompleteReport(): Artifact {
  const report = abReport();
  const failed = caseRow(report, CASE_B);
  failed.runs = 0;
  failed.passes = 0;
  failed.passRate = 0;
  Object.assign(failed, {
    scoredRunIds: [],
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
      { kind: 'completion', passed: false, detail: 'slot_incomplete' },
      { kind: 'judge', passed: false, detail: 'not_run: deterministic assertions failed' },
    ],
  });
  const execution = (report as unknown as { execution: { runs: Array<Record<string, unknown>> } }).execution;
  const failedRun = execution.runs[1]!;
  failedRun.outcome = 'failed';
  (failedRun.attempts as Array<Record<string, unknown>>)[0]!.outcome = 'failure';
  report.payload.rules = [
    { rule: 'a', caseCount: 1, passRate: 1 },
    { rule: 'b', caseCount: 1, passRate: 0 },
  ];
  report.payload.aggregatePassRate = 0.5;
  report.completeness = {
    ...report.completeness!,
    totalRuns: 1,
    totalPasses: 1,
    completedRuns: 1,
    failedRuns: 1,
    complete: false,
  };
  return report;
}

describe('Run · discovery-ab', () => {
  it('shows both sides with their pass rates, saying which is read against which', async () => {
    stubArtifactFetch(withRepetitions(abReport()));
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
    stubArtifactFetch(withRepetitions(abReport()));
    renderRun(AB_RUN);

    const differing = await screen.findByTestId('ab-case-historical/builder-and-operator');
    expect(differing.textContent).toContain('100.0% (3/3)');
    expect(differing.textContent).toContain('33.3% (1/3)');
    expect(within(differing).getByText(/B lower/)).toHaveClass('text-term-red');

    const agreeing = screen.getByTestId('ab-case-historical/co-researchers-structure');
    expect(within(agreeing).getByText('same')).toBeInTheDocument();
    expect(within(agreeing).queryByText(/B (higher|lower)/)).toBeNull();
  });

  it('marks a case a side was flaky on, which no single row can say', async () => {
    const report = withRepetitions(abReport());
    // The artifact itself calls nothing flaky: a repetition row has one run, and
    // the schema defines flaky as passing some runs and failing others. The mark
    // is only there if the view derives it across the repetitions.
    expect(report.payload.cases.some((row) => row.flaky)).toBe(false);

    stubArtifactFetch(report);
    renderRun(AB_RUN);

    const flaky = await screen.findByTestId('ab-case-historical/builder-and-operator');
    expect(within(flaky).getByText(/flaky on B/)).toBeInTheDocument();

    const steady = screen.getByTestId('ab-case-historical/co-researchers-structure');
    expect(within(steady).queryByText(/flaky/)).toBeNull();
  });

  it('reports no verdict, not a comparison, when the run did not complete', async () => {
    stubArtifactFetch(incompleteReport());
    renderRun({ ...AB_RUN, status: 'insufficient-evidence', exitCode: 3 });

    expect(await screen.findByText(/No verdict/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 case-run\(s\) completed and 1 failed/)).toBeInTheDocument();

    // Side b scored 0% and side a scored 100%, and neither number is presented:
    // half a comparison is not a comparison.
    expect(screen.queryByTestId('ab-side-a')).toBeNull();
    expect(screen.queryByTestId('ab-side-b')).toBeNull();
    expect(screen.queryByTestId('ab-case-historical/builder-and-operator')).toBeNull();
    expect(screen.queryByText(/difference \(B − A\)/)).toBeNull();

    // What was configured is still a fact of the run.
    expect(screen.getByTestId('ab-config-DISCOVERY_ALLOWED_TYPES')).toBeInTheDocument();
  });

  it('never compares this harness to a baseline, and never asks for one', async () => {
    const fetchMock = stubArtifactFetch(withRepetitions(abReport()));
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
