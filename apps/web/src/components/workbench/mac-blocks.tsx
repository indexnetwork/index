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
      fontFamily: "var(--mac-sans)", fontSize: 11, lineHeight: 1.4, whiteSpace: "normal",
      color: "var(--ink-2)", background: "var(--wb-selected)", borderRadius: 2, padding: "1px 6px",
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
  closedLabel,
  waitingOnThem,
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
  /** Chip on a closed card: "not a fit" or "missed". */
  closedLabel?: string;
  waitingOnThem?: boolean;
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
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={onProfile}
      style={{
        textAlign: "left",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        gap: 12,
        padding: "12px 0", minWidth: 0,
        background: hover ? "var(--wb-hover)" : "transparent", color: "var(--ink)",
        borderBottom: "1px solid var(--wb-divider)",
        cursor: "pointer",
        transition: "background .12s ease",
      }}>
      <span title="view profile" onClick={openProfile} style={{ cursor: "pointer", lineHeight: 0 }}>
        <UserAvatar id={userId} name={name} avatar={photo} size={28} />
      </span>
      <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <span title="view profile" onClick={openProfile} style={{
            fontFamily: "var(--mac-sans)", fontSize: 13, fontWeight: 500, cursor: userId ? "pointer" : undefined,
            minWidth: 0, whiteSpace: "normal",
          }}>{name}</span>
          {unverified && <NotOnIndexTag />}
        </div>
        <div style={{ fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.4, color: "#666" }}>{blurb}</div>
      </div>
      <div style={{ display: "grid", gap: 6, alignContent: "start", justifyItems: "end" }} onClick={(e) => e.stopPropagation()}>
        {accepted ? (
          <>
            {waitingOnThem && <StatusLabel color="#6b8bc4">chat open</StatusLabel>}
            <button type="button" className="wb-btn small" onClick={onOpen}>
              {unverified ? "invite" : hasChat ? "open chat ›" : "send message"}
            </button>
          </>
        ) : ready && hasChat ? (
          <button type="button" className="wb-btn small" onClick={onOpenChat}>open chat ›</button>
        ) : ready ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="wb-btn primary small" onClick={onAccept}>accept</button>
            <button type="button" className="wb-btn small" onClick={onPass}>pass</button>
          </div>
        ) : negotiating ? (
          <>
            <StatusLabel color="var(--wb-live)">in progress</StatusLabel>
            <AgentLogLink onClick={onOpen} />
          </>
        ) : expired ? (
          <>
            <StatusLabel color="#ccc" muted>{closedLabel || "missed"}</StatusLabel>
            <AgentLogLink onClick={onOpen} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** A status word with its 6px dot, as on the intents screen. */
function StatusLabel({ color, muted = false, children }: { color: string; muted?: boolean; children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--mac-sans)", fontSize: 11, color: muted ? "#999" : "var(--ink-2)", whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: color, flex: "0 0 auto" }} />
      {children}
    </span>
  );
}

function AgentLogLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      background: "none", border: "none", padding: "4px 2px", cursor: "pointer",
      fontFamily: "var(--mac-sans)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase",
      color: "var(--ink-3)", textDecoration: "underline", textUnderlineOffset: 3, whiteSpace: "nowrap",
    }}>agent log ›</button>
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
    <div style={{ marginBottom: 4, fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
      your agent
      {at && <time className="wb-stamp" dateTime={at} style={{ textTransform: "none" }}> · {formatChatClock(at)}</time>}
    </div>
  );
}

export function AgentFeedNote({ children, at }: { children: ReactNode; at?: string }) {
  return (
    <div className="wb-stamped" style={{ display: "flex", gap: 10 }}>
      <MyAgentAvatar size={20} style={{ marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <AgentLabel at={at} />
        <div style={{ background: "var(--wb-selected)", padding: "10px 12px", fontFamily: "var(--wb-code)", fontSize: 12.5, lineHeight: 1.6, color: "var(--ink)", wordBreak: "break-word" }}>{children}</div>
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
    <section style={{ display: "flex", gap: 10 }}>
      <MyAgentAvatar size={20} style={{ marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <AgentLabel />
        {lines.map((line) => (
          <p key={line} style={{ margin: "0 0 6px", fontFamily: "var(--wb-code)", fontSize: 12, lineHeight: 1.6, color: "var(--ink-2)" }}>
            {line.endsWith(".") ? line : `${line}.`}
          </p>
        ))}
        {plan ? <p style={{ margin: "0 0 8px", fontFamily: "var(--wb-code)", fontSize: 12, lineHeight: 1.6, color: "var(--ink)" }}>{plan}</p> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {queries.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button type="button" aria-expanded={queriesOpen} onClick={() => setQueriesOpen((value) => !value)} style={{
                background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer",
                fontSize: 12, lineHeight: 1.6, fontFamily: "var(--wb-code)", color: "var(--ink-2)",
              }}>
                Ran {queries.length} {queries.length === 1 ? "query" : "queries"}
              </button>
              {queriesOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {queries.map((query) => (
                    <div key={query} style={{ paddingLeft: 12, borderLeft: "1px solid #ccc", color: "#666", fontSize: 12, lineHeight: 1.6, fontFamily: "var(--wb-code)" }}>
                      Looking for {query}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {summary && (
            <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.6, fontFamily: "var(--wb-code)", color: "var(--ink)" }}>
              {summary}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
