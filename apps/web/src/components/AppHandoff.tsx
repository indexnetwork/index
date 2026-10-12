import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import Download, { AppCard, AppsShell, HermesIcon, IndexIcon, MAC_APP_REQUIREMENTS, WebIcon } from "@/app/download/page";
import { HERMES_INSTALL_URL, MAC_APP_DOWNLOAD_URL } from "@/app/site/links";
import { useAuthContext } from "@/contexts/AuthContext";
import { authClient } from "@/lib/auth-client";
import { isHermesUserAgent, isMacUserAgent } from "@/lib/devices";

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
 * launch screen whose button opens `index://` or `hermes://`. A signed-out
 * visitor opening a profile sees that public page. Everyone else gets the web
 * page (`webPage`), or the download page when there is none (`/o`).
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
  if (route === "signed-out") return kind === "u" && webPage ? <>{webPage}</> : <Download overlay />;
  if ((route === "mac" || route === "hermes") && !showWeb) {
    return (
      <AppLaunch
        app={route}
        macHref={macUrl}
        hermesHref={hermesUrl}
        onContinue={webPage ? () => { writeStayOnWeb(); setShowWeb(true); } : undefined}
      />
    );
  }
  return <>{fallback}</>;
}

/**
 * Offers where to open the link, laid out like the download page: one card
 * per place Index runs, in the same order. Nothing opens until a click.
 *
 * - The app this account uses is the only primary card, labelled YOUR APP.
 * - The other app gets the same "open in" button, for someone who uses both.
 * - Each app card carries its own install link, since "open" only works once
 *   it is installed; that replaces a separate get-the-apps row.
 * - Web continues to this page in the browser (`onContinue`), or to `/` for a
 *   link with no web page.
 */
function AppLaunch({ app, macHref, hermesHref, onContinue }: {
  app: "mac" | "hermes";
  macHref: string;
  hermesHref: string;
  onContinue?: () => void;
}) {
  const mac = app === "mac";
  const openClass = (primary: boolean) => `site-btn site-btn--block${primary ? "" : " site-btn--secondary"}`;
  const webAction = onContinue ? (
    <button type="button" className={openClass(false)} onClick={onContinue}>Continue on web →</button>
  ) : (
    <a className={openClass(false)} href="/">Go to Index →</a>
  );
  return (
    <AppsShell overlay>
      <div className="apps-intro">
        <h1 className="site-h1 apps-title">{mac ? "Open in Index" : "Open in Hermes"}</h1>
        <p className="site-p">Pick where to open this link.</p>
      </div>

      <div className="apps-cards apps-cards--three">
        <AppCard
          icon={<IndexIcon />}
          label={mac ? "YOUR APP" : "APP"}
          title="Index for Mac"
          body={`Open this link in the desktop app. ${MAC_APP_REQUIREMENTS}.`}
          action={
            <div className="apps-card-actions">
              <a className={openClass(mac)} href={macHref}>Open in Index →</a>
              <a className="apps-card-alt" href={MAC_APP_DOWNLOAD_URL}><span className="apps-card-alt-lead">Don&apos;t have it? </span>Download .dmg ↓</a>
            </div>
          }
        />
        <AppCard
          icon={<HermesIcon />}
          label={mac ? "PLUGIN" : "YOUR APP"}
          title="Hermes plugin"
          body="Open this link in Hermes, with Index as a plugin."
          action={
            <div className="apps-card-actions">
              <a className={openClass(!mac)} href={hermesHref}>Open in Hermes →</a>
              <a className="apps-card-alt" href={HERMES_INSTALL_URL}><span className="apps-card-alt-lead">Don&apos;t have it? </span>Install plugin →</a>
            </div>
          }
        />
        <AppCard
          icon={<WebIcon />}
          label="WEB"
          title="Index in the browser"
          body={onContinue ? "Open this page here instead. Nothing to install." : "This link opens in an app. Continue to Index on the web."}
          action={<div className="apps-card-actions">{webAction}</div>}
        />
      </div>
    </AppsShell>
  );
}
