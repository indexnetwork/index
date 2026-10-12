import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import Download, { AppCard, AppsShell, HermesIcon, WebIcon } from "@/app/download/page";
import { HERMES_INSTALL_URL } from "@/app/site/links";
import { useAuthContext } from "@/contexts/AuthContext";
import { authClient } from "@/lib/auth-client";
import { isHermesUserAgent } from "@/lib/devices";

const HERMES_OPEN_URL = "hermes://open/index-network";
const HERMES_PARAM = { u: "user", i: "intent", o: "o" } as const;
const STAY_ON_WEB_KEY = "index.handoff.web";

type Kind = keyof typeof HERMES_PARAM;
type Target = "hermes" | null;

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
 * A signed-in account with a Hermes session gets a launch screen whose button
 * opens `hermes://`. A signed-out visitor opening a profile sees that public
 * page. Everyone else gets the web page (`webPage`), or the download page when
 * there is none (`/o`).
 *
 * Continue in the app remembers the choice in this browser. Later external opens
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
  const hermesUrl = `${HERMES_OPEN_URL}?${HERMES_PARAM[kind]}=${encodeURIComponent(id)}`;

  useEffect(() => {
    if (!isAuthenticated || !external) return;
    authClient.listSessions().then(
      ({ data }) => {
        const agents = ((data ?? []) as Array<{ userAgent?: string | null }>).map((s) => s.userAgent);
        setTarget(agents.some(isHermesUserAgent) ? "hermes" : null);
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
  if (route === "hermes" && !showWeb) {
    return (
      <AppLaunch
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
 * - Hermes is the primary card, labelled YOUR APP.
 * - It carries its own install link, since "open" only works once it is
 *   installed; that replaces a separate get-the-apps row.
 * - The app card continues to this page here (`onContinue`), or to `/` for a
 *   link with no web page.
 */
function AppLaunch({ hermesHref, onContinue }: {
  hermesHref: string;
  onContinue?: () => void;
}) {
  const openClass = (primary: boolean) => `site-btn site-btn--block${primary ? "" : " site-btn--secondary"}`;
  const webAction = onContinue ? (
    <button type="button" className={openClass(false)} onClick={onContinue}>Continue in the app →</button>
  ) : (
    <a className={openClass(false)} href="/">Open app →</a>
  );
  return (
    <AppsShell overlay>
      <div className="apps-intro">
        <h1 className="site-h1 apps-title">Open in Hermes</h1>
        <p className="site-p">Pick where to open this link.</p>
      </div>

      <div className="apps-cards">
        <AppCard
          icon={<HermesIcon />}
          label="YOUR APP"
          title="Hermes plugin"
          body="Open this link in Hermes, with Index as a plugin."
          action={
            <div className="apps-card-actions">
              <a className={openClass(true)} href={hermesHref}>Open in Hermes →</a>
              <a className="apps-card-alt" href={HERMES_INSTALL_URL}><span className="apps-card-alt-lead">Don&apos;t have it? </span>Install plugin →</a>
            </div>
          }
        />
        <AppCard
          icon={<WebIcon />}
          label="APP"
          title="Index app"
          body={onContinue ? "Open this page in the Index app instead." : "Open the Index app instead."}
          action={<div className="apps-card-actions">{webAction}</div>}
        />
      </div>
    </AppsShell>
  );
}
