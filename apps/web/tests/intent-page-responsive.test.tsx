/**
 * Intent page responsive layout (IND-503).
 *
 * Desktop (lg+): Personal Agent and Radar columns are equal width (50/50).
 * Mobile (< lg): Radar is the primary content; the Personal Agent column is a
 * Radix-Dialog off-canvas sheet that stays mounted (forceMount) across
 * open/close so the negotiator chat's live stream/question state survives.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import IntentDetailPage from '@/app/i/[intentId]/page';

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

function makeQuestion(id: string) {
  return {
    id,
    title: `Question ${id}?`,
    prompt: `Question ${id}?`,
    payload: { prompt: `Question ${id}?`, title: `Question ${id}?`, options: [], multiSelect: false },
    options: [],
    multiSelect: false,
    mode: 'intent',
    sourceType: 'intent',
    sourceId: 'intent-1',
    createdAt: new Date().toISOString(),
  };
}

describe('Intent page — responsive Personal Agent / Radar layout (IND-503)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.features = { negotiatorChat: true };
    mocks.intentsService.getIntent.mockResolvedValue({
      id: 'intent-1',
      payload: 'Looking for a technical co-founder',
      summary: 'Looking for a technical co-founder',
      createdAt: new Date().toISOString(),
    });
    mocks.intentsService.visitIntent.mockResolvedValue(undefined);
    mocks.opportunitiesService.getHomeView.mockResolvedValue({ sections: [] });
    mocks.questionsService.getPending.mockResolvedValue([
      makeQuestion('q-1'),
      makeQuestion('q-2'),
    ]);
    mocks.questionsService.getAnswered.mockResolvedValue([]);
  });

  test('desktop columns are equal width (lg:flex-1 on both, no 40/60 split)', async () => {
    renderIntentPage();
    const sheet = await screen.findByTestId('personal-agent-sheet');
    const radar = await screen.findByTestId('radar-column');

    expect(sheet.className).toContain('lg:flex-1');
    expect(radar.className).toContain('lg:flex-1');
    expect(sheet.className).not.toContain('lg:flex-[2]');
    expect(radar.className).not.toContain('lg:flex-[3]');
  });

  test('mobile: left column is an off-canvas sheet, not stacked above Radar', async () => {
    renderIntentPage();
    const sheet = await screen.findByTestId('personal-agent-sheet');

    // Fixed off-canvas below lg, translated out when closed; static column at lg+.
    expect(sheet.className).toContain('fixed');
    expect(sheet.className).toContain('data-[state=closed]:translate-x-full');
    expect(sheet.className).toContain('lg:static');
    expect(sheet.getAttribute('data-state')).toBe('closed');

    // Sheet stays first in DOM order (no content-ordering regression), Radar after.
    const radar = await screen.findByTestId('radar-column');
    expect(
      sheet.compareDocumentPosition(radar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('mobile trigger carries the pending-question count badge', async () => {
    renderIntentPage();
    const trigger = await screen.findByTestId('personal-agent-trigger');
    expect(trigger).toHaveTextContent('Personal Agent');

    const badge = await screen.findByTestId('intent-question-count');
    expect(badge).toHaveTextContent('2');
    expect(trigger.contains(badge)).toBe(true);
  });

  test('sheet opens via trigger and closes via Escape, close button, and overlay', async () => {
    renderIntentPage();
    const sheet = await screen.findByTestId('personal-agent-sheet');
    const trigger = await screen.findByTestId('personal-agent-trigger');

    // Open via trigger.
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(sheet.getAttribute('data-state')).toBe('open'),
    );

    // Close via the in-sheet close button.
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() =>
      expect(sheet.getAttribute('data-state')).toBe('closed'),
    );

    // Open again, close via Escape.
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(sheet.getAttribute('data-state')).toBe('open'),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(sheet.getAttribute('data-state')).toBe('closed'),
    );

    // Open again, dismiss via overlay pointer-down.
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(sheet.getAttribute('data-state')).toBe('open'),
    );
    const overlay = await screen.findByTestId('personal-agent-overlay');
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    await waitFor(() =>
      expect(sheet.getAttribute('data-state')).toBe('closed'),
    );
  });

  test('negotiator chat is never unmounted by open/close cycles', async () => {
    renderIntentPage();
    const chat = await screen.findByTestId('intent-negotiator-chat-stub');
    const trigger = await screen.findByTestId('personal-agent-trigger');

    fireEvent.click(trigger);
    await waitFor(() =>
      expect(
        screen.getByTestId('personal-agent-sheet').getAttribute('data-state'),
      ).toBe('open'),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.getByTestId('personal-agent-sheet').getAttribute('data-state'),
      ).toBe('closed'),
    );

    // Same element instance — forceMount kept the subtree alive.
    expect(screen.getByTestId('intent-negotiator-chat-stub')).toBe(chat);
  });

  test('questions-fallback branch gets the same drawer treatment', async () => {
    mocks.authState.features = null; // flag off → static questions block
    renderIntentPage();

    const sheet = await screen.findByTestId('personal-agent-sheet');
    expect(sheet.className).toContain('data-[state=closed]:translate-x-full');

    const trigger = await screen.findByTestId('personal-agent-trigger');
    expect(trigger).toHaveTextContent('Questions');
    expect(trigger.contains(await screen.findByTestId('intent-question-count'))).toBe(true);

    fireEvent.click(trigger);
    await waitFor(() =>
      expect(sheet.getAttribute('data-state')).toBe('open'),
    );
    expect(await screen.findByTestId('injected-questions')).toBeInTheDocument();
  });
});
