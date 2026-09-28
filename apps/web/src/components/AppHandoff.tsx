import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import Download, { IndexMark } from "@/app/download/page";
import { useAuthContext } from "@/contexts/AuthContext";
import { authClient } from "@/lib/auth-client";
import { isHermesUserAgent, isMacUserAgent } from "@/lib/devices";

export const DOWNLOAD_PATH = "/download";

const HERMES_OPEN_URL = "hermes://open/index-network";
const HERMES_PARAM = { u: "user", i: "intent", o: "o" } as const;

type Kind = keyof typeof HERMES_PARAM;
type Target = "mac" | "hermes" | null;

/**
 * Web end of a canonical entity link (`/u`, `/i`, `/o`).
 *
 * A working universal link opens the macOS app before this renders. Otherwise
 * a signed-in account opens its Mac app over `index://` (which needs no
 * associated domain, so it also covers Chrome, pasted links, and other hosts),
 * then Hermes, then the web page (`webPage`). Signed-out visitors get one
 * Hermes attempt with the download page underneath, since a browser cannot
 * tell what is installed.
 */
export default function AppHandoff({ kind, id, webPage }: { kind: Kind; id: string; webPage?: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthContext();
  const [target, setTarget] = useState<Target | undefined>(undefined);
  const [showWeb, setShowWeb] = useState(false);
  // Only a link opened from outside hands off; in-app navigation stays on web.
  const { key } = useLocation();
  const [external] = useState(key === "default");
  const fallback = webPage ?? <Download overlay />;
  const macUrl = `index://${kind}/${encodeURIComponent(id)}`;
  const hermesUrl = `${HERMES_OPEN_URL}?${HERMES_PARAM[kind]}=${encodeURIComponent(id)}`;

  useEffect(() => {
    if (!isAuthenticated || !external) return;
    authClient.listSessions().then(
      ({ data }) => {
        const agents = ((data ?? []) as Array<{ userAgent?: string | null }>).map((s) => s.userAgent);
        setTarget(agents.some(isMacUserAgent) ? "mac" : agents.some(isHermesUserAgent) ? "hermes" : null);
      },
      () => setTarget(null),
    );
  }, [isAuthenticated, external]);

  const route = isLoading
    ? "pending"
    : !external
      ? "web"
      : !isAuthenticated
        ? "signed-out"
        : target === undefined
          ? "pending"
          : target ?? "web";

  useEffect(() => {
    if (route === "mac") window.location.href = macUrl;
    else if (route === "hermes" || route === "signed-out") window.location.href = hermesUrl;
  }, [route, macUrl, hermesUrl]);

  if (route === "pending") return null;
  if (route === "signed-out") return <Download overlay />;
  if ((route === "mac" || route === "hermes") && !showWeb) {
    return (
      <AppLaunch
        app={route}
        href={route === "mac" ? macUrl : hermesUrl}
        onContinue={webPage ? () => setShowWeb(true) : undefined}
      />
    );
  }
  return <>{fallback}</>;
}

/**
 * Shown while the browser hands the link to the app. The page cannot tell
 * whether the app opened, so it offers a retry and a way on instead of
 * claiming success.
 */
function AppLaunch({ app, href, onContinue }: { app: "mac" | "hermes"; href: string; onContinue?: () => void }) {
  const mac = app === "mac";
  return (
    <div className="download-page download-page--overlay">
      <main className="download-page__main">
        <h1 className="download-page__title">{mac ? "opening index" : "opening hermes"}</h1>
        <p className="download-page__lede">If nothing happened, open it again below.</p>

        <div className="download-page__offers">
          <div className="download-page__cards">
            <section className="download-card">
              <div className="download-card__body">
                <span className={mac ? "download-card__icon" : "download-card__icon download-card__icon--outlined"}>
                  {mac ? <IndexMark /> : <img src="/logos/nous.webp" alt="" aria-hidden="true" />}
                </span>
                <h2 className="download-card__name">{mac ? "Index for Mac" : "Hermes"}</h2>
                <a className="download-btn download-btn--primary" href={href}>
                  {mac ? "OPEN INDEX →" : "OPEN HERMES →"}
                </a>
              </div>
            </section>
          </div>

          {onContinue ? (
            <button type="button" className="download-page__browser" onClick={onContinue}>
              Continue on web →
            </button>
          ) : (
            <a className="download-page__browser" href={DOWNLOAD_PATH}>
              Get the apps →
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
