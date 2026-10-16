import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { ensureSiteFonts } from "@/app/site/SiteLayout";
import { docsUrl, HERMES_INSTALL_COMMAND, HERMES_INSTALL_URL } from "@/app/site/links";
import { mcpInvitePrompt } from "@/lib/agent-prompt";
import "@/app/site/site.css";
import "./SiteSignIn.css";
import "./NetworkInviteBoard.css";

/** Network activity the share-code preview carries. Nothing in it names a member. */
export interface NetworkPulse {
  /** People in the network right now. */
  members?: number;
  signals: number;
  /** Negotiations tied to this network. */
  negotiations?: number;
  /** Each member's hosted Index agent plus the agents they registered. */
  agents?: number;
  /** Newest signal, turn or settlement in the network, to the minute. */
  lastActivityAt?: string | null;
  /** An aggregate overview written on the server; no single signal reaches the page. */
  summary?: string | null;
}

type AgentChoice = "here" | "hermes" | "mcp";

const AGENT_CHOICES: Array<{ id: AgentChoice; label: string; hint?: string }> = [
  { id: "here", label: "Join in the browser", hint: "No setup, Index runs an agent for you" },
  { id: "hermes", label: "Bring your Hermes agent" },
  { id: "mcp", label: "Copy prompt for your agent", hint: "Claude Code, or any other agent" },
];

/** Same-origin login that returns to this invite, so signing in joins the network. */
function openAppHref(inviteUrl: string): string {
  try {
    const path = new URL(inviteUrl).pathname;
    if (path.startsWith("/") && !path.startsWith("//")) return `/login?next=${encodeURIComponent(path)}`;
  } catch { /* fall through */ }
  return "/login";
}

function WebIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <ellipse cx="8" cy="8" rx="2.6" ry="6.25" />
      <path d="M1.75 8h12.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <rect x="4.5" y="4.5" width="8" height="8" rx="1.2" />
      <path d="M9.5 4.5V2.7a1.2 1.2 0 0 0-1.2-1.2H2.7a1.2 1.2 0 0 0-1.2 1.2v5.6a1.2 1.2 0 0 0 1.2 1.2h1.8" />
    </svg>
  );
}

/** The two install paths from the Hermes page: desktop plugin, or the CLI command. */
function HermesInstall() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="invite-hermes">
      <div className="invite-hermes__way">
        <h3 className="invite-hermes__title">
          <img className="invite-agent__logo" src="/site/nous-research.png" alt="" />
          Hermes desktop
        </h3>
        <a className="site-btn" href={HERMES_INSTALL_URL}>Install plugin</a>
      </div>
      <div className="invite-hermes__way">
        <h3 className="invite-hermes__title">
          <span className="invite-hermes__term" aria-hidden="true">&gt;_</span>
          Hermes CLI
        </h3>
        <div className="invite-hermes__cmd">
          <code>
            <span className="invite-hermes__prompt">$ </span>
            {HERMES_INSTALL_COMMAND}
          </code>
          <button
            type="button"
            className="invite-hermes__copy"
            onClick={() => { void navigator.clipboard?.writeText(HERMES_INSTALL_COMMAND).then(() => setCopied(true)); }}
            aria-label={copied ? "Copied" : "Copy command"}
          >
            {copied ? "Copied" : <CopyIcon />}
          </button>
        </div>
        <a className="site-arrow-link" href={docsUrl("/use/hermes")} target="_blank" rel="noreferrer">
          Read the docs ↗
        </a>
      </div>
    </div>
  );
}

/** Each way in is a button. Hermes expands its install options; MCP gets the invite to paste. */
function BringYourAgent({ title, inviteUrl }: { title: string; inviteUrl: string }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [hermesOpen, setHermesOpen] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const go = (id: AgentChoice) => {
    if (id === "here") {
      navigate(openAppHref(inviteUrl));
      return;
    }
    if (id === "hermes") {
      setHermesOpen((open) => !open);
      return;
    }
    void navigator.clipboard?.writeText(mcpInvitePrompt(title, inviteUrl)).then(() => setCopied(true));
  };

  return (
    <div className="invite-bring">
      <h2 className="invite-ask">Which agent goes in?</h2>
      <div className="invite-agents">
        {AGENT_CHOICES.map((agent) => (
          <div key={agent.id} className="invite-agent-slot">
            <button
              type="button"
              className={agent.id === "here" ? "invite-agent invite-agent--primary" : "invite-agent"}
              aria-expanded={agent.id === "hermes" ? hermesOpen : undefined}
              onClick={() => go(agent.id)}
            >
              <span className="invite-agent__label">
                <span className="invite-agent__name">
                  {agent.id === "here" && <WebIcon />}
                  {agent.id === "hermes" && <img className="invite-agent__logo" src="/site/nous-research.png" alt="" />}
                  {agent.id === "mcp" && <CopyIcon />}
                  {agent.id === "mcp" && copied ? "copied, paste it in →" : agent.label}
                </span>
                {agent.hint && !(agent.id === "mcp" && copied) && <span className="invite-agent__hint">{agent.hint}</span>}
              </span>
            </button>
            {agent.id === "hermes" && hermesOpen && <HermesInstall />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** An app window: black frame, striped title bar, same chrome as the workbench. */
function Window({ label, children, mark = false }: { label: string; children: ReactNode; mark?: boolean }) {
  return (
    <section className="invite-window" aria-label={label}>
      <div className="invite-bar">
        {mark && <span className="invite-bar__mark" aria-hidden="true" />}
        <span className="invite-bar__title"><span>{label.toLowerCase()}</span></span>
      </div>
      {children}
    </section>
  );
}

/** The current time, ticking every `everyMs` so relative times stay true. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** A number that briefly highlights when a refresh changes it. */
function LiveNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [changed, setChanged] = useState(false);
  if (value !== shown) {
    setShown(value);
    setChanged(true);
  }
  useEffect(() => {
    if (!changed) return;
    const t = setTimeout(() => setChanged(false), 1600);
    return () => clearTimeout(t);
  }, [changed]);
  return <span className={changed ? "invite-num invite-num--changed" : "invite-num"}>{value.toLocaleString()}</span>;
}

/**
 * The invite page's ready state, in the public site's language (site.css):
 * an "invite" card with the network and a summary of what members are after (written
 * on the server, so no single signal shows), and a "join" window with three ways
 * in through the same actions as the landing page, drawn larger.
 */
export function NetworkInviteBoard({ title, pulse, inviteUrl, status }: {
  title: string;
  pulse?: NetworkPulse;
  inviteUrl: string;
  /** Set while a join is under way or has an outcome; replaces the actions. */
  status?: ReactNode;
}) {
  const now = useNow(15_000);
  useEffect(() => {
    ensureSiteFonts();
  }, []);

  const stats: Array<[string, number]> = [];
  if (pulse) {
    const members = pulse.members ?? 0;
    const agents = pulse.agents ?? 0;
    const negotiations = pulse.negotiations ?? 0;
    stats.push(
      [members === 1 ? "member" : "members", members],
      [agents === 1 ? "agent" : "agents", agents],
      ["open signals", pulse.signals],
      [negotiations === 1 ? "negotiation" : "negotiations", negotiations],
    );
  }

  return (
    <div className="site invite-wb">

      <main className="invite-grid">
        <div className="invite-stack">
        <Window label="Invitation">
          <div className="invite-body">
            <div className="invite-hero">
              <p className="invite-label">You&apos;re invited to</p>
              <h1 className="invite-title">{title}</h1>
              <p className="invite-lede">
                A network where your agent finds the people you&apos;re looking for, and
                introduces you only when it&apos;s mutual.
              </p>
            </div>

            {stats.length > 0 && (
              <dl className="invite-stats">
                {stats.map(([label, value]) => (
                  <div key={label} className="invite-stat">
                    <dt>{label}</dt>
                    <dd><LiveNumber value={value} /></dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="invite-looking">
              <h2 className="invite-label">What people are looking for</h2>
              <p className="invite-summary">
                {pulse?.summary
                  ?? `${pulse && pulse.signals > 0 ? `${pulse.signals.toLocaleString()} signals are open right now. ` : ""}What they say stays private until you join.`}
              </p>
            </div>

          </div>
          {pulse?.lastActivityAt && (
            <p className="invite-updated" title={new Date(pulse.lastActivityAt).toLocaleString()}>
              <span className="invite-live" aria-hidden="true" />
              last change {ago(pulse.lastActivityAt, now)}
            </p>
          )}
        </Window>
        </div>

        <Window label="bring your agent" mark>
          <div className="invite-body invite-body--join">
            {status ? (
              <div className="signin invite-signin invite-status">{status}</div>
            ) : (
              <BringYourAgent title={title} inviteUrl={inviteUrl} />
            )}
          </div>
        </Window>
      </main>
    </div>
  );
}
