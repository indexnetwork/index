/**
 * Pinned Personal Agent (negotiator DM) entry (IND-411).
 *
 * Verifies the flag-gated pinned entry: hidden when the backend does not
 * report `features.negotiatorChat`, visible and labeled from the negotiator
 * agent row when it does, get-or-create on first click, direct navigation on
 * subsequent clicks, and exclusion of the negotiator DM from the history list.
 *
 * The entry moved from the retired Sidebar to AgentSessionsPanel, which the
 * shell renders as the aside on agent chat routes.
 */
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import AgentSessionsPanel from '@/components/AgentSessionsPanel';
import { renderWithRouter } from '@/test/test-utils';

const mocks = vi.hoisted(() => {
  const apiClient = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return {
    apiClient,
    authState: {
      user: null as Record<string, unknown> | null,
      features: null as Record<string, unknown> | null,
    },
    questionsState: { personalAgentPending: 0 },
  };
});

vi.mock('@/lib/api', () => ({
  apiClient: mocks.apiClient,
  useAuthenticatedAPI: () => mocks.apiClient,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({
    isReady: true,
    isLoading: false,
    isAuthenticated: !!mocks.authState.user,
    user: mocks.authState.user,
    features: mocks.authState.features,
    userLoading: false,
    error: null,
    refetchUser: vi.fn(),
    updateUser: vi.fn(),
    openLoginModal: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('@/contexts/AIChatSessionsContext', () => ({
  useAIChatSessions: () => ({ sessionsVersion: 0, refetchSessions: vi.fn() }),
}));

vi.mock('@/contexts/IndexesContext', () => ({
  useNetworksState: () => ({ indexes: [], addIndex: vi.fn() }),
}));

vi.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({
    success: vi.fn(),
    error: vi.fn(),
    addNotification: vi.fn(),
  }),
}));

vi.mock('@/contexts/QuestionsContext', () => ({
  useQuestions: () => ({
    personalAgentPending: mocks.questionsState.personalAgentPending,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPanel(route = '/agent/chat') {
  return renderWithRouter(
    <>
      <AgentSessionsPanel />
      <LocationProbe />
    </>,
    { route }
  );
}

const aliceUser = { id: 'user-1', name: 'Alice Smith', avatar: null };

/** Route apiClient.get by endpoint: history list vs pinned negotiator lookup. */
function mockSessions({
  history = [],
  negotiator = [],
}: {
  history?: Array<Record<string, unknown>>;
  negotiator?: Array<Record<string, unknown>>;
}) {
  mocks.apiClient.get.mockImplementation((endpoint: string) => {
    if (endpoint === '/chat/sessions?persona=negotiator') {
      return Promise.resolve({ sessions: negotiator });
    }
    if (endpoint === '/chat/sessions') {
      return Promise.resolve({ sessions: history });
    }
    return Promise.resolve({});
  });
}

describe('AgentSessionsPanel pinned Personal Agent entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.user = aliceUser;
    mocks.authState.features = null;
    mocks.questionsState.personalAgentPending = 0;
    mockSessions({});
  });

  test('flag off → no negotiator entry, no persona lookup', async () => {
    renderPanel();

    // Let the history-session fetch settle.
    await waitFor(() => expect(mocks.apiClient.get).toHaveBeenCalledWith('/chat/sessions'));

    expect(screen.queryByText(/Negotiator|Personal Agent/)).toBeNull();
    expect(mocks.apiClient.get).not.toHaveBeenCalledWith('/chat/sessions?persona=negotiator');
  });

  test('flag on, no session yet → entry visible with canonical label; click get-or-creates and navigates', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mocks.apiClient.post.mockResolvedValue({
      session: { id: 'neg-session-1', title: "Alice's Negotiator" },
      created: true,
      agent: { id: 'agent-1', name: "Alice's Negotiator", description: null },
    });

    renderPanel();

    // Canonical branding until the session (which carries the agent's real
    // name) resolves.
    const entry = await screen.findByText('Personal Agent');
    fireEvent.click(entry);

    await waitFor(() =>
      expect(mocks.apiClient.post).toHaveBeenCalledWith('/chat/negotiator/session')
    );
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/d/neg-session-1')
    );
  });

  test('memory shortcut on the pinned entry navigates to /agent/memory', async () => {
    mocks.authState.features = { negotiatorChat: true };

    renderPanel();

    const link = await screen.findByTestId('negotiator-memory-link');
    fireEvent.click(link);

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/agent/memory')
    );
    // The memory shortcut must not bootstrap a chat session.
    expect(mocks.apiClient.post).not.toHaveBeenCalled();
  });

  test('flag on, existing session → label from session title; click navigates without POST', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mockSessions({
      negotiator: [{ id: 'neg-session-1', title: "Alice's Negotiator", networkId: null, createdAt: '', updatedAt: '' }],
    });

    renderPanel();

    const entry = await screen.findByText("Alice's Negotiator");
    fireEvent.click(entry);

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/d/neg-session-1')
    );
    expect(mocks.apiClient.post).not.toHaveBeenCalled();
  });

  test('pinned entry resolves the unscoped DM, skipping intent-pinned negotiator sessions (IND-403)', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mockSessions({
      negotiator: [
        // Most-recent first: an intent-pinned negotiator session must NOT
        // become the pinned entry.
        { id: 'pinned-intent-1', title: 'Find a co-founder', scopeType: 'intent', networkId: null, createdAt: '', updatedAt: '' },
        { id: 'neg-dm-1', title: "Alice's Negotiator", scopeType: null, networkId: null, createdAt: '', updatedAt: '' },
      ],
    });

    renderPanel();

    const entry = await screen.findByText("Alice's Negotiator");
    expect(screen.queryByText('Find a co-founder')).toBeNull();
    fireEvent.click(entry);

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/d/neg-dm-1')
    );
    expect(mocks.apiClient.post).not.toHaveBeenCalled();
  });

  test('pending-question badge renders on the entry when the inbox has open questions (IND-404)', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mocks.questionsState.personalAgentPending = 3;
    mockSessions({
      negotiator: [{ id: 'neg-session-1', title: "Alice's Negotiator", networkId: null, createdAt: '', updatedAt: '' }],
    });

    renderPanel();

    await screen.findByText("Alice's Negotiator");
    expect(screen.getByTestId('negotiator-question-badge')).toHaveTextContent('3');
  });

  test('badge caps at 99+ and disappears at zero (IND-404)', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mocks.questionsState.personalAgentPending = 120;
    mockSessions({
      negotiator: [{ id: 'neg-session-1', title: "Alice's Negotiator", networkId: null, createdAt: '', updatedAt: '' }],
    });

    const { unmount } = renderPanel();
    await screen.findByText("Alice's Negotiator");
    expect(screen.getByTestId('negotiator-question-badge')).toHaveTextContent('99+');
    unmount();

    mocks.questionsState.personalAgentPending = 0;
    renderPanel();
    await screen.findByText("Alice's Negotiator");
    expect(screen.queryByTestId('negotiator-question-badge')).toBeNull();
  });

  test('negotiator session never renders in the history list', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mockSessions({
      // Defensive path: even if the backend ever leaked the negotiator DM
      // into the history payload, the panel filters it out of History.
      history: [
        { id: 'neg-session-1', title: "Alice's Negotiator", networkId: null, createdAt: '', updatedAt: '' },
        { id: 'other-1', title: 'Other chat', networkId: null, createdAt: '', updatedAt: '' },
      ],
      negotiator: [{ id: 'neg-session-1', title: "Alice's Negotiator", networkId: null, createdAt: '', updatedAt: '' }],
    });

    renderPanel();

    await screen.findByText('Other chat');
    // Exactly one occurrence: the pinned entry, not a history row.
    expect(screen.getAllByText("Alice's Negotiator")).toHaveLength(1);
  });

  test('New conversation targets the agent chat route', async () => {
    renderPanel('/d/some-session');

    fireEvent.click(await screen.findByText('New conversation'));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/agent/chat')
    );
  });
});
