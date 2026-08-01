import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';

import { SignIn } from '../src/routes/SignIn';
import { NotPermitted } from '../src/routes/NotPermitted';
import { Shell } from '../src/components/Shell';

/**
 * The real `window.location`, saved while a test is standing in for it.
 *
 * happy-dom's `location` is not assignable, so the navigation test below replaces
 * the whole property. Vitest runs every file in a worker against one `window`, so
 * leaving the stub in place would hand a later test — anything driving
 * react-router's history, for instance — a plain object with no `assign`, no
 * `reload` and no origin.
 */
let realLocation: PropertyDescriptor | undefined;

/** Replaces `window.location` with a recording stub, remembering the real one. */
function stubLocation(): void {
  realLocation = Object.getOwnPropertyDescriptor(window, 'location');
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: { href: string } }).location = { href: '' };
}

afterEach(() => {
  cleanup();
  if (realLocation !== undefined) {
    delete (window as unknown as { location?: unknown }).location;
    Object.defineProperty(window, 'location', realLocation);
    realLocation = undefined;
  }
});

describe('SignIn', () => {
  it('shows the sign-in button when unauthenticated', () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    render(
      <BrowserRouter>
        <SignIn />
      </BrowserRouter>
    );

    expect(screen.getByRole('button', { name: /sign in with index/i })).toBeInTheDocument();
  });

  it('calls POST /api/auth/login and navigates to the returned URL', async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/auth/login') && init?.method === 'POST') {
        return new Response(JSON.stringify({ url: 'https://index.network/cli-auth?callback=http://127.0.0.1:4321/callback&version=2&state=abc' }));
      }
      return new Response('{}');
    });
    vi.stubGlobal('fetch', mockFetch);

    stubLocation();

    render(
      <BrowserRouter>
        <SignIn />
      </BrowserRouter>
    );

    const button = screen.getByRole('button', { name: /sign in/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/login'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    await waitFor(() => {
      expect(window.location.href).toContain('/cli-auth');
    });
  });

  it('never renders server-supplied strings as HTML', () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const { container } = render(
      <BrowserRouter>
        <SignIn />
      </BrowserRouter>
    );

    // React escapes by default, so any attempt to render HTML would appear as text
    expect(container.innerHTML).not.toContain('dangerouslySetInnerHTML');
  });
});

describe('NotPermitted', () => {
  it('explains that only @index.network accounts are allowed', () => {
    render(
      <BrowserRouter>
        <NotPermitted />
      </BrowserRouter>
    );

    expect(screen.getByText(/index\.network/i)).toBeInTheDocument();
    expect(screen.getByText(/not permitted/i)).toBeInTheDocument();
  });

  it('does not suggest signing in again (that would be a loop)', () => {
    render(
      <BrowserRouter>
        <NotPermitted />
      </BrowserRouter>
    );

    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  });

  it('is visually distinct from the sign-in screen', () => {
    const { container, unmount } = render(
      <BrowserRouter>
        <SignIn />
      </BrowserRouter>
    );
    const signinText = container.textContent;
    unmount();

    const { container: notPermittedContainer } = render(
      <BrowserRouter>
        <NotPermitted />
      </BrowserRouter>
    );

    // They should have different content
    expect(signinText).not.toBe(notPermittedContainer.textContent);
  });
});

describe('Shell with auth', () => {
  it('offers no nav links while signed out', async () => {
    // A link that changes the URL and still renders the sign-in prompt offers a
    // choice that does not exist.
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/auth/status')) {
        return new Response(JSON.stringify({ authenticated: false }));
      }
      return new Response('{}');
    }) as unknown as typeof fetch;

    render(
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in with index/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'fixture' })).not.toBeInTheDocument();
  });

  it('shows user email when authenticated', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/auth/status')) {
        return new Response(JSON.stringify({ authenticated: true, email: 'test@index.network', name: 'Test User' }));
      }
      return new Response('{}');
    }) as unknown as typeof fetch;

    render(
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('test@index.network')).toBeInTheDocument();
    });
  });

  it('shows a sign-out button when authenticated', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/auth/status')) {
        return new Response(JSON.stringify({ authenticated: true, email: 'test@index.network', name: 'Test User' }));
      }
      return new Response('{}');
    }) as unknown as typeof fetch;

    render(
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    });
  });

  it('calls POST /api/auth/logout when sign-out is clicked', async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/auth/status')) {
        return new Response(JSON.stringify({ authenticated: true, email: 'test@index.network', name: 'Test User' }));
      }
      if (String(url).endsWith('/api/auth/logout') && init?.method === 'POST') {
        return new Response('{}');
      }
      return new Response('{}');
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    });

    const button = screen.getByRole('button', { name: /sign out/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/logout'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
