import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * CLI authentication bridge page.
 *
 * Opened by `index login` — exchanges the user's existing browser session
 * for a JWT and redirects to the CLI's local callback server.
 *
 * Query params:
 *   - callback: URL of the CLI's local callback server (required)
 *
 * Flow:
 *   1. If user has a session cookie, exchange it for a JWT via Better Auth
 *   2. Redirect to callback URL with ?session_token=<jwt>
 *   3. If no session, redirect to login with a return URL back here
 */
function CliAuthPage() {
  const [status, setStatus] = useState<"loading" | "error" | "redirecting">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackUrl = params.get("callback");

    if (!callbackUrl) {
      setStatus("error");
      setError("Missing callback parameter. Use `index login` from the CLI.");
      return;
    }

    async function exchangeToken(callback: string) {
      try {
        // Check if user has an active session
        const session = await authClient.getSession();

        if (!session.data?.session) {
          // No session — redirect to home page to log in, then return here
          const returnUrl = `${window.location.pathname}?callback=${encodeURIComponent(callback)}`;
          window.location.href = `/?cli_return=${encodeURIComponent(returnUrl)}`;
          return;
        }

        // Exchange session cookie for JWT
        const { data, error: tokenError } = await authClient.token();

        if (tokenError || !data?.token) {
          setStatus("error");
          setError("Failed to obtain token. Please try logging in again.");
          return;
        }

        // Redirect to CLI callback with token
        setStatus("redirecting");
        const redirectUrl = `${callback}?session_token=${encodeURIComponent(data.token)}`;
        window.location.href = redirectUrl;
      } catch {
        setStatus("error");
        setError("Authentication failed. Please try `index login` again.");
      }
    }

    exchangeToken(callbackUrl);
  }, []);

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
