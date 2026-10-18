import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ensureSiteFonts } from "@/app/site/SiteLayout";
import CopyPromptButton from "@/app/site/CopyPromptButton";
import { docsUrl, HERMES_INSTALL_COMMAND, HERMES_INSTALL_URL } from "@/app/site/links";
import "@/app/site/site.css";
import "./download.css";

/**
 * Single-viewport shell for the install pages: logo bar, a vertically centred
 * `main` that scrolls on its own when the window is short, and the footer.
 * `overlay` covers the chrome of a route that renders it in place.
 */
export function AppsShell({ overlay, bar = "index", narrow = false, framed = true, children }: {
  overlay?: boolean;
  bar?: string;
  narrow?: boolean;
  /** When false, children are separate windows on the desktop, not one pane. */
  framed?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    ensureSiteFonts();
  }, []);

  return (
    <div className={overlay ? "site apps apps--overlay" : "site apps"}>
      <div className={narrow ? "apps-col apps-col--narrow" : "apps-col"}>
        <main className="apps-main">
          {framed ? (
            <section className="apps-board">
              <h2 className="apps-card-bar"><span>{bar}</span></h2>
              <div className="apps-board__body">{children}</div>
            </section>
          ) : children}
        </main>
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
  body?: string;
  action: ReactNode;
}) {
  return (
    <section className="apps-card">
      <h2 className="apps-card-bar"><span>{label.toLowerCase()}</span></h2>
      <div className="apps-card-body">
        <div className="apps-card-text">
          <h3 className="apps-card-title">{icon}{title}</h3>
          {body ? <p className="site-p">{body}</p> : null}
        </div>
        {action}
      </div>
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

/** Desktop install and the CLI command, the same two paths as the Hermes page. */
function HermesInstall() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="apps-hermes">
      <div className="apps-hermes__way">
        <h4 className="apps-hermes__title">
          <img src="/site/nous-research.png" alt="" />
          Hermes desktop
        </h4>
        <a className="site-btn site-btn--secondary site-btn--block" href={HERMES_INSTALL_URL}>Install plugin</a>
      </div>
      <div className="apps-hermes__way">
        <h4 className="apps-hermes__title">
          <span className="apps-hermes__term" aria-hidden="true">&gt;_</span>
          Hermes CLI
        </h4>
        <div className="apps-hermes__cmd">
          <code>
            <span className="apps-hermes__prompt">$ </span>
            {HERMES_INSTALL_COMMAND}
          </code>
          <button
            type="button"
            className="apps-hermes__copy"
            onClick={() => { void navigator.clipboard?.writeText(HERMES_INSTALL_COMMAND).then(() => setCopied(true)); }}
            aria-label={copied ? "Copied" : "Copy command"}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <a className="site-arrow-link" href={docsUrl("/use/hermes")} target="_blank" rel="noreferrer">
          Read the docs ↗
        </a>
      </div>
    </div>
  );
}

function HermesCard({ title = "Hermes plugin", body = "Already use Hermes? Add Index to the agent you have." }: { title?: string; body?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <AppCard
      icon={<HermesIcon />}
      label="PLUGIN"
      title={title}
      body={body}
      action={
        <div className="apps-card-actions">
          {open ? <HermesInstall /> : (
            <button
              type="button"
              className="site-btn site-btn--secondary site-btn--block"
              aria-expanded={false}
              onClick={() => setOpen(true)}
            >
              Install plugin →
            </button>
          )}
        </div>
      }
    />
  );
}

/** The three ways in: Index app, Hermes plugin, or a prompt for any other agent. */
export function IndexChips({
  appHref = "/login",
  prompt,
  appTitle = "Index app",
  appBody = "Open Index and start an intent.",
  hermesTitle = "Hermes plugin",
  hermesBody = "Already use Hermes? Add Index to the agent you have.",
  agentTitle = "Your agent",
  agentBody = "Paste a prompt into Claude, Cursor, or any agent that takes MCP servers.",
}: {
  appHref?: string;
  prompt?: string;
  appTitle?: string;
  appBody?: string;
  hermesTitle?: string;
  hermesBody?: string;
  agentTitle?: string;
  agentBody?: string;
}) {
  return (
    <div className="apps-cards">
      <AppCard
        icon={<WebIcon />}
        label="APP"
        title={appTitle}
        body={appBody}
        action={
          <div className="apps-card-actions">
            <Link className="site-btn site-btn--block" to={appHref}>Open app →</Link>
          </div>
        }
      />
      <HermesCard title={hermesTitle} body={hermesBody} />
      <AppCard
        icon={<AgentIcon />}
        label="MCP"
        title={agentTitle}
        body={agentBody}
        action={
          <div className="apps-card-actions">
            <CopyPromptButton className="site-btn site-btn--secondary site-btn--block" label="Copy prompt →" text={prompt} />
          </div>
        }
      />
    </div>
  );
}

/** `/download` (Get Index): the app first, then the Hermes plugin, then a prompt for any other agent. */
export default function Download({ overlay }: { overlay?: boolean }) {
  return (
    <AppsShell overlay={overlay} framed={false}>
      <IndexChips />
    </AppsShell>
  );
}

export const Component = Download;
