/**
 * Negotiator DM question inbox (P4.3 / IND-404).
 *
 * ChatContent surfaces the client's full pending-question inbox
 * (GET /questions?status=pending&noConversation=true) when the loaded session
 * runs the negotiator persona without an intent pin. Orchestrator sessions
 * keep the existing behavior (conversation-linked questions only).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router';
import { useEffect, type ComponentType, type ReactNode, type Ref } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import ChatContent from '@/components/ChatContent';
import { AIChatProvider } from '@/contexts/AIChatContext';
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
    sendOnboardingMessage: vi.fn(),
    sendWebMessage: vi.fn(),
    clearChat: vi.fn(),
    startSignalSession: vi.fn(),
    loadSession: vi.fn().mockResolvedValue(false),
    sessionLoadState: { status: 'idle', targetSessionId: null, error: null } as {
      status: 'idle' | 'loading' | 'ready' | 'error';
      targetSessionId: string | null;
      error: string | null;
    },
    isSessionReady: vi.fn(),
    sessionId: null as string | null,
    sessionTitle: null as string | null,
    sessionPersona: null as string | null,
    turnBlock: null as null | {
      code: string;
      message: string;
      action?: { type: 'start_signal_session'; href: '/' };
    },
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
    gmailOnConnected: null as null | (() => void),
    assistantCallbacks: {} as {
      approve?: (proposalId: string, description: string) => unknown;
      reject?: (proposalId: string) => unknown;
      undo?: (proposalId: string) => unknown;
      networkJoin?: (networkId: string, title: string) => unknown;
      opportunityAccept?: (opportunityId: string, userId: string) => unknown;
      opportunityReject?: (opportunityId: string, userId: string) => unknown;
      agentActionResolve?: (proposalId: string) => unknown;
      agentActionConfirm?: (proposalId: string) => unknown;
    },
    proposalStatuses: {} as Record<string, string>,
    injectedCallbacks: {} as {
      answer?: (questionId: string, body: { selectedOptions: string[] }) => unknown;
      dismiss?: (questionId: string) => unknown;
    },
    decisionSubmit: undefined as undefined | ((answer: string) => void),
    streamingDraftStart: undefined as undefined | ((opportunityId: string, userId: string) => unknown),
    opportunityAction: vi.fn(),
    streamingDraftHandler: vi.fn(),
  };
});

vi.mock('@/lib/api', () => ({
  apiClient: mocks.apiClient,
  useAuthenticatedAPI: () => mocks.apiClient,
}));

vi.mock('@/contexts/AIChatSessionsContext', () => ({ useAIChatSessions: () => ({ refetchSessions: vi.fn() }) }));

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
  useGmailConnect: (onConnected: () => void) => {
    mocks.gmailOnConnected = onConnected;
    return {
      OAuthLink: ({ children }: { children?: ReactNode }) => (
        <button type="button" onClick={onConnected}>gmail continuation{String(children ?? '')}</button>
      ),
    };
  },
}));

vi.mock('@/hooks/useSuggestions', () => ({
  useSuggestions: () => ({ suggestions: [] }),
}));

vi.mock('@/hooks/useOpportunityActions', () => ({
  useOpportunityActions: () => ({
    opportunityStatusMap: {},
    setOpportunityStatusMap: vi.fn(),
    opportunityActionLoading: {},
    handleOpportunityAction: mocks.opportunityAction,
    handleStreamingDraftStartChat: mocks.streamingDraftHandler,
    inviteModalElement: null,
  }),
}));

vi.mock('@/components/InjectedQuestions/InjectedQuestions', () => ({
  InjectedQuestions: ({
    questions,
    onAnswer,
    onDismiss,
    readOnly,
  }: {
    questions: PendingQuestion[];
    onAnswer: (questionId: string, body: { selectedOptions: string[] }) => unknown;
    onDismiss: (questionId: string) => unknown;
    readOnly?: boolean;
  }) => {
    mocks.injectedCallbacks = { answer: onAnswer, dismiss: onDismiss };
    return (
      <div data-testid="injected-questions">
        {questions.map((q) => (
          <div key={q.id}>
            {q.payload?.title ?? q.id}
            {!readOnly && (
              <>
                <button type="button" onClick={() => void onAnswer(q.id, { selectedOptions: ['Yes'] })}>answer injected</button>
                <button type="button" onClick={() => void onDismiss(q.id)}>dismiss injected</button>
              </>
            )}
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock('@/components/chat/ToolCallsDisplay', () => ({ ToolCallsDisplay: () => null }));
vi.mock('@/components/chat/SuggestionChips', () => ({ SuggestionChips: () => null }));
vi.mock('@/components/DecisionQuestions', () => ({
  DecisionQuestions: ({ onSubmit, readOnly }: { onSubmit: (answer: string) => void; readOnly?: boolean }) => {
    mocks.decisionSubmit = onSubmit;
    return readOnly ? <div>decision read only</div> : <button type="button" onClick={() => onSubmit('Decision answer')}>submit decision</button>;
  },
}));
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

function RoutedChatContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const sessionId = location.pathname.startsWith('/d/')
    ? location.pathname.slice('/d/'.length)
    : null;
  return (
    <>
      <ChatContent sessionIdParam={sessionId} />
      <button type="button" onClick={() => navigate('/d/session-a')}>switch to session A</button>
      <button type="button" onClick={() => navigate('/d/session-b')}>switch to session B</button>
      <LocationProbe />
    </>
  );
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


describe('persisted opportunity history hydration', () => {
  beforeEach(() => {
    mocks.apiClient.get.mockReset();
    mocks.apiClient.post.mockReset();
    mocks.apiClient.post.mockResolvedValue({});
    mocks.questionsService.getPending.mockResolvedValue([]);
  });

  test('has no live draft-ready event in stream contracts while retaining historical draft hydration', () => {
    const root = resolve(process.cwd(), '../..');
    const streamContractFiles = [
      'packages/protocol/src/chat/chat.agent.ts',
      'packages/protocol/src/chat/chat-streaming.types.ts',
      'packages/protocol/src/shared/observability/request-context.ts',
      'packages/protocol/src/mcp/mcp.server.ts',
      'services/api/src/types/chat-streaming.types.ts',
      'services/api/src/controllers/mcp.controller.ts',
      'apps/web/src/contexts/AIChatContext.tsx',
      'apps/web/src/components/ChatContent.tsx',
      'apps/web/src/components/chat/ToolCallsDisplay.tsx',
    ];

    for (const file of streamContractFiles) {
      expect(readFileSync(resolve(root, file), 'utf8')).not.toContain('opportunity_draft_ready');
    }
  });

  test('hydrates API discoveries and drafts through AIChatProvider into ChatContent without direct discovery', async () => {
    const sessionResponse = {
      session: { id: 'history-session', title: 'History', persona: 'signal' },
      sessionId: 'history-session', hasPreviousSession: false, previousSessionCursor: null,
      messages: [{ id: 'history-message', role: 'assistant', content: 'Stored cards', createdAt: '2026-01-01T00:00:00Z',
        discoveries: [{ candidateId: 'legacy-user', candidateName: 'Legacy Ada', score: 91, sourceDescription: 'Stored legacy opportunity' }],
        streamingDrafts: [{ opportunityId: 'draft-1', opportunity: { id: 'draft-1', status: 'pending', interpretation: { reasoning: 'Stored draft opportunity' } }, counterparty: { userId: 'draft-user', name: 'Draft Grace' }, receivedAt: 0 }],
      }],
    };
    mocks.apiClient.post.mockImplementation(async (path: string) => {
      if (path === '/chat/web/session') return sessionResponse;
      return {};
    });
    renderWithRouter(<AIChatProvider><ChatContent sessionIdParam="history-session" /></AIChatProvider>);
    await waitFor(() => expect(mocks.apiClient.post).toHaveBeenCalledWith('/chat/web/session', { sessionId: 'history-session' }));
    await waitFor(() => expect(screen.getByText('Legacy Ada')).toBeInTheDocument());
    expect(screen.getByText('Stored legacy opportunity')).toBeInTheDocument();
    expect(screen.getByText('Draft Grace')).toBeInTheDocument();
    expect(screen.getByText('Stored draft opportunity')).toBeInTheDocument();
    expect(mocks.apiClient.post.mock.calls.map(([path]: [string]) => path)).not.toContain('/opportunities/discover');
    expect(mocks.apiClient.post.mock.calls.map(([path]: [string]) => path)).not.toContain('/tools/discover_opportunities');
  });
});
