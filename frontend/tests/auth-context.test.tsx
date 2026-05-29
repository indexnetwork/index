import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AuthProvider } from '@/contexts/AuthContext';

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
  default: () => null,
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
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>
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
});
