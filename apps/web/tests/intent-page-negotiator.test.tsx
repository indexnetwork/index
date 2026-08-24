/**
 * Intent page agent-chat panel.
 *
 * The chat window renders unconditionally (the negotiatorChat flag is
 * deleted); the fallback for a runtime bootstrap failure is a static
 * Personal Agent panel with the refine input. The old static questions
 * block is retired with the card questions (conversational-questions plan,
 * "Retirements").
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import IntentDetailPage from '@/app/i/[intentId]/page';

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
    getIntentCycle: vi.fn(),
    getIntentCycleTimeline: vi.fn(),
  },
  chatStubBehavior: { failBootstrap: false },
  turnCompletedHandlers: new Set<(event: { intentId: string }) => void>(),
  intentInvalidationHandlers: new Set<(event: { intentId: string }) => void>(),
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
  useConversation: () => ({
    subscribePersonalAgentTurnCompleted: (handler: (event: { intentId: string }) => void) => {
      mocks.turnCompletedHandlers.add(handler);
      return () => mocks.turnCompletedHandlers.delete(handler);
    },
    subscribeIntentDiscoveryProgress: () => () => {},
    subscribeIntentInvalidation: (handler: (event: { intentId: string }) => void) => {
      mocks.intentInvalidationHandlers.add(handler);
      return () => mocks.intentInvalidationHandlers.delete(handler);
    },
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

function emitTurnCompleted(event: { intentId: string }) {
  act(() => {
    mocks.turnCompletedHandlers.forEach((handler) => handler(event));
  });
}

function emitIntentInvalidation(event: { intentId: string }) {
  act(() => {
    mocks.intentInvalidationHandlers.forEach((handler) => handler(event));
  });
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
    mocks.conversationsService.getIntentCycle.mockResolvedValue({ round: { number: 0, size: null, kickoffStartedAt: null, working: 0, paused: 0 }, negotiations: [] });
    mocks.conversationsService.getIntentCycleTimeline.mockResolvedValue([]);
    mocks.chatStubBehavior.failBootstrap = false;
    mocks.turnCompletedHandlers.clear();
    mocks.intentInvalidationHandlers.clear();
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

  test('refreshes the entire workspace when the PersonalAgent turn completes', async () => {
    renderIntentPage();
    await screen.findByText('Looking for a technical co-founder');
    await waitFor(() => expect(mocks.conversationsService.getIntentCycleTimeline).toHaveBeenCalledTimes(1));
    vi.clearAllMocks();

    emitTurnCompleted({ intentId: 'intent-1' });

    await waitFor(() => expect(mocks.intentsService.getIntent).toHaveBeenCalledWith('intent-1'));
    expect(mocks.conversationsService.getIntentCycle).toHaveBeenCalledWith('intent-1');
    expect(mocks.conversationsService.getIntentCycleTimeline).toHaveBeenCalledWith('intent-1');
    expect(mocks.opportunitiesService.getRadarView).toHaveBeenCalled();
  });

  test('refreshes the entire workspace when negotiation expiry invalidates its intent', async () => {
    renderIntentPage();
    await screen.findByText('Looking for a technical co-founder');
    await waitFor(() => expect(mocks.conversationsService.getIntentCycleTimeline).toHaveBeenCalledTimes(1));
    vi.clearAllMocks();

    emitIntentInvalidation({ intentId: 'intent-1' });

    await waitFor(() => expect(mocks.intentsService.getIntent).toHaveBeenCalledWith('intent-1'));
    expect(mocks.conversationsService.getIntentCycle).toHaveBeenCalledWith('intent-1');
    expect(mocks.conversationsService.getIntentCycleTimeline).toHaveBeenCalledWith('intent-1');
    expect(mocks.opportunitiesService.getRadarView).toHaveBeenCalled();
  });
});
