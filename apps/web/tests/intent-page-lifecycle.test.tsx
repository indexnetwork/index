import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import IntentDetailPage from '@/app/i/[intentId]/page';
import { createIntentsService } from '@/services/intents';
import { createQuestionsService } from '@/services/questions';

const mocks = vi.hoisted(() => {
  const intent: {
    id: string;
    payload: string;
    summary: string;
    status?: string | null;
    createdAt: string;
  } = {
    id: 'intent-1',
    payload: 'Find a climate-tech collaborator',
    summary: 'Find a climate-tech collaborator',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  };

  const getIntent = vi.fn();
  const setIntentStatus = vi.fn();
  const archiveIntent = vi.fn();
  const refineIntent = vi.fn();
  const getHomeView = vi.fn();
  const getNegotiationActivity = vi.fn();
  const getPending = vi.fn();
  const getAnswered = vi.fn();
  const answerQuestion = vi.fn();
  const dismissQuestion = vi.fn();

  return {
    intent,
    getIntent,
    setIntentStatus,
    archiveIntent,
    refineIntent,
    getHomeView,
    getNegotiationActivity,
    getPending,
    getAnswered,
    answerQuestion,
    dismissQuestion,
    notificationError: vi.fn(),
    intentsService: { getIntent, setIntentStatus, archiveIntent, refineIntent, visitIntent: vi.fn(async () => {}) },
    opportunitiesService: { getHomeView },
    conversationsService: { getNegotiationActivity },
    questionsService: {
      getPending,
      getAnswered,
      answer: answerQuestion,
      dismiss: dismissQuestion,
    },
  };
});

vi.mock('@/components/ClientLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/chat/OpportunityCardInChat', () => ({
  default: ({ card }: { card: { opportunityId: string } }) => (
    <div data-testid={`radar-card-${card.opportunityId}`}>Existing Radar match</div>
  ),
  OpportunitySkeleton: () => <div data-testid="opportunity-skeleton" />,
}));

vi.mock('@/components/InjectedQuestions/InjectedQuestions', () => ({
  InjectedQuestions: ({ questions }: { questions: Array<{ id: string; title: string }> }) => (
    <div>
      {questions.map((question) => (
        <div key={question.id} data-testid={`question-${question.id}`}>{question.title}</div>
      ))}
    </div>
  ),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({
    isReady: true,
    isLoading: false,
    isAuthenticated: true,
    user: { id: 'user-1', name: 'Alice Smith' },
    features: null,
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
  useConversations: () => mocks.conversationsService,
  useQuestionsService: () => mocks.questionsService,
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({ negotiations: [] }),
}));

vi.mock('@/contexts/QuestionsContext', () => ({
  useQuestions: () => ({ refresh: vi.fn(async () => {}) }),
}));

vi.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({
    success: vi.fn(),
    error: mocks.notificationError,
    addNotification: vi.fn(),
  }),
}));

vi.mock('@/hooks/useOpportunityActions', () => ({
  useOpportunityActions: () => ({
    opportunityStatusMap: {},
    opportunityActionLoading: {},
    handleOpportunityAction: vi.fn(),
    inviteModalElement: null,
  }),
}));

function IntentPageHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/i/intent-2')}>Go to intent 2</button>
      <IntentDetailPage />
    </>
  );
}

function renderIntentPage() {
  return render(
    <MemoryRouter initialEntries={['/i/intent-1']}>
      <Routes>
        <Route path="/i/:intentId" element={<IntentPageHarness />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function expectWorkspacePreserved() {
  expect(await screen.findByTestId('radar-card-opportunity-1')).toHaveTextContent('Existing Radar match');
  expect(await screen.findByTestId('question-question-1')).toHaveTextContent('Which region?');
}

describe('Intent detail lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.intent.status = 'ACTIVE';
    mocks.getIntent.mockImplementation(async () => ({ ...mocks.intent }));
    mocks.getHomeView.mockResolvedValue({
      sections: [{
        items: [{ opportunityId: 'opportunity-1', status: 'negotiating' }],
      }],
    });
    mocks.getNegotiationActivity.mockResolvedValue([]);
    mocks.getAnswered.mockResolvedValue([]);
    mocks.getPending.mockResolvedValue([{
      id: 'question-1',
      title: 'Which region?',
      prompt: 'Which region?',
      options: [],
      multiSelect: false,
      mode: 'intent',
      sourceType: 'intent',
      sourceId: 'intent-1',
      createdAt: new Date().toISOString(),
    }]);
    mocks.setIntentStatus.mockResolvedValue({
      id: 'intent-1',
      status: 'PAUSED',
      lifecycleVersionMs: 100,
      changed: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('hydrates the answered Q&A log from the server', async () => {
    mocks.getPending.mockResolvedValue([]);
    mocks.getAnswered.mockResolvedValue([{
      id: 'answered-1',
      payload: {
        title: 'What kind of collaborator?',
        prompt: 'What kind of collaborator?',
        options: [],
        multiSelect: false,
      },
      answer: {
        selectedOptions: ['Technical founder', 'Climate operator'],
        freeText: 'in Europe',
        answeredBy: 'user-1',
        answeredAt: new Date().toISOString(),
      },
      status: 'answered',
    }]);
    renderIntentPage();

    expect(await screen.findByText('What kind of collaborator?')).toBeInTheDocument();
    expect(screen.getByText('Technical founder, Climate operator, in Europe')).toBeInTheDocument();
    expect(screen.getByText('noted — updating the search.')).toBeInTheDocument();
  });

  test('renders the questions empty state when there are no pending questions', async () => {
    mocks.getPending.mockResolvedValue([]);
    mocks.getAnswered.mockResolvedValue([]);
    renderIntentPage();

    expect(await screen.findByText('no pending questions right now.')).toBeInTheDocument();
  });

  test('ACTIVE renders live discovery, Pause, and the existing workspace', async () => {
    renderIntentPage();

    expect(await screen.findByText('live')).toBeInTheDocument();
    expect(screen.getByText('background matching on — negotiation activity appears in Radar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    await expectWorkspacePreserved();
  });

  test('passive Radar refresh authoritatively removes cards omitted by the server', async () => {
    vi.useFakeTimers();
    renderIntentPage();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('radar-card-opportunity-1')).toBeInTheDocument();

    mocks.getHomeView.mockResolvedValue({ sections: [] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.queryByTestId('radar-card-opportunity-1')).toBeNull();
    expect(screen.getByText('No matches here yet.')).toBeInTheDocument();
  });

  test('PAUSED renders static paused discovery, Resume with Play, and keeps the workspace', async () => {
    mocks.intent.status = 'PAUSED';
    renderIntentPage();

    expect(await screen.findByText('paused')).toBeInTheDocument();
    expect(screen.getByText(/background discovery is paused; existing Radar matches and questions remain available/)).toBeInTheDocument();
    const resume = screen.getByRole('button', { name: 'Resume' });
    expect(resume.querySelector('.lucide-play')).not.toBeNull();
    expect(screen.queryByText('live')).toBeNull();
    expect(document.querySelector('.animate-ping')).toBeNull();
    await expectWorkspacePreserved();
  });

  test('null legacy status is treated as ACTIVE', async () => {
    mocks.intent.status = null;
    renderIntentPage();

    expect(await screen.findByText('live')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });

  test.each([
    ['FULFILLED', 'fulfilled', 'this signal has been fulfilled'],
    ['EXPIRED', 'expired', 'this signal has expired'],
  ])('%s renders neutral lifecycle copy without pause or resume', async (status, badge, copy) => {
    mocks.intent.status = status;
    renderIntentPage();

    expect(await screen.findByText(badge)).toBeInTheDocument();
    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    await expectWorkspacePreserved();
  });

  test('suppresses duplicate pause requests, stays live while pending, then applies the authoritative success', async () => {
    let resolveStatus!: (value: {
      id: string;
      status: 'PAUSED';
      lifecycleVersionMs: number;
      changed: boolean;
    }) => void;
    mocks.setIntentStatus.mockReturnValue(new Promise((resolve) => {
      resolveStatus = resolve;
    }));
    renderIntentPage();

    const pause = await screen.findByRole('button', { name: 'Pause' });
    fireEvent.click(pause);
    fireEvent.click(pause);

    expect(mocks.setIntentStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setIntentStatus).toHaveBeenCalledWith('intent-1', 'PAUSED');
    const pendingPause = screen.getByRole('button', { name: 'Pause' });
    expect(pendingPause).toBeDisabled();
    expect(pendingPause).toHaveAttribute('aria-busy', 'true');
    expect(pendingPause.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.getByText('live')).toBeInTheDocument();
    await expectWorkspacePreserved();

    await act(async () => {
      resolveStatus({
        id: 'intent-1',
        status: 'PAUSED',
        lifecycleVersionMs: 101,
        changed: true,
      });
    });

    expect(await screen.findByText('paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    await expectWorkspacePreserved();
    expect(mocks.getPending).toHaveBeenCalledTimes(1);
    expect(mocks.getHomeView).toHaveBeenCalledTimes(2);
  });

  test('Resume schedules bounded refreshes and surfaces a newly returned pool question', async () => {
    mocks.intent.status = 'PAUSED';
    mocks.setIntentStatus.mockResolvedValue({
      id: 'intent-1',
      status: 'ACTIVE',
      lifecycleVersionMs: 200,
      changed: true,
    });
    let pendingCalls = 0;
    mocks.getPending.mockImplementation(async () => {
      pendingCalls += 1;
      const existing = {
        id: 'question-1',
        title: 'Which region?',
        prompt: 'Which region?',
        options: [],
        multiSelect: false,
        mode: 'intent',
        sourceType: 'intent',
        sourceId: 'intent-1',
        createdAt: new Date().toISOString(),
      };
      if (pendingCalls < 3) return [existing];
      return [existing, {
        ...existing,
        id: 'question-pool-2',
        title: 'Builders or investors?',
        mode: 'pool_discovery',
      }];
    });
    renderIntentPage();
    await expectWorkspacePreserved();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('live')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(5);
    expect(screen.getByTestId('radar-card-opportunity-1')).toBeInTheDocument();
    expect(screen.queryByTestId('question-question-pool-2')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(screen.getByTestId('question-question-pool-2')).toHaveTextContent('Builders or investors?');
    expect(screen.getByTestId('radar-card-opportunity-1')).toBeInTheDocument();
    // 4 remaining bounded-refresh checkpoints; the conversation scroll-pinning
    // effect may additionally hold a rAF timer after the question list updates.
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(4);
  });

  test('a deferred response for the previous intent cannot overwrite or clear the current mutation', async () => {
    let resolveIntent1!: (value: {
      id: string;
      status: 'PAUSED';
      lifecycleVersionMs: number;
      changed: boolean;
    }) => void;
    let resolveIntent2!: typeof resolveIntent1;
    mocks.getIntent.mockImplementation(async (id: string) => ({
      ...mocks.intent,
      id,
      summary: id === 'intent-1' ? 'Intent one' : 'Intent two',
      payload: id === 'intent-1' ? 'Intent one' : 'Intent two',
      status: 'ACTIVE',
    }));
    mocks.setIntentStatus.mockImplementation((id: string) => new Promise((resolve) => {
      if (id === 'intent-1') resolveIntent1 = resolve;
      else resolveIntent2 = resolve;
    }));
    renderIntentPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to intent 2' }));
    expect(await screen.findByText('Intent two')).toBeInTheDocument();
    const intent2Pause = await screen.findByRole('button', { name: 'Pause' });
    expect(intent2Pause).toBeEnabled();
    fireEvent.click(intent2Pause);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();

    await act(async () => {
      resolveIntent1({
        id: 'intent-1',
        status: 'PAUSED',
        lifecycleVersionMs: 101,
        changed: true,
      });
    });

    expect(screen.getByText('Intent two')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolveIntent2({
        id: 'intent-2',
        status: 'PAUSED',
        lifecycleVersionMs: 202,
        changed: true,
      });
    });
    expect(await screen.findByText('paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
  });

  test.each([
    ['ACTIVE', 'Pause', 'PAUSED', 'Failed to pause signal', 'live'],
    ['PAUSED', 'Resume', 'ACTIVE', 'Failed to resume signal', 'paused'],
  ])('failed %s transition retains prior state and content', async (
    initialStatus,
    actionName,
    targetStatus,
    expectedError,
    retainedBadge,
  ) => {
    mocks.intent.status = initialStatus;
    mocks.setIntentStatus.mockRejectedValue(new Error('network failed'));
    renderIntentPage();

    fireEvent.click(await screen.findByRole('button', { name: actionName }));

    await waitFor(() => expect(mocks.notificationError).toHaveBeenCalledWith(expectedError));
    expect(mocks.setIntentStatus).toHaveBeenCalledWith('intent-1', targetStatus);
    expect(screen.getByText(retainedBadge)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: actionName })).toBeEnabled();
    await expectWorkspacePreserved();
  });
});

describe('intent lifecycle service', () => {
  test('fetches answered questions scoped to the intent', async () => {
    const get = vi.fn().mockResolvedValue({ questions: [] });
    const service = createQuestionsService({ get } as never);

    await expect(service.getAnswered({ scopeType: 'intent', scopeId: 'intent-1' })).resolves.toEqual([]);
    expect(get).toHaveBeenCalledWith('/questions?status=answered&scopeType=intent&scopeId=intent-1');
  });

  test('PATCHes the lifecycle endpoint and returns the authoritative response', async () => {
    const patch = vi.fn().mockResolvedValue({
      success: true,
      intent: {
        id: 'canonical-intent-id',
        status: 'ACTIVE',
        lifecycleVersionMs: 456,
      },
      changed: true,
    });
    const service = createIntentsService({ patch } as never);

    await expect(service.setIntentStatus('short-id', 'ACTIVE')).resolves.toEqual({
      id: 'canonical-intent-id',
      status: 'ACTIVE',
      lifecycleVersionMs: 456,
      changed: true,
    });
    expect(patch).toHaveBeenCalledWith('/intents/short-id/status', { status: 'ACTIVE' });
  });

  test('rejects a malformed lifecycle response instead of applying an untrusted status', async () => {
    const patch = vi.fn().mockResolvedValue({
      success: true,
      intent: { id: 'intent-1', status: 'FULFILLED', lifecycleVersionMs: 456 },
      changed: true,
    });
    const service = createIntentsService({ patch } as never);

    await expect(service.setIntentStatus('intent-1', 'PAUSED')).rejects.toThrow('Invalid signal status response');
  });
});
