/**
 * Intent page questions-block ⇄ negotiator-chat gating (P4.2 / IND-403).
 *
 * The chat window replaces the static questions block only when the
 * backend-surfaced flag (`features.negotiatorChat` on /auth/me) is on; the
 * fallback (flag off or runtime bootstrap failure) is the unchanged
 * questions block.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import IntentDetailPage from '@/app/i/[intentId]/page';

const mocks = vi.hoisted(() => ({
  authState: {
    features: null as Record<string, unknown> | null,
  },
  chatStubBehavior: { failBootstrap: false },
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
  default: ({ onUnavailable }: { onUnavailable: () => void }) => {
    if (mocks.chatStubBehavior.failBootstrap) {
      // Simulate a runtime bootstrap failure (e.g. backend flag flipped off).
      setTimeout(onUnavailable, 0);
      return null;
    }
    return <div data-testid="intent-negotiator-chat-stub" />;
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
  useIntents: () => ({
    getIntent: vi.fn().mockResolvedValue({
      id: 'intent-1',
      payload: 'Looking for a technical co-founder',
      summary: 'Looking for a technical co-founder',
      createdAt: new Date().toISOString(),
    }),
    archiveIntent: vi.fn(),
    refineIntent: vi.fn(),
    visitIntent: vi.fn(async () => {}),
  }),
  useOpportunities: () => ({
    getHomeView: vi.fn().mockResolvedValue({ sections: [] }),
  }),
  useQuestionsService: () => ({
    getPending: vi.fn().mockResolvedValue([
      {
        id: 'q-1',
        title: 'Which city?',
        prompt: 'Which city?',
        options: [],
        multiSelect: false,
        mode: 'intent',
        sourceType: 'intent',
        sourceId: 'intent-1',
        createdAt: new Date().toISOString(),
      },
    ]),
    answer: vi.fn(),
    dismiss: vi.fn(),
  }),
}));


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
    expect(screen.getByText(/^Personal Agent$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Questions \(/)).toBeNull();
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
