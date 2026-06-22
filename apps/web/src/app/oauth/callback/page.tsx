import { useEffect } from "react";

/**
 * Minimal OAuth callback page.
 * Composio redirects here after the user completes Gmail auth.
 * Notifies the opener via postMessage so the parent can proceed immediately,
 * then attempts to close the popup.
 */
function OAuthCallbackPage() {
  const params = new URLSearchParams(window.location.search);
  const hasError = params.has("error");
  const status = hasError ? "error" : "success";

  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage(
        { type: "oauth_callback", status },
        window.location.origin,
      );
    }
    window.close();
  }, [status]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <p className="text-sm text-neutral-400">
        {hasError ? "Authorization failed — you can close this window." : "Connected — you can close this window."}
      </p>
    </div>
  );
}

export const Component = OAuthCallbackPage;
