import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';

import { Compare } from '../src/routes/Compare';
import type { RunRecord } from '../src/api/client';
import { historicalQualityRef } from './historical-quality.fixture';

/** One MockEventSource per stream URL, so a pair page's two subscriptions are
 * addressable independently by run id. */
class MockEventSource {
  static instances = new Map<string, MockEventSource>();

  closed = false;

  private listeners = new Map<string, Set<(event: MessageEvent | Event) => void>>();

  constructor(public readonly url: string) {
    MockEventSource.instances.set(url, this);
  }

  addEventListener(event: string, handler: (event: MessageEvent | Event) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  close() {
    this.closed = true;
  }

  _emit(event: string, data: unknown) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const messageEvent = new MessageEvent(event, { data: JSON.stringify(data) });
      handlers.forEach((handler) => handler(messageEvent));
    }
  }

  static forRun(runId: string): MockEventSource {
    const instance = MockEventSource.instances.get(`/api/runs/${runId}/stream`);
    if (!instance) throw new Error(`No EventSource opened for run ${runId}`);
    return instance;
  }
}

const RUN_A: RunRecord = {
  id: 'run-a',
  status: 'running',
  spec: { kind: 'eval', harness: 'matching', profile: 'default', flags: { runs: 1 } },
  argv: ['bun', 'run', 'eval:matching'],
  env: {},
  profileFingerprint: 'fp-a',
  experimental: false,
  workload: 2,
  exitCode: null,
  artifactPath: null,
  createdAt: '2026-07-30T10:00:00.000Z',
  startedAt: '2026-07-30T10:00:01.000Z',
  endedAt: null,
  pid: 111,
};

const RUN_B: RunRecord = {
  ...RUN_A,
  id: 'run-b',
  spec: { kind: 'eval', harness: 'matching', profile: 'sonnet-evaluator', flags: { runs: 1 } },
  profileFingerprint: 'fp-b',
  experimental: true,
};

const TERMINAL_A: RunRecord = {
  ...RUN_A,
  status: 'passed',
  endedAt: '2026-07-30T10:05:00.000Z',
  exitCode: 0,
};

const TERMINAL_B: RunRecord = {
  ...RUN_B,
  status: 'passed',
  endedAt: '2026-07-30T10:06:00.000Z',
  exitCode: 0,
};

const EMPTY_DIFF = {
  regressions: [],
  skippedCaseIds: [],
  addedCaseIds: [],
  removedCaseIds: [],
  unscoredCaseIds: [],
};

const PAIR_RESULT = {
  comparable: true,
  aggregate: { reference: 0.9, subject: 0.95, delta: 0.05 },
  regressions: {
    ...EMPTY_DIFF,
    regressions: [{ id: 'case-reg', kind: 'case', before: 1, after: 0.5, pValue: 0.01 }],
  },
  improvements: EMPTY_DIFF,
  runs: {
    reference: { id: 'run-a', profile: 'default', profileFingerprint: 'aaaabbbbccccdddd', complete: true },
    subject: { id: 'run-b', profile: 'sonnet-evaluator', profileFingerprint: 'eeeeffff00001111', complete: false },
  },
};

function stubPair(compare: unknown) {
  MockEventSource.instances.clear();
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/api/compare')) return new Response(JSON.stringify(compare));
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', MockEventSource);
  return fetchMock;
}

function renderPair() {
  render(
    <MemoryRouter initialEntries={['/?referenceRun=run-a&subjectRun=run-b']}>
      <Compare />
    </MemoryRouter>,
  );
}

const REFS = {
  refs: [
    {
      id: 'a',
      harness: 'matching',
      kind: 'run',
      createdAt: '2026-07-30T10:00:00.000Z',
      aggregatePassRate: 0.971,
      models: ['google/gemini-2.5-flash'],
      path: 'x',
    },
    {
      id: 'b',
      harness: 'matching',
      kind: 'run',
      createdAt: '2026-07-31T10:00:00.000Z',
      aggregatePassRate: 0.976,
      models: ['anthropic/claude-sonnet-4'],
      path: 'y',
    },
    {
      id: 'c',
      harness: 'premise',
      kind: 'run',
      createdAt: '2026-07-31T11:00:00.000Z',
      aggregatePassRate: 0.8,
      models: ['google/gemini-2.5-flash'],
      path: 'z',
    },
    historicalQualityRef(undefined, 'quality'),
  ],
  issues: [],
};

function stub(compare: unknown) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/api/compare')) return new Response(JSON.stringify(compare));
    return new Response(JSON.stringify(REFS));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function compareCalls(fetchMock: ReturnType<typeof stub>): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/api/compare'));
}

beforeEach(() => vi.unstubAllGlobals());

afterEach(() => cleanup());

describe('Compare', () => {
  it('explains a refusal instead of showing a delta', async () => {
    stub({
      comparable: false,
      findings: [{ dimension: 'corpusFingerprint', reference: 'aaa', subject: 'bbb' }],
    });
    render(
      <MemoryRouter initialEntries={['/?reference=a&subject=b']}>
        <Compare />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/cannot be compared/i)).toBeInTheDocument();
    expect(await screen.findByText(/corpusFingerprint/)).toBeInTheDocument();
    expect(screen.queryByText(/Δ/)).toBeNull();
  });

  it('labels regressions and improvements separately', async () => {
    stub({
      comparable: true,
      aggregate: { reference: 0.971, subject: 0.976, delta: 0.005 },
      regressions: {
        regressions: [{ id: 'case-x', kind: 'case', before: 1, after: 0.5, pValue: 0.01 }],
        skippedCaseIds: [],
        addedCaseIds: [],
        removedCaseIds: [],
        unscoredCaseIds: [],
      },
      improvements: {
        regressions: [{ id: 'case-y', kind: 'case', before: 0.5, after: 1, pValue: 0.02 }],
        skippedCaseIds: [],
        addedCaseIds: [],
        removedCaseIds: [],
        unscoredCaseIds: [],
      },
    });
    render(
      <MemoryRouter initialEntries={['/?reference=a&subject=b']}>
        <Compare />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/case-x/)).toBeInTheDocument();
    expect(await screen.findByText(/case-y/)).toBeInTheDocument();
    expect(await screen.findByText(/one-sided/i)).toBeInTheDocument();
  });

  it('follows browser back to the previously compared pair', async () => {
    const fetchMock = stub({ comparable: false, findings: [] });
    const router = createMemoryRouter([{ path: '/', element: <Compare /> }], {
      initialEntries: ['/?reference=a&subject=b', '/?reference=b&subject=a'],
      initialIndex: 1,
    });
    render(<RouterProvider router={router} />);

    const reference = (await screen.findByLabelText('Reference')) as HTMLSelectElement;
    await waitFor(() => expect(reference.value).toBe('b'));

    await act(async () => {
      await router.navigate(-1);
    });

    await waitFor(() =>
      expect((screen.getByLabelText('Reference') as HTMLSelectElement).value).toBe('a'),
    );
    expect((screen.getByLabelText('Subject') as HTMLSelectElement).value).toBe('b');
    await waitFor(() =>
      expect(compareCalls(fetchMock).at(-1)).toContain('reference=a&subject=b'),
    );
  });

  it('excludes quality measurements from both selectors and never submits them', async () => {
    const fetchMock = stub({ comparable: false, findings: [] });
    render(
      <MemoryRouter initialEntries={['/?reference=quality&subject=a']}>
        <Compare />
      </MemoryRouter>,
    );

    const reference = await screen.findByLabelText('Reference');
    expect(within(reference).queryByRole('option', { name: /historical quality/i })).toBeNull();
    expect(within(reference).queryByRole('option', { name: /quality/i })).toBeNull();
    expect(within(screen.getByLabelText('Subject')).queryByRole('option', { name: /quality/i })).toBeNull();
    await waitFor(() => expect(compareCalls(fetchMock)).toEqual([]));
  });

  it('clears a subject the new reference cannot be compared against', async () => {
    stub({ comparable: false, findings: [] });
    const router = createMemoryRouter([{ path: '/', element: <Compare /> }], {
      initialEntries: ['/?reference=a&subject=b'],
    });
    render(<RouterProvider router={router} />);

    const reference = (await screen.findByLabelText('Reference')) as HTMLSelectElement;
    await waitFor(() => expect(reference.value).toBe('a'));

    await userEvent.selectOptions(reference, 'c');

    // Assert the search params were actually cleared, not just that the select
    // value is empty (which it would be anyway since option 'b' no longer exists
    // after filtering to the 'premise' harness).
    await waitFor(() => {
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get('reference')).toBe('c');
      expect(params.get('subject')).toBeNull();
    });
  });
});

describe('Compare pair mode', () => {
  it("shows both runs' progress while either is active", async () => {
    const fetchMock = stubPair({ comparable: false, findings: [] });
    renderPair();

    act(() => {
      MockEventSource.forRun('run-a')._emit('status', RUN_A);
      MockEventSource.forRun('run-b')._emit('status', RUN_B);
    });

    expect(await screen.findByText(/reference · default/)).toBeInTheDocument();
    expect(screen.getByText(/candidate · sonnet-evaluator/)).toBeInTheDocument();

    act(() => {
      MockEventSource.forRun('run-a')._emit(
        'log',
        'Running 2 case(s) \u00d7 1 run(s) against google/gemini-2.5-flash\u2026\n',
      );
    });

    expect(await screen.findByText('0/2 cases')).toBeInTheDocument();
    // While either run is active the page says so instead of showing a stale diff.
    expect(screen.getByText('comparison appears when both runs finish')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/api/compare')),
    ).toEqual([]);
  });

  it('flips to the diff view when both runs are terminal', async () => {
    const fetchMock = stubPair(PAIR_RESULT);
    renderPair();

    act(() => {
      MockEventSource.forRun('run-a')._emit('status', TERMINAL_A);
      MockEventSource.forRun('run-b')._emit('status', TERMINAL_B);
    });

    // The diff renders, each side labelled with its profile and fingerprint prefix.
    expect(await screen.findByText(/case-reg/)).toBeInTheDocument();
    expect(await screen.findByText(/aaaabbbbcccc(?!d)/)).toBeInTheDocument();
    expect(screen.getByText(/eeeeffff0000(?!1)/)).toBeInTheDocument();

    const compareUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/api/compare'));
    expect(compareUrls).toHaveLength(1);
    expect(compareUrls[0]).toContain('referenceRun=run-a');
    expect(compareUrls[0]).toContain('subjectRun=run-b');

    // Both streams were closed once their runs went terminal.
    expect(MockEventSource.forRun('run-a').closed).toBe(true);
    expect(MockEventSource.forRun('run-b').closed).toBe(true);
  });

  it('renders the incomplete-evidence caveat when a side is incomplete', async () => {
    stubPair(PAIR_RESULT);
    renderPair();

    act(() => {
      MockEventSource.forRun('run-a')._emit('status', TERMINAL_A);
      MockEventSource.forRun('run-b')._emit('status', TERMINAL_B);
    });

    expect(await screen.findByText(/incomplete evidence/)).toBeInTheDocument();
  });

  it('keeps artifact compare working when no run params are present', async () => {
    stub({
      comparable: false,
      findings: [{ dimension: 'corpusFingerprint', reference: 'aaa', subject: 'bbb' }],
    });
    render(
      <MemoryRouter initialEntries={['/?reference=a&subject=b']}>
        <Compare />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/cannot be compared/i)).toBeInTheDocument();
    expect(screen.queryByText('comparison appears when both runs finish')).toBeNull();
  });
});
