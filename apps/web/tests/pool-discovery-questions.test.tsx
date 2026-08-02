/**
 * Pool discriminator questions on the intent page (IND-418).
 *
 * Covers the web half of pool_discovery questions:
 * - evidence provenance chip on the question card (present/absent),
 * - pending-question count badge in the Personal Agent panel header,
 * - interview-mode chaining: after answering a pool_discovery question the
 *   page refetches once and appends a newly returned follow-up card.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import IntentDetailPage from '@/app/i/[intentId]/page';
import { InjectedQuestions } from '@/components/InjectedQuestions/InjectedQuestions';
import type { PendingQuestion } from '@/services/questions';

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
    visitIntent: vi.fn(async () => {}),
  },
  opportunitiesService: {
    getRadarView: vi.fn(),
  },
}));

vi.mock('@/components/ClientLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/chat/OpportunityCardInChat', () => ({
  default: () => null,
  OpportunitySkeleton: () => null,
}));

vi.mock('@/components/IntentMemoryStrip', () => ({
  default: () => null,
}));

vi.mock('@/components/IntentNegotiatorChat', () => ({
  default: () => <div data-testid="intent-negotiator-chat-stub" />,
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

function primePageServices() {
  mocks.intentsService.getIntent.mockResolvedValue({
    id: 'intent-1',
    payload: 'Looking for a technical co-founder',
    summary: 'Looking for a technical co-founder',
    createdAt: new Date().toISOString(),
  });
  mocks.opportunitiesService.getRadarView.mockResolvedValue({ items: [] });
}


vi.mock('@/contexts/QuestionsContext', () => ({
  useQuestions: () => ({ refresh: vi.fn(async () => {}) }),
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

function makePoolQuestion(overrides: {
  id: string;
  prompt: string;
  evidence?: string;
}): PendingQuestion {
  return {
    id: overrides.id,
    detection: {
      mode: 'pool_discovery',
      sourceType: 'intent',
      sourceId: 'intent-1',
      timestamp: new Date().toISOString(),
    },
    actors: [{ userId: 'user-1', role: 'subject' }],
    payload: {
      title: overrides.prompt,
      prompt: overrides.prompt,
      options: [
        {
          label: 'Prefer senior folks',
          description: '8 of your 21 current matches lean this way',
        },
        {
          label: 'Both matter',
          description: 'Keep the pool broad',
        },
      ],
      multiSelect: false,
      ...(overrides.evidence ? { evidence: overrides.evidence } : {}),
    },
    status: 'pending',
    answer: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    conversationId: null,
  };
}

function renderIntentPage() {
  return render(
    <MemoryRouter initialEntries={['/i/intent-1']}>
      <Routes>
        <Route path="/i/:intentId" element={<IntentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('pool_discovery questions — evidence chip', () => {
  const noop = async () => {};

  test('renders the muted provenance chip above the prompt when payload.evidence is present', () => {
    const question = makePoolQuestion({
      id: 'q-pool-1',
      prompt: 'What matters more in a co-founder?',
      evidence: 'based on 18 people matching this intent',
    });
    render(<InjectedQuestions questions={[question]} onAnswer={noop} onDismiss={noop} />);

    const chip = screen.getByTestId('question-evidence-chip');
    expect(chip).toHaveTextContent('◎ based on 18 people matching this signal');
    // Muted styling — never the red/amber reserved for rejected/expired.
    expect(chip.className).toContain('text-gray-500');
    expect(chip.className).toContain('bg-gray-100');
    // Option description renders as a sub-line for single-select options.
    expect(screen.getByText('Prefer senior folks')).toBeInTheDocument();
    expect(screen.getByText('8 of your 21 current matches lean this way')).toBeInTheDocument();
  });

  test('renders no chip when payload.evidence is absent', () => {
    const question = makePoolQuestion({
      id: 'q-pool-2',
      prompt: 'What matters more in a co-founder?',
    });
    render(<InjectedQuestions questions={[question]} onAnswer={noop} onDismiss={noop} />);

    expect(screen.queryByTestId('question-evidence-chip')).toBeNull();
  });
});

describe('intent page — pending question count badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primePageServices();
    mocks.questionsService.getAnswered.mockResolvedValue([]);
    mocks.authState.features = { negotiatorChat: true };
  });

  test('shows the pending count in the Personal Agent panel header', async () => {
    mocks.questionsService.getPending.mockResolvedValue([
      makePoolQuestion({ id: 'q-1', prompt: 'First?' }),
      makePoolQuestion({ id: 'q-2', prompt: 'Second?' }),
    ]);
    renderIntentPage();

    const badge = await screen.findByTestId('intent-question-count');
    expect(badge).toHaveTextContent('2');
  });

  test('hides the badge when the pending count is 0', async () => {
    mocks.questionsService.getPending.mockResolvedValue([]);
    renderIntentPage();

    await screen.findByTestId('intent-negotiator-chat-stub');
    expect(screen.queryByTestId('intent-question-count')).toBeNull();
  });
});

describe('intent page — interview-mode chaining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primePageServices();
    mocks.questionsService.getAnswered.mockResolvedValue([]);
    // Flag off → the static Questions panel renders the real InjectedQuestions.
    mocks.authState.features = null;
    mocks.questionsService.answer.mockResolvedValue({ success: true });
  });

  test('after answering, the optimistic log is replaced by one server-backed entry', async () => {
    const question = makePoolQuestion({ id: 'q-pool-1', prompt: 'What matters more in a co-founder?' });
    mocks.questionsService.getPending.mockResolvedValue([question]);
    mocks.questionsService.getAnswered
      .mockResolvedValueOnce([])
      .mockResolvedValue([{
        ...question,
        status: 'answered',
        answer: {
          selectedOptions: ['Server answer'],
          answeredBy: 'user-1',
          answeredAt: new Date().toISOString(),
        },
      }]);

    const { container } = renderIntentPage();
    await screen.findByText('What matters more in a co-founder?');

    fireEvent.click(container.querySelector('input[value="Both matter"]') as HTMLInputElement);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(mocks.questionsService.answer).toHaveBeenCalledWith('q-pool-1', {
        selectedOptions: ['Both matter'],
      }),
    );
    expect(await screen.findByText('noted — updating the search.')).toBeInTheDocument();
    expect(screen.getAllByText('What matters more in a co-founder?')).toHaveLength(1);
    expect(screen.getByText('Server answer')).toBeInTheDocument();
    expect(screen.queryByText('Both matter')).toBeNull();
    expect(mocks.questionsService.getAnswered).toHaveBeenCalledTimes(2);
  });

  test('after answering a pool_discovery question, refetches once and appends the follow-up', async () => {
    const first = makePoolQuestion({ id: 'q-pool-1', prompt: 'What matters more in a co-founder?' });
    const followUp = makePoolQuestion({ id: 'q-pool-2', prompt: 'Which stage do you prefer?' });
    mocks.questionsService.getPending
      .mockResolvedValueOnce([first])
      .mockResolvedValue([followUp]);

    const { container } = renderIntentPage();

    await screen.findByText('What matters more in a co-founder?');

    // Answer: pick an option and submit through the real card machinery.
    const option = container.querySelector('input[value="Both matter"]') as HTMLInputElement;
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(mocks.questionsService.answer).toHaveBeenCalledWith('q-pool-1', {
        selectedOptions: ['Both matter'],
      }),
    );

    // Typing indicator shows while the chained refetch is pending.
    await screen.findByTestId('question-chain-typing');

    // ~1.2s later the follow-up card is appended as a continuation.
    await screen.findByText('Which stage do you prefer?', undefined, { timeout: 3000 });
    expect(screen.queryByTestId('question-chain-typing')).toBeNull();
    // Exactly one chain refetch (initial load + one after the answer).
    expect(mocks.questionsService.getPending).toHaveBeenCalledTimes(2);
  });
});
