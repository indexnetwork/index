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

const callback = 'http://127.0.0.1:43123/callback';
const state = 'state_token-that-is-url-safe-1234567890';

function setPage(query: string): void {
  window.location.href = `http://localhost/cli-auth?${query}`;
}

describe('CLI auth page mixed-version bridge', () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.post.mockReset();
  });

  test('mints and returns the temporary v1 contract for an authenticated session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { id: 'session-1' } } });
    mocks.post.mockResolvedValue({
      key: 'v1-secret',
      id: 'v1-key-id',
      expiresAt: '2026-10-16T12:00:00.000Z',
    });
    setPage(`callback=${encodeURIComponent(callback)}`);

    render(<CliAuthPage />);

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
      '/auth/cli-credential',
      { protocolVersion: 1 },
    ));
    await waitFor(() => expect(window.location.search).toBe('?session_token=v1-secret'));
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

    expect(await screen.findByText('Invalid CLI callback. Use `index login` from the CLI.')).toBeTruthy();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  test('preserves the exact v2 request through the login return', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    setPage(`callback=${encodeURIComponent(callback)}&version=2&state=${state}`);

    render(<CliAuthPage />);

    await waitFor(() => expect(window.location.pathname).toBe('/'));
    const returnPath = new URLSearchParams(window.location.search).get('cli_return');
    const returnUrl = new URL(returnPath ?? '', 'http://localhost');
    expect(returnUrl.pathname).toBe('/cli-auth');
    expect(returnUrl.searchParams.get('callback')).toBe(callback);
    expect(returnUrl.searchParams.get('version')).toBe('2');
    expect(returnUrl.searchParams.get('state')).toBe(state);
  });
});
