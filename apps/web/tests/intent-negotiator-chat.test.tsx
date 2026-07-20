/**
 * Intent-pinned negotiator chat embed (P4.2 / IND-403).
 *
 * Component tests for IntentNegotiatorChat: session bootstrap against
 * POST /chat/negotiator/session { intentId }, load-into-shared-context,
 * pending questions as opening turns (existing questions pipeline), send
 * flow, unavailable fallback, and context release on unmount.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import IntentNegotiatorChat from '@/components/IntentNegotiatorChat';
import type { PendingQuestion } from '@/services/questions';

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
    sendOnboardingMessage: vi.fn(),
    stopStream: vi.fn(),
    loadSession: vi.fn().mockResolvedValue(undefined),
    clearChat: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  apiClient: mocks.apiClient,
  useAuthenticatedAPI: () => mocks.apiClient,
}));

vi.mock('@/contexts/AIChatContext', () => ({
  useAIChat: () => mocks.chat,
}));

vi.mock('@/components/InjectedQuestions/InjectedQuestions', () => ({
  InjectedQuestions: ({ questions }: { questions: PendingQuestion[] }) => (
    <div data-testid="injected-questions">
      {questions.map((q) => (
        <div key={q.id}>{q.title}</div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/chat/AssistantMessageContent', () => ({
  default: ({ content }: { content: string }) => <div data-testid="assistant-content">{content}</div>,
}));

vi.mock('@/components/chat/ToolCallsDisplay', () => ({
  ToolCallsDisplay: () => null,
}));

const SESSION_RESPONSE = {
  session: { id: 'neg-intent-sess-1' },
  created: true,
  agent: { id: 'agent-1', name: "Alice's Negotiator", description: null },
};

const QUESTION: PendingQuestion = {
  id: 'q-1',
  title: 'Which city should we prioritize?',
  prompt: 'Which city should we prioritize?',
  options: [],
  multiSelect: false,
  mode: 'intent',
  sourceType: 'intent',
  sourceId: 'intent-1',
  createdAt: new Date().toISOString(),
} as unknown as PendingQuestion;

function renderChat(overrides: Partial<Parameters<typeof IntentNegotiatorChat>[0]> = {}) {
  const props = {
    intentId: 'intent-1',
    questions: [] as PendingQuestion[],
    onAnswerQuestion: vi.fn(),
    onDismissQuestion: vi.fn(),
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
    mocks.chat.messages = [];
    mocks.chat.isLoading = false;
    mocks.chat.sessionId = null;
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

  test('renders pending intent questions as the opening turns (existing pipeline)', async () => {
    renderChat({ questions: [QUESTION] });

    await screen.findByTestId('negotiator-opening-questions');
    expect(screen.getByTestId('injected-questions').textContent).toContain('Which city should we prioritize?');
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

  test('reloads the stable session when a bounded pool-reaction checkpoint arrives', async () => {
    mocks.chat.sessionId = 'neg-intent-sess-1';
    const { rerender, props } = renderChat({ refreshVersion: 0 });
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(1));

    rerender(<IntentNegotiatorChat {...props} refreshVersion={1} />);
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledTimes(2));
    expect(mocks.chat.loadSession).toHaveBeenLastCalledWith('neg-intent-sess-1');
  });

  test('releases the shared chat context on unmount', async () => {
    const { unmount } = renderChat();
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalled());

    unmount();
    expect(mocks.chat.clearChat).toHaveBeenCalledWith({ abortStream: false });
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
