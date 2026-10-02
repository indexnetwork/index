import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import AuthModal from "@/components/AuthModal";

/** Browser login, returning the owner to the app. */
function LoginPage() {
  const [sessionChecked, setSessionChecked] = useState(false);
  // The MCP plugin passes the original authorize query to /login. The API
  // validates it again; no client-provided redirect URL is navigated to here.
  const isMcpLogin = new URLSearchParams(window.location.search).has('client_id');
  const authorizeURL = `${import.meta.env.VITE_PROTOCOL_URL || window.location.origin}/api/auth/mcp/authorize${window.location.search}`;
  const finishLogin = () => window.location.replace(isMcpLogin ? authorizeURL : '/');

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (!data?.session) setSessionChecked(true);
      else window.location.replace(isMcpLogin ? authorizeURL : '/');
    }).catch(() => {
      // Network error — show login form rather than blank screen.
      setSessionChecked(true);
    });
  }, [isMcpLogin, authorizeURL]);

  if (!sessionChecked) return null;

  return (
    <AuthModal
      isOpen={true}
      onClose={() => {
        authClient.getSession().then(({ data }) => {
          if (data?.session) finishLogin();
        });
      }}
      callbackURL={isMcpLogin ? window.location.href : window.location.origin}
    />
  );
}

export const Component = LoginPage;
