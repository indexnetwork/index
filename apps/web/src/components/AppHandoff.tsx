import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import Download from "@/app/download/page";
import { useAuthContext } from "@/contexts/AuthContext";
import { authClient } from "@/lib/auth-client";
import { isHermesUserAgent } from "@/lib/devices";

export const DOWNLOAD_PATH = "/download";

const HERMES_OPEN_URL = "hermes://open/index-network";

/**
 * Web end of a canonical entity link (`/u`, `/i`, `/o`).
 *
 * With the macOS app installed the OS opens these URLs before this renders.
 * Otherwise: a signed-in account with a Hermes session goes to Hermes; other
 * signed-in users get the web page (`webPage`); signed-out visitors get one
 * Hermes attempt with the download page underneath, since a browser cannot
 * tell whether Hermes is installed.
 */
export default function AppHandoff({ hermesQuery, webPage }: { hermesQuery?: string; webPage?: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthContext();
  const [hasHermes, setHasHermes] = useState<boolean | null>(null);
  const [showWeb, setShowWeb] = useState(false);
  // Only a link opened from outside hands off; in-app navigation stays on web.
  const { key } = useLocation();
  const [external] = useState(key === "default");
  const hermesUrl = external && hermesQuery ? `${HERMES_OPEN_URL}?${hermesQuery}` : null;
  const fallback = webPage ?? <Download />;

  useEffect(() => {
    if (!isAuthenticated || !hermesUrl) return;
    authClient.listSessions().then(
      ({ data }) => setHasHermes(((data ?? []) as Array<{ userAgent?: string | null }>).some((s) => isHermesUserAgent(s.userAgent))),
      () => setHasHermes(false),
    );
  }, [isAuthenticated, hermesUrl]);

  const route = isLoading
    ? "pending"
    : !isAuthenticated
      ? "signed-out"
      : !hermesUrl
        ? "web"
        : hasHermes === null
          ? "pending"
          : hasHermes ? "hermes" : "web";

  useEffect(() => {
    if (hermesUrl && (route === "signed-out" || route === "hermes")) window.location.href = hermesUrl;
  }, [route, hermesUrl]);

  if (route === "pending") return null;
  if (route === "signed-out") return external ? <Download /> : <>{fallback}</>;
  if (route === "hermes" && !showWeb) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <p className="text-gray-900 mb-4">Opened in Hermes.</p>
          {webPage && (
            <button onClick={() => setShowWeb(true)} className="text-sm text-gray-500 hover:text-black underline">
              View on web
            </button>
          )}
        </div>
      </div>
    );
  }
  return <>{fallback}</>;
}
