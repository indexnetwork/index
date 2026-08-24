/**
 * Intent page agent-chat panel.
 *
 * The chat window renders unconditionally (the negotiatorChat flag is
 * deleted); the fallback for a runtime bootstrap failure is a static
 * Personal Agent panel with the refine input. The old static questions
 * block is retired with the card questions (conversational-questions plan,
 * "Retirements").
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import IntentDetailPage from '@/app/i/[intentId]/page';
import { RADAR_REFRESH_INTERVAL_MS } from '@/hooks/useRadarLiveRefresh';

const mocks = vi.hoisted(() => ({
  authState: {
    features: null as Record<string, unknown> | null,
  },
  intentsService: {
    getIntent: vi.fn(),
    archiveIntent: vi.fn(),
    refineIntent: vi.fn(),
    visitIntent: vi.fn(),
  },
  opportunitiesService: {
    getRadarView: vi.fn(),
  },
  conversationsService: {
    getNegotiationActivity: vi.fn(),
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
  useIntents: () => mocks.intentsService,
  useOpportunities: () => mocks.opportunitiesService,
  useConversations: () => mocks.conversationsService,
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({ negotiations: [], subscribeQuestionRegeneration: () => () => {} }),
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

describe('Intent page — agent chat panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.features = null;
    mocks.intentsService.getIntent.mockResolvedValue({
      id: 'intent-1',
      payload: 'Looking for a technical co-founder',
      summary: 'Looking for a technical co-founder',
      createdAt: new Date().toISOString(),
    });
    mocks.intentsService.visitIntent.mockResolvedValue(undefined);
    mocks.opportunitiesService.getRadarView.mockResolvedValue({ items: [] });
    mocks.conversationsService.getNegotiationActivity.mockResolvedValue([]);
    mocks.chatStubBehavior.failBootstrap = false;
  });

  test('the chat window renders unconditionally — no flag gates it', async () => {
    renderIntentPage();

    await screen.findByText('Looking for a technical co-founder');
    await screen.findByTestId('intent-negotiator-chat-stub');
    // The label appears on the panel, the mobile sheet trigger, and the
    // sr-only dialog title, so assert presence rather than uniqueness.
    expect(screen.getAllByText(/^Personal Agent$/).length).toBeGreaterThan(0);
  });

  test('runtime bootstrap failure → falls back to the static panel', async () => {
    mocks.chatStubBehavior.failBootstrap = true;
    renderIntentPage();

    await screen.findByText('Looking for a technical co-founder');
    await waitFor(() => expect(screen.queryByTestId('intent-negotiator-chat-stub')).toBeNull());
    expect(
      await screen.findByPlaceholderText(/tell the agent anything about this signal/i),
    ).toBeInTheDocument();
  });

  test('shows truthful discovery preparation instead of claiming agents are talking', async () => {
    mocks.intentsService.getIntent.mockResolvedValue({
      id: 'intent-1', payload: 'Looking for a technical co-founder', summary: null,
      createdAt: new Date().toISOString(), warming: true,
      networks: [{ id: 'community-1', title: 'Builders' }],
      discoveryProgress: {
        status: 'retrying', attempt: 2, maxAttempts: 3, assignedCommunityCount: 1,
        processedCommunityCount: 0, possibleOverlapCount: 0, conversationsStartedCount: 0,
        queuedAt: '2026-08-19T09:14:00.000Z', startedAt: '2026-08-19T09:15:00.000Z',
        completedAt: null, updatedAt: '2026-08-19T09:15:00.000Z',
      },
    });
    renderIntentPage();
    await screen.findByText('Looking for a technical co-founder');
    fireEvent.click(screen.getByRole('button', { name: /Negotiating/ }));
    expect(await screen.findByText('Finding your first conversations')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('retrying');
    expect(screen.getByText(/attempt 2 of 3 . retrying/i)).toBeInTheDocument();
    expect(screen.queryByText(/still talking with theirs/i)).toBeNull();
  });

  test('reports a completed search with no conversations distinctly from failure', async () => {
    mocks.intentsService.getIntent.mockResolvedValue({
      id: 'intent-1', payload: 'Looking for a technical co-founder', summary: null,
      createdAt: new Date().toISOString(), warming: false,
      networks: [{ id: 'community-1', title: 'Builders' }],
      discoveryProgress: {
        status: 'completed', attempt: 1, maxAttempts: 3, assignedCommunityCount: 1,
        processedCommunityCount: 1, possibleOverlapCount: 0, conversationsStartedCount: 0,
        queuedAt: null, startedAt: null, completedAt: new Date().toISOString(), updatedAt: null,
      },
    });
    renderIntentPage();
    await screen.findByText('Looking for a technical co-founder');
    fireEvent.click(screen.getByRole('button', { name: /Negotiating/ }));
    // A zero-result run still reports its tally; an empty card would read as
    // though the agent never ran.
    expect(await screen.findByText('Scanned 1 community — no overlaps yet')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('completed');
  });
  test('refreshes the signal snapshot so a finished run lands on the card', async () => {
    // The SSE-driven radar refresh never carried the intent snapshot, so a
    // completed run's tallies used to sit unread until the slower progress poll.
    const warmingIntent = {
      id: 'intent-1', payload: 'Looking for a technical co-founder', summary: null,
      createdAt: new Date().toISOString(), warming: true,
      networks: [{ id: 'community-1', title: 'Builders' }, { id: 'community-2', title: 'Climate' }],
      discoveryProgress: {
        status: 'running', attempt: 1, maxAttempts: 3, assignedCommunityCount: 2,
        processedCommunityCount: 0, possibleOverlapCount: 0, conversationsStartedCount: 0,
        queuedAt: '2026-08-19T09:14:00.000Z', startedAt: '2026-08-19T09:15:00.000Z',
        completedAt: null, updatedAt: '2026-08-19T09:15:00.000Z',
      },
    };
    mocks.intentsService.getIntent
      .mockResolvedValueOnce(warmingIntent)
      .mockResolvedValue({
        ...warmingIntent,
        discoveryProgress: {
          ...warmingIntent.discoveryProgress,
          status: 'completed', processedCommunityCount: 2, possibleOverlapCount: 3,
          conversationsStartedCount: 1, completedAt: '2026-08-19T09:21:00.000Z',
        },
      });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderIntentPage();
      await screen.findByText('Looking for a technical co-founder');
      fireEvent.click(screen.getByRole('button', { name: /Negotiating/ }));
      await screen.findByText('Finding your first conversations');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RADAR_REFRESH_INTERVAL_MS);
      });

      expect(
        await screen.findByText('Scanned 2 communities — 3 possible overlaps, 1 conversation started'),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test('a blocked card is not frozen: it observes the signal joining a community', async () => {
    // `blocked` used to sit outside the poll allowlist, so the card could never
    // see its own recovery and stayed on "Needs attention" indefinitely.
    const blockedIntent = {
      id: 'intent-1', payload: 'Looking for a technical co-founder', summary: null,
      createdAt: new Date().toISOString(), warming: true, networks: [],
      discoveryProgress: {
        status: 'blocked', attempt: 0, maxAttempts: 3, assignedCommunityCount: 0,
        processedCommunityCount: 0, possibleOverlapCount: 0, conversationsStartedCount: 0,
        queuedAt: '2026-08-19T09:14:00.000Z', startedAt: null,
        completedAt: '2026-08-19T09:14:00.000Z', updatedAt: '2026-08-19T09:14:00.000Z',
      },
    };
    mocks.intentsService.getIntent
      .mockResolvedValueOnce(blockedIntent)
      .mockResolvedValue({
        ...blockedIntent,
        networks: [{ id: 'community-1', title: 'Builders' }],
        discoveryProgress: {
          ...blockedIntent.discoveryProgress,
          status: 'running', attempt: 1, assignedCommunityCount: 1,
          startedAt: '2026-08-19T09:16:00.000Z', completedAt: null,
        },
      });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderIntentPage();
      await screen.findByText('Looking for a technical co-founder');
      fireEvent.click(screen.getByRole('button', { name: /Negotiating/ }));
      await screen.findByText('Scanning is paused');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(await screen.findByText('Finding your first conversations')).toBeInTheDocument();
      expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('scanning');
    } finally {
      vi.useRealTimers();
    }
  });
});
