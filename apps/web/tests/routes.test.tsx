/**
 * Route rendering smoke tests.
 *
 * Each test imports a page component directly and renders it inside a
 * MemoryRouter with mocked context providers. The goal is to verify that
 * every route component can mount without throwing -- NOT to test
 * functionality.
 */
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

// Mock APIContext
vi.mock('@/contexts/APIContext', () => {
  const noopService = new Proxy(
    {},
    { get: () => vi.fn().mockResolvedValue({}) }
  );
  return {
    APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAPI: () =>
      new Proxy({}, { get: () => noopService }),
    useIndexes: () => noopService,
    useIntents: () => noopService,
    useConnections: () => noopService,
    useSynthesis: () => noopService,
    useDiscover: () => noopService,
    useFiles: () => noopService,
    useSync: () => noopService,
    useLinks: () => noopService,
    useAuth: () => noopService,
    useIntegrations: () => noopService,
    useAdmin: () => noopService,
    useUsers: () => noopService,
    useOpportunities: () => noopService,
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

// Mock AIChatContext — use a Proxy so any property access returns a safe default
vi.mock('@/contexts/AIChatContext', () => ({
  AIChatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAIChat: () =>
    new Proxy(
      {
        messages: [],
        isStreaming: false,
        isLoading: false,
        sessionId: null,
        tools: [],
        debugMeta: null,
        suggestions: [],
        opportunities: [],
      },
      {
        get(target, prop) {
          if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
          // Any unknown property returns a no-op function (covers setters, send, clear, etc.)
          return vi.fn();
        },
      }
    ),
}));

// Mock IndexesContext
vi.mock('@/contexts/IndexesContext', () => ({
  IndexesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useIndexesState: () => ({
    indexes: [],
    loading: false,
    error: null,
    refreshIndexes: vi.fn(),
    addIndex: vi.fn(),
    updateIndex: vi.fn(),
    removeIndex: vi.fn(),
  }),
}));

// Mock IndexFilterContext
vi.mock('@/contexts/IndexFilterContext', () => ({
  IndexFilterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useIndexFilter: () => ({
    selectedIndexIds: [],
    setSelectedIndexIds: vi.fn(),
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

// Mock indexes service (standalone, used by /index/[indexId] and /l/[code])
const noopServiceProxy = () =>
  new Proxy({}, { get: () => vi.fn().mockResolvedValue({}) });

vi.mock('@/services/indexes', () => ({
  indexesService: noopServiceProxy(),
  createIndexesService: () => noopServiceProxy(),
  useIndexService: () => noopServiceProxy(),
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

// Stub global fetch
beforeAll(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve([]),
    text: () => Promise.resolve(''),
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

  test('/blog — Blog page renders without crashing', async () => {
    const { Component } = await import('@/app/blog/page');
    const { container } = renderWithRouter(<Component />, { route: '/blog' });
    expect(container).toBeTruthy();
  });

  test('/blog/:slug — Blog post page renders without crashing', async () => {
    const { Component } = await import('@/app/blog/[slug]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/blog/test-post',
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
    });
    expect(container).toBeTruthy();
  });

  test('/index/:indexId — Index detail page renders without crashing', async () => {
    const { Component } = await import('@/app/index/[indexId]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/index/mock-index-id',
    });
    expect(container).toBeTruthy();
  });

  test('/l/:code — Invitation page renders without crashing', async () => {
    const { Component } = await import('@/app/l/[code]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/l/mock-invite-code',
    });
    expect(container).toBeTruthy();
  });

  test('/library — Library page renders without crashing', async () => {
    const { Component } = await import('@/app/library/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/library',
    });
    expect(container).toBeTruthy();
  });

  test('/networks — Networks page renders without crashing', async () => {
    const { Component } = await import('@/app/networks/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/networks',
    });
    expect(container).toBeTruthy();
  });

  test('/networks/:id — Network detail page renders without crashing', async () => {
    const { Component } = await import('@/app/networks/[id]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/networks/mock-network-id',
    });
    expect(container).toBeTruthy();
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

  test('/profile — Profile page renders without crashing', async () => {
    const { Component } = await import('@/app/profile/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/profile',
    });
    expect(container).toBeTruthy();
  });

  test('/s/:token — Shared session page renders without crashing', async () => {
    const { Component } = await import('@/app/s/[token]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/s/mock-share-token',
    });
    expect(container).toBeTruthy();
  });

  test('/u/:id — User profile page renders without crashing', async () => {
    const { Component } = await import('@/app/u/[id]/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/u/mock-user-id',
    });
    expect(container).toBeTruthy();
  });

  test('/u/:id/chat — User chat page renders without crashing', async () => {
    const { Component } = await import('@/app/u/[id]/chat/page');
    const { container } = renderWithRouter(<Component />, {
      route: '/u/mock-user-id/chat',
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
