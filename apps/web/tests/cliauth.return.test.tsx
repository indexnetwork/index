import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AuthProvider } from '@/contexts/AuthContext';
import { buildCliAuthReturnPath, type CliAuthRequest } from '@/lib/cli-auth';
import { renderWithRouter } from '@/test/test-utils';

const mocks = vi.hoisted(() => ({
  signInSocial: vi.fn(),
  signInMagicLink: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false }),
    signOut: mocks.signOut,
    signIn: {
      social: mocks.signInSocial,
      magicLink: mocks.signInMagicLink,
      email: mocks.signInEmail,
    },
    signUp: { email: mocks.signUpEmail },
  },
  clearJwtToken: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useAuthenticatedAPI: () => ({ get: vi.fn() }),
}));

vi.mock('@/services/auth', () => ({
  useAuthService: () => ({ updateProfile: vi.fn() }),
}));

vi.mock('@/app/landing/Nav', () => ({
  ensureLandingFonts: vi.fn(),
}));

function renderHomeWithCliReturn(cliReturn: string) {
  return renderWithRouter(
    <AuthProvider>
      <div data-testid="home">Home</div>
    </AuthProvider>,
    { route: `/?cli_return=${encodeURIComponent(cliReturn)}` },
  );
}

async function expectGoogleCallback(request: CliAuthRequest): Promise<void> {
  const returnPath = buildCliAuthReturnPath('/cli-auth', request);
  renderHomeWithCliReturn(returnPath);

  fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(mocks.signInSocial).toHaveBeenCalledTimes(1));
  expect(mocks.signInSocial).toHaveBeenCalledWith({
    provider: 'google',
    callbackURL: `${window.location.origin}${returnPath}`,
  });
}

describe('unauthenticated CLI auth return', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInSocial.mockResolvedValue({ error: null });
    mocks.signInEmail.mockResolvedValue({ error: null });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      providers: ['google'],
      emailPassword: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('preserves the exact v1 request through AuthModal and Better Auth', async () => {
    await expectGoogleCallback({
      protocolVersion: 1,
      callback: 'http://127.0.0.1:43123/callback',
    });
  });

  test('preserves the exact state-bound v2 request through AuthModal and Better Auth', async () => {
    await expectGoogleCallback({
      protocolVersion: 2,
      callback: 'http://127.0.0.1:43123/callback',
      state: 'state_token-that-is-url-safe-1234567890',
    });
  });

  test('preserves the v2 callback through email/password Better Auth', async () => {
    const returnPath = buildCliAuthReturnPath('/cli-auth', {
      protocolVersion: 2,
      callback: 'http://127.0.0.1:43123/callback',
      state: 'state_token-that-is-url-safe-1234567890',
    });
    renderHomeWithCliReturn(returnPath);

    fireEvent.click(await screen.findByRole('button', { name: 'sign in with a password' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(mocks.signInEmail).toHaveBeenCalledWith({
      email: 'alice@example.com',
      password: 'correct-horse-battery',
      callbackURL: `${window.location.origin}${returnPath}`,
    }));
  });

  test.each([
    'https://attacker.example/cli-auth?callback=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback',
    '/cli-auth?callback=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback&version=2',
    '/cli-auth?callback=http%3A%2F%2Fattacker.example%3A43123%2Fcallback',
  ])('ignores external or malformed return without opening auth: %s', async (cliReturn) => {
    renderHomeWithCliReturn(cliReturn);

    await screen.findByTestId('home');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.signInSocial).not.toHaveBeenCalled();
  });
});
