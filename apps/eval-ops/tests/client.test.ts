import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { subscribeToRun, encodeArtifactId } from '../src/api/client';

describe('subscribeToRun', () => {
  let mockSource: {
    addEventListener: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSource = {
      addEventListener: vi.fn(),
      close: vi.fn(),
    };

    // Stub EventSource as a class constructor
    const EventSourceMock = class {
      addEventListener = mockSource.addEventListener;
      close = mockSource.close;
    };

    vi.stubGlobal('EventSource', EventSourceMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses log frames from JSON-encoded strings', () => {
    const onLog = vi.fn();
    const onStatus = vi.fn();
    const onError = vi.fn();

    subscribeToRun('run-123', { onLog, onStatus, onError });

    const logListener = mockSource.addEventListener.mock.calls.find(
      ([event]) => event === 'log',
    )?.[1];
    expect(logListener).toBeDefined();

    // Server sends: send("log", "line one\nline two")
    // Which becomes: data: "line one\nline two"
    // The browser delivers the JSON string literal
    const fakeEvent = { data: '"line one\\nline two"' } as MessageEvent<string>;
    logListener?.(fakeEvent);

    expect(onLog).toHaveBeenCalledOnce();
    expect(onLog).toHaveBeenCalledWith('line one\nline two');
  });

  it('parses status frames as JSON objects', () => {
    const onLog = vi.fn();
    const onStatus = vi.fn();
    const onError = vi.fn();

    subscribeToRun('run-123', { onLog, onStatus, onError });

    const statusListener = mockSource.addEventListener.mock.calls.find(
      ([event]) => event === 'status',
    )?.[1];
    expect(statusListener).toBeDefined();

    const fakeEvent = {
      data: JSON.stringify({ id: 'run-123', status: 'running' }),
    } as MessageEvent<string>;
    statusListener?.(fakeEvent);

    expect(onStatus).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith({ id: 'run-123', status: 'running' });
  });

  it('does not throw when a log frame is malformed', () => {
    const onLog = vi.fn();
    const onStatus = vi.fn();
    const onError = vi.fn();

    subscribeToRun('run-123', { onLog, onStatus, onError });

    const logListener = mockSource.addEventListener.mock.calls.find(
      ([event]) => event === 'log',
    )?.[1];

    const malformedEvent = { data: '{not valid json' } as MessageEvent<string>;
    expect(() => logListener?.(malformedEvent)).not.toThrow();
    expect(onLog).not.toHaveBeenCalled();
  });

  it('does not throw when a status frame is malformed', () => {
    const onLog = vi.fn();
    const onStatus = vi.fn();
    const onError = vi.fn();

    subscribeToRun('run-123', { onLog, onStatus, onError });

    const statusListener = mockSource.addEventListener.mock.calls.find(
      ([event]) => event === 'status',
    )?.[1];

    const malformedEvent = { data: '{not valid json' } as MessageEvent<string>;
    expect(() => statusListener?.(malformedEvent)).not.toThrow();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('invokes onError when the EventSource fires an error event', () => {
    const onLog = vi.fn();
    const onStatus = vi.fn();
    const onError = vi.fn();

    subscribeToRun('run-123', { onLog, onStatus, onError });

    const errorListener = mockSource.addEventListener.mock.calls.find(
      ([event]) => event === 'error',
    )?.[1];
    expect(errorListener).toBeDefined();

    const fakeErrorEvent = new Event('error');
    errorListener?.(fakeErrorEvent);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(fakeErrorEvent);
  });

  it('returns an unsubscribe function that closes the EventSource', () => {
    const onLog = vi.fn();
    const onStatus = vi.fn();
    const onError = vi.fn();

    const unsubscribe = subscribeToRun('run-123', { onLog, onStatus, onError });
    expect(mockSource.close).not.toHaveBeenCalled();

    unsubscribe();
    expect(mockSource.close).toHaveBeenCalledOnce();
  });
});

describe('encodeArtifactId', () => {
  // Parity test: ensures client encoder stays byte-identical to the protocol's
  // Buffer.from(relPath, "utf8").toString("base64url") implementation.
  // Expected values computed from packages/protocol/eval/ops/ops.artifacts.ts
  // using Node's Buffer API (the source of truth).
  //
  // Note: btoa() throws DOMException for non-ASCII (code points > U+00FF).
  // All current artifact paths are ASCII-only, but this is a latent divergence:
  // the protocol UTF-8-encodes before base64, while btoa latin-1-encodes U+0080-U+00FF
  // and throws above that range.

  it('produces byte-identical output to the protocol encoder for baseline paths', () => {
    const baselinePath = 'matching/baselines/matching.baseline.json';
    expect(encodeArtifactId(baselinePath)).toBe('bWF0Y2hpbmcvYmFzZWxpbmVzL21hdGNoaW5nLmJhc2VsaW5lLmpzb24');
  });

  it('produces byte-identical output to the protocol encoder for run report paths', () => {
    const runReportPath = '.ops-runs/20250131-145623-abc123/report.json';
    expect(encodeArtifactId(runReportPath)).toBe('Lm9wcy1ydW5zLzIwMjUwMTMxLTE0NTYyMy1hYmMxMjMvcmVwb3J0Lmpzb24');
  });

  it('produces byte-identical output to the protocol encoder for CLI run paths', () => {
    const cliRunPath = 'matching/runs/matching.run-20250131-145623.json';
    expect(encodeArtifactId(cliRunPath)).toBe('bWF0Y2hpbmcvcnVucy9tYXRjaGluZy5ydW4tMjAyNTAxMzEtMTQ1NjIzLmpzb24');
  });
});
