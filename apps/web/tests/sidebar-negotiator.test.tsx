/**
 * Pinned Personal Agent (negotiator DM) sidebar entry (IND-411).
 *
 * Verifies the flag-gated pinned entry: hidden when the backend does not
 * report `features.negotiatorChat`, visible and labeled from the negotiator
 * agent row when it does, get-or-create on first click, direct navigation on
 * subsequent clicks, and exclusion of the negotiator DM from the history list.
 */
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import Sidebar from '@/components/Sidebar';
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

vi.mock('@/contexts/IndexFilterContext', () => ({
  useNetworkFilter: () => ({
    selectedNetworkIds: [],
    setSelectedNetworkIds: vi.fn(),
  }),
}));

vi.mock('@/contexts/AIChatSessionsContext', () => ({
  useAIChatSessions: () => ({ sessionsVersion: 0, refetchSessions: vi.fn() }),
}));

vi.mock('@/contexts/AIChatContext', () => ({
  useAIChat: () => new Proxy({}, { get: () => vi.fn() }),
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => new Proxy({}, { get: () => vi.fn() }),
}));

vi.mock('@/contexts/IndexesContext', () => ({
  useNetworksState: () => ({ indexes: [], addIndex: vi.fn() }),
}));

vi.mock('@/contexts/APIContext', () => {
  const noopService = new Proxy({}, { get: () => vi.fn().mockResolvedValue([]) });
  return {
    useNetworks: () => noopService,
    useOpportunities: () => noopService,
  };
});

vi.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({
    success: vi.fn(),
    error: vi.fn(),
    addNotification: vi.fn(),
  }),
}));

vi.mock('@/contexts/QuestionsContext', () => ({
  useQuestions: () => ({ count: 0 }),
}));

vi.mock('@/components/modals/CreateIndexModal', () => ({
  default: () => null,
}));

vi.mock('@/components/MasterKeyDialog', () => ({
  default: () => null,
}));

vi.mock('@/components/UserAvatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderSidebar(route = '/') {
  return renderWithRouter(
    <>
      <Sidebar />
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

describe('Sidebar pinned Personal Agent entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.user = aliceUser;
    mocks.authState.features = null;
    mockSessions({});
  });

  test('flag off → no negotiator entry, no persona lookup', async () => {
    renderSidebar();

    // Let the history-session fetch settle.
    await waitFor(() => expect(mocks.apiClient.get).toHaveBeenCalledWith('/chat/sessions'));

    expect(screen.queryByText(/Negotiator|Personal Agent/)).toBeNull();
    expect(mocks.apiClient.get).not.toHaveBeenCalledWith('/chat/sessions?persona=negotiator');
  });

  test('flag on, no session yet → entry visible with derived label; click get-or-creates and navigates', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mocks.apiClient.post.mockResolvedValue({
      session: { id: 'neg-session-1', title: "Alice's Negotiator" },
      created: true,
      agent: { id: 'agent-1', name: "Alice's Negotiator", description: null },
    });

    renderSidebar();

    const entry = await screen.findByText("Alice's Negotiator");
    fireEvent.click(entry);

    await waitFor(() =>
      expect(mocks.apiClient.post).toHaveBeenCalledWith('/chat/negotiator/session')
    );
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/d/neg-session-1')
    );
  });

  test('flag on, existing session → label from session title; click navigates without POST', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mockSessions({
      negotiator: [{ id: 'neg-session-1', title: "Alice's Negotiator", networkId: null, createdAt: '', updatedAt: '' }],
    });

    renderSidebar();

    const entry = await screen.findByText("Alice's Negotiator");
    fireEvent.click(entry);

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/d/neg-session-1')
    );
    expect(mocks.apiClient.post).not.toHaveBeenCalled();
  });

  test('negotiator session never renders in the history list', async () => {
    mocks.authState.features = { negotiatorChat: true };
    mockSessions({
      // Defensive path: even if the backend ever leaked the negotiator DM
      // into the history payload, the sidebar filters it out of History.
      history: [
        { id: 'neg-session-1', title: "Alice's Negotiator", networkId: null, createdAt: '', updatedAt: '' },
        { id: 'other-1', title: 'Other chat', networkId: null, createdAt: '', updatedAt: '' },
      ],
      negotiator: [{ id: 'neg-session-1', title: "Alice's Negotiator", networkId: null, createdAt: '', updatedAt: '' }],
    });

    renderSidebar();

    await screen.findByText('Other chat');
    // Exactly one occurrence: the pinned entry, not a history row.
    expect(screen.getAllByText("Alice's Negotiator")).toHaveLength(1);
  });
});
