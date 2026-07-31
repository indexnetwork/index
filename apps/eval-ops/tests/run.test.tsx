import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { Run } from '../src/routes/Run';

const RUN = {
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

class MockEventSource {
  private listeners: Map<string, Set<(event: MessageEvent | Event) => void>> = new Map();

  addEventListener(event: string, handler: (event: MessageEvent | Event) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  close() {}

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

function renderRun(runData: typeof RUN) {
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
    const expRun = {
      ...RUN,
      experimental: true,
      spec: { kind: 'eval', harness: 'matching', profile: 'claude-evaluator', flags: {} },
    };
    renderRun(expRun);
    expect(await screen.findByText(/Experimental configuration/)).toBeInTheDocument();
    expect(await screen.findByText(/not compared to the committed baseline/i)).toBeInTheDocument();
  });

  it('shows the exit code and status for a finished run', async () => {
    const finishedRun = { ...RUN, status: 'regression', exitCode: 1, endedAt: '2026-07-30T10:00:10.000Z' };
    renderRun(finishedRun);
    expect(await screen.findByText(/regression/)).toBeInTheDocument();
    expect(await screen.findByText(/exit 1/)).toBeInTheDocument();
  });

  it('offers cancel only while running', async () => {
    const passedRun = { ...RUN, status: 'passed', exitCode: 0, endedAt: '2026-07-30T10:00:10.000Z' };
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
});
