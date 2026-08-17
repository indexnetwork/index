import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { Component as LoginPage } from '@/app/login/page';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: mocks.getSession },
}));

// Stand in for the real modal so the test can read the callbackURL it is handed
// without pulling in AuthForm's providers fetch.
vi.mock('@/components/AuthModal', () => ({
  default: ({ callbackURL }: { callbackURL?: string }) => (
    <div data-testid="auth-modal" data-callback={callbackURL} />
  ),
}));

const OAUTH_QUERY = 'client_id=mcp-client&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%2Fcb';

function setPage(query: string): void {
  window.location.href = query ? `http://localhost/login?${query}` : 'http://localhost/login';
}

describe('login page OAuth bridge', () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
  });

  test('forwards a signed-in OAuth request to the MCP authorize endpoint', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { id: 'session-1' } } });
    setPage(OAUTH_QUERY);

    render(<LoginPage />);

    await waitFor(() => expect(window.location.pathname).toBe('/api/auth/mcp/authorize'));
    expect(window.location.search).toBe(`?${OAUTH_QUERY}`);
  });

  test('sends a signed-in visitor home instead of to the invalid_client error page', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { id: 'session-2' } } });
    // Better Auth redirects a param-less authorize request here as `?undefined`.
    setPage('undefined');

    render(<LoginPage />);

    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(window.location.search).toBe('');
  });

  test('returns to the OAuth request after signing in', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    setPage(OAUTH_QUERY);

    render(<LoginPage />);

    const modal = await screen.findByTestId('auth-modal');
    expect(modal.getAttribute('data-callback')).toBe(`http://localhost/login?${OAUTH_QUERY}`);
  });

  test('signs a plain visitor into the app rather than back into this page', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    setPage('undefined');

    render(<LoginPage />);

    const modal = await screen.findByTestId('auth-modal');
    expect(modal.getAttribute('data-callback')).toBe('http://localhost');
  });
});
