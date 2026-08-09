import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { api, onAuthRefusal, subscribeToRun, encodeArtifactId } from '../src/api/client';
import type { HistoricalQualityArtifact } from '../src/api/client';
import { COMPLETE_HISTORICAL_QUALITY_ARTIFACT } from './historical-quality.fixture';

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
    // The stream now asks who is signed in when it fails, so every test in this
    // suite needs an answer: an unstubbed fetch would reach the network and print
    // a connection error over an otherwise clean run.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ authenticated: true, email: 'ops@index.network' }))),
    );
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

  /**
   * The stream is gated like every other route, but EventSource surfaces no
   * status code: a 401 arrives as the same bare `error` event as a dropped
   * connection. It never passes through `fetchJson`, so without this the shell's
   * refusal channel never fires, the run page blames the run id, and EventSource
   * reconnects against the 401 every few seconds forever.
   */
  describe('a stream that fails before any status frame', () => {
    const errorListener = () =>
      mockSource.addEventListener.mock.calls.find(([event]) => event === 'error')?.[1];
    const statusListener = () =>
      mockSource.addEventListener.mock.calls.find(([event]) => event === 'status')?.[1];

    it('publishes an auth refusal when the session has lapsed', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        expect(url).toBe('/api/auth/status');
        return new Response(JSON.stringify({ authenticated: false }));
      });
      vi.stubGlobal('fetch', fetchMock);
      const refusals: string[] = [];
      const unsubscribe = onAuthRefusal((refusal) => refusals.push(refusal));

      subscribeToRun('run-123', { onLog: vi.fn(), onStatus: vi.fn(), onError: vi.fn() });
      errorListener()?.(new Event('error'));
      await vi.waitFor(() => expect(refusals).toEqual(['unauthenticated']));

      // The probe is the public status route, and it is asked exactly once.
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(['/api/auth/status']);
      unsubscribe();
    });

    it('says nothing when the operator is still signed in', async () => {
      const refusals: string[] = [];
      const unsubscribe = onAuthRefusal((refusal) => refusals.push(refusal));

      subscribeToRun('run-123', { onLog: vi.fn(), onStatus: vi.fn(), onError: vi.fn() });
      errorListener()?.(new Event('error'));
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

      // A live session with a broken stream is a stream problem. Demoting the
      // shell here would throw the operator out of a session that works.
      expect(refusals).toEqual([]);
      unsubscribe();
    });

    it('does not probe once a status frame has arrived', async () => {
      const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ authenticated: false })));
      vi.stubGlobal('fetch', fetchMock);

      subscribeToRun('run-123', { onLog: vi.fn(), onStatus: vi.fn(), onError: vi.fn() });
      statusListener()?.({ data: JSON.stringify({ id: 'run-123', status: 'running' }) } as MessageEvent<string>);
      // A mid-stream drop is an ordinary reconnect, and each retry fires another
      // error event: probing on every one would be a request loop of its own.
      errorListener()?.(new Event('error'));
      errorListener()?.(new Event('error'));

      expect(fetchMock).not.toHaveBeenCalled();
    });
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

describe('config and run-comparison client methods', () => {
  const calls: { url: string; init?: RequestInit }[] = [];

  function stubFetch(respond: (url: string) => Response) {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return respond(url);
      }),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const profile = {
    name: 'sonnet-evaluator',
    description: 'evaluator on sonnet',
    models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' },
    env: {},
  };

  it('configs() fetches GET /api/configs', async () => {
    const body = { repo: [], saved: [profile] };
    stubFetch(() => new Response(JSON.stringify(body)));

    const result = await api.configs();

    expect(result).toEqual(body);
    expect(calls).toEqual([{ url: '/api/configs', init: undefined }]);
  });

  it('configMetadata() fetches GET /api/configs/metadata', async () => {
    const body = {
      env: [
        {
          key: 'POOL_QUESTIONS_MODE',
          label: 'Pool questions',
          description: 'd',
          kind: 'enum',
          values: ['off', 'on'],
          defaultDescription: 'off',
        },
      ],
      models: [{ id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', blurb: 'b' }],
      harnessAgents: { matching: [{ id: 'opportunityEvaluator', label: 'Evaluator', role: 'r' }] },
    };
    stubFetch(() => new Response(JSON.stringify(body)));

    const result = await api.configMetadata();

    expect(result).toEqual(body);
    expect(calls).toEqual([{ url: '/api/configs/metadata', init: undefined }]);
  });

  it('createConfig() POSTs the profile as JSON with the anti-CSRF content type', async () => {
    stubFetch(() => new Response(JSON.stringify(profile), { status: 201 }));

    const result = await api.createConfig(profile);

    expect(result).toEqual(profile);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/configs');
    expect(calls[0].init?.method).toBe('POST');
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual(profile);
  });

  it('updateConfig() PATCHes the named config with the patch body', async () => {
    const patch = { description: 'better description' };
    stubFetch(() => new Response(JSON.stringify({ ...profile, ...patch })));

    const result = await api.updateConfig('sonnet-evaluator', patch);

    expect(result.description).toBe('better description');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/configs/sonnet-evaluator');
    expect(calls[0].init?.method).toBe('PATCH');
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual(patch);
  });

  it('deleteConfig() DELETEs the named config and tolerates the 204 empty body', async () => {
    stubFetch(() => new Response(null, { status: 204 }));

    await expect(api.deleteConfig('sonnet-evaluator')).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/configs/sonnet-evaluator');
    expect(calls[0].init?.method).toBe('DELETE');
  });

  it('compareRuns() builds the run-mode compare URL', async () => {
    const outcome = { comparable: false, findings: [] };
    stubFetch(() => new Response(JSON.stringify(outcome)));

    const result = await api.compareRuns('run-a', 'run-b');

    expect(result).toEqual(outcome);
    expect(calls.map((c) => c.url)).toEqual(['/api/compare?referenceRun=run-a&subjectRun=run-b']);
  });

  it('launch() posts a spec carrying ad-hoc overrides verbatim', async () => {
    const record = { id: 'run-1', status: 'queued' };
    stubFetch(() => new Response(JSON.stringify(record), { status: 202 }));

    await api.launch({
      kind: 'eval',
      harness: 'matching',
      profile: 'default',
      overrides: { models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' }, env: {} },
      flags: { runs: 1 },
    });

    const posted = JSON.parse(calls[0].init?.body as string);
    expect(posted.overrides).toEqual({
      models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' },
      env: {},
    });
  });

  it('surfaces the server error field on a refused create', async () => {
    stubFetch(() =>
      new Response(JSON.stringify({ error: 'A config named "sonnet-evaluator" already exists' }), {
        status: 409,
      }),
    );

    await expect(api.createConfig(profile)).rejects.toThrow(
      'A config named "sonnet-evaluator" already exists',
    );
  });
});

describe('historical quality client types', () => {
  it('name the strict measurement, funnel, and participant fields served by V2', () => {
    const artifact = COMPLETE_HISTORICAL_QUALITY_ARTIFACT as HistoricalQualityArtifact;
    const first = artifact.payload.cases[0]!;

    expect(artifact.measurement.kind).toBe('historical-quality-pilot');
    expect(artifact.measurement.completedSlots).toBe(10);
    expect(first.stageFunnel?.participants).toBe(24);
    expect(first.participantMetrics).toHaveLength(24);
    expect(first.participantMetrics[0]?.role).toBe('target');
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
