/**
 * Negotiator DM question inbox (P4.3 / IND-404).
 *
 * ChatContent surfaces the client's full pending-question inbox
 * (GET /questions?status=pending&noConversation=true) when the loaded session
 * runs the negotiator persona without an intent pin. Orchestrator sessions
 * keep the existing behavior (conversation-linked questions only).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { useEffect, type ComponentType, type ReactNode, type Ref } from 'react';
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
    },
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

vi.mock('@/components/chat/AssistantMessageContent', () => ({
  default: ({
    content,
    onIntentProposalApprove,
    onIntentProposalReject,
    onIntentProposalUndo,
    onOpportunityPrimaryAction,
    onOpportunitySecondaryAction,
    onNetworkJoin,
    OAuthLink,
  }: {
    content: string;
    onIntentProposalApprove?: (proposalId: string, description: string) => Promise<void> | void;
    onIntentProposalReject?: (proposalId: string) => Promise<void> | void;
    onIntentProposalUndo?: (proposalId: string) => Promise<void> | void;
    onOpportunityPrimaryAction?: (opportunityId: string, userId: string) => unknown;
    onOpportunitySecondaryAction?: (opportunityId: string, userId: string) => unknown;
    onNetworkJoin?: (networkId: string, title: string) => unknown;
    OAuthLink?: ComponentType<{ children?: ReactNode }>;
  }) => {
    mocks.assistantCallbacks = {
      approve: onIntentProposalApprove,
      reject: onIntentProposalReject,
      undo: onIntentProposalUndo,
      networkJoin: onNetworkJoin,
      opportunityAccept: onOpportunityPrimaryAction,
      opportunityReject: onOpportunitySecondaryAction,
    };
    useEffect(() => {
      if (!content.includes('Auto proposal') || !onIntentProposalApprove) return;
      const timer = setTimeout(() => {
        void onIntentProposalApprove('proposal-auto', 'Auto proposal description');
      }, 5000);
      return () => clearTimeout(timer);
    }, [content, onIntentProposalApprove]);
    const GmailLink = OAuthLink;
    return (
      <div>
        {content}
        {onIntentProposalApprove && (
          <button type="button" onClick={() => {
            void Promise.resolve(onIntentProposalApprove('proposal-1', 'Build a climate founders circle')).catch(() => {});
          }}>
            approve proposal
          </button>
        )}
        {onIntentProposalReject && <button type="button" onClick={() => void onIntentProposalReject('proposal-1')}>reject proposal</button>}
        {onIntentProposalUndo && <button type="button" onClick={() => void onIntentProposalUndo('proposal-1')}>undo proposal</button>}
        {onOpportunityPrimaryAction && <button type="button" onClick={() => void onOpportunityPrimaryAction('opp-1', 'user-1')}>accept opportunity</button>}
        {onOpportunitySecondaryAction && <button type="button" onClick={() => void onOpportunitySecondaryAction('opp-1', 'user-1')}>reject opportunity</button>}
        {onNetworkJoin && <button type="button" onClick={() => void onNetworkJoin('network-1', 'Climate Network')}>join network</button>}
        {GmailLink && <GmailLink>Connect</GmailLink>}
      </div>
    );
  },
  parseAllBlocks: () => [],
}));

vi.mock('@/components/chat/ToolCallsDisplay', () => ({ ToolCallsDisplay: () => null }));
vi.mock('@/components/chat/InlineDiscoveryCard', () => ({ default: () => null }));
vi.mock('@/components/chat/OpportunityCardInChat', () => ({
  default: ({ onPrimaryAction }: { onPrimaryAction?: (opportunityId: string, userId: string) => unknown }) => {
    mocks.streamingDraftStart = onPrimaryAction;
    return onPrimaryAction
      ? <button type="button" onClick={() => void onPrimaryAction('opp-draft', 'user-draft')}>start streaming draft chat</button>
      : <div>streaming draft read only</div>;
  },
  OpportunitySkeleton: () => null,
}));
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
    mocks.chat.sessionLoadState = { status: 'ready', targetSessionId: 'dm-session-1', error: null };
    mocks.chat.isSessionReady.mockImplementation((id: string) => (
      mocks.chat.sessionLoadState.status === 'ready'
      && mocks.chat.sessionLoadState.targetSessionId === id
      && mocks.chat.sessionId === id
    ));
    mocks.chat.sessionPersona = null;
    mocks.chat.turnBlock = null;
    mocks.chat.chatScope = null;
    mocks.auth.features.signalAgent = false;
    mocks.chat.sendMessage.mockResolvedValue(undefined);
    mocks.chat.sendWebMessage.mockResolvedValue(undefined);
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
    expect(screen.getByTestId('negotiator-question-inbox')).not.toBeNull();
    expect(screen.getByText('Open questions for you')).not.toBeNull();
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
    mocks.chat.sessionLoadState = { status: 'idle', targetSessionId: null, error: null };
    mocks.chat.isSessionReady.mockImplementation((id: string) => (
      mocks.chat.sessionLoadState.status === 'ready'
      && mocks.chat.sessionLoadState.targetSessionId === id
      && mocks.chat.sessionId === id
    ));
    mocks.chat.sessionPersona = null;
    mocks.chat.turnBlock = null;
    mocks.chat.chatScope = null;
    mocks.chat.isLoading = false;
    mocks.auth.features.signalAgent = false;
    mocks.chat.sendMessage.mockResolvedValue(undefined);
    mocks.chat.sendWebMessage.mockResolvedValue(undefined);
    mocks.gmailOnConnected = null;
    mocks.assistantCallbacks = {};
    mocks.injectedCallbacks = {};
    mocks.decisionSubmit = undefined;
    mocks.streamingDraftStart = undefined;
    mocks.opportunityAction.mockResolvedValue(undefined);
    mocks.streamingDraftHandler.mockResolvedValue(undefined);
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

    await waitFor(() => expect(mocks.chat.sendWebMessage).toHaveBeenCalledWith(
      'Help me refine my climate signal',
      undefined,
      undefined,
      { persona: 'signal' },
    ));
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
  });

  test('flag off preserves the existing ordinary web request', async () => {
    renderWithRouter(<ChatContent />, { route: '/' });
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Find collaborators' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(mocks.chat.sendWebMessage).toHaveBeenCalledWith(
      'Find collaborators',
      undefined,
      undefined,
      undefined,
    ));
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
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

    expect(screen.getByText('Old question')).not.toBeNull();
    expect(screen.getByText('Old answer')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start a Signal Agent chat' }));

    expect(mocks.chat.startSignalSession).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
    expect(mocks.chat.sendWebMessage).not.toHaveBeenCalled();
  });

  test('proposal confirmation navigates to the exact returned intent and successful undo returns to the originating chat', async () => {
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
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/i/intent-returned-42'));

    const notification = mocks.notifications.addNotification.mock.calls[0]?.[0] as {
      onAction: () => Promise<void>;
    };
    await act(async () => notification.onAction());
    expect(mocks.apiClient.patch).toHaveBeenCalledWith('/intents/intent-returned-42/archive');
    expect(screen.getByTestId('location').textContent).toBe('/d/signal-session');
  });

  test('undo failure stays on intent detail, reports the error, and the same action can retry', async () => {
    mocks.chat.sessionId = 'signal-session';
    mocks.chat.sessionPersona = 'signal';
    mocks.chat.messages = [
      { id: 'm1', role: 'assistant', content: 'Proposal ready', timestamp: new Date() },
    ];
    mocks.apiClient.post.mockImplementation((path: string) => path === '/intents/confirm'
      ? Promise.resolve({ intentId: 'intent-returned-42' })
      : Promise.resolve({}));
    mocks.apiClient.patch.mockRejectedValueOnce(new Error('archive unavailable'));

    renderWithRouter(
      <>
        <ChatContent sessionIdParam="signal-session" />
        <LocationProbe />
      </>,
      { route: '/d/signal-session' },
    );

    fireEvent.click(screen.getByRole('button', { name: 'approve proposal' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/i/intent-returned-42'));
    const notification = mocks.notifications.addNotification.mock.calls[0]?.[0] as { onAction: () => Promise<void> };

    await expect(notification.onAction()).rejects.toThrow('archive unavailable');
    expect(screen.getByTestId('location').textContent).toBe('/i/intent-returned-42');
    expect(mocks.notifications.error).toHaveBeenCalledWith('Failed to undo signal', 'archive unavailable');

    mocks.apiClient.patch.mockResolvedValueOnce({});
    await act(async () => notification.onAction());
    expect(mocks.apiClient.patch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('location').textContent).toBe('/d/signal-session');
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
    expect(screen.getByTestId('location').textContent).toBe('/d/signal-session');
    expect(mocks.notifications.addNotification).not.toHaveBeenCalled();
  });

  test('Gmail continuation uses the dedicated web transport', async () => {
    mocks.chat.sessionId = 'signal-session';
    mocks.chat.sessionPersona = 'signal';
    mocks.chat.messages = [{ id: 'm1', role: 'assistant', content: 'Connect Gmail', timestamp: new Date() }];

    renderWithRouter(<ChatContent sessionIdParam="signal-session" />, { route: '/d/signal-session' });
    fireEvent.click(screen.getByRole('button', { name: /gmail continuation/i }));

    await waitFor(() => expect(mocks.chat.sendWebMessage).toHaveBeenCalledWith(
      "I've connected my account, please continue with the import.",
      undefined,
      undefined,
      { hidden: true },
    ));
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
  });

  test('network join follow-up uses the dedicated web transport', async () => {
    mocks.chat.sessionId = 'signal-session';
    mocks.chat.messages = [{ id: 'm1', role: 'assistant', content: 'Networks', timestamp: new Date() }];

    renderWithRouter(<ChatContent sessionIdParam="signal-session" />, { route: '/d/signal-session' });
    fireEvent.click(screen.getByRole('button', { name: 'join network' }));

    await waitFor(() => expect(mocks.chat.sendWebMessage).toHaveBeenCalledWith("I'd like to join Climate Network"));
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
  });

  test('late injected-question answer uses the dedicated web transport', async () => {
    const chatQuestion = {
      ...INBOX_QUESTION,
      id: 'q-chat',
      detection: { mode: 'chat', messageId: null },
      payload: { ...INBOX_QUESTION.payload, title: 'Late chat question', prompt: 'Which direction?' },
    } as unknown as PendingQuestion;
    mocks.chat.sessionId = 'signal-session';
    mocks.chat.messages = [{ id: 'm1', role: 'assistant', content: 'Question', timestamp: new Date() }];
    mocks.questionsService.getByConversation.mockResolvedValue([chatQuestion]);
    mocks.questionsService.answer.mockResolvedValue({ resumed: false });

    renderWithRouter(<ChatContent sessionIdParam="signal-session" />, { route: '/d/signal-session' });
    await screen.findByText('Late chat question');
    fireEvent.click(screen.getByRole('button', { name: 'answer injected' }));

    await waitFor(() => expect(mocks.chat.sendWebMessage).toHaveBeenCalledWith('Re: "Which direction?" — Yes'));
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
  });

  test('decision answer uses the dedicated web transport', async () => {
    mocks.chat.sessionId = 'signal-session';
    mocks.chat.messages = [{
      id: 'm1',
      role: 'assistant',
      content: 'Decision',
      timestamp: new Date(),
      decisionQuestions: [{ title: 'Choose', question: 'Choose one', options: ['A'] }],
    }];

    renderWithRouter(<ChatContent sessionIdParam="signal-session" />, { route: '/d/signal-session' });
    fireEvent.click(screen.getByRole('button', { name: 'submit decision' }));

    await waitFor(() => expect(mocks.chat.sendWebMessage).toHaveBeenCalledWith('Decision answer'));
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
  });

  test('mid-stream composer preserves the provider-owned web transport', async () => {
    mocks.chat.sessionId = 'signal-session';
    mocks.chat.isLoading = true;
    mocks.chat.messages = [{
      id: 'm1',
      role: 'assistant',
      content: 'Streaming',
      timestamp: new Date(),
      isStreaming: true,
      traceEvents: [{ type: 'graph_start' }],
    }];

    renderWithRouter(<ChatContent sessionIdParam="signal-session" />, { route: '/d/signal-session' });
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Steer this turn' } });
    fireEvent.submit(input.closest('form')!);

    expect(mocks.chat.submitMidStreamMessage).toHaveBeenCalledWith(
      'Steer this turn',
      [{ type: 'graph_start' }],
      undefined,
      undefined,
    );
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
  });

  test('streaming-draft start-chat stays available only on mutable sessions', async () => {
    mocks.chat.sessionId = 'signal-session';
    mocks.chat.messages = [{
      id: 'm1',
      role: 'assistant',
      content: 'Draft',
      timestamp: new Date(),
      streamingDrafts: [{
        opportunityId: 'opp-draft',
        counterparty: { userId: 'user-draft', name: 'Taylor' },
        opportunity: { status: 'draft' },
        personalizedSummary: 'A useful connection',
      }],
    }];

    renderWithRouter(<ChatContent sessionIdParam="signal-session" />, { route: '/d/signal-session' });
    fireEvent.click(screen.getByRole('button', { name: 'start streaming draft chat' }));
    expect(mocks.streamingDraftHandler).toHaveBeenCalledWith('opp-draft', 'user-draft');
  });

  test('legacy history omits controls and stale callbacks cause zero mutation side effects, including auto-approve', async () => {
    vi.useFakeTimers();
    try {
      mocks.auth.features.signalAgent = true;
      mocks.chat.sessionId = 'legacy-session';
      mocks.chat.sessionPersona = 'signal';
      mocks.chat.liveQuestions = [{ ...INBOX_QUESTION, id: 'q-live' }];
      mocks.chat.messages = [{
        id: 'm1',
        role: 'assistant',
        content: 'Auto proposal controls',
        timestamp: new Date(),
        decisionQuestions: [{ title: 'Choose', question: 'Choose one', options: ['A'] }],
        streamingDrafts: [{
          opportunityId: 'opp-draft',
          counterparty: { userId: 'user-draft', name: 'Taylor' },
          opportunity: { status: 'draft' },
        }],
      }];

      const view = renderWithRouter(<ChatContent sessionIdParam="legacy-session" />, { route: '/d/legacy-session' });
      const staleAssistant = { ...mocks.assistantCallbacks };
      const staleInjected = { ...mocks.injectedCallbacks };
      const staleDecision = mocks.decisionSubmit;
      const staleStreaming = mocks.streamingDraftStart;
      const staleGmail = mocks.gmailOnConnected;

      mocks.chat.sessionPersona = 'orchestrator';
      view.rerender(<ChatContent sessionIdParam="legacy-session" />);

      expect(screen.queryByRole('button', { name: 'approve proposal' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'reject proposal' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'accept opportunity' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'join network' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'submit decision' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'answer injected' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'start streaming draft chat' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Rename conversation' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Share conversation' })).toBeNull();
      expect((screen.getByRole('button', { name: 'Untitled chat' }) as HTMLButtonElement).disabled).toBe(true);

      await act(async () => {
        await staleAssistant.approve?.('proposal-stale', 'Stale proposal');
        await staleAssistant.reject?.('proposal-stale');
        await staleAssistant.undo?.('proposal-stale');
        await staleAssistant.networkJoin?.('network-stale', 'Stale Network');
        await staleAssistant.opportunityAccept?.('opp-stale', 'user-stale');
        await staleAssistant.opportunityReject?.('opp-stale', 'user-stale');
        await staleInjected.answer?.('q-live', { selectedOptions: ['Yes'] });
        await staleInjected.dismiss?.('q-live');
        staleDecision?.('Stale decision');
        await staleStreaming?.('opp-stale', 'user-stale');
        staleGmail?.();
        await vi.advanceTimersByTimeAsync(6000);
      });

      const mutationPaths = mocks.apiClient.post.mock.calls
        .map(([path]) => path)
        .filter((path) => ['/intents/confirm', '/intents/reject', '/chat/session/share'].includes(path));
      expect(mutationPaths).toEqual([]);
      expect(mocks.apiClient.patch).not.toHaveBeenCalled();
      expect(mocks.questionsService.answer).not.toHaveBeenCalled();
      expect(mocks.questionsService.dismiss).not.toHaveBeenCalled();
      expect(mocks.streamingDraftHandler).not.toHaveBeenCalled();
      expect(mocks.opportunityAction).not.toHaveBeenCalled();
      expect(mocks.chat.sendWebMessage).not.toHaveBeenCalled();
      expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test('root typed refusal remains visible and offers only a generic safe new-chat action', () => {
    mocks.chat.turnBlock = { code: 'CHAT_PERSONA_MISMATCH', message: 'This request does not match the chat that was opened.' };

    renderWithRouter(<ChatContent />, { route: '/' });

    expect(screen.getByText('This request does not match the chat that was opened.')).not.toBeNull();
    expect(screen.queryByTestId('chat-input')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a Signal Agent chat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));
    expect(mocks.chat.clearChat).toHaveBeenCalled();
    expect(mocks.chat.startSignalSession).not.toHaveBeenCalled();
  });

  test('root safe continuation starts a fresh Signal session without trusting a server href', () => {
    mocks.chat.turnBlock = {
      code: 'LEGACY_WEB_SESSION_READ_ONLY',
      message: 'This earlier chat is read-only.',
      action: { type: 'start_signal_session', href: '/' },
    };

    renderWithRouter(<ChatContent />, { route: '/' });
    fireEvent.click(screen.getByRole('button', { name: 'Start a Signal Agent chat' }));
    expect(mocks.chat.startSignalSession).toHaveBeenCalled();
  });

  test('A-to-B transition quarantines A, blocks submit, and ignores stale A readiness before B resolves', async () => {
    mocks.chat.sessionId = 'session-a';
    mocks.chat.sessionLoadState = { status: 'ready', targetSessionId: 'session-a', error: null };
    mocks.chat.messages = [{ id: 'a1', role: 'assistant', content: 'Session A content', timestamp: new Date() }];

    const view = renderWithRouter(<ChatContent sessionIdParam="session-a" />, { route: '/d/session-a' });
    expect(screen.getByText('Session A content')).not.toBeNull();

    view.rerender(<ChatContent sessionIdParam="session-b" />);
    expect(screen.getByLabelText('Loading chat session-b')).not.toBeNull();
    expect(screen.queryByText('Session A content')).toBeNull();
    expect(screen.queryByTestId('chat-input')).toBeNull();
    expect(mocks.chat.sendWebMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.chat.loadSession).toHaveBeenCalledWith('session-b'));

    mocks.chat.sessionLoadState = { status: 'ready', targetSessionId: 'session-a', error: null };
    view.rerender(<ChatContent sessionIdParam="session-b" />);
    expect(screen.getByLabelText('Loading chat session-b')).not.toBeNull();
    expect(screen.queryByText('Session A content')).toBeNull();

    mocks.chat.sessionId = 'session-b';
    mocks.chat.sessionLoadState = { status: 'ready', targetSessionId: 'session-b', error: null };
    mocks.chat.messages = [{ id: 'b1', role: 'assistant', content: 'Session B content', timestamp: new Date() }];
    view.rerender(<ChatContent sessionIdParam="session-b" />);
    expect(screen.getByText('Session B content')).not.toBeNull();
    expect(screen.queryByText('Session A content')).toBeNull();
  });

  test('B load failure clears A and renders retry/back recovery without interactions', async () => {
    mocks.chat.sessionId = 'session-a';
    mocks.chat.sessionLoadState = { status: 'ready', targetSessionId: 'session-a', error: null };
    mocks.chat.messages = [{ id: 'a1', role: 'assistant', content: 'Session A content', timestamp: new Date() }];

    const view = renderWithRouter(
      <>
        <ChatContent sessionIdParam="session-b" />
        <LocationProbe />
      </>,
      { route: '/d/session-b' },
    );
    expect(screen.queryByText('Session A content')).toBeNull();

    mocks.chat.sessionId = null;
    mocks.chat.messages = [];
    mocks.chat.sessionLoadState = { status: 'error', targetSessionId: 'session-b', error: 'Could not load this chat. Please try again.' };
    view.rerender(
      <>
        <ChatContent sessionIdParam="session-b" />
        <LocationProbe />
      </>,
    );

    expect(screen.getByRole('heading', { name: 'Could not load this chat' })).not.toBeNull();
    expect(screen.queryByText('Session A content')).toBeNull();
    expect(screen.queryByTestId('chat-input')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.chat.loadSession).toHaveBeenLastCalledWith('session-b');
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(mocks.chat.clearChat).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  });
});
