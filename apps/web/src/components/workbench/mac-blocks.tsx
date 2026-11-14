import { useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";

import UserAvatar from "@/components/UserAvatar";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import type { NegotiationSummary, NegotiationTurn } from "@/services/negotiations";
import { formatChatClock } from "@/lib/utils";

/* Copied from apps/mac/src/ui. Data bindings are the only web-side change. */

/** Marks someone who has not verified their email with Index yet. */
export function NotOnIndexTag() {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifySelf: "start", width: "fit-content", maxWidth: "100%",
      fontFamily: "var(--mac-mono)", fontSize: 10, lineHeight: 1.4, whiteSpace: "normal",
      color: "var(--ink-2)", background: "#E8E6E1", padding: "2px 6px",
    }}>Not yet on Index</span>
  );
}

export function MatchCard({
  name,
  blurb,
  photo,
  userId,
  unverified,
  accepted,
  ready,
  negotiating,
  expired,
  statusLabel,
  age,
  hasChat,
  onOpen,
  onOpenChat,
  onProfile,
  onAccept,
  onPass,
}: {
  name: string;
  blurb: string;
  photo?: string | null;
  userId?: string;
  unverified?: boolean;
  accepted: boolean;
  ready: boolean;
  negotiating: boolean;
  expired: boolean;
  /** Stage word under the buttons: "awaiting you", "in progress", "accepted", "not a fit" or "missed". */
  statusLabel: string;
  /** How long ago the card last changed ("3h"), joined to the stage word. */
  age?: string | null;
  hasChat: boolean;
  onOpen: () => void;
  onOpenChat: () => void;
  onProfile: () => void;
  onAccept: () => void;
  onPass: () => void;
}) {
  const [hover, setHover] = useState(false);
  const openProfile = (e: MouseEvent) => {
    e.stopPropagation();
    onProfile();
  };
  const agentLogStyle = { display: "flex", alignItems: "center", gap: 5, letterSpacing: 1, textTransform: "uppercase" } as const;
  const actions = accepted ? (
    <button type="button" className="wb-btn primary small" onClick={onOpen}>
      {unverified ? "invite" : hasChat ? "open chat ›" : "send message"}
    </button>
  ) : ready && hasChat ? (
    <button type="button" className="wb-btn primary small" onClick={onOpenChat}>open chat ›</button>
  ) : ready ? (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="wb-btn primary small" onClick={onAccept}>accept</button>
      <button type="button" className="wb-btn small" onClick={onPass}>pass</button>
    </div>
  ) : negotiating ? (
    <button type="button" className="wb-btn small" onClick={onOpen} style={agentLogStyle}>
      <span style={{ width: 6, height: 6, background: "#FF8A00", border: "1px solid #000", flex: "0 0 auto" }} />
      agent log ›
    </button>
  ) : expired ? (
    <button type="button" className="wb-btn small" onClick={onOpen} style={agentLogStyle}>
      agent log ›
    </button>
  ) : null;
  return (
    <div
      className="wb-main-card"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={onProfile}
      style={{
        textAlign: "left",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        gap: 14,
        padding: "14px 14px", minWidth: 0,
        background: "#fff", color: "#000",
        border: "1px solid #000",
        borderLeft: accepted ? "3px solid #FF8A00" : "1px solid #000",
        boxShadow: hover ? "2px 2px 0 rgba(0,0,0,0.22)" : "none",
        transform: hover ? "translate(-1px, -1px)" : "none",
        cursor: "pointer",
        transition: "all .12s ease",
      }}>
      <span title="view profile" onClick={openProfile} style={{ cursor: "pointer", lineHeight: 0 }}>
        <UserAvatar id={userId} name={name} avatar={photo} size={36} />
      </span>
      <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <span title="view profile" onClick={openProfile} style={{
            fontFamily: "var(--mac-sans)", fontSize: 15, fontWeight: 600, cursor: userId ? "pointer" : undefined,
            minWidth: 0, whiteSpace: "normal",
          }}>{name}</span>
          {unverified && <NotOnIndexTag />}
        </div>
        <div style={{ fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4 }}>{blurb}</div>
      </div>
      <div style={{ display: "grid", gap: 6, alignContent: "start", justifyItems: "end" }} onClick={(e) => e.stopPropagation()}>
        {actions}
        <span style={{ fontFamily: "var(--mac-mono)", fontSize: 10, color: "var(--ink-2)", whiteSpace: "nowrap" }}>
          {age ? `${statusLabel} · ${age}` : statusLabel}
        </span>
      </div>
    </div>
  );
}

export function SummarySection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 5 }}>
      <div style={{
        fontFamily: "var(--mac-sans)", fontSize: 11, fontWeight: 500,
        color: "var(--ink-2)", letterSpacing: "0.1em", textTransform: "uppercase",
      }}>{label}</div>
      <div style={{ fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "var(--ink)" }}>{children}</div>
    </div>
  );
}

export function OptionChip({ label, selected = false, write = false, onClick }: {
  label: string; selected?: boolean; write?: boolean; onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={onClick}
      aria-pressed={write ? undefined : selected}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center",
        padding: "4px 10px", cursor: "pointer", textAlign: "left",
        borderRadius: 3, fontFamily: "var(--wb-code)", fontSize: 12,
        ...(write ? {
          background: hover ? "var(--wb-hover-2)" : "#fff",
          border: "1px solid var(--wb-control)",
          color: hover ? "var(--ink)" : "var(--ink-3)",
        } : {
          background: selected ? "var(--wb-selected)" : hover ? "var(--wb-hover-2)" : "#fff",
          border: `1px solid ${selected ? "#ccc" : "var(--wb-control)"}`,
          color: selected ? "var(--ink)" : "var(--ink-2)",
        }),
      }}>{label}</button>
  );
}

export function WriteOwn({ open, value, onOpen, onChange, onClose }: {
  open: boolean; value: string; onOpen: () => void; onChange: (value: string) => void; onClose: () => void;
}) {
  if (!open) return <OptionChip write label="write your own" onClick={onOpen} />;
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => { if (!e.currentTarget.value.trim()) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.currentTarget.value.trim()) onClose(); }}
      placeholder="write your own"
      aria-label="Write your own answer"
      style={{
        flex: "1 1 200px", minWidth: 160,
        padding: "4px 10px",
        fontFamily: "var(--wb-code)", fontSize: 12, color: "var(--ink)", outline: "none",
      }}
    />
  );
}

export const CALIBRATING_LINES = [
  "structuring your inputs into intents…",
  "reaching out across the network…",
  "filtering through options…",
  "coming back around",
];

function negoResult(th: NegotiationSummary): "won" | "lost" | "open" {
  if (th.outcome === "agreed") return "won";
  if (th.outcome === "declined" || th.outcome === "closed") return "lost";
  return "open";
}
function negoDetail(th: NegotiationSummary) {
  if (th.outcome === "agreed") return "opportunity";
  if (th.outcome === "declined") return "declined";
  return "no opportunity";
}
function negoFirstName(th: NegotiationSummary) {
  return (th.counterparty?.name || "unknown").split(/\s+/)[0].toLowerCase();
}
// Date and 24h time at a fixed width ("oct 02 14:03"), so turn text lines up under it.
function negoClock(iso: string | null | undefined) {
  const d = new Date(iso || "");
  if (isNaN(d.getTime())) return "------ --:--";
  const p = (n: number) => String(n).padStart(2, "0");
  const day = d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }).toLowerCase();
  return `${day} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const NEGO_RESULT_GLYPH = {
  won: { g: "✓", color: "var(--wb-live)" },
  lost: { g: "✕", color: "var(--ink-3)" },
  open: { g: "●", color: "var(--amiga-accent)" },
};

export function NegoTurnLine({ th, turn, you, withTag, onTag }: {
  th: NegotiationSummary; turn: NegotiationTurn; you: boolean; withTag: boolean; onTag?: (th: NegotiationSummary) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-3)" }}>
        <time dateTime={turn.createdAt} title={turn.createdAt ? new Date(turn.createdAt).toLocaleString() : undefined} style={{ color: "var(--ink-3)", flex: "0 0 auto", width: "12ch" }}>{negoClock(turn.createdAt)}</time>
        {withTag && (
          <button type="button" onClick={() => onTag?.(th)} style={{
            flex: "0 0 auto", fontFamily: "var(--mac-sans)", fontSize: 11,
            border: "1px solid var(--wb-control)", borderRadius: 2, background: "#fff", color: "var(--ink-2)",
            padding: "0 5px", cursor: "pointer", width: 76, textAlign: "left",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{negoFirstName(th)}</button>
        )}
        {!you && th.counterparty?.userId ? (
          <Link to={`/u/${th.counterparty.userId}`} title="view profile" style={{ flex: "0 0 auto", color: "var(--ink-3)", textDecoration: "underline", textUnderlineOffset: 3 }}>{negoFirstName(th)}.agent</Link>
        ) : (
          <span style={{ flex: "0 0 auto" }}>{you ? "you.agent" : `${negoFirstName(th)}.agent`}</span>
        )}
        <span style={{ flex: "0 0 auto" }}>{you ? "→" : "←"}</span>
        <span style={{
          flex: "0 0 auto", textTransform: "uppercase", letterSpacing: "0.1em",
          background: "var(--wb-selected)", color: "var(--ink-2)",
          borderRadius: 2, padding: "0 6px", fontSize: 11, fontFamily: "var(--mac-sans)",
        }}>{turn.action || "unknown"}</span>
      </div>
      {turn.message && (
        <div style={{
          marginLeft: withTag ? "calc(12ch + 92px)" : "calc(12ch + 8px)",
          fontFamily: "var(--wb-code)", fontSize: 12, lineHeight: 1.6,
          color: "var(--ink)", maxWidth: 560,
        }}>"{turn.message}"</div>
      )}
    </div>
  );
}

export function NegoClosedLine({ th, withTag }: { th: NegotiationSummary; withTag: boolean }) {
  const r = negoResult(th);
  const { g } = NEGO_RESULT_GLYPH[r];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      fontFamily: "var(--wb-code)", fontSize: 11,
      color: r === "won" ? "var(--ink)" : "var(--ink-3)",
    }}>
      <span style={{ color: "#aaa" }}>{negoClock(th.settledAt || th.updatedAt)}</span>
      <span>{withTag ? `${negoFirstName(th)} · ` : ""}closed {g} {negoDetail(th)}</span>
      <span style={{ flex: 1, borderTop: "1px solid var(--wb-divider)" }} />
    </div>
  );
}

export function NegoOpenLine({ th, withTag }: { th: NegotiationSummary; withTag: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-2)",
    }}>
      <span style={{ color: "#aaa" }}>{negoClock(th.updatedAt)}</span>
      <span>{withTag ? `${negoFirstName(th)} · ` : ""}open <span style={{ color: "var(--wb-live)" }}>●</span> {th.turnCount || 0}t</span>
      <span style={{ flex: 1, borderTop: "1px solid var(--wb-divider)" }} />
    </div>
  );
}

export function NegoThreadRow({ th, active, onPick }: { th: NegotiationSummary; active: boolean; onPick: () => void }) {
  const r = negoResult(th);
  const { g, color } = NEGO_RESULT_GLYPH[r];
  return (
    <button type="button" onClick={onPick} title={`last activity ${new Date(th.updatedAt || th.settledAt || th.createdAt).toLocaleString()}`} style={{
      display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8,
      alignItems: "center", width: "100%", textAlign: "left",
      padding: "7px 10px", cursor: "pointer",
      border: "none", borderRadius: 3,
      background: active ? "var(--wb-selected)" : "transparent",
      color: "var(--ink)",
      fontFamily: "var(--mac-sans)", fontSize: 13,
    }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: active ? 500 : 400 }}>{negoFirstName(th)}</span>
      <span style={{ color: "var(--ink-3)", fontSize: 11, whiteSpace: "nowrap" }}>{th.turnCount || 0}t</span>
      <span style={{ color }}>{g}</span>
    </button>
  );
}

export { negoResult };

export function IntentAction({ label, active = false, onClick, danger = false }: {
  label: string; active?: boolean; onClick: () => void; danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const on = active || hover;
  const edge = danger ? "var(--ink-warn)" : "var(--wb-control)";
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: "var(--mac-sans)", fontSize: 11, fontWeight: 500,
        padding: "4px 10px", whiteSpace: "nowrap", borderRadius: 3,
        border: `1px solid ${edge}`,
        background: danger
          ? (active ? "var(--ink-warn)" : hover ? "#fbf1f0" : "#fff")
          : (active ? "var(--wb-selected)" : on ? "var(--wb-hover-2)" : "#fff"),
        color: danger
          ? (active ? "#fff" : "var(--ink-warn)")
          : (on ? "var(--ink)" : "var(--ink-2)"),
        boxShadow: "none",
      }}>{label}</button>
  );
}

export function PipelineFunnel({ stages, activeStage, onClickStage }: {
  stages: Array<{ label: string; display?: string; count: number; accent?: boolean }>;
  activeStage: string;
  onClickStage: (label: string) => void;
}) {
  const allActive = activeStage === "all";
  return (
    <div style={{
      display: "grid", height: "100%",
      gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`,
      fontFamily: "var(--mac-sans)",
    }}>
      {stages.map((stage, i) => {
        const last = i === stages.length - 1;
        const isActive = activeStage === stage.label;
        const dim = !allActive && !isActive;
        return (
          <button
            key={stage.label}
            type="button"
            onClick={() => onClickStage(isActive ? "all" : stage.label)}
            title={`${stage.display ?? stage.label} · ${stage.count}`}
            style={{
              position: "relative", minWidth: 0,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
              padding: "0 5px",
              background: "transparent", color: "var(--ink)",
              opacity: dim ? 0.45 : 1,
              cursor: "pointer",
              border: "none", borderRadius: 0,
              fontFamily: "var(--mac-sans)",
            }}>
            <span style={{ fontSize: 16, fontWeight: 500, lineHeight: 1, color: stage.accent && stage.count > 0 ? "var(--amiga-accent)" : "var(--ink)" }}>{stage.count}</span>
            <span style={{
              display: "block", width: "100%", overflow: "hidden", textAlign: "center", color: "var(--ink-2)",
              fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap", lineHeight: 1,
            }}>{stage.display ?? stage.label}</span>
            {!last && <span aria-hidden style={{ position: "absolute", right: 0, top: 12, bottom: 12, width: 1, background: "var(--wb-hairline)" }} />}
          </button>
        );
      })}
    </div>
  );
}

/** The radar while the agent is still out looking: the same eye and line as the Mac app. */
export function DiscoveryLoader() {
  return (
    <div style={{ padding: "16px 30px 30px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <img src="/loading-eye.gif" alt="searching" style={{ width: 180, height: 180, objectFit: "cover", flexShrink: 0, display: "block", mixBlendMode: "multiply" }} />
      <div style={{ fontFamily: "var(--mac-sans)", fontSize: 13, fontWeight: 400, color: "var(--ink-2)", margin: 0 }}>
        hold on, looking for your people
      </div>
    </div>
  );
}

function AgentLabel({ at }: { at?: string }) {
  return (
    <div style={{ marginBottom: 5, fontFamily: "var(--mac-mono)", fontSize: 11, color: "#8f8f88", textTransform: "uppercase", letterSpacing: "0.05em" }}>
      your agent
      {at && <time className="wb-stamp" dateTime={at} style={{ textTransform: "none" }}> · {formatChatClock(at)}</time>}
    </div>
  );
}

export function AgentFeedNote({ children, at }: { children: ReactNode; at?: string }) {
  return (
    <div className="wb-stamped" style={{ display: "flex", gap: 12 }}>
      <MyAgentAvatar size={30} style={{ marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <AgentLabel at={at} />
        <div style={{ maxWidth: "92%", fontFamily: "var(--mac-sans)", fontSize: 14, lineHeight: 1.55, color: "#2a2a2a" }}>{children}</div>
      </div>
    </div>
  );
}

export function parseDiscovery(text: string): { plan: string; queries: string[]; discovered: number | null; reached: number | null } | null {
  try {
    const data = JSON.parse(text) as { plan?: unknown; queries?: unknown; discovered?: unknown; reached?: unknown };
    if (data && Array.isArray(data.queries)) {
      const queries = data.queries.filter((query): query is string => typeof query === "string" && !!query);
      const counted = typeof data.discovered === "number";
      if (!queries.length && !counted) return null;
      return {
        plan: typeof data.plan === "string" ? data.plan : "",
        queries,
        discovered: counted ? data.discovered : null,
        reached: counted ? (typeof data.reached === "number" ? data.reached : data.discovered as number) : null,
      };
    }
  } catch { /* plain sentence */ }
  const match = /^Discovered (\d+) people and reached out to (\d+)\.$/.exec(text);
  if (!match) return null;
  return { plan: "", queries: [], discovered: Number(match[1]), reached: Number(match[2]) };
}

export function discoverySummary(discovered: number, reached: number | null) {
  const promising = reached ?? discovered;
  const people = discovered === 1 ? "person" : "people";
  const ones = promising === 1 ? "one" : "ones";
  return `Discovered ${discovered} ${people} with compatible intentions, and decided to reach out to ${promising} promising ${ones}`;
}

export function DiscoveryTrace({
  loading = [], plan = "", queries = [], discovered = null, reached = null, progress = "",
}: {
  loading?: string[]; plan?: string; queries?: string[]; discovered?: number | null; reached?: number | null; progress?: string;
}) {
  const [queriesOpen, setQueriesOpen] = useState(true);
  const summary = typeof discovered === "number" ? discoverySummary(discovered, reached) : progress;
  const lines = loading.length && !loading.some((line) => line.startsWith("Warming up")) ? ["Warming up.", ...loading] : loading;
  return (
    <section style={{ display: "flex", gap: 12 }}>
      <MyAgentAvatar size={30} style={{ marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <AgentLabel />
        {lines.map((line) => (
          <p key={line} style={{ margin: "0 0 8px", fontFamily: "var(--mac-sans)", fontSize: 14, lineHeight: 1.55, color: "#5A5548" }}>
            {line.endsWith(".") ? line : `${line}.`}
          </p>
        ))}
        {plan ? <p style={{ margin: "0 0 10px", fontFamily: "var(--mac-sans)", fontSize: 14, lineHeight: 1.55, color: "#2a2a2a" }}>{plan}</p> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {queries.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button type="button" className="wb-trace-toggle" aria-expanded={queriesOpen} onClick={() => setQueriesOpen((value) => !value)} style={{
                display: "grid", gridTemplateColumns: "18px 1fr", gap: 10, alignItems: "center",
                background: "none", border: "none", padding: 0, textAlign: "left",
                fontSize: 14, lineHeight: 1.55, fontFamily: "var(--mac-sans)", color: "#5A5548",
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" /></svg>
                <span>Ran {queries.length} {queries.length === 1 ? "query" : "queries"}</span>
              </button>
              {queriesOpen && (
                <div style={{ marginLeft: 8, padding: "2px 0 2px 19px", borderLeft: "1px solid #B5AF9F", display: "flex", flexDirection: "column", gap: 9 }}>
                  {queries.map((query) => (
                    <div key={query} style={{ display: "grid", gridTemplateColumns: "14px 1fr", gap: 9, alignItems: "baseline", color: "#5A5548", fontSize: 14, lineHeight: 1.55, fontFamily: "var(--mac-sans)" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /></svg>
                      <span>Looking for <span style={{ fontFamily: "var(--mac-mono)", fontSize: 12, color: "#8A8578" }}>{query}</span></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {summary && (
            <div style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 10, alignItems: "center", fontSize: 14, lineHeight: 1.55, fontFamily: "var(--mac-sans)", color: "#5A5548" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
              <span>{summary}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
