/**
 * Intent page questions-block ⇄ negotiator-chat gating (P4.2 / IND-403).
 *
 * The chat window replaces the static questions block only when the
 * backend-surfaced flag (`features.negotiatorChat` on /auth/me) is on; the
 * fallback (flag off or runtime bootstrap failure) is the unchanged
 * questions block.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import IntentDetailPage from '@/app/i/[intentId]/page';
import { AnsweredQuestionLog } from '@/components/InjectedQuestions/AnsweredQuestionLog';
import type { AnsweredThreadEntry } from '@/components/InjectedQuestions/AnsweredQuestionLog';

const mocks = vi.hoisted(() => ({
  authState: {
    features: null as Record<string, unknown> | null,
  },
  questionsService: {
    getPending: vi.fn(),
    getAnswered: vi.fn(),
    answer: vi.fn(),
    dismiss: vi.fn(),
  },
  intentsService: {
    getIntent: vi.fn(),
    archiveIntent: vi.fn(),
    refineIntent: vi.fn(),
    visitIntent: vi.fn(),
  },
  opportunitiesService: {
    getHomeView: vi.fn(),
  },
  chatStubBehavior: { failBootstrap: false },
  questionRevision: 'revision-1',
}));

vi.mock('@/components/ClientLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/chat/OpportunityCardInChat', () => ({
  default: () => null,
  OpportunitySkeleton: () => null,
}));

vi.mock('@/components/InjectedQuestions/InjectedQuestions', () => ({
  InjectedQuestions: () => <div data-testid="injected-questions" />,
}));

vi.mock('@/components/IntentNegotiatorChat', () => ({
  default: ({
    answered = [],
    onAnswerQuestion,
    onUnavailable,
    questions = [],
  }: {
    answered?: AnsweredThreadEntry[];
    onAnswerQuestion: (questionId: string, body: { selectedOptions: string[]; freeText?: string }) => Promise<void>;
    onUnavailable: () => void;
    questions?: Array<{ id: string; payload: { prompt: string } }>;
  }) => {
    if (mocks.chatStubBehavior.failBootstrap) {
      // Simulate a runtime bootstrap failure (e.g. backend flag flipped off).
      setTimeout(onUnavailable, 0);
      return null;
    }
    return (
      <div data-testid="intent-negotiator-chat-stub">
        {answered.length > 0 && (
          <div data-testid="negotiator-answered-log">
            {answered.map((entry) => (
              <span
                key={entry.id}
                data-testid={`answered-entry-${entry.id}`}
                data-message-id={entry.messageId ?? ''}
                data-answered-at={entry.answeredAt ?? ''}
              />
            ))}
            <AnsweredQuestionLog entries={answered} />
          </div>
        )}
        {questions.map((question) => (
          <button
            key={question.id}
            type="button"
            onClick={() => void onAnswerQuestion(question.id, { selectedOptions: ['Berlin'] })}
          >
            answer-{question.id}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({
    isReady: true,
    isLoading: false,
    isAuthenticated: true,
    user: { id: 'user-1', name: 'Alice Smith' },
    features: mocks.authState.features,
    userLoading: false,
    error: null,
    refetchUser: vi.fn(),
    updateUser: vi.fn(),
    openLoginModal: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('@/contexts/APIContext', () => ({
  useIntents: () => mocks.intentsService,
  useOpportunities: () => mocks.opportunitiesService,
  useQuestionsService: () => mocks.questionsService,
}));


vi.mock('@/contexts/QuestionsContext', () => ({
  useQuestions: () => ({
    refresh: vi.fn(async () => {}),
    pendingRevision: mocks.questionRevision,
  }),
}));

vi.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({
    success: vi.fn(),
    error: vi.fn(),
    addNotification: vi.fn(),
  }),
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

function renderIntentPage() {
  return render(
    <MemoryRouter initialEntries={['/i/intent-1']}>
      <Routes>
        <Route path="/i/:intentId" element={<IntentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Intent page — negotiator chat gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.features = null;
    mocks.questionRevision = 'revision-1';
    mocks.intentsService.getIntent.mockResolvedValue({
      id: 'intent-1',
      payload: 'Looking for a technical co-founder',
      summary: 'Looking for a technical co-founder',
      createdAt: new Date().toISOString(),
    });
    mocks.intentsService.visitIntent.mockResolvedValue(undefined);
    mocks.opportunitiesService.getHomeView.mockResolvedValue({ sections: [] });
    mocks.questionsService.getPending.mockResolvedValue([
      {
        id: 'q-1',
        title: 'Which city?',
        prompt: 'Which city?',
        payload: {
          prompt: 'Which city?',
          title: 'Which city?',
          options: [],
          multiSelect: false,
        },
        options: [],
        multiSelect: false,
        mode: 'intent',
        sourceType: 'intent',
        sourceId: 'intent-1',
        createdAt: new Date().toISOString(),
      },
    ]);
    mocks.questionsService.getAnswered.mockResolvedValue([]);
    mocks.questionsService.answer.mockReset();
    mocks.chatStubBehavior.failBootstrap = false;
  });

  test('flag off → static questions block, no chat window', async () => {
    renderIntentPage();

    await screen.findByText('Looking for a technical co-founder');
    await screen.findByTestId('injected-questions');
    expect(screen.queryByTestId('intent-negotiator-chat-stub')).toBeNull();
    expect(screen.getByText(/^Questions \(/)).toBeInTheDocument();
  });

  test('flag on → chat window replaces the questions block', async () => {
    mocks.authState.features = { negotiatorChat: true };
    renderIntentPage();

    await screen.findByText('Looking for a technical co-founder');
    await screen.findByTestId('intent-negotiator-chat-stub');
    expect(screen.queryByTestId('injected-questions')).toBeNull();
    // The label now also appears on the mobile sheet trigger and the sr-only
    // dialog title, so assert presence rather than uniqueness.
    expect(screen.getAllByText(/^Personal Agent$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Questions \(/)).toBeNull();
  });

  test('hydrated answered entries render inside the negotiator branch', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mocks.questionsService.getAnswered.mockResolvedValue([{
      id: 'answered-1',
      detection: {
        mode: 'intent',
        sourceType: 'intent',
        sourceId: 'intent-1',
        timestamp: '2026-07-20T10:01:00Z',
        messageId: 'assistant-anchor-1',
      },
      createdAt: '2026-07-20T10:01:00Z',
      payload: {
        title: 'What kind of collaborator?',
        prompt: 'What kind of collaborator?',
        options: [],
        multiSelect: false,
      },
      answer: {
        selectedOptions: ['Technical founder'],
        freeText: 'in Europe',
        answeredBy: 'user-1',
        answeredAt: '2026-07-20T10:02:00Z',
      },
      status: 'answered',
    }]);
    renderIntentPage();

    await waitFor(() => expect(mocks.questionsService.getAnswered).toHaveBeenCalled());
    expect(await screen.findByTestId('negotiator-answered-log')).toBeInTheDocument();
    expect(screen.getByTestId('answered-entry-answered-1')).toHaveAttribute('data-message-id', 'assistant-anchor-1');
    expect(screen.getByText('What kind of collaborator?')).toBeInTheDocument();
    expect(screen.getByText('Technical founder, in Europe')).toBeInTheDocument();
  });

  test('answering a pending question keeps prior entries and appends the new answer', async () => {
    mocks.authState.features = { negotiatorChat: true };
    const prior = {
      id: 'answered-1',
      payload: {
        title: 'What kind of collaborator?',
        prompt: 'What kind of collaborator?',
        options: [],
        multiSelect: false,
      },
      answer: {
        selectedOptions: ['Technical founder'],
        answeredBy: 'user-1',
        answeredAt: new Date().toISOString(),
      },
      status: 'answered',
    };
    let answeredRows: Array<Record<string, unknown>> = [prior];
    mocks.questionsService.getAnswered.mockImplementation(async () => answeredRows);
    mocks.questionsService.answer.mockImplementation(async () => {
      answeredRows = [prior, {
        id: 'q-1',
        payload: { title: 'Which city?', prompt: 'Which city?', options: [], multiSelect: false },
        answer: { selectedOptions: ['Berlin'], answeredBy: 'user-1', answeredAt: new Date().toISOString() },
        status: 'answered',
      }];
      return { success: true };
    });
    renderIntentPage();

    expect(await screen.findByText('Technical founder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'answer-q-1' }));

    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());
    expect(screen.getByText('Technical founder')).toBeInTheDocument();
    expect(screen.getByTestId('answered-entry-q-1').getAttribute('data-answered-at')).not.toBe('');
    expect(mocks.questionsService.answer).toHaveBeenCalledWith('q-1', { selectedOptions: ['Berlin'] });
  });

  test('pending-set invalidation performs one passive exact-intent pending+answered refetch', async () => {
    const view = renderIntentPage();
    await waitFor(() => expect(mocks.questionsService.getPending).toHaveBeenCalledWith({
      scopeType: 'intent',
      scopeId: 'intent-1',
    }));
    mocks.questionsService.getPending.mockClear();
    mocks.questionsService.getAnswered.mockClear();

    mocks.questionRevision = 'revision-2';
    view.rerender(
      <MemoryRouter initialEntries={['/i/intent-1']}>
        <Routes><Route path="/i/:intentId" element={<IntentDetailPage />} /></Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.questionsService.getPending).toHaveBeenCalledTimes(1));
    expect(mocks.questionsService.getPending).toHaveBeenCalledWith({
      scopeType: 'intent',
      scopeId: 'intent-1',
      passive: true,
    });
    expect(mocks.questionsService.getAnswered).toHaveBeenCalledWith({
      scopeType: 'intent',
      scopeId: 'intent-1',
      passive: true,
    });
  });

  test('runtime bootstrap failure → falls back to the questions block', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mocks.chatStubBehavior.failBootstrap = true;
    renderIntentPage();

    await screen.findByText('Looking for a technical co-founder');
    await waitFor(() => expect(screen.queryByTestId('intent-negotiator-chat-stub')).toBeNull());
    await screen.findByTestId('injected-questions');
    expect(screen.getByText(/^Questions \(/)).toBeInTheDocument();
  });
});
