import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import AuthForm from "@/components/AuthForm";
import { AppsShell } from "@/app/download/page";
import { buildCliDeviceCodeCallbackUrl, buildCliAuthReturnPath, parseCliAuthRequest, DEVICE_CLIENT_ID, type CliAuthRequest } from "@/lib/cli-auth";

import "./cli-auth.css";

function Status({ title, message, ok, action }: {
  title: string;
  message: string;
  ok?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="cli-auth__status">
      {ok && (
        <div className="cli-auth__check">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#0b1612" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
      )}
      <h1>{title}</h1>
      <p>{message}</p>
      {action && (
        <div style={{ marginTop: 24 }}>
          <button type="button" className="site-btn" onClick={action.onClick}>{action.label}</button>
        </div>
      )}
    </div>
  );
}

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
          setError("Couldn't start device sign-in. Try again, or restart sign-in from the app.");
          return;
        }

        // Reading the code with a session claims it for this owner, which is
        // what makes it approvable; approval then only ever binds a code this
        // page just minted.
        await authClient.device({ query: { user_code: userCode } });
        const approved = await authClient.device.approve({ userCode });
        if (!approved.data?.success) {
          setStatus("error");
          setError("Couldn't authorize this device. Try again, or restart sign-in from the app.");
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
        setError("Sign-in didn't go through. Try again, or restart sign-in from the app.");
      }
    }

    exchangeToken(request);
  }, [request]);

  return (
    <AppsShell>
      <div className="cli-auth">
        {status === "login" && request && (
          <div className="auth cli-auth__form">
            <AuthForm
              callbackURL={`${window.location.origin}${buildCliAuthReturnPath(window.location.pathname, request)}`}
              onAuthenticated={() => window.location.reload()}
            />
          </div>
        )}
        {status === "loading" && (
          <Status title="Signing you in" message="Connecting to your account…" />
        )}
        {status === "redirecting" && (
          <Status ok title="Authentication complete" message="You can close this window now." />
        )}
        {status === "error" && (
          <Status
            title="Authorization failed"
            message={error ?? ""}
            // A malformed request can only be fixed by starting again from the app or CLI.
            // Runtime failures reload this same validated request, which mints a fresh device code.
            action={request ? { label: "Try again", onClick: () => window.location.reload() } : undefined}
          />
        )}
      </div>
    </AppsShell>
  );
}

export const Component = CliAuthPage;
