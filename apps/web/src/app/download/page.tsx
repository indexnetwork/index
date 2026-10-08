import { useEffect, type ReactNode } from "react";
import { ensureSiteFonts, SiteFooter, SiteNav } from "@/app/site/SiteLayout";
import { HERMES_INSTALL_URL, MAC_APP_DOWNLOAD_URL } from "@/app/site/links";
import "@/app/site/site.css";
import "./download.css";

/** Shown on the Index for Mac card. */
export const MAC_APP_REQUIREMENTS = "macOS 13+, Apple silicon";

/**
 * Single-viewport shell for the install pages: logo bar, a vertically centred
 * `main` that scrolls on its own when the window is short, and the footer.
 * `overlay` covers the chrome of a route that renders it in place.
 */
export function AppsShell({ overlay, children }: { overlay?: boolean; children: ReactNode }) {
  useEffect(() => {
    ensureSiteFonts();
  }, []);

  return (
    <div className={overlay ? "site apps apps--overlay" : "site apps"}>
      <div className="apps-col">
        <SiteNav logoOnly />
        <main className="apps-main">{children}</main>
        <SiteFooter className="site-footer apps-footer" />
      </div>
    </div>
  );
}

export function AppCard({
  icon,
  label,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <section className="apps-card">
      <div className="apps-card-head">
        {icon}
        <span className="apps-card-label">{label}</span>
      </div>
      <div className="apps-card-text">
        <h2 className="site-col-title">{title}</h2>
        <p className="site-p">{body}</p>
      </div>
      {action}
    </section>
  );
}

export function IndexIcon() {
  return <img className="apps-card-icon" src="/site/index-logo.png" alt="Index" />;
}

export function HermesIcon() {
  return <img className="apps-card-icon apps-card-icon--mark" src="/site/nous-research.png" alt="Hermes" />;
}

/** `/download` — post-invite install page: Mac app, Hermes plugin, web. */
export default function Download({ overlay }: { overlay?: boolean }) {
  return (
    <AppsShell overlay={overlay}>
      <div className="apps-intro">
        <h1 className="site-h1 apps-title">Get the apps</h1>
        <p className="site-p">
          Install Index on macOS or add the Hermes plugin to stay connected to your networks.
        </p>
      </div>

      <div className="apps-cards">
        <AppCard
          icon={<IndexIcon />}
          label="APP"
          title="Index for Mac"
          body={`Our desktop app. ${MAC_APP_REQUIREMENTS}.`}
          action={
            <a className="site-btn site-btn--block" href={MAC_APP_DOWNLOAD_URL}>
              Download .dmg ↓
            </a>
          }
        />
        <AppCard
          icon={<HermesIcon />}
          label="PLUGIN"
          title="Hermes plugin"
          body="Already use Hermes? Add Index to the agent you have."
          action={
            <a className="site-btn site-btn--secondary site-btn--block" href={HERMES_INSTALL_URL}>
              Install plugin →
            </a>
          }
        />
      </div>

      <a className="apps-browser" href="/">
        <span className="apps-browser-icon apps-browser-icon--web" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="0.8">
            <circle cx="8" cy="8" r="6.25" />
            <ellipse cx="8" cy="8" rx="2.6" ry="6.25" />
            <path d="M1.75 8h12.5" />
          </svg>
        </span>
        <span className="apps-browser-text">
          <span className="apps-browser-title">Index in the browser</span>
          <span className="apps-browser-sub">The same app. Nothing to install.</span>
        </span>
        <span className="apps-browser-cta">Open Index</span>
      </a>
    </AppsShell>
  );
}

export const Component = Download;
