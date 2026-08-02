import { useState } from 'react';
import { Frame } from '../components/Frame';
import { api, type SignInStart } from '../api/client';

/** The deployed variant of {@link SignInStart}, once the union has been narrowed. */
type TokenStart = Extract<SignInStart, { kind: 'token' }>;

/**
 * Sign-in screen shown when the operator has no ops session.
 *
 * The server decides which of two exchanges it runs and says so in the reply to
 * `POST /api/auth/login`; this screen never guesses.
 *
 *  - Locally the server returns a bridge URL. The Index web app's /cli-auth page
 *    mints a revocable API key from the operator's existing browser session and
 *    redirects back to /callback, where the ops server establishes its session.
 *  - On a deployed host the bridge cannot complete — `validateCliCallbackUrl` in
 *    apps/web accepts only `http:` on loopback, deliberately — so the server
 *    returns the API and web app origins instead. This screen fetches a
 *    better-auth JWT from the API with the browser's own session cookie
 *    (cross-site works because that cookie is `SameSite=None; Secure`) and posts
 *    it to the ops server, which resolves it against `/api/auth/me` and applies
 *    the same domain policy. The browser supplies a token, never an identity.
 *
 * The token is a bearer credential. It exists in a local const for the length of
 * one exchange: it never reaches React state, the DOM, the URL or a log.
 */
export function SignIn() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set when the API says this browser has no Index session.
   *
   * The operator has been sent to the web app in a *new tab*, so this one keeps
   * its place: navigating away would sign them in with no way back, which is the
   * same dead end as a sign-in that redirects to a page this site does not serve.
   * Holding the start here is what lets "continue" retry the identical exchange.
   */
  const [awaitingIndex, setAwaitingIndex] = useState<TokenStart | null>(null);

  /** Fetches a token, submits it, and reloads into the signed-in dashboard. */
  const exchangeToken = async (start: TokenStart): Promise<void> => {
    const response = await fetch(`${start.apiUrl}/api/auth/token`, {
      // The browser's own Index session is the whole credential here.
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (response.status === 401) {
      // No Index session in this browser. Sign in over there, come back here.
      // Re-opened on every attempt, including "continue" pressed too early: a
      // click that appeared to do nothing would read as a broken button.
      window.open(start.webAppUrl, '_blank', 'noopener,noreferrer');
      setAwaitingIndex(start);
      setLoading(false);
      return;
    }
    if (!response.ok) {
      throw new Error(`Index could not issue a session token (HTTP ${response.status}).`);
    }

    const body: unknown = await response.json();
    const token = (body as { token?: unknown }).token;
    if (typeof token !== 'string' || token === '') {
      throw new Error('Index did not return a session token.');
    }

    // Resolved server-side; the reply carries the identity and never the token.
    await api.submitToken(token);
    // The shell asks who is signed in on mount, so a reload is the whole handoff.
    window.location.reload();
  };

  const handleSignIn = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // Asked once. A retry reuses the answer rather than minting a bridge state
      // nobody will ever return.
      const started = awaitingIndex ?? (await api.login());
      if (started.kind === 'bridge') {
        window.location.href = started.url;
        return;
      }
      await exchangeToken(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md p-4">
        {/* Labelled "sign in", not "index eval ops": the shell header already
            carries the site title, and two copies of it would read as a heading
            duplicated by mistake. */}
        <Frame label="sign in">
          <div className="flex flex-col gap-4 py-4">
            <p className="text-term-fg">
              {awaitingIndex === null
                ? 'Sign in with your Index account to access the eval ops dashboard.'
                : 'Sign in to Index in the tab that just opened, then continue here.'}
            </p>
            <button
              onClick={handleSignIn}
              disabled={loading}
              className="px-4 py-2 bg-term-panel border border-term-rule text-term-cyan hover:bg-term-rule disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={awaitingIndex === null ? 'Sign in with Index' : 'Continue'}
            >
              {/* Not "Redirecting...": the deployed exchange never leaves this page. */}
              {loading ? 'Signing in...' : awaitingIndex === null ? 'Sign in with Index' : 'Continue'}
            </button>
            {error && (
              <p className="text-term-red text-sm">{error}</p>
            )}
          </div>
        </Frame>
      </div>
    </div>
  );
}
