/**
 * Intent page negotiator-chat gating (P4.2 / IND-403).
 *
 * The chat window renders only when the backend-surfaced flag
 * (`features.negotiatorChat` on /auth/me) is on; the fallback (flag off or
 * runtime bootstrap failure) is a static Personal Agent panel with the
 * refine input. The old static questions block is retired with the card
 * questions (conversational-questions plan, "Retirements").
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

describe('Intent page — negotiator chat gating', () => {
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

  test('flag off → static fallback panel, no chat window', async () => {
    renderIntentPage();

    await screen.findByText('Looking for a technical co-founder');
    expect(screen.queryByTestId('intent-negotiator-chat-stub')).toBeNull();
    expect(
      screen.getByPlaceholderText(/tell the agent anything about this signal/i),
    ).toBeInTheDocument();
  });

  test('flag on → chat window renders', async () => {
    mocks.authState.features = { negotiatorChat: true };
    renderIntentPage();

    await screen.findByText('Looking for a technical co-founder');
    await screen.findByTestId('intent-negotiator-chat-stub');
    // The label appears on the panel, the mobile sheet trigger, and the
    // sr-only dialog title, so assert presence rather than uniqueness.
    expect(screen.getAllByText(/^Personal Agent$/).length).toBeGreaterThan(0);
  });

  test('runtime bootstrap failure → falls back to the static panel', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mocks.chatStubBehavior.failBootstrap = true;
    renderIntentPage();

    await screen.findByText('Looking for a technical co-founder');
    await waitFor(() => expect(screen.queryByTestId('intent-negotiator-chat-stub')).toBeNull());
    expect(
      await screen.findByPlaceholderText(/tell the agent anything about this signal/i),
    ).toBeInTheDocument();
  });
});
