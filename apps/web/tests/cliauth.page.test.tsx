import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { Component as CliAuthPage } from '@/app/cli-auth/page';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: mocks.getSession },
}));

vi.mock('@/lib/api', () => ({
  apiClient: { post: mocks.post },
}));

vi.mock('@/app/landing/Nav', () => ({
  ensureLandingFonts: vi.fn(),
}));

const callback = 'http://127.0.0.1:43123/callback';
const state = 'state_token-that-is-url-safe-1234567890';

function setPage(query: string): void {
  window.location.href = `http://localhost/cli-auth?${query}`;
}

describe('CLI auth page v2 bridge', () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.post.mockReset();
  });

  test('fails a legacy v1 callback-only request closed', async () => {
    setPage(`callback=${encodeURIComponent(callback)}`);

    render(<CliAuthPage />);

    expect(await screen.findByText('Invalid sign-in request. Start the sign-in from the Index app, or run `index login` from the CLI.')).toBeTruthy();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  test('mints and returns the exact state-bound v2 contract', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { id: 'session-2' } } });
    mocks.post.mockResolvedValue({
      key: 'v2-secret',
      id: 'v2-key-id',
      expiresAt: '2026-10-16T12:00:00.000Z',
    });
    setPage(`callback=${encodeURIComponent(callback)}&version=2&state=${state}`);

    render(<CliAuthPage />);

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
      '/auth/cli-credential',
      { protocolVersion: 2 },
    ));
    await waitFor(() => {
      expect(window.location.search).toBe(`?api_key=v2-secret&key_id=v2-key-id&state=${state}`);
    });
  });

  test('mints at most one key when React replays effect setup', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { id: 'session-strict' } } });
    mocks.post.mockResolvedValue({
      key: 'strict-secret',
      id: 'strict-key-id',
      expiresAt: '2026-10-16T12:00:00.000Z',
    });
    setPage(`callback=${encodeURIComponent(callback)}&version=2&state=${state}`);

    render(<StrictMode><CliAuthPage /></StrictMode>);

    await waitFor(() => expect(window.location.search).toContain('api_key=strict-secret'));
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  test('fails malformed v2 closed before session lookup or key minting', async () => {
    setPage(`callback=${encodeURIComponent(callback)}&version=2`);

    render(<CliAuthPage />);

    expect(await screen.findByText('Invalid sign-in request. Start the sign-in from the Index app, or run `index login` from the CLI.')).toBeTruthy();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  test('shows the inline sign-in form on the page when there is no session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      providers: ['google'],
      emailPassword: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    setPage(`callback=${encodeURIComponent(callback)}&version=2&state=${state}`);

    try {
      render(<CliAuthPage />);

      expect(await screen.findByText('Sign in to the Index Network')).toBeTruthy();
      // Stays on the exact validated request — no home-page redirect.
      expect(window.location.pathname).toBe('/cli-auth');
      expect(new URLSearchParams(window.location.search).get('state')).toBe(state);
      expect(mocks.post).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
