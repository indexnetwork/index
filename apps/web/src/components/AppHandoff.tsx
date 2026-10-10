import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import Download, { AppCard, AppsShell, HermesIcon, IndexIcon } from "@/app/download/page";
import { useAuthContext } from "@/contexts/AuthContext";
import { authClient } from "@/lib/auth-client";
import { isHermesUserAgent, isMacUserAgent } from "@/lib/devices";

export const DOWNLOAD_PATH = "/download";

const HERMES_OPEN_URL = "hermes://open/index-network";
const HERMES_PARAM = { u: "user", i: "intent", o: "o" } as const;
const STAY_ON_WEB_KEY = "index.handoff.web";

type Kind = keyof typeof HERMES_PARAM;
type Target = "mac" | "hermes" | null;

function readStayOnWeb(): boolean {
  try {
    return localStorage.getItem(STAY_ON_WEB_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStayOnWeb() {
  try {
    localStorage.setItem(STAY_ON_WEB_KEY, "1");
  } catch {
    // Private mode can refuse storage; the wall simply returns next time.
  }
}

/**
 * Web end of a canonical entity link (`/u`, `/i`, `/o`).
 *
 * A working universal link can still open the macOS app before this renders.
 * This page does not. A signed-in account with a Mac or Hermes session gets a
 * launch screen whose button opens `index://` or `hermes://`. Everyone else
 * gets the web page (`webPage`), or the download page when there is none (`/o`).
 *
 * Continue on web remembers the choice in this browser. Later external opens
 * of a page that has a web view skip the launch screen. A link with no web
 * page (`/o`) always uses the launch screen.
 */
export default function AppHandoff({ kind, id, webPage }: { kind: Kind; id: string; webPage?: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthContext();
  const [target, setTarget] = useState<Target | undefined>(undefined);
  const [showWeb, setShowWeb] = useState(false);
  // Only a link opened from outside hands off; in-app navigation stays on web.
  const { key } = useLocation();
  const [external] = useState(key === "default");
  // Remembered only for routes that actually have a page. `/o` continues at `/`.
  const [stayOnWeb] = useState(() => !!webPage && readStayOnWeb());
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
        : stayOnWeb
          ? "web"
          : target === undefined
            ? "pending"
            : target ?? "web";

  if (route === "pending") return null;
  if (route === "signed-out") return <Download overlay />;
  if ((route === "mac" || route === "hermes") && !showWeb) {
    return (
      <AppLaunch
        app={route}
        href={route === "mac" ? macUrl : hermesUrl}
        onContinue={webPage ? () => { writeStayOnWeb(); setShowWeb(true); } : undefined}
      />
    );
  }
  return <>{fallback}</>;
}

/**
 * Offers the account's app as a click, plus install or the web page
 * (`onContinue`). A link with no web page continues at `/`.
 */
function AppLaunch({ app, href, onContinue }: { app: "mac" | "hermes"; href: string; onContinue?: () => void }) {
  const mac = app === "mac";
  const continueBody = (
    <>
      <span className="apps-browser-icon" aria-hidden="true">↗</span>
      <span className="apps-browser-text">
        <span className="apps-browser-title">Continue on web</span>
        <span className="apps-browser-sub">Open this page in the browser instead.</span>
      </span>
      <span className="apps-browser-cta">Continue →</span>
    </>
  );
  return (
    <AppsShell overlay>
      <div className="apps-intro">
        <h1 className="site-h1 apps-title">{mac ? "Open in Index" : "Open in Hermes"}</h1>
        <p className="site-p">Open this link in the app below.</p>
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

      <div className="apps-exits">
        <a className="apps-browser" href={DOWNLOAD_PATH}>
          <span className="apps-browser-icon" aria-hidden="true">↓</span>
          <span className="apps-browser-text">
            <span className="apps-browser-title">Don&apos;t have it yet?</span>
            <span className="apps-browser-sub">Install Index on macOS or add the Hermes plugin.</span>
          </span>
          <span className="apps-browser-cta">Get the apps →</span>
        </a>
        {onContinue ? (
          <button type="button" className="apps-browser" onClick={onContinue}>
            {continueBody}
          </button>
        ) : (
          <a className="apps-browser" href="/">
            {continueBody}
          </a>
        )}
      </div>
    </AppsShell>
  );
}
