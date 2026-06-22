import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { ComponentPropsWithoutRef } from "react";

function isGmailOAuthHref(href: string | undefined): href is string {
  if (!href) return false;
  try {
    const hostname = new URL(href).hostname;
    return hostname.endsWith("composio.dev") || hostname === "accounts.google.com";
  } catch {
    return false;
  }
}

/**
 * Shared hook for the Gmail OAuth popup flow used in both onboarding and in-chat.
 *
 * Returns `OAuthLink` — a drop-in `a` renderer for ReactMarkdown that detects
 * Gmail OAuth URLs and renders the styled Connect/Connected button entirely
 * in-hook. Callers need no OAuth-related DOM or state of their own.
 *
 * @example
 * const { OAuthLink } = useGmailConnect(() => sendMessage("I've connected my account…"));
 * <ReactMarkdown components={{ a: OAuthLink }}>{content}</ReactMarkdown>
 */
export function useGmailConnect(onConnected: () => void) {
  const [gmailConnected, setGmailConnected] = useState(false);

  // Ref so the setInterval callback is never stale after re-renders.
  const onConnectedRef = useRef(onConnected);
  useEffect(() => { onConnectedRef.current = onConnected; }, [onConnected]);

  const openGmailPopup = useCallback((href: string) => {
    const width = 560, height = 720;
    const left = Math.round(window.screen.width / 2 - width / 2);
    const top = Math.round(window.screen.height / 2 - height / 2);
    const popup = window.open(
      href,
      "oauth_gmail",
      `width=${width},height=${height},left=${left},top=${top}`,
    );
    if (!popup) return;

    let succeeded = false;

    const cleanup = () => {
      clearInterval(poll);
      clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
    };

    const complete = () => {
      succeeded = true;
      cleanup();
      setGmailConnected(true);
      onConnectedRef.current();
    };

    // Primary: postMessage from /oauth/callback page (fires even if window.close() is blocked).
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "oauth_callback" && event.data?.status === "success") complete();
    };
    window.addEventListener("message", handleMessage);

    // Fallback: detect popup close without success callback — just clean up, don't mark connected.
    const poll = setInterval(() => {
      if (popup.closed && !succeeded) cleanup();
    }, 1500);

    // Safety timeout: stop listening after 5 minutes.
    const timeout = setTimeout(cleanup, 300_000);
  }, []);

  /**
   * Drop-in `a` renderer for ReactMarkdown.
   * Recreated only when `gmailConnected` transitions true (once per session).
   */
  const OAuthLink = useMemo(() => {
    function GmailOAuthLink({ href, children, ...props }: ComponentPropsWithoutRef<"a">) {
      if (!isGmailOAuthHref(href)) {
        return (
          <a href={href} {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }

      if (gmailConnected) {
        return (
          <span
            style={{ color: "#22c55e" }}
            className="flex items-center gap-2 px-4 py-2 mt-3 bg-neutral-100 text-sm font-medium rounded-md w-fit cursor-default"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Gmail Connected
          </span>
        );
      }

      return (
        <button
          type="button"
          onClick={() => openGmailPopup(href)}
          style={{ color: "white" }}
          className="flex items-center gap-2 px-4 py-2 mt-3 bg-black hover:bg-neutral-800 text-sm font-medium rounded-md transition-colors w-fit cursor-pointer"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Connect Gmail
        </button>
      );
    }
    return GmailOAuthLink;
  }, [gmailConnected, openGmailPopup]);

  return { OAuthLink };
}
