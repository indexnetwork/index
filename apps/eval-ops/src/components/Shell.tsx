import { Link, Outlet } from 'react-router';
import { useState, useEffect } from 'react';
import { api } from '../api/client';

const LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/', label: 'overview' },
  { to: '/launch', label: 'launch' },
  { to: '/compare', label: 'compare' },
  { to: '/profiles', label: 'profiles' },
  { to: '/fixture', label: 'fixture' },
];

interface AuthStatus {
  authenticated: boolean;
  email?: string;
  name?: string;
}

/**
 * The application shell. Every route an operator needs is reachable from here by
 * mouse: these are real links with real hrefs, not keyboard shortcuts.
 */
export function Shell() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const data = await api.authStatus();
        setAuthStatus(data);
      } catch {
        // If status check fails, assume unauthenticated
        setAuthStatus({ authenticated: false });
      }
    }
    checkAuth();
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await api.logout();
      // Reload to trigger the unauthenticated flow
      window.location.reload();
    } catch {
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--color-term-rule)] px-4 py-2 flex items-baseline gap-4 justify-between">
        <div className="flex items-baseline gap-4">
          <h1 className="text-sm">index eval ops</h1>
          <nav className="flex gap-4 text-sm">
            {LINKS.map((link) => (
              <Link key={link.to} to={link.to} className="text-term-blue hover:underline">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        {authStatus?.authenticated && (
          <div className="flex items-baseline gap-4 text-sm">
            <span className="text-term-dim">{authStatus.email}</span>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="text-term-cyan hover:underline disabled:opacity-50"
              aria-label="Sign out"
            >
              {signingOut ? 'signing out...' : 'sign out'}
            </button>
          </div>
        )}
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
