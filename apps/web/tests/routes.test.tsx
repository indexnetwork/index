/**
 * Route rendering smoke tests.
 *
 * Each test imports a page component directly and renders it inside a
 * MemoryRouter with mocked context providers. The goal is to verify that
 * every route component can mount without throwing -- NOT to test
 * functionality.
 */
import { waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeAll } from 'vitest';
import { renderWithRouter } from '@/test/test-utils';

// ---------------------------------------------------------------------------
// Module-level mocks for contexts and heavy dependencies
// ---------------------------------------------------------------------------

// Mock better-auth client (used by AuthContext)
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false }),
    signOut: vi.fn(),
    token: vi.fn().mockResolvedValue({ data: { token: 'mock' } }),
  },
  getJwtToken: vi.fn().mockResolvedValue('mock-token'),
  clearJwtToken: vi.fn(),
}));

// Mock api module
vi.mock('@/lib/api', () => {
  const noop = vi.fn().mockResolvedValue({});
  const mockApi = {
    get: noop,
    getPublic: noop,
    post: noop,
    put: noop,
    patch: noop,
    delete: noop,
    uploadFile: noop,
  };
  return {
    apiClient: mockApi,
    apiUrl: (path: string) => path,
    APIError: class APIError extends Error {
      status: number;
      constructor(msg: string, status: number) {
        super(msg);
        this.status = status;
      }
    },
    useAuthenticatedAPI: () => mockApi,
  };
});

// Mock AuthContext
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuthContext: () => ({
    isReady: true,
    isLoading: false,
    isAuthenticated: false,
    user: null,
    userLoading: false,
    error: null,
    refetchUser: vi.fn(),
    updateUser: vi.fn(),
    openLoginModal: vi.fn(),
    signOut: vi.fn(),
  }),
}));

// Mock APIContext with the empty response shape each covered route expects.
vi.mock('@/contexts/APIContext', () => {
  const indexesService = {
    discoverPublicIndexes: vi.fn().mockResolvedValue({ data: [] }),
    getCurrentUserMemberSettings: vi.fn().mockResolvedValue({ isOwner: false }),
    getNetwork: vi.fn().mockRejectedValue(new Error('Network not found')),
    getSharedIndexes: vi.fn().mockResolvedValue([]),
    joinIndex: vi.fn().mockResolvedValue({ alreadyMember: false }),
  };
  const networkRequestsService = {
    listMine: vi.fn().mockResolvedValue({ requests: [], canReview: false }),
    listPending: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn().mockResolvedValue(undefined),
    review: vi.fn(),
  };
  const intentsService = {
    getIntent: vi.fn().mockRejectedValue(new Error('Signal not found')),
    visitIntent: vi.fn().mockResolvedValue(undefined),
    archiveIntent: vi.fn(),
    setIntentStatus: vi.fn(),
    refineIntent: vi.fn(),
  };
  const opportunitiesService = {
    getRadarView: vi.fn().mockResolvedValue({
      items: [],
      meta: { totalOpportunities: 0 },
    }),
  };
  const conversationsService = {
    getNegotiationActivity: vi.fn().mockResolvedValue([]),
  };
  const questionsService = {
    getPending: vi.fn().mockResolvedValue([]),
    getAnswered: vi.fn().mockResolvedValue([]),
    getByConversation: vi.fn().mockResolvedValue([]),
    answer: vi.fn(),
    dismiss: vi.fn(),
  };
  const usersService = {
    getUserProfile: vi.fn().mockResolvedValue(null),
  };
  const noopService = new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) });
  const services = {
    indexesService,
    networkRequestsService,
    intentsService,
    connectionsService: noopService,
    synthesisService: noopService,
    discoverService: noopService,
    authService: noopService,
    integrationsService: noopService,
    usersService,
    opportunitiesService,
    conversationService: conversationsService,
    apiKeysService: noopService,
    agentsService: noopService,
    questionsService,
  };
  return {
    APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAPI: () => services,
    useIndexes: () => indexesService,
    useNetworks: () => indexesService,
    useNetworkRequests: () => networkRequestsService,
    useIntents: () => intentsService,
    useConnections: () => noopService,
    useSynthesis: () => noopService,
    useDiscover: () => noopService,
    useAuth: () => noopService,
    useIntegrations: () => noopService,
    useUsers: () => usersService,
    useOpportunities: () => opportunitiesService,
    useConversations: () => conversationsService,
    useQuestionsService: () => questionsService,
  };
});

// Mock NotificationContext
vi.mock('@/contexts/NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNotifications: () => ({
    notifications: [],
    addNotification: vi.fn(),
    removeNotification: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

// Mock DiscoveryFilterContext
vi.mock('@/contexts/DiscoveryFilterContext', () => ({
  DiscoveryFilterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDiscoveryFilter: () => ({
    discoveryIntents: undefined,
    setDiscoveryIntents: vi.fn(),
  }),
}));

// Mock AIChatSessionsContext
vi.mock('@/contexts/AIChatSessionsContext', () => ({
  AIChatSessionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAIChatSessions: () => ({
    sessionsVersion: 0,
    refetchSessions: vi.fn(),
  }),
}));

type AIChatContextContract = ReturnType<
  typeof import('@/contexts/AIChatContext')['useAIChat']
>;

// Mock AIChatContext with a compile-time-complete context contract.
vi.mock('@/contexts/AIChatContext', () => {
  const context = {
    isOpen: false,
    setIsOpen: vi.fn(),
    messages: [],
    sessionId: null,
    sessionTitle: null,
    sessionPersona: null,
    setSessionId: vi.fn(),
    sessionNetworkId: null,
    chatScope: null,
    setChatScope: vi.fn(),
    scopeNetworkId: null,
    setScopeNetworkId: vi.fn(),
    resolveIntentSession: vi.fn().mockResolvedValue(null),
    suggestions: [],
    isLoading: false,
    turnBlock: null,
    stopStream: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendWebMessage: vi.fn().mockResolvedValue(undefined),
    clearChat: vi.fn(),
    startSignalSession: vi.fn(),
    loadSession: vi.fn().mockResolvedValue(false),
    loadPreviousMessages: vi.fn().mockResolvedValue(undefined),
    hasPreviousSession: false,
    isLoadingPreviousMessages: false,
    sessionLoadState: {
      status: 'error',
      targetSessionId: 'mock-session-id',
      error: 'Conversation not found',
    },
    isSessionReady: vi.fn().mockReturnValue(false),
    updateSessionTitle: vi.fn().mockResolvedValue(false),
    pendingQueue: [],
    cancelQueuedMessage: vi.fn(),
    submitMidStreamMessage: vi.fn(),
  } satisfies AIChatContextContract;
  return {
    AIChatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAIChat: () => context,
  };
});

// Mock ConversationContext
vi.mock('@/contexts/ConversationContext', () => ({
  ConversationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useConversation: () =>
    new Proxy(
      {
        conversations: [],
        negotiations: [],
        messages: new Map(),
        sessionHistory: new Map(),
        sessionOpportunityMap: new Map(),
        isConnected: false,
        // Subscriptions must hand back an unsubscribe: an effect that
        // returns the subscribe result crashes cleanup otherwise.
        subscribeQuestionRegeneration: vi.fn(() => () => {}),
      },
      {
        get(target, prop) {
          if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
          return vi.fn().mockResolvedValue(undefined);
        },
      },
    ),
}));

// Mock IndexesContext
vi.mock('@/contexts/IndexesContext', () => ({
  NetworksProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNetworksState: () => ({
    indexes: [],
    loading: false,
    error: null,
    refreshIndexes: vi.fn(),
    addIndex: vi.fn(),
    updateIndex: vi.fn(),
    removeIndex: vi.fn(),
  }),
}));

// Mock NetworkFilterContext
vi.mock('@/contexts/IndexFilterContext', () => ({
  NetworkFilterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNetworkFilter: () => ({
    selectedNetworkIds: [],
    setSelectedNetworkIds: vi.fn(),
  }),
}));

// Mock QuestionsContext
vi.mock('@/contexts/QuestionsContext', () => ({
  QuestionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useQuestions: () => ({
    questions: [],
    count: 0,
    globalPending: 0,
    pushedPoolPending: 0,
    personalAgentPending: 0,
    pendingRevision: 'anonymous:',
    loading: false,
    answer: vi.fn(),
    dismiss: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock XMTPContext
vi.mock('@/contexts/XMTPContext', () => ({
  XMTPProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useXMTP: () => ({
    client: null,
    isReady: false,
    conversations: [],
    sendMessage: vi.fn(),
  }),
}));

// Mock SaveBarContext
vi.mock('@/contexts/SaveBarContext', () => ({
  SaveBarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSaveBarVisible: () => false,
}));

// Mock the public/authenticated network services used by /l/[code].
vi.mock('@/services/networks', () => ({
  indexesService: {
    getIndexByShareCode: vi.fn().mockRejectedValue(new Error('Invitation not found')),
  },
  createIndexesService: vi.fn(),
  useNetworkService: () => ({
    acceptInvitation: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock v2 indexes service (used by IndexesContext)
vi.mock('@/services/v2/indexes.service', () => ({
  useIndexesV2: () =>
    new Proxy({}, { get: () => vi.fn().mockResolvedValue({ data: [] }) }),
}));

// Mock v2 upload service (used by ChatContent)
vi.mock('@/services/v2/upload.service', () => ({
  useUploadServiceV2: () => ({
    uploadFile: vi.fn().mockResolvedValue({}),
  }),
}));

// Mock auth service hook (used by AuthContext)
vi.mock('@/services/auth', () => ({
  createAuthService: () =>
    new Proxy({}, { get: () => vi.fn().mockResolvedValue({}) }),
  useAuthService: () =>
    new Proxy({}, { get: () => vi.fn().mockResolvedValue({}) }),
}));

// Mock useSuggestions hook
vi.mock('@/hooks/useSuggestions', () => ({
  useSuggestions: () => ({
    suggestions: [],
    isLoading: false,
    fetchSuggestions: vi.fn(),
    clearSuggestions: vi.fn(),
  }),
}));

// Mock ClientWrapper to avoid sidebar/header complexity
vi.mock('@/components/ClientWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="client-wrapper">{children}</div>,
}));

// Mock FeedbackWidget (used by ClientLayout)
vi.mock('@/components/FeedbackWidget', () => ({
  default: () => null,
}));

// Stub global fetch with endpoint-specific empty response contracts.
beforeAll(() => {
  global.fetch = vi.fn().mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    const body = url.includes('/api/chat/shared/')
      ? { session: { id: 'shared-session', createdAt: new Date(0).toISOString() }, messages: [] }
      : [];
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(''),
    });
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Route rendering smoke tests', () => {
  test('/ — Home page renders without crashing', async () => {
    const { Component } = await import('@/app/page');
    const { container } = renderWithRouter(<Component />, { route: '/' });
    expect(container).toBeTruthy();
  });

  test('/about — About page renders without crashing', async () => {
    const { Component } = await import('@/app/about/page');
    const { container } = renderWithRouter(<Component />, { route: '/about' });
    expect(container).toBeTruthy();
  });

  test('/waitlist — Waitlist page renders without crashing', async () => {
    const { Component } = await import('@/app/waitlist/page');
    const { container } = renderWithRouter(<Component />, { route: '/waitlist' });
    expect(container).toBeTruthy();
  });

  test('/blog — Blog page renders without crashing', async () => {
    const { Component } = await import('@/app/blog/page');
    const { container } = renderWithRouter(<Component />, { route: '/blog' });
    expect(container).toBeTruthy();
  });

  test('/blog/:slug — Blog post page renders without crashing', async () => {
    const { Component } = await import('@/app/blog/[slug]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/blog/test-post',
      routePattern: '/blog/:slug',
    });
    expect(container).toBeTruthy();
  });

  test('/chat — Chat page renders without crashing', async () => {
    const { Component } = await import('@/app/chat/page');
    const { container } = renderWithRouter(<Component />, { route: '/chat' });
    expect(container).toBeTruthy();
  });

  test('/d/:id — Discovery page renders without crashing', async () => {
    const { Component } = await import('@/app/d/[id]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/d/mock-session-id',
      routePattern: '/d/:id',
    });
    await waitFor(() => expect(container.textContent).toContain('Could not load this chat'));
  });

  test('/i/:intentId — Intent detail page renders without crashing', async () => {
    const { Component } = await import('@/app/i/[intentId]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/i/mock-intent-id',
      routePattern: '/i/:intentId',
    });
    await waitFor(() => expect(container.textContent).toContain('Signal not found'));
  });

  test('/l/:code — Invitation page renders without crashing', async () => {
    const { Component } = await import('@/app/l/[code]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/l/mock-invite-code',
      routePattern: '/l/:code',
    });
    await waitFor(() => expect(container.textContent).toContain('Invitation unavailable'));
  });

  test('/networks — Networks page renders without crashing', async () => {
    const { Component } = await import('@/app/networks/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/networks',
    });
    await waitFor(() => expect(container.textContent).toContain('Networks'));
  });

  test('/networks/:id — Network detail page renders without crashing', async () => {
    const { Component } = await import('@/app/networks/[id]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/networks/mock-network-id',
      routePattern: '/networks/:id/*',
    });
    await waitFor(() => expect(container.textContent).toContain('Network not found'));
  });

  test('/pages/privacy-policy — Privacy policy page renders without crashing', async () => {
    const { Component } = await import('@/app/pages/privacy-policy/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/pages/privacy-policy',
    });
    expect(container).toBeTruthy();
  });

  test('/pages/terms-of-use — Terms of use page renders without crashing', async () => {
    const { Component } = await import('@/app/pages/terms-of-use/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/pages/terms-of-use',
    });
    expect(container).toBeTruthy();
  });

  test('/s/:token — Shared session page renders without crashing', async () => {
    const { Component } = await import('@/app/s/[token]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/s/mock-share-token',
      routePattern: '/s/:token',
    });
    await waitFor(() => expect(container.textContent).toContain('Shared conversation'));
  });

  test('/c/:code — Connect-link landing page renders without crashing', async () => {
    const { Component } = await import('@/app/c/[code]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/c/mock-connect-code',
      routePattern: '/c/:code',
    });
    expect(container).toBeTruthy();
    expect(container.textContent).toContain('Open in the Index app');
  });

  test('/o/:id — Opportunity link landing page renders without crashing', async () => {
    const { Component } = await import('@/app/o/[id]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/o/mock-opportunity-id',
      routePattern: '/o/:id',
    });
    expect(container).toBeTruthy();
    expect(container.textContent).toContain('Open in the Index app');
  });

  test('/download — macOS install page renders without crashing', async () => {
    const { Component } = await import('@/app/download/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/download',
    });
    expect(container).toBeTruthy();
    // Lowercased in the redesign; the heading copy is "get the apps".
    expect(container.textContent).toContain('get the apps');
  });

  test('/u/:id — User profile page renders without crashing', async () => {
    const { Component } = await import('@/app/u/[id]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/u/mock-user-id',
      routePattern: '/u/:id',
    });
    await waitFor(() => expect(container.textContent).toContain('User not found'));
  });

  test('/u/:id/chat — User chat page renders without crashing', async () => {
    const { Component } = await import('@/app/u/[id]/chat/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/u/mock-user-id/chat',
      routePattern: '/u/:id/chat',
    });
    expect(container).toBeTruthy();
  });

  test('/dev/intent-proposal — Intent proposal page renders without crashing', async () => {
    const { Component } = await import('@/app/dev/intent-proposal/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/dev/intent-proposal',
    });
    expect(container).toBeTruthy();
  });

  test('* — Not found page renders without crashing', async () => {
    const { Component } = await import('@/app/not-found');
    const { container } = renderWithRouter(<Component />, {
      route: '/nonexistent-path',
    });
    expect(container).toBeTruthy();
    expect(container.textContent).toContain('404');
  });
});
