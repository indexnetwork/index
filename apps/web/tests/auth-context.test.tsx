import { screen } from '@testing-library/react';
import { useLocation } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AuthProvider } from '@/contexts/AuthContext';
import { renderWithRouter } from '@/test/test-utils';

const mocks = vi.hoisted(() => {
  const apiClient = {
    get: vi.fn(),
  };
  const authService = {
    updateProfile: vi.fn(),
  };

  return {
    apiClient,
    authService,
    clearJwtToken: vi.fn(),
    signOut: vi.fn(),
    useSession: vi.fn(),
    authModal: vi.fn(),
  };
});

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signOut: mocks.signOut,
    useSession: () => mocks.useSession(),
  },
  clearJwtToken: mocks.clearJwtToken,
}));

vi.mock('@/lib/api', () => ({
  useAuthenticatedAPI: () => mocks.apiClient,
}));

vi.mock('@/services/auth', () => ({
  useAuthService: () => mocks.authService,
}));

vi.mock('@/components/AuthModal', () => ({
  default: (props: { isOpen: boolean; callbackURL?: string }) => {
    mocks.authModal(props);
    return null;
  },
}));

function incompleteUser() {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    name: 'Alice',
    onboarding: {},
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderAuthProviderAt(route: string) {
  return renderWithRouter(
    <AuthProvider>
      <LocationProbe />
    </AuthProvider>,
    { route }
  );
}

describe('AuthProvider onboarding routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({
      data: { session: { id: 'session-1' } },
      isPending: false,
    });
    mocks.apiClient.get.mockResolvedValue({ user: incompleteUser() });
    mocks.authService.updateProfile.mockResolvedValue(incompleteUser());
  });

  test('redirects an authenticated incomplete user from the home page to onboarding', async () => {
    renderAuthProviderAt('/');

    expect(await screen.findByTestId('location')).toHaveTextContent('/onboarding');
  });

  test('allows an authenticated incomplete user to stay on networks', async () => {
    renderAuthProviderAt('/networks');

    expect(await screen.findByTestId('location')).toHaveTextContent('/networks');
  });

  test('still redirects unauthenticated users away from networks', async () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: false });

    renderAuthProviderAt('/networks');

    expect(await screen.findByTestId('location')).toHaveTextContent('/');
    expect(mocks.apiClient.get).not.toHaveBeenCalled();
  });

  test('opens the login modal with a preserved callbackURL when an unauthenticated user hits a protected deep link', async () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: false });

    // A negotiation-trace deep link from the daily digest, opened while logged out.
    renderAuthProviderAt('/chat/abc-123');

    // The user is bounced to home, but the login modal is opened so that after
    // authenticating Better Auth redirects them back to the captured URL
    // (real browser URL via createBrowserRouter; jsdom reports the origin).
    expect(await screen.findByTestId('location')).toHaveTextContent('/');
    const lastCall = mocks.authModal.mock.calls.at(-1)?.[0] as
      | { isOpen: boolean; callbackURL?: string }
      | undefined;
    expect(lastCall?.isOpen).toBe(true);
    expect(typeof lastCall?.callbackURL).toBe('string');
    expect(lastCall?.callbackURL).toBeTruthy();
  });
});
