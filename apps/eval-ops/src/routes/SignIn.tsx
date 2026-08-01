import { useState } from 'react';
import { Frame } from '../components/Frame';
import { api } from '../api/client';

/**
 * Sign-in screen shown when the operator has no ops session.
 *
 * The server redirects unauthenticated requests to the Index web app's /cli-auth
 * bridge, which mints a revocable API key from the user's existing browser session
 * and redirects back to /callback where the ops server establishes its own session.
 */
export function SignIn() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.login();
      // Navigate to the bridge URL
      window.location.href = data.url;
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
              Sign in with your Index account to access the eval ops dashboard.
            </p>
            <button
              onClick={handleSignIn}
              disabled={loading}
              className="px-4 py-2 bg-term-panel border border-term-rule text-term-cyan hover:bg-term-rule disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Sign in with Index"
            >
              {loading ? 'Redirecting...' : 'Sign in with Index'}
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
