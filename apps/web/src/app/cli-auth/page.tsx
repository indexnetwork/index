import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { apiClient } from "@/lib/api";
import AuthForm from "@/components/AuthForm";
import { buildCliApiKeyCallbackUrl, buildCliCredentialCreateBody, buildCliAuthReturnPath, buildLegacyCliCallbackUrl, parseCliAuthRequest, type CliAuthRequest } from "@/lib/cli-auth";

/**
 * CLI authentication bridge page.
 *
 * Opened by `index login` — exchanges the user's existing browser session
 * for a revocable CLI API key and redirects to the local callback server.
 *
 * Query params:
 *   - v1 (TEMPORARY): callback only, for the already-released CLI
 *   - v2: callback, exact version=2, and one-time state
 *
 * Flow:
 *   1. Fail closed on malformed/unknown protocol combinations
 *   2. If user has a session cookie, mint a version-tagged CLI API key
 *   3. Return the v1-compatible session_token name or the state-bound v2 fields
 *   4. If no session, show the sign-in form inline; Better Auth returns to
 *      this exact validated request after login
 *
 * The v1 bridge must remain until released clients have aged out. Its
 * session_token value is deliberately an API-key secret, never a browser JWT.
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

        // Mint a non-web API-key principal so CLI chat keeps compatibility
        // orchestrator behavior without creating a session-JWT web bypass.
        const credential = await apiClient.post<{ key: string; id: string; expiresAt: string }>(
          "/auth/cli-credential",
          buildCliCredentialCreateBody(authRequest),
        );
        if (!credential.key || !credential.id || !credential.expiresAt) {
          setStatus("error");
          setError("Failed to obtain credentials. Please try signing in again.");
          return;
        }

        setStatus("redirecting");
        window.location.href = authRequest.protocolVersion === 1
          ? buildLegacyCliCallbackUrl(authRequest.callback, credential.key)
          : buildCliApiKeyCallbackUrl(
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
