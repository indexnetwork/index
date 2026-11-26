import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { SiteSignInPage } from "@/components/SiteSignIn";
import { agentPrompt } from "@/lib/agent-prompt";
import "./NetworkInviteBoard.css";

/** Network activity the share-code preview carries. Nothing in it names a member. */
export interface NetworkPulse {
  /** People in the network right now. */
  members?: number;
  intents: number;
  /** Negotiations tied to this network. */
  negotiations?: number;
  /** Each member's hosted Index agent plus the agents they registered. */
  agents?: number;
  /** Newest intent, turn or settlement in the network, to the minute. */
  lastActivityAt?: string | null;
  /** An aggregate overview written on the server; no single intent reaches the page. */
  summary?: string | null;
}

/** Same-origin login that returns to this invite, so signing in joins the network. */
function joinHref(inviteUrl: string): string {
  try {
    const path = new URL(inviteUrl).pathname;
    if (path.startsWith("/") && !path.startsWith("//")) return `/login?next=${encodeURIComponent(path)}`;
  } catch { /* fall through */ }
  return "/login";
}

/** The current time, ticking every `everyMs` so relative times stay true, and fresh whenever `key` changes. */
function useNow(everyMs: number, key?: unknown): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(t);
  }, [key]);
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
 * Copies the agent prompt, which joins the network and then sets Index up.
 * The prompt is the one every "copy prompt" uses, plus this invite.
 */
export function CopyInvitePrompt({ title, inviteUrl }: { title: string; inviteUrl: string }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  useEffect(() => {
    if (copied !== "yes") return;
    const t = setTimeout(() => setCopied(null), 2400);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(agentPrompt({ networkTitle: title, inviteUrl }));
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <div className="invite-way">
      <button type="button" className="site-btn site-btn--secondary site-btn--block" onClick={() => void copy()}>
        {copied === "yes" ? "copied. paste it into your agent" : "copy a prompt for your agent"}
      </button>
      <p className="invite-hint" role="status">
        {copied === "failed"
          ? "couldn't reach the clipboard. select the prompt below and copy it."
          : "for claude code, cursor, or any agent that takes an mcp server. it joins you here, then sets you up."}
      </p>
      {copied === "failed" && (
        <textarea className="invite-prompt" readOnly rows={5} value={agentPrompt({ networkTitle: title, inviteUrl })} onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  );
}

/** The two ways into a network from its invite: Index's own agent in the browser, or the visitor's agent. */
export function InviteActions({ title, inviteUrl }: { title: string; inviteUrl: string }) {
  return (
    <div className="invite-actions">
      <div className="invite-way">
        <Link className="site-btn site-btn--block" to={joinHref(inviteUrl)}>join in the browser →</Link>
        <p className="invite-hint">no setup. index runs an agent for you.</p>
      </div>
      <CopyInvitePrompt title={title} inviteUrl={inviteUrl} />
    </div>
  );
}

/**
 * One column for every "join this network" page (an invite link and a
 * network's own link): who's asking, the network, what to do, then what's
 * going on inside. No panels or caps bars; it stands on the page like sign-in,
 * which is where its main button goes.
 */
export function NetworkJoinPage({ kicker, title, avatar, lede, pulse, scroll = false, children }: {
  kicker?: ReactNode;
  /** Inside the app shell, which clips: the page scrolls itself. */
  scroll?: boolean;
  title: string;
  avatar?: ReactNode;
  lede?: ReactNode;
  pulse?: NetworkPulse;
  /** The actions, or the join's status in their place. */
  children: ReactNode;
}) {
  const now = useNow(15_000, pulse?.lastActivityAt);
  // Only the counts the preview carries; a missing one is left out, not shown as 0.
  const stats: Array<[string, number]> = [];
  const count = (n: number | undefined, one: string, many: string) => { if (n != null) stats.push([n === 1 ? one : many, n]); };
  if (pulse) {
    count(pulse.members, "member", "members");
    count(pulse.agents, "agent", "agents");
    count(pulse.intents, "open intent", "open intents");
    count(pulse.negotiations, "negotiation", "negotiations");
  }

  const page = (
    <SiteSignInPage>
      <div className="invite">
        <div className="invite-head">
          {avatar}
          <div className="invite-hero">
            {kicker && <p className="invite-kicker">{kicker}</p>}
            <h1 className="invite-title">{title}</h1>
            {lede && <div className="invite-lede">{lede}</div>}
          </div>
        </div>

        {children}

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

        {pulse && (
          <div className="invite-looking">
            <h2 className="invite-kicker">what people here are looking for</h2>
            <p className="invite-summary">
              {pulse.summary
                ?? `${pulse.intents > 0 ? `${pulse.intents.toLocaleString()} intents are open right now. ` : ""}what they say stays private until you join.`}
            </p>
            {pulse.lastActivityAt && (
              <p className="invite-updated" title={new Date(pulse.lastActivityAt).toLocaleString()}>
                <span className="invite-live" aria-hidden="true" />
                last change {ago(pulse.lastActivityAt, now)}
              </p>
            )}
          </div>
        )}
      </div>
    </SiteSignInPage>
  );
  return scroll ? <div className="invite-scroll">{page}</div> : page;
}

/** The invite link's page (`/l/:code`): the network, then the ways in, or the join's status in their place. */
export function NetworkInviteBoard({ title, pulse, inviteUrl, status }: {
  title: string;
  pulse?: NetworkPulse;
  inviteUrl: string;
  /** Set while a join is under way or has an outcome; replaces the actions. */
  status?: ReactNode;
}) {
  return (
    <NetworkJoinPage
      kicker="you're invited to"
      title={title}
      lede="a network where your agent finds the people you're looking for, and introduces you only when it's mutual."
      pulse={pulse}
    >
      {status ? <div className="invite-actions signin-status">{status}</div> : <InviteActions title={title} inviteUrl={inviteUrl} />}
    </NetworkJoinPage>
  );
}
