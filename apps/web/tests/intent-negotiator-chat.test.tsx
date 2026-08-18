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
    stopStream: vi.fn(),
    loadSession: vi.fn().mockResolvedValue(undefined),
    loadPreviousMessages: vi.fn(),
    hasPreviousSession: false,
    isLoadingPreviousMessages: false,
    clearChat: vi.fn(),
  },
  regenerationHandlers: new Set<(event: { intentId: string; pending: boolean }) => void>(),
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
  }),
}));

/** Emit a live SSE regeneration flip to every mounted subscriber. */
function emitRegeneration(event: { intentId: string; pending: boolean }) {
  act(() => {
    mocks.regenerationHandlers.forEach((handler) => handler(event));
  });
}

vi.mock('@/components/InjectedQuestions/InjectedQuestions', () => ({
  InjectedQuestions: ({
    questions,
    onAnswer,
    onDismiss,
  }: {
    questions: PendingQuestion[];
    onAnswer: (questionId: string, body: { selectedOptions: string[] }) => Promise<void>;
    onDismiss: (questionId: string) => Promise<void>;
  }) => (
    <div data-testid="injected-questions">
      {questions.map((question) => (
        <div key={question.id}>
          <span>{question.payload.title}</span>
          <button type="button" onClick={() => void onAnswer(question.id, { selectedOptions: ['Berlin'] })}>
            answer-{question.id}
          </button>
          <button type="button" onClick={() => void onDismiss(question.id)}>
            dismiss-{question.id}
          </button>
        </div>
      ))}
    </div>
  ),
}));

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

const QUESTION: PendingQuestion = {
  id: 'q-1',
  detection: {
    mode: 'intent',
    sourceType: 'intent',
    sourceId: 'intent-1',
    timestamp: '2026-07-20T10:02:00Z',
  },
  actors: [{ userId: 'user-1', role: 'subject' }],
  payload: {
    title: 'Which city should we prioritize?',
    prompt: 'Which city should we prioritize?',
    options: [],
    multiSelect: false,
  },
  status: 'pending',
  answer: null,
  expiresAt: null,
  createdAt: '2026-07-20T10:02:00Z',
  conversationId: null,
};

function renderChat(overrides: Partial<Parameters<typeof IntentNegotiatorChat>[0]> = {}) {
  const props = {
    intentId: 'intent-1',
    questions: [] as PendingQuestion[],
    answered: [],
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
    mocks.regenerationHandlers.clear();
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

  test('renders pending intent questions through the existing answer pipeline', async () => {
    renderChat({ questions: [QUESTION] });

    await screen.findByTestId('negotiator-pending-questions');
    expect(screen.getByTestId('injected-questions').textContent).toContain('Which city should we prioritize?');
  });

  test('places an unanchored pending question after older chat history', async () => {
    mocks.chat.messages = [
      { id: 'old-user', role: 'user', content: 'Earlier request', timestamp: new Date('2026-07-20T10:00:00Z') },
      { id: 'old-assistant', role: 'assistant', content: 'Earlier response', timestamp: new Date('2026-07-20T10:01:00Z') },
    ];

    renderChat({ questions: [QUESTION] });

    const chat = await screen.findByTestId('intent-negotiator-chat');
    await screen.findByText('Earlier response');
    const content = chat.textContent ?? '';
    expect(content.indexOf('Earlier response')).toBeLessThan(content.indexOf('Which city should we prioritize?'));
  });

  test('places anchored answered and pending questions after their assistant message', async () => {
    mocks.chat.messages = [
      { id: 'anchor-message', role: 'assistant', content: 'I need one detail.', timestamp: new Date('2026-07-20T10:00:00Z') },
      { id: 'later-user', role: 'user', content: 'A later reply', timestamp: new Date('2026-07-20T10:05:00Z') },
    ];
    const anchoredQuestion = {
      ...QUESTION,
      id: 'q-anchored',
      detection: { ...QUESTION.detection, messageId: 'anchor-message' },
    };
    const { props } = renderChat({
      questions: [anchoredQuestion],
      answered: [{
        id: 'answered-anchored',
        prompt: 'Previously asked detail?',
        response: 'Previously answered',
        messageId: 'anchor-message',
        answeredAt: '2026-07-20T10:10:00Z',
      }],
    });

    const chat = await screen.findByTestId('intent-negotiator-chat');
    await screen.findByText('A later reply');
    const content = chat.textContent ?? '';
    expect(content.indexOf('I need one detail.')).toBeLessThan(content.indexOf('Previously asked detail?'));
    expect(content.indexOf('Previously asked detail?')).toBeLessThan(content.indexOf('Which city should we prioritize?'));
    expect(content.indexOf('Which city should we prioritize?')).toBeLessThan(content.indexOf('A later reply'));

    fireEvent.click(screen.getByRole('button', { name: 'answer-q-anchored' }));
    fireEvent.click(screen.getByRole('button', { name: 'dismiss-q-anchored' }));
    expect(props.onAnswerQuestion).toHaveBeenCalledWith('q-anchored', { selectedOptions: ['Berlin'] });
    expect(props.onDismissQuestion).toHaveBeenCalledWith('q-anchored');
  });

  test('keeps an unanchored answered exchange deterministically trailing before pending', async () => {
    mocks.chat.messages = [
      { id: 'older-assistant', role: 'assistant', content: 'Old agent turn', timestamp: new Date('2026-07-20T10:00:00Z') },
      { id: 'newer-user', role: 'user', content: 'New user turn', timestamp: new Date('2026-07-20T12:00:00Z') },
    ];
    renderChat({
      questions: [QUESTION],
      answered: [{
        id: 'answered-between',
        prompt: 'Answered between turns?',
        response: 'Yes',
        answeredAt: '2026-07-20T11:00:00Z',
      }],
    });

    const chat = await screen.findByTestId('intent-negotiator-chat');
    await screen.findByText('New user turn');
    const content = chat.textContent ?? '';
    expect(content.indexOf('Old agent turn')).toBeLessThan(content.indexOf('New user turn'));
    expect(content.indexOf('New user turn')).toBeLessThan(content.indexOf('Answered between turns?'));
    expect(content.indexOf('Answered between turns?')).toBeLessThan(content.indexOf('Which city should we prioritize?'));
  });

  test('uses a deterministic end fallback for an answered exchange without timestamps', async () => {
    mocks.chat.messages = [
      { id: 'fallback-message', role: 'assistant', content: 'Last authoritative turn', timestamp: new Date('2026-07-20T12:00:00Z') },
    ];
    renderChat({
      questions: [QUESTION],
      answered: [{
        id: 'answered-without-time',
        prompt: 'Optimistic answer?',
        response: 'Kept without a fabricated timestamp',
      }],
    });

    const chat = await screen.findByTestId('intent-negotiator-chat');
    await screen.findByText('Last authoritative turn');
    const content = chat.textContent ?? '';
    expect(content.indexOf('Last authoritative turn')).toBeLessThan(content.indexOf('Optimistic answer?'));
    expect(content.indexOf('Optimistic answer?')).toBeLessThan(content.indexOf('Which city should we prioritize?'));
  });

  test('keeps answered history visible without the empty state', async () => {
    renderChat({
      answered: [{
        id: 'answered-1',
        prompt: 'What should we prioritize?',
        response: 'Berlin',
        answeredAt: new Date().toISOString(),
      }],
    });

    expect(await screen.findByTestId('negotiator-answered-exchange')).toBeInTheDocument();
    expect(screen.getByText('What should we prioritize?')).toBeInTheDocument();
    expect(screen.getByText('Berlin')).toBeInTheDocument();
    expect(screen.getByText('noted — updating the search.')).toBeInTheDocument();
    expect(screen.queryByTestId('questions-empty-state')).toBeNull();
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
