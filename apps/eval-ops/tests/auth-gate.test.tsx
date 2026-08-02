import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { App } from '../src/App';

/**
 * The gate, exercised through the real app rather than through the two screens.
 *
 * Rendering `SignIn` directly proves only that the component exists; it says
 * nothing about whether anything mounts it. These tests render `<App />` — the
 * real router, the real shell, the real routes — against a stubbed
 * `GET /api/auth/status`, which is exactly the surface where "built but never
 * wired" is visible.
 */

/** Every dashboard frame Overview renders. None may appear behind a login prompt. */
const DASHBOARD_CONTENT = [/harness health/i, /recent runs/i, /fixture status/i];

const AUTHENTICATED = { authenticated: true, email: 'ops@index.network', name: 'Ops' };

/** Empty-but-valid bodies for the routes Overview fetches on mount. */
function dashboardResponse(url: string): Response | null {
  if (url.endsWith('/api/harnesses')) return new Response(JSON.stringify({ harnesses: [] }));
  if (url.endsWith('/api/artifacts')) return new Response(JSON.stringify({ refs: [], issues: [] }));
  if (url.endsWith('/api/runs')) return new Response(JSON.stringify({ runs: [], issues: [] }));
  if (url.endsWith('/api/fixture')) return new Response(JSON.stringify({ allowed: false, reason: 'not configured' }));
  return null;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the shell gates the dashboard on the server\'s answer', () => {
  it('renders the sign-in prompt and no dashboard content while unauthenticated', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/auth/status')) {
        return new Response(JSON.stringify({ authenticated: false }));
      }
      // What the server would really answer: the gate refuses every other route.
      return new Response(
        JSON.stringify({ error: 'Sign in with your Index account to use the eval ops site.', authenticated: false }),
        { status: 401 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('button', { name: /sign in with index/i })).toBeInTheDocument();
    for (const content of DASHBOARD_CONTENT) {
      expect(screen.queryByText(content)).not.toBeInTheDocument();
    }

    // The stronger claim: the routes never mounted, so nothing was even asked for.
    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.filter((path) => !path.startsWith('/api/auth/'))).toEqual([]);
  });

  it('renders neither the dashboard nor the sign-in prompt while the answer is outstanding', async () => {
    // A status request that never settles: the shell must sit in its neutral state
    // rather than guessing, in either direction.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    render(<App />);

    expect(await screen.findByText(/checking your index session/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in with index/i })).not.toBeInTheDocument();
    for (const content of DASHBOARD_CONTENT) {
      expect(screen.queryByText(content)).not.toBeInTheDocument();
    }
  });

  it('renders the dashboard once the operator is authenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url);
        if (path.endsWith('/api/auth/status')) return new Response(JSON.stringify(AUTHENTICATED));
        return dashboardResponse(path) ?? new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }),
    );

    render(<App />);

    for (const content of DASHBOARD_CONTENT) {
      expect(await screen.findByText(content)).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /sign in with index/i })).not.toBeInTheDocument();
  });

  it('replaces the dashboard with the refusal screen when a gated route answers 403 permitted:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url);
        if (path.endsWith('/api/auth/status')) return new Response(JSON.stringify(AUTHENTICATED));
        if (path.endsWith('/api/runs')) {
          // Exactly what the server's auth gate emits for a session the domain
          // policy no longer admits.
          return new Response(
            JSON.stringify({ error: 'not an @index.network account', authenticated: true, permitted: false }),
            { status: 403 },
          );
        }
        return dashboardResponse(path) ?? new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }),
    );

    render(<App />);

    expect(await screen.findByText(/not permitted/i)).toBeInTheDocument();
    for (const content of DASHBOARD_CONTENT) {
      expect(screen.queryByText(content)).not.toBeInTheDocument();
    }
    // A refusal is not an invitation to sign in again: that would loop.
    expect(screen.queryByRole('button', { name: /sign in with index/i })).not.toBeInTheDocument();
  });

  it('does not mistake some other 403 for a domain refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url);
        if (path.endsWith('/api/auth/status')) return new Response(JSON.stringify(AUTHENTICATED));
        if (path.endsWith('/api/fixture')) {
          // The fixture guard's refusal: a 403 with no `permitted` field, which
          // says nothing about who is signed in.
          return new Response(JSON.stringify({ error: 'that database is not disposable' }), { status: 403 });
        }
        return dashboardResponse(path) ?? new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }),
    );

    render(<App />);

    expect(await screen.findByText(/that database is not disposable/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/not permitted/i)).not.toBeInTheDocument();
  });
});
