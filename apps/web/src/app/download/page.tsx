import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ensureSiteFonts, SiteNav } from "@/app/site/SiteLayout";
import CopyPromptButton from "@/app/site/CopyPromptButton";
import { docsUrl, HERMES_INSTALL_COMMAND, HERMES_INSTALL_URL } from "@/app/site/links";
import "@/app/site/site.css";
import "@/app/site/flow.css";
import "./download.css";

/**
 * Single-viewport shell for the install pages: a vertically centred `main` that scrolls on its own when the window is short.
 * `overlay` covers the chrome of a route that renders it in place.
 */
export function AppsShell({ overlay, bar = "index", narrow = false, framed = true, brand = false, children }: {
  overlay?: boolean;
  /** Show the Index Network logo top left, where the landing page has it. */
  brand?: boolean;
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
    <div className={`site apps${overlay ? " apps--overlay" : ""}${brand ? " apps--branded" : ""}`}>
      {brand && <div className="site-col apps-nav"><SiteNav logoOnly /></div>}
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

function HermesCard({ title = "Hermes plugin", body = "Already use Hermes? Add Index to the agent you have.", cta = "Install plugin →" }: { title?: string; body?: string; cta?: string }) {
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
              {cta}
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
  columns = false,
}: {
  appHref?: string;
  prompt?: string;
  appTitle?: string;
  appBody?: string;
  hermesTitle?: string;
  hermesBody?: string;
  agentTitle?: string;
  agentBody?: string;
  /** Three columns split by hairlines, no boxes, the app's buttons (the /download page). */
  columns?: boolean;
}) {
  return (
    <div className={columns ? "apps-cards apps-cards--cols" : "apps-cards"}>
      <AppCard
        icon={<WebIcon />}
        label="APP"
        title={appTitle}
        body={appBody}
        action={
          <div className="apps-card-actions">
            <Link className={columns ? "site-btn" : "site-btn site-btn--block"} to={appHref}>{columns ? "open app →" : "Open app →"}</Link>
          </div>
        }
      />
      <HermesCard title={hermesTitle} body={hermesBody} cta={columns ? "install plugin" : undefined} />
      <AppCard
        icon={<AgentIcon />}
        label="MCP"
        title={agentTitle}
        body={agentBody}
        action={
          <div className="apps-card-actions">
            <CopyPromptButton className={columns ? "site-btn site-btn--secondary" : "site-btn site-btn--secondary site-btn--block"} label={columns ? "copy prompt" : "Copy prompt →"} text={prompt} />
          </div>
        }
      />
    </div>
  );
}

/** `/download` (Get Index): the app first, then the Hermes plugin, then a prompt for any other agent. */
export default function Download({ overlay }: { overlay?: boolean }) {
  const chips = (
    <IndexChips
      columns
      appTitle="index app"
      appBody="open index and start an intent."
      hermesTitle="hermes plugin"
      hermesBody="already use hermes? add index to the agent you have."
      agentTitle="your agent"
      agentBody="paste a prompt into claude, cursor, or any agent that takes mcp servers."
    />
  );

  return (
    <AppsShell overlay={overlay} framed={false} brand>
      <div className="apps-get">
        <h1 className="apps-get__title">get index</h1>
        {chips}
      </div>
    </AppsShell>
  );
}

export const Component = Download;
