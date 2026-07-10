/**
 * Negotiator DM question inbox (P4.3 / IND-404).
 *
 * ChatContent surfaces the client's full pending-question inbox
 * (GET /questions?status=pending&noConversation=true) when the loaded session
 * runs the negotiator persona without an intent pin. Orchestrator sessions
 * keep the existing behavior (conversation-linked questions only).
 */
import { screen, waitFor } from '@testing-library/react';
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
    loadSession: vi.fn().mockResolvedValue(undefined),
    sessionId: null as string | null,
    sessionTitle: null as string | null,
    sessionPersona: null as string | null,
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
  useNotifications: () => ({ success: vi.fn(), error: vi.fn(), addNotification: vi.fn() }),
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
  default: ({ content }: { content: string }) => <div>{content}</div>,
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
  MentionsTextInput: () => <textarea data-testid="chat-input" />,
}));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock('remark-gfm', () => ({ default: () => null }));

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
    mocks.chat.sessionId = 'dm-session-1';
    mocks.chat.sessionPersona = null;
    mocks.chat.chatScope = null;
    mocks.questionsService.getByConversation.mockResolvedValue([]);
    mocks.questionsService.getPending.mockResolvedValue([INBOX_QUESTION]);
    mocks.apiClient.post.mockResolvedValue({ intents: [] });
  });

  test('negotiator DM fetches the full inbox and renders it as question cards', async () => {
    mocks.chat.sessionPersona = 'negotiator';

    renderWithRouter(<ChatContent sessionIdParam="dm-session-1" />);

    await waitFor(() =>
      expect(mocks.questionsService.getPending).toHaveBeenCalledWith({ noConversation: true })
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
