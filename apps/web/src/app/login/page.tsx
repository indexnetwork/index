import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import AuthModal from "@/components/AuthModal";

/**
 * OAuth login bridge page.
 *
 * Opened by the MCP OAuth flow when the user is not authenticated.
 * Receives signed OAuth query params from Better Auth's mcp plugin.
 *
 * Flow:
 *   1. If already logged in → forward to the MCP authorize endpoint (completes OAuth flow)
 *   2. If not logged in → show login modal with callbackURL = this page's full URL
 *      After login, Better Auth redirects back here → step 1 fires
 *
 * `client_id` decides whether this is an OAuth request at all. Without it,
 * forwarding to `/mcp/authorize` lands on Better Auth's `invalid_client` error
 * page, which reads as a failed sign-in even though the session was created
 * fine. Better Auth itself produces such a URL: its authorize route redirects
 * to `${loginPage}?${url.split("?")[1]}`, so a param-less authorize request
 * arrives here as `/login?undefined`. Treat anything without a `client_id` as
 * a plain visit: sign in against the app, not the OAuth endpoint.
 */
function LoginPage() {
  const [sessionChecked, setSessionChecked] = useState(false);
  const isOAuthRequest = new URLSearchParams(window.location.search).has("client_id");

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (!data?.session) {
        setSessionChecked(true);
      } else if (isOAuthRequest) {
        // Session exists → forward to the MCP authorize endpoint with the original OAuth params
        const protocolUrl = import.meta.env.VITE_PROTOCOL_URL ?? "";
        window.location.href = `${protocolUrl}/api/auth/mcp/authorize${window.location.search}`;
      } else {
        // Already signed in with nothing to authorize — replace so Back does not return here.
        window.location.replace("/");
      }
    }).catch(() => {
      // Network error — show login form rather than blank screen
      setSessionChecked(true);
    });
  }, [isOAuthRequest]);

  if (!sessionChecked) return null;

  // For an OAuth request, return to this page so the authorize forward can fire
  // once signed in. Otherwise send the user into the app — carrying a non-OAuth
  // query string back here would just re-enter this branch.
  const callbackURL = isOAuthRequest ? window.location.href : window.location.origin;

  return (
    <AuthModal
      isOpen={true}
      onClose={() => {}}
      callbackURL={callbackURL}
    />
  );
}

export const Component = LoginPage;
