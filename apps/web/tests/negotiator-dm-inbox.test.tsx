/**
 * Negotiator DM question inbox (P4.3 / IND-404).
 *
 * ChatContent surfaces the client's full pending-question inbox
 * (GET /questions?status=pending&noConversation=true) when the loaded session
 * runs the negotiator persona without an intent pin. Orchestrator sessions
 * keep the existing behavior (conversation-linked questions only).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import type { Ref } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import ChatContent from '@/components/ChatContent';
import { renderWithRouter } from '@/test/test-utils';
import type { PendingQuestion } from '@/services/questions';

const mocks = vi.hoisted(() => {
  const questionsService = {
    getPending: vi.fn(),
    getByConversation: vi.fn(),
    answer: vi.fn(),
    dismiss: vi.fn(),
  };
  const chat = {
    messages: [] as Array<Record<string, unknown>>,
    isLoading: false,
    stopStream: vi.fn(),
    sendMessage: vi.fn(),
    clearChat: vi.fn(),
    startSignalSession: vi.fn(),
    loadSession: vi.fn().mockResolvedValue(undefined),
    sessionId: null as string | null,
    sessionTitle: null as string | null,
    sessionPersona: null as string | null,
    turnBlock: null,
    suggestions: null,
    chatScope: null as Record<string, unknown> | null,
    setChatScope: vi.fn(),
    setScopeNetworkId: vi.fn(),
    sessionNetworkId: null,
    updateSessionTitle: vi.fn(),
    pendingQueue: [] as unknown[],
    cancelQueuedMessage: vi.fn(),
    submitMidStreamMessage: vi.fn(),
    liveQuestions: [] as unknown[],
  };
  return {
    questionsService,
    chat,
    auth: { features: { signalAgent: false } },
    notifications: { success: vi.fn(), error: vi.fn(), addNotification: vi.fn() },
    apiClient: { get: vi.fn(), post: vi.fn().mockResolvedValue({}), patch: vi.fn(), delete: vi.fn() },
  };
});

vi.mock('@/lib/api', () => ({
  apiClient: mocks.apiClient,
  useAuthenticatedAPI: () => mocks.apiClient,
}));

vi.mock('@/contexts/AIChatContext', () => ({
  useAIChat: () => mocks.chat,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => mocks.auth,
}));

vi.mock('@/contexts/APIContext', () => {
  const noopService = new Proxy({}, { get: () => vi.fn().mockResolvedValue([]) });
  return {
    useOpportunities: () => noopService,
    useQuestionsService: () => mocks.questionsService,
    useNetworks: () => noopService,
  };
});

vi.mock('@/services/v2/upload.service', () => ({
  useUploadServiceV2: () => new Proxy({}, { get: () => vi.fn().mockResolvedValue([]) }),
}));

vi.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => mocks.notifications,
}));

vi.mock('@/contexts/IndexFilterContext', () => ({
  useNetworkFilter: () => ({ selectedNetworkIds: [], setSelectedNetworkIds: vi.fn() }),
}));

vi.mock('@/contexts/IndexesContext', () => ({
  useNetworksState: () => ({ indexes: [], refreshIndexes: vi.fn(), addIndex: vi.fn() }),
}));

vi.mock('@/hooks/useGmailConnect', () => ({
  useGmailConnect: () => ({ OAuthLink: () => null }),
}));

vi.mock('@/hooks/useSuggestions', () => ({
  useSuggestions: () => ({ suggestions: [] }),
}));

vi.mock('@/hooks/useOpportunityActions', () => ({
  useOpportunityActions: () => ({
    opportunityStatusMap: {},
    setOpportunityStatusMap: vi.fn(),
    opportunityActionLoading: {},
    handleOpportunityAction: vi.fn(),
    handleStreamingDraftStartChat: vi.fn(),
    inviteModalElement: null,
  }),
}));

vi.mock('@/components/InjectedQuestions/InjectedQuestions', () => ({
  InjectedQuestions: ({ questions }: { questions: PendingQuestion[] }) => (
    <div data-testid="injected-questions">
      {questions.map((q) => (
        <div key={q.id}>{q.payload?.title ?? q.id}</div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/chat/AssistantMessageContent', () => ({
  default: ({
    content,
    onIntentProposalApprove,
  }: {
    content: string;
    onIntentProposalApprove?: (proposalId: string, description: string) => Promise<void>;
  }) => (
    <div>
      {content}
      {onIntentProposalApprove && (
        <button
          type="button"
          onClick={() => {
            void onIntentProposalApprove('proposal-1', 'Build a climate founders circle').catch(() => {});
          }}
        >
          approve proposal
        </button>
      )}
    </div>
  ),
  parseAllBlocks: () => [],
}));

vi.mock('@/components/chat/ToolCallsDisplay', () => ({ ToolCallsDisplay: () => null }));
vi.mock('@/components/chat/InlineDiscoveryCard', () => ({ default: () => null }));
vi.mock('@/components/chat/OpportunityCardInChat', () => ({
  default: () => null,
  OpportunitySkeleton: () => null,
}));
vi.mock('@/components/chat/SuggestionChips', () => ({ SuggestionChips: () => null }));
vi.mock('@/components/DecisionQuestions', () => ({ DecisionQuestions: () => null }));
vi.mock('@/components/IntentList', () => ({ default: () => null }));
vi.mock('@/components/DebugCopyButton', () => ({ DebugCopyButton: () => null }));
vi.mock('@/components/MentionsInput', () => ({
  MentionsTextInput: ({
    value,
    onChange,
    inputRef,
  }: {
    value: string;
    onChange: (value: string) => void;
    inputRef?: Ref<HTMLInputElement>;
  }) => (
    <input
      ref={inputRef}
      data-testid="chat-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock('remark-gfm', () => ({ default: () => null }));

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

const INBOX_QUESTION = {
  id: 'q-inbox-1',
  detection: { mode: 'negotiation', sourceType: 'opportunity', sourceId: 'opp-1' },
  actors: [],
  payload: {
    title: 'Timeline check',
    prompt: 'When could you start?',
    options: [],
    multiSelect: false,
  },
  status: 'pending',
  answer: null,
  expiresAt: null,
  createdAt: new Date().toISOString(),
  conversationId: null,
} as unknown as PendingQuestion;

describe('Negotiator DM question inbox (IND-404)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat.messages = [];
    mocks.chat.sessionId = 'dm-session-1';
    mocks.chat.sessionPersona = null;
    mocks.chat.turnBlock = null;
    mocks.chat.chatScope = null;
    mocks.auth.features.signalAgent = false;
    mocks.chat.sendMessage.mockResolvedValue(undefined);
    mocks.questionsService.getByConversation.mockResolvedValue([]);
    mocks.questionsService.getPending.mockResolvedValue([INBOX_QUESTION]);
    mocks.apiClient.post.mockResolvedValue({ intents: [] });
  });

  test('negotiator DM fetches the full inbox and renders it as question cards', async () => {
    mocks.chat.sessionPersona = 'negotiator';

    renderWithRouter(<ChatContent sessionIdParam="dm-session-1" />);

    await waitFor(() =>
      expect(mocks.questionsService.getPending).toHaveBeenCalledWith({
        noConversation: true,
        excludeModes: ['pool_discovery'],
      })
    );
    await screen.findByText('Timeline check');
    expect(screen.getByTestId('negotiator-question-inbox')).toBeInTheDocument();
    expect(screen.getByText('Open questions for you')).toBeInTheDocument();
  });

  test('orchestrator sessions do not fetch the global inbox', async () => {
    mocks.chat.sessionPersona = 'orchestrator';

    renderWithRouter(<ChatContent sessionIdParam="dm-session-1" />);

    await waitFor(() =>
      expect(mocks.questionsService.getByConversation).toHaveBeenCalledWith('dm-session-1')
    );
    expect(mocks.questionsService.getPending).not.toHaveBeenCalled();
    expect(screen.queryByTestId('negotiator-question-inbox')).toBeNull();
  });

  test('intent-pinned negotiator sessions keep the intent-scope query (no global inbox)', async () => {
    mocks.chat.sessionPersona = 'negotiator';
    mocks.chat.chatScope = { type: 'intent', id: 'intent-42' };

    renderWithRouter(<ChatContent sessionIdParam="dm-session-1" />);

    await waitFor(() =>
      expect(mocks.questionsService.getPending).toHaveBeenCalledWith({ scopeType: 'intent', scopeId: 'intent-42' })
    );
    expect(mocks.questionsService.getPending).not.toHaveBeenCalledWith({ noConversation: true });
    expect(screen.queryByTestId('negotiator-question-inbox')).toBeNull();
  });
});

describe('Signal Agent web cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat.messages = [];
    mocks.chat.sessionId = null;
    mocks.chat.sessionPersona = null;
    mocks.chat.turnBlock = null;
    mocks.chat.chatScope = null;
    mocks.chat.isLoading = false;
    mocks.auth.features.signalAgent = false;
    mocks.chat.sendMessage.mockResolvedValue(undefined);
    mocks.questionsService.getByConversation.mockResolvedValue([]);
    mocks.questionsService.getPending.mockResolvedValue([]);
    mocks.apiClient.post.mockResolvedValue({ intents: [] });
    mocks.apiClient.patch.mockResolvedValue({});
  });

  test('flag-on home composer explicitly requests the Signal persona', async () => {
    mocks.auth.features.signalAgent = true;

    renderWithRouter(<ChatContent />, { route: '/' });
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Help me refine my climate signal' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(mocks.chat.sendMessage).toHaveBeenCalledWith(
      'Help me refine my climate signal',
      undefined,
      undefined,
      { surface: 'web', persona: 'signal' },
    ));
  });

  test('flag off preserves the existing ordinary web request', async () => {
    renderWithRouter(<ChatContent />, { route: '/' });
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Find collaborators' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(mocks.chat.sendMessage).toHaveBeenCalledWith(
      'Find collaborators',
      undefined,
      undefined,
      { surface: 'web' },
    ));
  });

  test('legacy orchestrator history remains visible with a separate Signal action', async () => {
    mocks.auth.features.signalAgent = true;
    mocks.chat.sessionId = 'legacy-session';
    mocks.chat.sessionPersona = 'orchestrator';
    mocks.chat.messages = [
      { id: 'm1', role: 'user', content: 'Old question', timestamp: new Date() },
      { id: 'm2', role: 'assistant', content: 'Old answer', timestamp: new Date() },
    ];

    renderWithRouter(
      <>
        <ChatContent sessionIdParam="legacy-session" />
        <LocationProbe />
      </>,
      { route: '/d/legacy-session' },
    );

    expect(screen.getByText('Old question')).toBeInTheDocument();
    expect(screen.getByText('Old answer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start a Signal Agent chat' }));

    expect(mocks.chat.startSignalSession).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/'));
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
  });

  test('proposal confirmation navigates to the exact returned intent and preserves undo', async () => {
    mocks.chat.sessionId = 'signal-session';
    mocks.chat.sessionPersona = 'signal';
    mocks.chat.messages = [
      { id: 'm1', role: 'assistant', content: 'Proposal ready', timestamp: new Date() },
    ];
    mocks.apiClient.post.mockImplementation((path: string) => {
      if (path === '/intents/confirm') {
        return Promise.resolve({ intentId: 'intent-returned-42' });
      }
      return Promise.resolve({});
    });

    renderWithRouter(
      <>
        <ChatContent sessionIdParam="signal-session" />
        <LocationProbe />
      </>,
      { route: '/d/signal-session' },
    );

    fireEvent.click(screen.getByRole('button', { name: 'approve proposal' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/i/intent-returned-42'));

    const notification = mocks.notifications.addNotification.mock.calls[0]?.[0] as {
      onAction: () => Promise<void>;
    };
    await notification.onAction();
    expect(mocks.apiClient.patch).toHaveBeenCalledWith('/intents/intent-returned-42/archive');
  });

  test('proposal confirmation failure does not navigate', async () => {
    mocks.chat.sessionId = 'signal-session';
    mocks.chat.sessionPersona = 'signal';
    mocks.chat.messages = [
      { id: 'm1', role: 'assistant', content: 'Proposal ready', timestamp: new Date() },
    ];
    mocks.apiClient.post.mockImplementation((path: string) =>
      path === '/intents/confirm'
        ? Promise.reject(new Error('confirmation failed'))
        : Promise.resolve({})
    );

    renderWithRouter(
      <>
        <ChatContent sessionIdParam="signal-session" />
        <LocationProbe />
      </>,
      { route: '/d/signal-session' },
    );

    fireEvent.click(screen.getByRole('button', { name: 'approve proposal' }));
    await waitFor(() => expect(mocks.apiClient.post).toHaveBeenCalledWith(
      '/intents/confirm',
      expect.objectContaining({ proposalId: 'proposal-1' }),
    ));
    expect(screen.getByTestId('location')).toHaveTextContent('/d/signal-session');
    expect(mocks.notifications.addNotification).not.toHaveBeenCalled();
  });
});
