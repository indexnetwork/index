import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { Run } from '../src/routes/Run';
import type { RunRecord } from '../src/api/client';

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
});
