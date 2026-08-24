import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import IntentDetailPage from '@/app/i/[intentId]/page';
import { createIntentsService } from '@/services/intents';

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
  const getRadarView = vi.fn();
  const getIntentCycle = vi.fn();

  return {
    intent,
    getIntent,
    setIntentStatus,
    archiveIntent,
    refineIntent,
    getRadarView,
    getIntentCycle,
    notificationError: vi.fn(),
    intentsService: { getIntent, setIntentStatus, archiveIntent, refineIntent, visitIntent: vi.fn(async () => {}) },
    opportunitiesService: { getRadarView },
    conversationsService: { getIntentCycle },
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

// The agent chat panel renders unconditionally now; these tests exercise the
// lifecycle column, so the panel is stubbed out.
vi.mock('@/components/IntentNegotiatorChat', () => ({
  default: () => <div data-testid="intent-negotiator-chat-stub" />,
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
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({ negotiations: [] }),
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
}

describe('Intent detail lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.intent.status = 'ACTIVE';
    mocks.getIntent.mockImplementation(async () => ({ ...mocks.intent }));
    mocks.getRadarView.mockResolvedValue({
      items: [{ opportunityId: 'opportunity-1', status: 'negotiating' }],
    });
    mocks.getIntentCycle.mockResolvedValue({ round: { number: 0, size: null, kickoffStartedAt: null, working: 0, paused: 0 }, negotiations: [] });
    mocks.setIntentStatus.mockResolvedValue({
      id: 'intent-1',
      status: 'PAUSED',
      lifecycleVersionMs: 100,
      changed: true,
    });
    mocks.archiveIntent.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('ACTIVE renders live discovery, Pause, and the existing workspace', async () => {
    renderIntentPage();

    expect(await screen.findByText('live')).toBeInTheDocument();
    expect(screen.getByText('background matching on — the PersonalAgent cycle is shown below')).toBeInTheDocument();
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

    mocks.getRadarView.mockResolvedValue({ items: [] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.queryByTestId('radar-card-opportunity-1')).toBeNull();
    expect(screen.getByText('No matches here yet.')).toBeInTheDocument();
  });

  test('a slow initial Radar request cannot be superseded into a permanent skeleton by the live poll', async () => {
    vi.useFakeTimers();
    let resolveSkeleton!: (value: { items: Array<{ opportunityId: string; status: string }> }) => void;
    let resolveFull!: (value: { items: Array<{ opportunityId: string; status: string }> }) => void;
    mocks.getRadarView.mockImplementation((options?: { presentation?: string }) => {
      if (options?.presentation === 'skeleton') {
        return new Promise((resolve) => { resolveSkeleton = resolve; });
      }
      return new Promise((resolve) => { resolveFull = resolve; });
    });

    renderIntentPage();
    expect(screen.getAllByTestId('opportunity-skeleton')).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // The passive poll waits for the initial load instead of invalidating its
    // request sequence and leaving opportunitiesLoading stuck forever.
    expect(mocks.getRadarView).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSkeleton({ items: [{ opportunityId: 'slow-opportunity', status: 'negotiating' }] });
      await Promise.resolve();
    });

    expect(screen.getByTestId('radar-card-slow-opportunity')).toBeInTheDocument();
    expect(screen.queryByTestId('opportunity-skeleton')).toBeNull();
    expect(mocks.getRadarView).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFull({ items: [{ opportunityId: 'slow-opportunity', status: 'negotiating' }] });
    });
  });

  test('a failed two-phase Radar fetch exits loading and offers a retry', async () => {
    mocks.getRadarView.mockRejectedValue(new Error('radar unavailable'));
    renderIntentPage();

    expect(await screen.findByText('Radar couldn’t load opportunities.')).toBeInTheDocument();
    expect(screen.queryByTestId('opportunity-skeleton')).toBeNull();

    mocks.getRadarView.mockResolvedValue({ items: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('No matches here yet.')).toBeInTheDocument();
    expect(screen.queryByText('Radar couldn’t load opportunities.')).toBeNull();
  });

  test('PAUSED renders static paused discovery, Resume with Play, and keeps the workspace', async () => {
    mocks.intent.status = 'PAUSED';
    renderIntentPage();

    expect(await screen.findByText('paused')).toBeInTheDocument();
    expect(screen.getByText(/background discovery is paused; existing Radar matches remain available/)).toBeInTheDocument();
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

  test('uses an in-app confirmation dialog before archiving', async () => {
    renderIntentPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Archive this signal? It will stop matching.');
    expect(dialog).toHaveTextContent('it will no longer find new opportunities.');
    expect(mocks.archiveIntent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.archiveIntent).not.toHaveBeenCalled();
  });

  test('archives from the in-app dialog without relying on window.confirm', async () => {
    let resolveArchive!: () => void;
    mocks.archiveIntent.mockReturnValue(new Promise<void>((resolve) => {
      resolveArchive = resolve;
    }));
    renderIntentPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive signal' }));

    expect(mocks.archiveIntent).toHaveBeenCalledWith('intent-1');
    expect(screen.getByRole('button', { name: 'Archiving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await act(async () => resolveArchive());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  test('keeps the archive dialog available when the request fails', async () => {
    mocks.archiveIntent.mockRejectedValue(new Error('network failed'));
    renderIntentPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive signal' }));

    await waitFor(() => {
      expect(mocks.notificationError).toHaveBeenCalledWith('Failed to archive signal');
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive signal' })).toBeEnabled();
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
    expect(mocks.getRadarView).toHaveBeenCalledTimes(2);
  });

  test('Resume schedules bounded workspace refreshes', async () => {
    mocks.intent.status = 'PAUSED';
    mocks.setIntentStatus.mockResolvedValue({
      id: 'intent-1',
      status: 'ACTIVE',
      lifecycleVersionMs: 200,
      changed: true,
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(screen.getByTestId('radar-card-opportunity-1')).toBeInTheDocument();
    // 4 remaining bounded-refresh checkpoints may still be armed.
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
