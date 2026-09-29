import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import Download, { AppCard, AppsShell, HermesIcon, IndexIcon } from "@/app/download/page";
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
    <AppsShell overlay>
      <div className="apps-intro">
        <h1 className="site-h1 apps-title">{mac ? "Opening Index" : "Opening Hermes"}</h1>
        <p className="site-p">If nothing happened, open it again below.</p>
      </div>

      <div className="apps-cards">
        <AppCard
          icon={mac ? <IndexIcon /> : <HermesIcon />}
          label={mac ? "APP" : "PLUGIN"}
          title={mac ? "Index for Mac" : "Hermes"}
          body={mac ? "Open this link in the Index app." : "Open this link in Hermes."}
          action={
            <a className="site-btn site-btn--block" href={href}>
              {mac ? "Open Index →" : "Open Hermes →"}
            </a>
          }
        />
      </div>

      {onContinue ? (
        <button type="button" className="apps-browser" onClick={onContinue}>
          <span className="apps-browser-icon" aria-hidden="true">↗</span>
          <span className="apps-browser-text">
            <span className="apps-browser-title">Continue on web</span>
            <span className="apps-browser-sub">Open this page in the browser instead.</span>
          </span>
          <span className="apps-browser-cta">Continue →</span>
        </button>
      ) : (
        <a className="apps-browser" href={DOWNLOAD_PATH}>
          <span className="apps-browser-icon" aria-hidden="true">↓</span>
          <span className="apps-browser-text">
            <span className="apps-browser-title">Don&apos;t have it yet?</span>
            <span className="apps-browser-sub">Install Index on macOS or add the Hermes plugin.</span>
          </span>
          <span className="apps-browser-cta">Get the apps →</span>
        </a>
      )}
    </AppsShell>
  );
}
