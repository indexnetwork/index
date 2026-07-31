import { Link, Outlet } from 'react-router';
import { useState, useEffect } from 'react';
import { api, onAuthRefusal } from '../api/client';
import { Frame } from './Frame';
import { SignIn } from '../routes/SignIn';
import { NotPermitted } from '../routes/NotPermitted';

const LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/', label: 'overview' },
  { to: '/launch', label: 'launch' },
  { to: '/compare', label: 'compare' },
  { to: '/profiles', label: 'profiles' },
  { to: '/fixture', label: 'fixture' },
];

/**
 * What the shell knows about the operator, and therefore what it may render.
 *
 * `unknown` is a real state rather than an optimistic "assume signed in": every
 * route fetches on mount, so rendering the dashboard before the answer arrives
 * would fire a screenful of calls that all come back 401 and leave the operator
 * reading error frames behind a login prompt.
 */
type Access =
  | { kind: 'unknown' }
  | { kind: 'signed-out' }
  | { kind: 'not-permitted' }
  | { kind: 'signed-in'; email?: string; name?: string };

/**
 * The application shell, and the one place the dashboard is gated.
 *
 * Every route an operator needs is reachable from here by mouse: these are real
 * links with real hrefs, not keyboard shortcuts. The header chrome stays put in
 * every state so the browser's own back and forward keep working, but `<Outlet />`
 * — and with it every route's data fetching — mounts only once the server has
 * said this browser holds a session it admits.
 */
export function Shell() {
  const [access, setAccess] = useState<Access>({ kind: 'unknown' });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let mounted = true;

    // A refusal seen by any later API call demotes the shell: a session can end
    // while the page is open (the server restarts, or sign-out happens in another
    // tab), and 403 with permitted:false is the only way the domain refusal is
    // observable in a browser at all.
    const unsubscribe = onAuthRefusal((refusal) => {
      if (!mounted) return;
      setAccess(refusal === 'not-permitted' ? { kind: 'not-permitted' } : { kind: 'signed-out' });
    });

    api
      .authStatus()
      .then((status) => {
        if (!mounted) return;
        setAccess(
          status.authenticated
            ? { kind: 'signed-in', email: status.email, name: status.name }
            : { kind: 'signed-out' },
        );
      })
      .catch(() => {
        // Fail closed: an unanswerable status question is not permission.
        if (mounted) setAccess({ kind: 'signed-out' });
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
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
        {access.kind === 'signed-in' && (
          <div className="flex items-baseline gap-4 text-sm">
            <span className="text-term-dim">{access.email}</span>
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
        {access.kind === 'unknown' && <CheckingSession />}
        {access.kind === 'signed-out' && <SignIn />}
        {access.kind === 'not-permitted' && <NotPermitted />}
        {access.kind === 'signed-in' && <Outlet />}
      </main>
    </div>
  );
}

/** The neutral state between asking who is signed in and being told. */
function CheckingSession() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md p-4">
        <Frame label="session">
          <p className="text-term-dim py-4">Checking your Index session...</p>
        </Frame>
      </div>
    </div>
  );
}
