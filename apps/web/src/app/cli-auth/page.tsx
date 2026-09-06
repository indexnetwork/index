import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import AuthForm from "@/components/AuthForm";
import { buildCliDeviceCodeCallbackUrl, buildCliAuthReturnPath, parseCliAuthRequest, DEVICE_CLIENT_ID, type CliAuthRequest } from "@/lib/cli-auth";

/**
 * Device sign-in bridge page.
 *
 * Opened by `index login`, the Mac app and Hermes — runs the device
 * authorization grant against the owner's browser session and redirects the
 * approved code to the local callback server, which exchanges it for a session
 * of its own.
 *
 * Query params: callback, exact version=2, and one-time state.
 *
 * Flow:
 *   1. Fail closed on malformed/unknown protocol combinations
 *   2. If the user has a session cookie, mint a device code, claim it and
 *      approve it — the page owns every step, so there is nothing to prompt
 *      for and no caller-supplied code can enter the grant
 *   3. Return the state-bound device_code/state callback fields
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

        const requested = await authClient.device.code({
          client_id: DEVICE_CLIENT_ID,
          scope: "openid profile",
        });
        const deviceCode = requested.data?.device_code;
        const userCode = requested.data?.user_code;
        if (!deviceCode || !userCode) {
          setStatus("error");
          setError("Failed to start device sign-in. Please try again from the app.");
          return;
        }

        // Reading the code with a session claims it for this owner, which is
        // what makes it approvable; approval then only ever binds a code this
        // page just minted.
        await authClient.device({ query: { user_code: userCode } });
        const approved = await authClient.device.approve({ userCode });
        if (!approved.data?.success) {
          setStatus("error");
          setError("Failed to authorize this device. Please try again from the app.");
          return;
        }

        setStatus("redirecting");
        window.location.href = buildCliDeviceCodeCallbackUrl(
          authRequest.callback,
          authRequest.state,
          deviceCode,
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
