/**
 * Intent-pinned negotiator chat embed (P4.2 / IND-403).
 *
 * Component tests for IntentNegotiatorChat: session bootstrap against
 * POST /chat/negotiator/session { intentId }, load-into-shared-context,
 * pending questions as opening turns (existing questions pipeline), send
 * flow, unavailable fallback, and context release on unmount.
 */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import IntentNegotiatorChat from '@/components/IntentNegotiatorChat';

const mocks = vi.hoisted(() => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  chat: {
    messages: [] as Array<Record<string, unknown>>,
    isLoading: false,
    sessionId: null as string | null,
    sendMessage: vi.fn(),
    stopStream: vi.fn(),
    loadSession: vi.fn().mockResolvedValue(undefined),
    loadPreviousMessages: vi.fn(),
    hasPreviousSession: false,
    isLoadingPreviousMessages: false,
    clearChat: vi.fn(),
  },
  regenerationHandlers: new Set<(event: { intentId: string; pending: boolean }) => void>(),
  turnCompletedHandlers: new Set<(event: { intentId: string }) => void>(),
  conversationMessageHandlers: new Set<(event: { conversationId: string; message: { role: string } }) => void>(),
}));

vi.mock('@/lib/api', () => ({
  apiClient: mocks.apiClient,
  useAuthenticatedAPI: () => mocks.apiClient,
}));

vi.mock('@/contexts/AIChatContext', () => ({
  useAIChat: () => mocks.chat,
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({
    subscribeQuestionRegeneration: (handler: (event: { intentId: string; pending: boolean }) => void) => {
      mocks.regenerationHandlers.add(handler);
      return () => {
        mocks.regenerationHandlers.delete(handler);
      };
    },
    subscribePersonalAgentTurnCompleted: (handler: (event: { intentId: string }) => void) => {
      mocks.turnCompletedHandlers.add(handler);
      return () => {
        mocks.turnCompletedHandlers.delete(handler);
      };
    },
    subscribeConversationMessage: (handler: (event: { conversationId: string; message: { role: string } }) => void) => {
      mocks.conversationMessageHandlers.add(handler);
      return () => {
        mocks.conversationMessageHandlers.delete(handler);
      };
    },
  }),
}));

/** Emit a live SSE regeneration flip to every mounted subscriber. */
function emitRegeneration(event: { intentId: string; pending: boolean }) {
  act(() => {
    mocks.regenerationHandlers.forEach((handler) => handler(event));
  });
}

function emitTurnCompleted(event: { intentId: string }) {
  act(() => {
    mocks.turnCompletedHandlers.forEach((handler) => handler(event));
  });
}

function emitConversationMessage(event: { conversationId: string; message: { role: string } }) {
  act(() => {
    mocks.conversationMessageHandlers.forEach((handler) => handler(event));
  });
}

vi.mock('@/components/chat/AssistantMessageContent', () => ({
  default: ({
    content,
    onQuestionQuote,
  }: {
    content: string;
    onQuestionQuote?: (prompt: string) => void;
  }) => (
    <div data-testid="assistant-content">
      {content}
      {onQuestionQuote && (
        <button type="button" onClick={() => onQuestionQuote('Which equity range works for you?')}>
          quote-question
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/components/chat/ToolCallsDisplay', () => ({
  ToolCallsDisplay: () => null,
}));

const SESSION_RESPONSE = {
  session: { id: 'neg-intent-sess-1' },
  created: true,
  agent: { id: 'agent-1', name: "Alice's Negotiator", description: null },
};


function renderChat(overrides: Partial<Parameters<typeof IntentNegotiatorChat>[0]> = {}) {
  const props = {
    intentId: 'intent-1',
    timelineEntries: [],
    timelineLoading: false,
    timelineError: false,
    opportunityStatusMap: {},
    opportunityActionLoading: {},
    onOpportunityAction: vi.fn(),
    onUnavailable: vi.fn(),
    ...overrides,
  };
  return { ...render(<IntentNegotiatorChat {...props} />), props };
}

describe('IntentNegotiatorChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.regenerationHandlers.clear();
    mocks.turnCompletedHandlers.clear();
    mocks.conversationMessageHandlers.clear();
    mocks.chat.messages = [];
    mocks.chat.isLoading = false;
    mocks.chat.sessionId = null;
    mocks.chat.hasPreviousSession = false;
    mocks.chat.isLoadingPreviousMessages = false;
    mocks.chat.loadSession.mockResolvedValue(undefined);
    mocks.apiClient.post.mockResolvedValue(SESSION_RESPONSE);
  });

  test('bootstraps the per-intent session and loads it into the shared context', async () => {
    renderChat();

    await waitFor(() =>
      expect(mocks.apiClient.post).toHaveBeenCalledWith('/chat/negotiator/session', { intentId: 'intent-1' })
    );
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledWith('neg-intent-sess-1'));

    // Ready: input enabled with the agent-name placeholder.
    const input = await screen.findByTestId('negotiator-chat-input');
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect(input.getAttribute('placeholder')).toBe("Message Alice's Negotiator…");
  });

  test('marks restored persisted history so stale signal summaries are not read as current', async () => {
    mocks.apiClient.post.mockResolvedValue({ ...SESSION_RESPONSE, created: false });
    mocks.chat.messages = [
      { id: 'old-1', role: 'assistant', content: 'An earlier summary', timestamp: new Date(Date.now() - 86_400_000) },
    ];
    mocks.chat.loadSession.mockResolvedValue(true);

    renderChat();

    const divider = await screen.findByTestId('negotiator-restored-history-divider');
    expect(divider).toHaveTextContent('earlier conversation');
    expect(divider).toHaveTextContent('may not reflect current signal state');
  });

  test('loads the previous durable session from the negotiator timeline', async () => {
    mocks.chat.hasPreviousSession = true;
    renderChat();

    const button = await screen.findByRole('button', { name: 'Load previous messages' });
    fireEvent.click(button);
    expect(mocks.chat.loadPreviousMessages).toHaveBeenCalledTimes(1);
  });

  test('falls back via onUnavailable when the bootstrap fails', async () => {
    mocks.apiClient.post.mockRejectedValue(new Error('404'));
    const { props } = renderChat();

    await waitFor(() => expect(props.onUnavailable).toHaveBeenCalled());
    expect(mocks.chat.loadSession).not.toHaveBeenCalled();
  });

  test('sends the typed message through the shared chat context', async () => {
    renderChat();
    const input = await screen.findByTestId('negotiator-chat-input');
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));

    fireEvent.change(input, { target: { value: 'Any progress on this signal?' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(mocks.chat.sendMessage).toHaveBeenCalledWith('Any progress on this signal?')
    );
    expect((input as HTMLInputElement).value).toBe('');
  });

  test('reconciles a completed PersonalAgent turn from the durable session', async () => {
    mocks.chat.sessionId = 'neg-intent-sess-1';
    renderChat();
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1));

    emitTurnCompleted({ intentId: 'intent-1' });
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(2));
    expect(mocks.chat.loadSession).toHaveBeenLastCalledWith('neg-intent-sess-1');
  });

  test('reconciles an agent message for the current session and invalidates its workspace', async () => {
    mocks.chat.sessionId = 'neg-intent-sess-1';
    const onLiveInvalidation = vi.fn();
    renderChat({ onLiveInvalidation });
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1));

    emitConversationMessage({ conversationId: 'someone-elses-session', message: { role: 'agent' } });
    expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1);
    expect(onLiveInvalidation).not.toHaveBeenCalled();

    emitConversationMessage({ conversationId: 'neg-intent-sess-1', message: { role: 'agent' } });
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(2));
    expect(onLiveInvalidation).toHaveBeenCalledTimes(1);
  });

  test('releases the shared chat context on unmount', async () => {
    const { unmount } = renderChat();
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalled());

    unmount();
    expect(mocks.chat.clearChat).toHaveBeenCalledWith({ abortStream: false });
  });

  test('shows the agent-working indicator while a question-message regeneration is pending', async () => {
    renderChat({ questionRegenerationPending: true });

    expect(await screen.findByTestId('question-regeneration-indicator')).toBeInTheDocument();
  });

  test('hides the regeneration indicator when the prop is absent', async () => {
    renderChat();

    await screen.findByTestId('negotiator-chat-input');
    expect(screen.queryByTestId('question-regeneration-indicator')).toBeNull();
  });

  test('shows the indicator on a live pending flip and reloads the session when it completes', async () => {
    mocks.chat.sessionId = 'neg-intent-sess-1';
    renderChat();
    await screen.findByTestId('negotiator-chat-input');
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1));

    // A regeneration starts while the user is viewing: indicator, no reload.
    emitRegeneration({ intentId: 'intent-1', pending: true });
    expect(await screen.findByTestId('question-regeneration-indicator')).toBeInTheDocument();
    expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1);

    // It finishes: the indicator clears and the session reloads so an
    // in-place rewrite of the open question-message renders.
    emitRegeneration({ intentId: 'intent-1', pending: false });
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(2));
    expect(mocks.chat.loadSession).toHaveBeenLastCalledWith('neg-intent-sess-1');
    expect(screen.queryByTestId('question-regeneration-indicator')).toBeNull();
  });

  test('the live flip supersedes a stale bootstrap pending snapshot', async () => {
    mocks.chat.sessionId = 'neg-intent-sess-1';
    mocks.apiClient.post.mockResolvedValue({ ...SESSION_RESPONSE, questionRegenerationPending: true });
    renderChat();

    expect(await screen.findByTestId('question-regeneration-indicator')).toBeInTheDocument();

    emitRegeneration({ intentId: 'intent-1', pending: false });
    await waitFor(() => expect(screen.queryByTestId('question-regeneration-indicator')).toBeNull());
  });

  test('ignores live regeneration flips for other signals', async () => {
    mocks.chat.sessionId = 'neg-intent-sess-1';
    renderChat();
    await screen.findByTestId('negotiator-chat-input');
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1));

    emitRegeneration({ intentId: 'someone-elses-intent', pending: true });
    expect(screen.queryByTestId('question-regeneration-indicator')).toBeNull();

    emitRegeneration({ intentId: 'someone-elses-intent', pending: false });
    expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1);
  });

  test('defers the completion reload while a response is streaming, then applies it', async () => {
    mocks.chat.sessionId = 'neg-intent-sess-1';
    const { rerender, props } = renderChat();
    await screen.findByTestId('negotiator-chat-input');
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1));

    // Regeneration completes while the negotiator is mid-stream: hold the reload.
    mocks.chat.isLoading = true;
    rerender(<IntentNegotiatorChat {...props} />);
    emitRegeneration({ intentId: 'intent-1', pending: false });
    expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1);

    // The stream settles: the held reload applies.
    mocks.chat.isLoading = false;
    rerender(<IntentNegotiatorChat {...props} />);
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(2));
  });

  test('ignores completed turns for another signal', async () => {
    mocks.chat.sessionId = 'neg-intent-sess-1';
    renderChat();
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1));
    emitTurnCompleted({ intentId: 'someone-elses-intent' });
    expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1);
  });

  test('tap-to-quote prefills the input with the question being answered', async () => {
    mocks.chat.messages = [
      { id: 'm1', role: 'assistant', content: 'Some questions for you.', timestamp: new Date() },
    ];
    renderChat();

    fireEvent.click(await screen.findByRole('button', { name: 'quote-question' }));

    const input = screen.getByTestId('negotiator-chat-input') as HTMLInputElement;
    expect(input.value).toBe('"Which equity range works for you?" — ');
    expect(document.activeElement).toBe(input);
  });

  test('renders streamed messages from the shared context', async () => {
    mocks.chat.messages = [
      { id: 'm1', role: 'user', content: 'Status?', timestamp: new Date() },
      { id: 'm2', role: 'assistant', content: 'Two matches are in negotiation.', timestamp: new Date() },
    ];
    renderChat();

    await screen.findByText('Status?');
    expect(screen.getByTestId('assistant-content').textContent).toContain('Two matches are in negotiation.');
  });
});
