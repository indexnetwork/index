import { useState } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AIChatProvider, useAIChat } from '@/contexts/AIChatContext';
import { renderWithRouter } from '@/test/test-utils';

const mocks = vi.hoisted(() => ({
  apiClient: {
    stream: vi.fn(),
    post: vi.fn(),
  },
  refetchSessions: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiClient: mocks.apiClient,
}));

vi.mock('@/contexts/AIChatSessionsContext', () => ({
  useAIChatSessions: () => ({ refetchSessions: mocks.refetchSessions }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function streamResponse(options?: { sessionId?: string; persona?: string; response?: string }) {
  return new Response(`data: ${JSON.stringify({ type: 'done', response: options?.response ?? 'ok' })}\n\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      ...(options?.sessionId ? { 'X-Session-Id': options.sessionId } : {}),
      ...(options?.persona ? { 'X-Chat-Persona': options.persona } : {}),
    },
  });
}

function controlledStream(options?: { sessionId?: string; persona?: string }) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        ...(options?.sessionId ? { 'X-Session-Id': options.sessionId } : {}),
        ...(options?.persona ? { 'X-Chat-Persona': options.persona } : {}),
      },
    }),
    event(value: Record<string, unknown>) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
    },
    close() {
      controller.close();
    },
  };
}

function sessionResponse(id: string, content = id, persona = 'signal') {
  return {
    session: { id, title: `Title ${id}`, persona },
    messages: [{
      id: `message-${id}`,
      role: 'assistant',
      content,
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
  };
}

function policyResponse(code: string, error: string, action?: { type: string; href: string }) {
  return new Response(JSON.stringify({ code, error, ...(action ? { action } : {}) }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  });
}

function Probe() {
  const chat = useAIChat();
  const [loadResult, setLoadResult] = useState('none');
  return (
    <div>
      <button onClick={() => void chat.sendWebMessage('first', undefined, undefined, { persona: 'signal' })}>
        web first
      </button>
      <button onClick={() => void chat.sendWebMessage('second')}>web second</button>
      <button onClick={() => void chat.sendMessage('compatibility')}>compatibility</button>
      <button onClick={() => void chat.sendOnboardingMessage('onboarding')}>onboarding</button>
      <button onClick={() => chat.clearChat()}>clear</button>
      <button onClick={() => chat.clearChat({ abortStream: false })}>clear detached</button>
      <button onClick={() => chat.startSignalSession()}>start signal</button>
      <button onClick={() => void chat.loadSession('session-a')}>load a</button>
      <button onClick={() => void chat.loadSession('session-b')}>load b</button>
      <button onClick={() => void chat.loadSession('old-session')}>load old</button>
      <button onClick={() => void chat.loadSession('failed-session').then((result) => setLoadResult(String(result)))}>
        load failed
      </button>
      <button onClick={() => chat.submitMidStreamMessage('queued follow-up', [])}>queue follow-up</button>
      <span data-testid="session">{chat.sessionId ?? 'none'}</span>
      <span data-testid="persona">{chat.sessionPersona ?? 'none'}</span>
      <span data-testid="messages">{chat.messages.map((message) => message.content).join('|')}</span>
      <span data-testid="message-count">{chat.messages.length}</span>
      <span data-testid="block">{chat.turnBlock?.code ?? 'none'}</span>
      <span data-testid="block-message">{chat.turnBlock?.message ?? 'none'}</span>
      <span data-testid="block-action">{chat.turnBlock?.action?.type ?? 'none'}</span>
      <span data-testid="loading">{chat.isLoading ? 'yes' : 'no'}</span>
      <span data-testid="load-status">{chat.sessionLoadState.status}</span>
      <span data-testid="load-target">{chat.sessionLoadState.targetSessionId ?? 'none'}</span>
      <span data-testid="load-error">{chat.sessionLoadState.error ?? 'none'}</span>
      <span data-testid="load-result">{loadResult}</span>
      <span data-testid="ready-b">{chat.isSessionReady('session-b') ? 'yes' : 'no'}</span>
      <span data-testid="queue-id">{chat.pendingQueue[0]?.id ?? 'none'}</span>
    </div>
  );
}

function renderProvider() {
  return renderWithRouter(
    <AIChatProvider>
      <Probe />
    </AIChatProvider>,
    { route: '/' },
  );
}

function text(testId: string) {
  return screen.getByTestId(testId).textContent;
}

describe('AIChatContext Signal persona transport and ownership', () => {
  beforeEach(() => {
    mocks.apiClient.stream.mockReset();
    mocks.apiClient.post.mockReset();
    mocks.refetchSessions.mockReset();
    mocks.apiClient.post.mockResolvedValue({});
  });

  test('web sends use the dedicated route while compatibility sends remain compatible', async () => {
    mocks.apiClient.stream
      .mockResolvedValueOnce(streamResponse({ sessionId: 'signal-session-1', persona: 'signal' }))
      .mockResolvedValueOnce(streamResponse());

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'web first' }));
    await waitFor(() => expect(text('session')).toBe('signal-session-1'));
    expect(mocks.apiClient.stream.mock.calls[0]?.[0]).toBe('/chat/web/stream');

    fireEvent.click(screen.getByRole('button', { name: 'compatibility' }));
    await waitFor(() => expect(mocks.apiClient.stream).toHaveBeenCalledTimes(2));
    // Persisted Signal compatibility is retained for existing callers.
    expect(mocks.apiClient.stream.mock.calls[1]?.[0]).toBe('/chat/web/stream');

    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    mocks.apiClient.stream.mockResolvedValueOnce(streamResponse());
    fireEvent.click(screen.getByRole('button', { name: 'compatibility' }));
    await waitFor(() => expect(mocks.apiClient.stream).toHaveBeenCalledTimes(3));
    expect(mocks.apiClient.stream.mock.calls[2]?.[0]).toBe('/chat/stream');
  });

  test('onboarding sends use the dedicated server-clamped route', async () => {
    mocks.apiClient.stream.mockResolvedValueOnce(streamResponse({
      sessionId: 'onboarding-session',
      persona: 'orchestrator',
    }));

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'onboarding' }));

    await waitFor(() => expect(text('session')).toBe('onboarding-session'));
    expect(mocks.apiClient.stream.mock.calls[0]?.[0]).toBe('/chat/onboarding/stream');
    expect(mocks.apiClient.stream.mock.calls[0]?.[1]).not.toHaveProperty('persona');
  });

  test('an old successful response cannot repopulate chat after clear', async () => {
    const old = deferred<Response>();
    mocks.apiClient.stream.mockReturnValueOnce(old.promise);

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'web first' }));
    await waitFor(() => expect(text('loading')).toBe('yes'));
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));

    await act(async () => {
      old.resolve(streamResponse({ sessionId: 'stale-session', persona: 'signal', response: 'stale' }));
      await old.promise;
    });

    await waitFor(() => expect(text('loading')).toBe('no'));
    expect(text('session')).toBe('none');
    expect(text('message-count')).toBe('0');
  });

  test('a deliberately detached successful stream may refresh only the sidebar', async () => {
    const old = deferred<Response>();
    mocks.apiClient.stream.mockReturnValueOnce(old.promise);

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'web first' }));
    await waitFor(() => expect(text('loading')).toBe('yes'));
    fireEvent.click(screen.getByRole('button', { name: 'clear detached' }));

    await act(async () => {
      old.resolve(streamResponse({ sessionId: 'detached-session', persona: 'signal', response: 'detached' }));
      await old.promise;
    });

    await waitFor(() => expect(mocks.refetchSessions).toHaveBeenCalledTimes(1));
    expect(text('session')).toBe('none');
    expect(text('persona')).toBe('none');
    expect(text('message-count')).toBe('0');
    expect(text('loading')).toBe('no');
  });

  test('an old stream cannot overwrite a newly loaded session', async () => {
    const old = deferred<Response>();
    mocks.apiClient.stream.mockReturnValueOnce(old.promise);
    mocks.apiClient.post.mockResolvedValueOnce(sessionResponse('session-b', 'loaded B'));

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'web first' }));
    fireEvent.click(screen.getByRole('button', { name: 'load b' }));
    await waitFor(() => expect(text('ready-b')).toBe('yes'));

    await act(async () => {
      old.resolve(streamResponse({ sessionId: 'stale-session', persona: 'signal', response: 'stale' }));
      await old.promise;
    });

    expect(text('session')).toBe('session-b');
    expect(text('messages')).toBe('loaded B');
    expect(text('loading')).toBe('no');
  });

  test('an old send finally cannot clear a newer send loading state', async () => {
    const old = deferred<Response>();
    const current = deferred<Response>();
    mocks.apiClient.stream
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'web first' }));
    fireEvent.click(screen.getByRole('button', { name: 'web second' }));
    await waitFor(() => expect(mocks.apiClient.stream).toHaveBeenCalledTimes(2));
    const oldSignal = (mocks.apiClient.stream.mock.calls[0]?.[2] as { signal: AbortSignal }).signal;
    const currentSignal = (mocks.apiClient.stream.mock.calls[1]?.[2] as { signal: AbortSignal }).signal;
    expect(oldSignal).not.toBe(currentSignal);
    expect(oldSignal.aborted).toBe(true);
    expect(currentSignal.aborted).toBe(false);

    await act(async () => {
      old.resolve(streamResponse({ response: 'old' }));
      await old.promise;
    });
    expect(text('loading')).toBe('yes');

    await act(async () => {
      current.resolve(streamResponse({ response: 'new' }));
      await current.promise;
    });
    await waitFor(() => expect(text('loading')).toBe('no'));
    expect(text('messages')).toContain('new');
    expect(text('messages')).not.toContain('old');
  });

  test('load A then B commits only B when responses arrive out of order', async () => {
    const loadA = deferred<ReturnType<typeof sessionResponse>>();
    const loadB = deferred<ReturnType<typeof sessionResponse>>();
    mocks.apiClient.post
      .mockReturnValueOnce(loadA.promise)
      .mockReturnValueOnce(loadB.promise);

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'load a' }));
    expect(text('load-status')).toBe('loading');
    expect(text('load-target')).toBe('session-a');
    fireEvent.click(screen.getByRole('button', { name: 'load b' }));
    expect(text('load-target')).toBe('session-b');

    await act(async () => {
      loadB.resolve(sessionResponse('session-b', 'B wins'));
      await loadB.promise;
    });
    await waitFor(() => expect(text('ready-b')).toBe('yes'));

    await act(async () => {
      loadA.resolve(sessionResponse('session-a', 'A stale'));
      await loadA.promise;
    });
    expect(text('session')).toBe('session-b');
    expect(text('messages')).toBe('B wins');
  });

  test('a failed load quarantines the old session and exposes target-specific failure', async () => {
    mocks.apiClient.post
      .mockResolvedValueOnce(sessionResponse('old-session', 'old content'))
      .mockRejectedValueOnce(new Error('private database detail'));

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'load old' }));
    await waitFor(() => expect(text('session')).toBe('old-session'));

    fireEvent.click(screen.getByRole('button', { name: 'load failed' }));
    await waitFor(() => expect(text('load-status')).toBe('error'));
    expect(text('load-target')).toBe('failed-session');
    expect(text('load-error')).toBe('Could not load this chat. Please try again.');
    expect(text('load-error')).not.toContain('private database detail');
    await waitFor(() => expect(text('load-result')).toBe('false'));
    expect(text('session')).toBe('none');
    expect(text('message-count')).toBe('0');
  });

  test.each([
    ['WEB_SIGNAL_AGENT_DISABLED', 'Signal Agent is not available right now.'],
    ['CHAT_PERSONA_MISMATCH', 'This request does not match the chat that was opened.'],
    ['CHAT_PERSONA_UNSUPPORTED', 'This chat cannot be continued safely.'],
  ])('maps %s to product-safe state without trusting server detail', async (code, safeMessage) => {
    mocks.apiClient.stream.mockResolvedValueOnce(policyResponse(code, 'sensitive internal detail'));

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'web first' }));

    await waitFor(() => expect(text('block')).toBe(code));
    expect(text('block-message')).toBe(safeMessage);
    expect(text('block-message')).not.toContain('sensitive internal detail');
    expect(text('block-action')).toBe('none');
    expect(text('message-count')).toBe('0');
  });

  test('accepts only the exact start Signal action and reset forces a fresh Signal session', async () => {
    mocks.apiClient.stream
      .mockResolvedValueOnce(policyResponse(
        'WEB_SIGNAL_SESSION_REQUIRED',
        'untrusted detail',
        { type: 'start_signal_session', href: '/' },
      ))
      .mockResolvedValueOnce(streamResponse({ sessionId: 'fresh-signal', persona: 'signal' }));

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'web first' }));
    await waitFor(() => expect(text('block-action')).toBe('start_signal_session'));
    expect(text('message-count')).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'start signal' }));
    expect(text('block')).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'web second' }));
    await waitFor(() => expect(text('session')).toBe('fresh-signal'));
    expect(mocks.apiClient.stream.mock.calls[1]?.[0]).toBe('/chat/web/stream');
    expect(mocks.apiClient.stream.mock.calls[1]?.[1]).toMatchObject({ persona: 'signal' });
  });

  test('rejects a valid-looking action attached to the wrong policy code', async () => {
    mocks.apiClient.stream.mockResolvedValueOnce(policyResponse(
      'WEB_SIGNAL_AGENT_DISABLED',
      'untrusted detail',
      { type: 'start_signal_session', href: '/' },
    ));

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'web first' }));
    await waitFor(() => expect(text('block')).toBe('WEB_SIGNAL_AGENT_DISABLED'));
    expect(text('block-action')).toBe('none');
  });

  test('rejects a lookalike continuation action', async () => {
    mocks.apiClient.stream.mockResolvedValueOnce(policyResponse(
      'WEB_SIGNAL_SESSION_REQUIRED',
      'untrusted detail',
      { type: 'start_signal_session', href: '/unsafe' },
    ));

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'web first' }));
    await waitFor(() => expect(text('block')).toBe('WEB_SIGNAL_SESSION_REQUIRED'));
    expect(text('block-action')).toBe('none');
  });

  test('queued web sends retain the dedicated transport when drained', async () => {
    const first = controlledStream({ sessionId: 'signal-session', persona: 'signal' });
    mocks.apiClient.stream
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(streamResponse({ sessionId: 'signal-session', persona: 'signal' }));

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'web first' }));
    await waitFor(() => expect(text('session')).toBe('signal-session'));
    fireEvent.click(screen.getByRole('button', { name: 'queue follow-up' }));
    await waitFor(() => expect(text('queue-id')).not.toBe('none'));
    const queuedId = text('queue-id');

    await act(async () => {
      first.event({ type: 'steer_or_queue', decision: 'queue', messageId: queuedId });
      first.event({ type: 'done', response: 'first complete' });
      first.close();
    });

    await waitFor(() => expect(mocks.apiClient.stream).toHaveBeenCalledTimes(2));
    expect(mocks.apiClient.stream.mock.calls[1]?.[0]).toBe('/chat/web/stream');
    expect(mocks.apiClient.stream.mock.calls[1]?.[1]).toMatchObject({
      message: 'queued follow-up',
      sessionId: 'signal-session',
    });
  });
});
