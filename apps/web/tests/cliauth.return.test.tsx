import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Component as CliAuthPage } from '@/app/cli-auth/page';
import { buildCliAuthReturnPath, type CliAuthRequest } from '@/lib/cli-auth';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  post: vi.fn(),
  signInSocial: vi.fn(),
  signInMagicLink: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: mocks.getSession,
    signIn: {
      social: mocks.signInSocial,
      magicLink: mocks.signInMagicLink,
      email: mocks.signInEmail,
    },
    signUp: { email: mocks.signUpEmail },
  },
}));

vi.mock('@/lib/api', () => ({
  apiClient: { post: mocks.post },
}));

vi.mock('@/app/landing/Nav', () => ({
  ensureLandingFonts: vi.fn(),
}));

function renderCliAuth(request: CliAuthRequest): string {
  const returnPath = buildCliAuthReturnPath('/cli-auth', request);
  window.location.href = `http://localhost${returnPath}`;
  render(<CliAuthPage />);
  return returnPath;
}

async function expectGoogleCallback(request: CliAuthRequest): Promise<void> {
  const returnPath = renderCliAuth(request);

  fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(mocks.signInSocial).toHaveBeenCalledTimes(1));
  expect(mocks.signInSocial).toHaveBeenCalledWith({
    provider: 'google',
    callbackURL: `${window.location.origin}${returnPath}`,
  });
}

describe('unauthenticated CLI auth inline sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: null } });
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

  test('preserves the exact v1 request through the inline form and Better Auth', async () => {
    await expectGoogleCallback({
      protocolVersion: 1,
      callback: 'http://127.0.0.1:43123/callback',
    });
  });

  test('preserves the exact state-bound v2 request through the inline form and Better Auth', async () => {
    await expectGoogleCallback({
      protocolVersion: 2,
      callback: 'http://127.0.0.1:43123/callback',
      state: 'state_token-that-is-url-safe-1234567890',
    });
  });

  test('preserves the v2 callback through email/password Better Auth', async () => {
    const returnPath = renderCliAuth({
      protocolVersion: 2,
      callback: 'http://127.0.0.1:43123/callback',
      state: 'state_token-that-is-url-safe-1234567890',
    });

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
});
