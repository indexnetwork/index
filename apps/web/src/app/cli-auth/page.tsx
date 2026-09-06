import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { apiKeysService } from "@/services/api-keys";
import AuthForm from "@/components/AuthForm";
import { buildCliApiKeyCallbackUrl, buildCliAuthReturnPath, parseCliAuthRequest, type CliAuthRequest } from "@/lib/cli-auth";

/**
 * CLI authentication bridge page.
 *
 * Opened by `index login` — exchanges the user's existing browser session
 * for a revocable CLI API key and redirects to the local callback server.
 *
 * Query params: callback, exact version=2, and one-time state.
 *
 * Flow:
 *   1. Fail closed on malformed/unknown protocol combinations
 *   2. If user has a session cookie, mint a user API key
 *   3. Return the state-bound api_key/key_id/state callback fields
 *   4. If no session, show the sign-in form inline; Better Auth returns to
 *      this exact validated request after login
 */
function CliAuthPage() {
  const [request] = useState<CliAuthRequest | null>(() =>
    parseCliAuthRequest(new URLSearchParams(window.location.search))
  );
  const [status, setStatus] = useState<"loading" | "login" | "error" | "redirecting">(
    request ? "loading" : "error",
  );
  const [error, setError] = useState<string | null>(
    request ? null : "Invalid sign-in request. Start the sign-in from the Index app, or run `index login` from the CLI.",
  );
  const exchangeStartedRef = useRef(false);

  useEffect(() => {
    if (!request || exchangeStartedRef.current) return;
    // React development/StrictMode may replay effect setup. Claim this exact
    // request synchronously before any await so it can mint at most one key.
    exchangeStartedRef.current = true;

    async function exchangeToken(authRequest: CliAuthRequest) {
      try {
        // Check if user has an active session
        const session = await authClient.getSession();

        if (!session.data?.session) {
          // No session — show the sign-in form inline. Redirect-based logins
          // (Google, magic link) return to this exact callback+state request;
          // non-redirecting ones re-run the exchange via onAuthenticated.
          setStatus("login");
          return;
        }

        // Mint a user API key through the one shared mint path.
        const credential = await apiKeysService.create("CLI");
        if (!credential.key || !credential.id) {
          setStatus("error");
          setError("Failed to obtain credentials. Please try signing in again.");
          return;
        }

        setStatus("redirecting");
        window.location.href = buildCliApiKeyCallbackUrl(
          authRequest.callback,
          authRequest.state,
          credential.key,
          credential.id,
        );
      } catch {
        setStatus("error");
        setError("Authentication failed. Please try signing in again from the app.");
      }
    }

    exchangeToken(request);
  }, [request]);

  return (
    <div className="flex-1 flex items-center justify-center bg-white">
      <div className="text-center max-w-sm w-full px-6">
        {status === "login" && request && (
          <div className="auth auth-light text-left">
            <AuthForm
              callbackURL={`${window.location.origin}${buildCliAuthReturnPath(window.location.pathname, request)}`}
              onAuthenticated={() => window.location.reload()}
            />
          </div>
        )}
        {status === "loading" && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Signing you in</h1>
            <p className="text-sm text-gray-500">Connecting to your account...</p>
          </>
        )}
        {status === "redirecting" && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Signed in</h1>
            <p className="text-sm text-gray-500">Returning to the app... You can close this window.</p>
          </>
        )}
        {status === "error" && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Authorization failed</h1>
            <p className="text-sm text-gray-500">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}

export const Component = CliAuthPage;
