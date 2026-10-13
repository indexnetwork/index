import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { ensureSiteFonts } from "@/app/site/SiteLayout";
import { inviteAgentPrompt } from "@/lib/agent-prompt";
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

type JoinPath = "web" | "agent" | "hermes";

const PATHS: Array<{ id: JoinPath; label: string }> = [
  { id: "web", label: "Browser" },
  { id: "agent", label: "Your agent" },
  { id: "hermes", label: "Hermes" },
];

/** A plain site card. */
function Window({ label, children }: { label: string; children: ReactNode }) {
  return <section className="invite-window" aria-label={label}>{children}</section>;
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

const OUTCOME: Record<"agreed" | "declined" | "closed", string> = {
  agreed: "✓ intro agreed",
  declined: "✕ passed",
  closed: "✕ closed",
};

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The Hermes agent log, anonymized: turns and outcomes only, between agents
 * with made-up names the server draws fresh on every load.
 */
function NegotiationLog({ pulse }: { pulse: NetworkPulse }) {
  const { total, agreed, live } = pulse.negotiations;
  const declined = pulse.negotiations.declined ?? 0;
  const agents = pulse.agentsLive ?? 0;
  const log = pulse.log ?? [];
  return (
    <Window label="Negotiations">
      <div className="invite-log">
        <div className="invite-log__head">
          <h2 className="invite-label">Negotiations</h2>
          <p className="invite-log__live">
            <span className="invite-live" aria-hidden="true" />
            <LiveNumber value={agents} /> {agents === 1 ? "agent" : "agents"} talking right now
          </p>
        </div>
        <p className="invite-log__counts">
          <b><LiveNumber value={total} /></b> sessions · <b><LiveNumber value={agreed} /></b> ✓ · <b><LiveNumber value={declined} /></b> ✕ · <b><LiveNumber value={live} /></b> open
        </p>
        {log.length > 0 ? (
          <ol className="invite-log__lines">
            {log.map((e, i) => (
              <li key={i} className={e.kind === "close" ? `invite-log__line invite-log__line--${e.outcome}` : "invite-log__line"}>
                <span className="invite-log__time">{hhmm(e.at)}</span>
                {e.kind === "turn" ? (
                  <span className="invite-log__what">
                    <span className="invite-log__name">{e.from}</span> → <span className="invite-log__name">{e.to}</span>{" "}
                    <b>{e.action}</b>
                    <span className="invite-log__meta"> · turn {e.turn}</span>
                  </span>
                ) : (
                  <span className="invite-log__what">
                    <span className="invite-log__name">{e.a}</span> &amp; <span className="invite-log__name">{e.b}</span>{" "}
                    <b>{OUTCOME[e.outcome]}</b>
                    <span className="invite-log__meta"> · {e.turns} {e.turns === 1 ? "turn" : "turns"}</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="invite-copy">The log opens up once the network has a few more members.</p>
        )}
        {pulse.negotiationSummary && <p className="invite-log__about">{pulse.negotiationSummary}</p>}
        <p className="invite-log__note">Names are made up and change on every visit. Members see their own negotiations in full.</p>
      </div>
    </Window>
  );
}

function CopyInvitePrompt({ title, inviteUrl }: { title: string; inviteUrl: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const prompt = inviteAgentPrompt(title, inviteUrl);
  return (
    <div className="invite-prompt">
      <pre className="invite-prompt__text">{prompt}</pre>
      <button
        type="button"
        className="site-btn invite-prompt__copy"
        onClick={() => { void navigator.clipboard?.writeText(prompt).then(() => setCopied(true)); }}
      >
        <span aria-live="polite">{copied ? "Copied. Paste it to your agent" : "Copy prompt"}</span>
      </button>
    </div>
  );
}

/**
 * The invite page's ready state, in the public site's language (site.css):
 * an "invite" card with the network and a summary of what members are after (written
 * on the server, so no single signal shows), and a "join" window with three ways
 * in: the browser, the visitor's own agent, or Hermes.
 */
export function NetworkInviteBoard({ title, memberCount, pulse, inviteUrl, webJoin, status }: {
  title: string;
  memberCount?: number;
  pulse?: NetworkPulse;
  inviteUrl: string;
  /** The sign-in form for joining in the browser. */
  webJoin: ReactNode;
  /** Set while a join is under way or has an outcome; replaces the choice. */
  status?: ReactNode;
}) {
  const [path, setPath] = useState<JoinPath>("web");
  const now = useNow(15_000);
  useEffect(() => {
    ensureSiteFonts();
  }, []);

  const stats: Array<[string, number]> = [];
  if (memberCount != null) stats.push([memberCount === 1 ? "member" : "members", memberCount]);
  if (pulse) stats.push(["open signals", pulse.signals], ["matches", pulse.opportunities], ["intros agreed", pulse.negotiations.agreed]);

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

        {pulse && <NegotiationLog pulse={pulse} />}
        </div>

        <Window label="Join">
          <div className="invite-body invite-body--join">
            {status ? (
              <div className="signin invite-signin invite-status">{status}</div>
            ) : (
              <>
                <div className="invite-choose">
                  <h2 className="invite-label">How do you want to join?</h2>
                  <div className="invite-paths" role="group" aria-label="Ways to join">
                    {PATHS.map((p) => (
                      <button key={p.id} type="button" aria-pressed={path === p.id} onClick={() => setPath(p.id)}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="invite-panel">
                  {path === "web" && <div className="signin invite-signin">{webJoin}</div>}
                  {path === "agent" && (
                    <>
                      <p className="invite-copy">
                        Paste this into your agent. It connects Index if it isn&apos;t already,
                        then joins {title} with your invite.
                      </p>
                      <CopyInvitePrompt title={title} inviteUrl={inviteUrl} />
                    </>
                  )}
                  {path === "hermes" && (
                    <>
                      <p className="invite-copy">
                        Install the Index plugin for Hermes, then paste this into Hermes to join {title}.
                      </p>
                      <Link className="site-arrow-link" to="/hermes" target="_blank" rel="noreferrer">Install the Hermes plugin →</Link>
                      <CopyInvitePrompt title={title} inviteUrl={inviteUrl} />
                    </>
                  )}
                </div>
              </>
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
