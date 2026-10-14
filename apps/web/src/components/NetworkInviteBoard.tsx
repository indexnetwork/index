import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { ensureSiteFonts } from "@/app/site/SiteLayout";
import { hermesInvitePrompt, mcpInvitePrompt } from "@/lib/agent-prompt";
import "@/app/site/site.css";
import "./SiteSignIn.css";
import "./NetworkInviteBoard.css";

/** One line of the anonymized negotiation log: what happened, never what was said or by whom. */
export type NegotiationLogEvent =
  | { kind: "turn"; thread: number; from: string; to: string; action: "propose" | "counter" | "accept" | "decline"; turn: number; at: string }
  | { kind: "close"; thread: number; a: string; b: string; outcome: "agreed" | "declined" | "closed"; turns: number; at: string };

/** Network activity the share-code preview carries. Nothing in it names a member. */
export interface NetworkPulse {
  signals: number;
  opportunities: number;
  /** Agents whose owner has a signal in this network. */
  agents?: number;
  /** Turns taken across negotiations in this network. */
  turns?: number;
  negotiations: { live: number; total: number; agreed: number; declined?: number };
  /** Distinct people whose agents are mid-negotiation here. */
  agentsLive?: number;
  /** Newest signal, turn or settlement in the network, to the minute. */
  lastActivityAt?: string | null;
  log?: NegotiationLogEvent[];
  /** An aggregate overview written on the server; no single signal reaches the page. */
  summary: string | null;
  /** A very high-level line on what the agents are negotiating about, written the same way. */
  negotiationSummary?: string | null;
}

type AgentChoice = "here" | "hermes" | "mcp";

const AGENT_CHOICES: Array<{ id: AgentChoice; label: string; hint?: string }> = [
  { id: "here", label: "Make a new one here" },
  { id: "hermes", label: "Hermes" },
  { id: "mcp", label: "MCP", hint: "Claude Code, or any other agent" },
];

/** Same-origin login that returns to this invite, so signing in joins the network. */
function openAppHref(inviteUrl: string): string {
  try {
    const path = new URL(inviteUrl).pathname;
    if (path.startsWith("/") && !path.startsWith("//")) return `/login?next=${encodeURIComponent(path)}`;
  } catch { /* fall through */ }
  return "/login";
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <rect x="4.5" y="4.5" width="8" height="8" rx="1.2" />
      <path d="M9.5 4.5V2.7a1.2 1.2 0 0 0-1.2-1.2H2.7a1.2 1.2 0 0 0-1.2 1.2v5.6a1.2 1.2 0 0 0 1.2 1.2h1.8" />
    </svg>
  );
}

/** Each way in is a button. A new agent is made here; Hermes and MCP get the invite to paste. */
function BringYourAgent({ title, inviteUrl }: { title: string; inviteUrl: string }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState<AgentChoice | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const go = (id: AgentChoice) => {
    if (id === "here") {
      navigate(openAppHref(inviteUrl));
      return;
    }
    const prompt = id === "hermes" ? hermesInvitePrompt(title, inviteUrl) : mcpInvitePrompt(title, inviteUrl);
    void navigator.clipboard?.writeText(prompt).then(() => setCopied(id));
  };

  return (
    <div className="invite-bring">
      <h2 className="invite-ask">Which agent goes in?</h2>
      <div className="invite-agents">
        {AGENT_CHOICES.map((agent) => (
          <button key={agent.id} type="button" className="invite-agent" onClick={() => go(agent.id)}>
            <span className="invite-agent__label">
              <span className="invite-agent__name">
                {agent.id === "hermes" && <img className="invite-agent__logo" src="/site/nous-research.png" alt="" />}
                {agent.id === "mcp" && <CopyIcon />}
                {copied === agent.id ? "copied, paste it in →" : agent.label}
                {agent.id === "here" && <span className="invite-agent__arrow" aria-hidden="true">→</span>}
              </span>
              {agent.hint && copied !== agent.id && <span className="invite-agent__hint">{agent.hint}</span>}
            </span>
          </button>
        ))}
      </div>
      <p className="invite-bring__copy">
        We won&apos;t ask what you&apos;re looking for. It works from what it already
        knows about you, then reports back in about 6 hours.
      </p>
      <p className="invite-send__note">it can&apos;t commit to anything without you</p>
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
    const agents = pulse.agents ?? 0;
    const turns = pulse.turns ?? 0;
    stats.push(
      [agents === 1 ? "agent" : "agents", agents],
      ["open signals", pulse.signals],
      [turns === 1 ? "negotiation turn" : "negotiation turns", turns],
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

      <footer className="invite-bottom">
        <a className="invite-badge invite-badge--link" href="https://index.network" target="_blank" rel="noreferrer">index.network →</a>
      </footer>
    </div>
  );
}
