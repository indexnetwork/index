import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { apiClient } from "@/lib/api";
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
 *   4. If no session, preserve the exact validated request through login
 *
 * The v1 bridge must remain until released clients have aged out. Its
 * session_token value is deliberately an API-key secret, never a browser JWT.
 */
function CliAuthPage() {
  const [request] = useState<CliAuthRequest | null>(() =>
    parseCliAuthRequest(new URLSearchParams(window.location.search))
  );
  const [status, setStatus] = useState<"loading" | "error" | "redirecting">(
    request ? "loading" : "error",
  );
  const [error, setError] = useState<string | null>(
    request ? null : "Invalid CLI callback. Use `index login` from the CLI.",
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
          // No session — redirect to home page to log in, then return here
          // with the same callback and one-time state intact.
          const returnPath = buildCliAuthReturnPath(
            window.location.pathname,
            authRequest,
          );
          window.location.href = `/?cli_return=${encodeURIComponent(returnPath)}`;
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
          setError("Failed to obtain CLI credentials. Please try logging in again.");
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
        setError("Authentication failed. Please try `index login` again.");
      }
    }

    exchangeToken(request);
  }, [request]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center max-w-sm px-6">
        {status === "loading" && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Authorizing CLI</h1>
            <p className="text-sm text-gray-500">Connecting to your account...</p>
          </>
        )}
        {status === "redirecting" && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">CLI authorized</h1>
            <p className="text-sm text-gray-500">Returning to terminal... You can close this window.</p>
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
