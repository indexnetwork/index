/**
 * Intent page responsive layout (IND-503, IND-505 desktop visibility fix).
 *
 * Desktop (lg+): Personal Agent and Radar columns are equal width (50/50);
 * the left column is a plain labelled region with no dialog semantics.
 * Mobile (< lg): Radar is the primary content; the left column is an
 * off-canvas sheet that, while open, behaves as a modal dialog — Radix
 * FocusScope containment, inert background, aria-modal, Escape/outside
 * dismiss via Radix DismissableLayer — and stays mounted across open/close
 * so the negotiator chat's live stream/question state survives.
 *
 * Interaction tests use @testing-library/user-event and assert against
 * document.activeElement (not just data-state). jsdom ships matchMedia with
 * a default 1024px viewport — i.e. DESKTOP semantics by default — so mobile
 * tests stub matchMedia to a < lg match and the desktop test stubs >= lg.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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

/** Stubs window.matchMedia so useIsDesktop() resolves `desktop` (jsdom lacks it). */
function stubMatchMedia(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function primeServices() {
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
}

describe('Intent page — responsive Personal Agent / Radar layout (IND-503)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mobile semantics by default; the desktop test re-stubs with `true`.
    stubMatchMedia(false);
    mocks.authState.features = { negotiatorChat: true };
    primeServices();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    expect(sheet.className).toContain('max-lg:data-[state=closed]:translate-x-full');
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

  test('mobile open: focus moves into the sheet and Tab/Shift+Tab stay contained; background is inert', async () => {
    const user = userEvent.setup();
    renderIntentPage();
    const sheet = await screen.findByTestId('personal-agent-sheet');
    const trigger = await screen.findByTestId('personal-agent-trigger');
    const radar = await screen.findByTestId('radar-column');

    await user.click(trigger);
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('open'));

    // Focus moved into the sheet.
    expect(sheet.contains(document.activeElement)).toBe(true);

    // Modal semantics + inert background while open.
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(radar).toHaveAttribute('inert');
    expect(screen.getByTestId('page-background')).toHaveAttribute('inert');

    // Tab repeatedly: focus must never leave the sheet.
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
    }
    // Shift+Tab likewise (reverse cycle).
    for (let i = 0; i < 2; i += 1) {
      await user.tab({ shift: true });
      expect(sheet.contains(document.activeElement)).toBe(true);
    }
  });

  test('mobile open: the ENTIRE page background — including the Back button — is inert; only the sheet is interactive', async () => {
    const user = userEvent.setup();
    renderIntentPage();
    const sheet = await screen.findByTestId('personal-agent-sheet');

    await user.click(await screen.findByTestId('personal-agent-trigger'));
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('open'));

    // One wrapper owns the background; the Back control lives inside it.
    const background = screen.getByTestId('page-background');
    expect(background).toHaveAttribute('inert');
    const backButton = screen.getByRole('button', { name: 'Back to home' });
    expect(background.contains(backButton)).toBe(true);
    expect(backButton.closest('[inert]')).toBe(background);

    // The sheet (and its backdrop) must NOT be inert.
    expect(sheet.closest('[inert]')).toBeNull();
    expect(screen.getByTestId('personal-agent-overlay').closest('[inert]')).toBeNull();

    // Walk every focusable element in the document: anything outside the
    // sheet must sit inside an inert subtree (i.e. be unfocusable).
    const focusables = document.body.querySelectorAll(
      'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(0);
    for (const el of Array.from(focusables)) {
      if (sheet.contains(el)) continue;
      const label = `${el.tagName} ${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 30)}`;
      expect(el.closest('[inert]', ), `${label} must be inert while the sheet is open`).not.toBeNull();
    }
  });

  test('background inertness is fully removed on every close path', async () => {
    const user = userEvent.setup();
    renderIntentPage();
    const sheet = await screen.findByTestId('personal-agent-sheet');
    const trigger = await screen.findByTestId('personal-agent-trigger');
    const background = screen.getByTestId('page-background');
    const radar = screen.getByTestId('radar-column');
    const assertNotInert = () => {
      expect(background).not.toHaveAttribute('inert');
      expect(radar).not.toHaveAttribute('inert');
    };

    // Path 1: Escape.
    await user.click(trigger);
    await waitFor(() => expect(background).toHaveAttribute('inert'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('closed'));
    assertNotInert();

    // Path 2: in-sheet close button.
    await user.click(trigger);
    await waitFor(() => expect(background).toHaveAttribute('inert'));
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('closed'));
    assertNotInert();

    // Path 3: outside pointer-down on the backdrop.
    await user.click(trigger);
    await waitFor(() => expect(background).toHaveAttribute('inert'));
    fireEvent.pointerDown(screen.getByTestId('personal-agent-overlay'));
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('closed'));
    assertNotInert();
  });

  test('close via Escape returns focus to the trigger and de-inerts the background', async () => {
    const user = userEvent.setup();
    renderIntentPage();
    const sheet = await screen.findByTestId('personal-agent-sheet');
    const trigger = await screen.findByTestId('personal-agent-trigger');

    await user.click(trigger);
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('open'));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('closed'));
    expect(document.activeElement).toBe(trigger);
    expect(await screen.findByTestId('radar-column')).not.toHaveAttribute('inert');
    expect(screen.getByTestId('page-background')).not.toHaveAttribute('inert');
  });

  test('close via the in-sheet close button returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderIntentPage();
    const sheet = await screen.findByTestId('personal-agent-sheet');
    const trigger = await screen.findByTestId('personal-agent-trigger');

    await user.click(trigger);
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('open'));

    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('closed'));
    expect(document.activeElement).toBe(trigger);
  });

  test('close via outside pointer-down on the backdrop returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderIntentPage();
    const sheet = await screen.findByTestId('personal-agent-sheet');
    const trigger = await screen.findByTestId('personal-agent-trigger');

    await user.click(trigger);
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('open'));

    // This is the path Radix's own close-auto-focus would suppress after an
    // outside interaction; the page-level focus choreography must still
    // return focus to the trigger.
    fireEvent.pointerDown(await screen.findByTestId('personal-agent-overlay'));
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('closed'));
    expect(document.activeElement).toBe(trigger);
  });

  test('negotiator chat is never unmounted by open/close cycles', async () => {
    const user = userEvent.setup();
    renderIntentPage();
    const chat = await screen.findByTestId('intent-negotiator-chat-stub');
    const trigger = await screen.findByTestId('personal-agent-trigger');

    await user.click(trigger);
    await waitFor(() =>
      expect(
        screen.getByTestId('personal-agent-sheet').getAttribute('data-state'),
      ).toBe('open'),
    );
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.getByTestId('personal-agent-sheet').getAttribute('data-state'),
      ).toBe('closed'),
    );

    // Same element instance — the subtree stayed mounted.
    expect(screen.getByTestId('intent-negotiator-chat-stub')).toBe(chat);
  });

  test('desktop (matchMedia >= lg): column is a labelled region, never a dialog, never inert', async () => {
    stubMatchMedia(true);
    const user = userEvent.setup();
    renderIntentPage();
    const sheet = await screen.findByTestId('personal-agent-sheet');

    expect(sheet.getAttribute('role')).toBe('region');
    expect(screen.queryByRole('dialog')).toBeNull();
    // Accessible name comes from the sr-only heading.
    expect(
      screen.getByRole('region', { name: 'Personal Agent' }),
    ).toBe(sheet);

    // Even if the sheet state is opened, desktop must not gain modal
    // semantics, inert background, or focus choreography.
    await user.click(await screen.findByTestId('personal-agent-trigger'));
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('open'));
    expect(sheet.getAttribute('role')).toBe('region');
    expect(sheet).not.toHaveAttribute('aria-modal');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByTestId('radar-column')).not.toHaveAttribute('inert');
    expect(screen.getByTestId('page-background')).not.toHaveAttribute('inert');
  });

  test('questions-fallback branch gets the same drawer treatment', async () => {
    mocks.authState.features = null; // flag off → static questions block
    const user = userEvent.setup();
    renderIntentPage();

    const sheet = await screen.findByTestId('personal-agent-sheet');
    expect(sheet.className).toContain('max-lg:data-[state=closed]:translate-x-full');
    expect(sheet.getAttribute('role')).toBe('dialog');

    const trigger = await screen.findByTestId('personal-agent-trigger');
    expect(trigger).toHaveTextContent('Questions');
    expect(trigger.contains(await screen.findByTestId('intent-question-count'))).toBe(true);

    await user.click(trigger);
    await waitFor(() => expect(sheet.getAttribute('data-state')).toBe('open'));
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(await screen.findByTestId('injected-questions')).toBeInTheDocument();
  });
});
