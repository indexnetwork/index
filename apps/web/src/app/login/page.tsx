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
 */
function LoginPage() {
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (data?.session) {
        // Session exists → forward to the MCP authorize endpoint with the original OAuth params
        const protocolUrl = import.meta.env.VITE_PROTOCOL_URL ?? "";
        window.location.href = `${protocolUrl}/api/auth/mcp/authorize${window.location.search}`;
      } else {
        setSessionChecked(true);
      }
    }).catch(() => {
      // Network error — show login form rather than blank screen
      setSessionChecked(true);
    });
  }, []);

  if (!sessionChecked) return null;

  // Pass the current full URL as callbackURL so Better Auth returns here after login
  const callbackURL = window.location.href;

  return (
    <AuthModal
      isOpen={true}
      onClose={() => {}}
      callbackURL={callbackURL}
    />
  );
}

export const Component = LoginPage;
