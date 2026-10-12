import { useEffect, type ReactNode } from "react";
import { ensureSiteFonts, SiteFooter, SiteNav } from "@/app/site/SiteLayout";
import CopyPromptButton from "@/app/site/CopyPromptButton";
import { HERMES_INSTALL_URL } from "@/app/site/links";
import "@/app/site/site.css";
import "./download.css";

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

export function HermesIcon() {
  return <img className="apps-card-icon apps-card-icon--mark" src="/site/nous-research.png" alt="Hermes" />;
}

export function WebIcon() {
  return (
    <span className="apps-card-icon apps-card-icon--web" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="0.8">
        <circle cx="8" cy="8" r="6.25" />
        <ellipse cx="8" cy="8" rx="2.6" ry="6.25" />
        <path d="M1.75 8h12.5" />
      </svg>
    </span>
  );
}

export function AgentIcon() {
  return (
    <span className="apps-card-icon apps-card-icon--web" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="0.8">
        <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1" />
        <path d="M10.5 5.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1h2.5" />
      </svg>
    </span>
  );
}

/** `/download` (Get Index): the app first, then the Hermes plugin, then a prompt for any other agent. */
export default function Download({ overlay }: { overlay?: boolean }) {
  return (
    <AppsShell overlay={overlay}>
      <div className="apps-intro">
        <h1 className="site-h1 apps-title">Get Index</h1>
        <p className="site-p">
          Open the app, add the Hermes plugin, or connect the agent you already use.
        </p>
      </div>

      <div className="apps-cards">
        <AppCard
          icon={<WebIcon />}
          label="APP"
          title="Index app"
          body="Open Index and start a signal."
          action={
            <div className="apps-card-actions">
              <a className="site-btn site-btn--block" href="/login">Open app →</a>
            </div>
          }
        />
        <AppCard
          icon={<HermesIcon />}
          label="PLUGIN"
          title="Hermes plugin"
          body="Already use Hermes? Add Index to the agent you have."
          action={
            <div className="apps-card-actions">
              <a className="site-btn site-btn--secondary site-btn--block" href={HERMES_INSTALL_URL}>Install plugin →</a>
            </div>
          }
        />
        <AppCard
          icon={<AgentIcon />}
          label="MCP"
          title="Your agent"
          body="Paste a prompt into Claude, Cursor, or any agent that takes MCP servers."
          action={
            <div className="apps-card-actions">
              <CopyPromptButton className="site-btn site-btn--secondary site-btn--block" label="Copy prompt →" />
            </div>
          }
        />
      </div>
    </AppsShell>
  );
}

export const Component = Download;
