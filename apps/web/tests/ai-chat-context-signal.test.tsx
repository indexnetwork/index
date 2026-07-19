import { fireEvent, screen, waitFor } from '@testing-library/react';
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

function streamResponse(options?: { sessionId?: string; persona?: string }) {
  return new Response('data: {"type":"done","response":"ok"}\n\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      ...(options?.sessionId ? { 'X-Session-Id': options.sessionId } : {}),
      ...(options?.persona ? { 'X-Chat-Persona': options.persona } : {}),
    },
  });
}

function Probe() {
  const chat = useAIChat();
  return (
    <div>
      <button onClick={() => void chat.sendMessage('first', undefined, undefined, { persona: 'signal' })}>
        first
      </button>
      <button onClick={() => void chat.sendMessage('second')}>second</button>
      <button onClick={() => chat.startSignalSession()}>start signal</button>
      <button onClick={() => void chat.resolveIntentSession({ id: 'intent-1' }, 'signal')}>
        resolve signal intent
      </button>
      <button onClick={() => void chat.sendMessage('onboard', undefined, undefined, {
        prefillMessages: [{ role: 'assistant', content: 'Welcome' }],
      })}>
        onboard
      </button>
      <span data-testid="session">{chat.sessionId ?? 'none'}</span>
      <span data-testid="persona">{chat.sessionPersona ?? 'none'}</span>
      <span data-testid="messages">{chat.messages.length}</span>
      <span data-testid="block">{chat.turnBlock?.code ?? 'none'}</span>
      <span data-testid="loading">{chat.isLoading ? 'yes' : 'no'}</span>
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

describe('AIChatContext Signal persona transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('explicitly requests Signal for creation, then inherits it by session ID', async () => {
    mocks.apiClient.stream
      .mockResolvedValueOnce(streamResponse({ sessionId: 'signal-session-1', persona: 'signal' }))
      .mockResolvedValueOnce(streamResponse({ sessionId: 'signal-session-1', persona: 'signal' }));

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'first' }));

    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('signal-session-1'));
    expect(screen.getByTestId('persona')).toHaveTextContent('signal');
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('no'));
    expect(mocks.apiClient.stream.mock.calls[0]?.[0]).toBe('/chat/web/stream');
    const firstPayload = mocks.apiClient.stream.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(firstPayload).toMatchObject({
      message: 'first',
      sessionId: null,
      persona: 'signal',
    });

    fireEvent.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() => expect(mocks.apiClient.stream).toHaveBeenCalledTimes(2));
    expect(mocks.apiClient.stream.mock.calls[1]?.[0]).toBe('/chat/web/stream');
    const secondPayload = mocks.apiClient.stream.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(secondPayload).toMatchObject({
      message: 'second',
      sessionId: 'signal-session-1',
    });
    expect(secondPayload).not.toHaveProperty('persona');
  });

  test('a continuation action forces the next creation to Signal despite stale flags', async () => {
    mocks.apiClient.stream.mockResolvedValueOnce(
      streamResponse({ sessionId: 'forced-signal-session', persona: 'signal' }),
    );

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'start signal' }));
    fireEvent.click(screen.getByRole('button', { name: 'second' }));

    await waitFor(() => expect(mocks.apiClient.stream).toHaveBeenCalledTimes(1));
    expect(mocks.apiClient.stream.mock.calls[0]?.[0]).toBe('/chat/web/stream');
    expect(mocks.apiClient.stream.mock.calls[0]?.[1]).toMatchObject({
      message: 'second',
      persona: 'signal',
    });
  });

  test('onboarding stays on the compatibility stream without claiming Signal', async () => {
    mocks.apiClient.stream.mockResolvedValueOnce(streamResponse({
      sessionId: 'onboarding-session',
      persona: 'orchestrator',
    }));

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'onboard' }));

    await waitFor(() => expect(mocks.apiClient.stream).toHaveBeenCalledTimes(1));
    expect(mocks.apiClient.stream.mock.calls[0]?.[0]).toBe('/chat/stream');
    expect(mocks.apiClient.stream.mock.calls[0]?.[1]).not.toHaveProperty('persona');
  });

  test('resolves intent-scoped Signal sessions through the dedicated web route', async () => {
    mocks.apiClient.post.mockResolvedValueOnce({ session: { id: 'intent-signal-session' } });

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'resolve signal intent' }));

    await waitFor(() => expect(mocks.apiClient.post).toHaveBeenCalledWith(
      '/chat/web/session/resolve',
      { scopeType: 'intent', scopeId: 'intent-1', persona: 'signal' },
    ));
  });

  test('captures a typed legacy block and removes optimistic placeholders', async () => {
    mocks.apiClient.stream.mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'This earlier chat is read-only. Start a new Signal Agent chat to continue.',
      code: 'WEB_SIGNAL_SESSION_REQUIRED',
      action: { type: 'start_signal_session', href: '/' },
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }));

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'first' }));

    await waitFor(() => expect(screen.getByTestId('block')).toHaveTextContent('WEB_SIGNAL_SESSION_REQUIRED'));
    expect(screen.getByTestId('messages')).toHaveTextContent('0');
    expect(screen.getByTestId('session')).toHaveTextContent('none');
  });
});
