import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { protocolOrigin } from "@/lib/protocol-origin";
import AuthModal from "@/components/AuthModal";

/** A same-origin path to resume after login. Anything else returns home. */
function resumePath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

/** Browser login, returning the owner to the app. */
function LoginPage() {
  const [sessionChecked, setSessionChecked] = useState(false);
  // The MCP plugin passes the original authorize query to /login. The API
  // validates it again; no client-provided redirect URL is navigated to here.
  const isMcpLogin = new URLSearchParams(window.location.search).has('client_id');
  const authorizeURL = `${protocolOrigin() || window.location.origin}/api/auth/mcp/authorize${window.location.search}`;
  const destination = isMcpLogin ? authorizeURL : resumePath();
  const finishLogin = () => window.location.replace(destination);

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (!data?.session) setSessionChecked(true);
      else window.location.replace(destination);
    }).catch(() => {
      // Network error — show login form rather than blank screen.
      setSessionChecked(true);
    });
  }, [destination]);

  if (!sessionChecked) return null;

  return (
    <AuthModal
      isOpen={true}
      onClose={() => {
        authClient.getSession().then(({ data }) => {
          if (data?.session) finishLogin();
        });
      }}
      callbackURL={isMcpLogin ? window.location.href : window.location.origin + destination}
    />
  );
}

export const Component = LoginPage;
