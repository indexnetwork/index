import { useState, type MouseEvent, type ReactNode } from "react";

import UserAvatar from "@/components/UserAvatar";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import type { NegotiationSummary, NegotiationTurn } from "@/services/negotiations";

/* Copied from apps/mac/src/ui. Data bindings are the only web-side change. */

export function LiveTag({ label }: { label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, flex: "0 0 auto",
      fontFamily: "var(--mac-mono)", fontSize: 9, letterSpacing: "0.08em",
      color: "var(--ink-2)", border: "1px solid var(--ink-4)", padding: "0 4px",
    }}>
      <span className="live-pulse" style={{
        width: 5, height: 5, borderRadius: "50%", background: "#1FA463",
        display: "block", flex: "0 0 auto",
      }} />
      {label}
    </span>
  );
}

export function MatchCard({
  name,
  blurb,
  photo,
  userId,
  accepted,
  ready,
  negotiating,
  expired,
  waitingOnThem,
  hasChat,
  onOpen,
  onProfile,
  onAccept,
  onPass,
}: {
  name: string;
  blurb: string;
  photo?: string | null;
  userId?: string;
  accepted: boolean;
  ready: boolean;
  negotiating: boolean;
  expired: boolean;
  waitingOnThem?: boolean;
  hasChat: boolean;
  onOpen: () => void;
  onProfile: () => void;
  onAccept: () => void;
  onPass: () => void;
}) {
  const [hover, setHover] = useState(false);
  const openProfile = (e: MouseEvent) => {
    e.stopPropagation();
    onProfile();
  };
  const cardClickable = accepted || expired || ready || negotiating;
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={cardClickable ? onOpen : undefined}
      style={{
        textAlign: "left",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        gap: 14,
        padding: "14px 14px", minWidth: 0,
        background: "#fff", color: "#000",
        border: "1px solid #000",
        borderLeft: accepted ? "3px solid #FF8A00" : "1px solid #000",
        filter: expired ? "opacity(0.45)" : "none",
        boxShadow: (cardClickable && hover) ? "2px 2px 0 rgba(0,0,0,0.22)" : "none",
        transform: (cardClickable && hover) ? "translate(-1px, -1px)" : "none",
        cursor: cardClickable ? "pointer" : "default",
        transition: "all .12s ease",
      }}>
      <span title="view profile" onClick={openProfile} style={{ cursor: "pointer", lineHeight: 0 }}>
        <UserAvatar id={userId} name={name} avatar={photo} size={36} />
      </span>
      <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <span title="view profile" onClick={openProfile} style={{
            fontFamily: "var(--mac-sans)", fontSize: 15, fontWeight: 600, cursor: userId ? "pointer" : undefined,
            minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{name}</span>
          {negotiating && <LiveTag label="live" />}
        </div>
        <div style={{ fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4 }}>{blurb}</div>
      </div>
      <div style={{ display: "grid", gap: 6, alignContent: "start", justifyItems: "end" }} onClick={(e) => e.stopPropagation()}>
        {accepted ? (
          <>
            {waitingOnThem && (
              <span style={{ fontFamily: "var(--mac-mono)", fontSize: 10, color: "var(--ink-2)" }}>waiting for them</span>
            )}
            <button type="button" className="wb-btn primary small" onClick={onOpen}>
              {hasChat ? "open chat ›" : "send message"}
            </button>
          </>
        ) : ready ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="wb-btn primary small" onClick={onAccept}>accept</button>
            <button type="button" className="wb-btn small" onClick={onPass}>pass</button>
          </div>
        ) : negotiating ? (
          <button type="button" className="wb-btn small" onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 5, letterSpacing: 1, textTransform: "uppercase" }}>
            <span style={{ width: 6, height: 6, background: "#FF8A00", border: "1px solid #000", flex: "0 0 auto" }} />
            negotiating ›
          </button>
        ) : expired ? (
          <span style={{ fontFamily: "var(--mac-mono)", fontSize: 10, opacity: 0.75 }}>expired · summary ›</span>
        ) : null}
      </div>
    </div>
  );
}

export function SummarySection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 5 }}>
      <div style={{
        fontFamily: "var(--mac-sans)", fontSize: 12.5, fontWeight: 700,
        color: "#000", letterSpacing: -0.1,
      }}>{label}</div>
      <div style={{ fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "#000" }}>{children}</div>
    </div>
  );
}

export function expiryReason(id: string, name: string) {
  const reasons = [
    "the moment passed. they committed to something else before you replied.",
    "they went quiet, and your agent stopped surfacing them after a few days.",
    "the overlap cooled as your signal sharpened, and your edges drifted apart.",
    "they matched elsewhere first; your agent closed the thread to keep the radar clean.",
  ];
  const s = id || name || "x";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return reasons[h % reasons.length];
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
        display: "inline-flex", alignItems: "center", minHeight: 36,
        padding: "8px 14px", cursor: "pointer", textAlign: "left",
        ...(write ? {
          background: "transparent",
          border: "1px solid #000",
          color: hover ? "#111" : "#8a8577",
          fontFamily: "var(--mac-mono)", fontSize: 12,
        } : {
          background: selected ? "#111" : "#fff",
          border: "1px solid #000",
          color: selected ? "#fff" : "#111",
          fontFamily: "var(--mac-sans)", fontSize: 13.5,
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
        flex: "1 1 220px", minWidth: 180, minHeight: 36,
        border: "1px solid #000", padding: "8px 14px",
        fontFamily: "var(--mac-mono)", fontSize: 12, color: "#111", outline: "none",
      }}
    />
  );
}

export const CALIBRATING_LINES = [
  "structuring your inputs into signals…",
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
function negoClock(iso: string | null | undefined) {
  const d = new Date(iso || "");
  if (isNaN(d.getTime())) return "--:--:--";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const NEGO_RESULT_GLYPH = {
  won: { g: "✓", color: "#000" },
  lost: { g: "✕", color: "var(--ink-warn)" },
  open: { g: "●", color: "#FF8A00" },
};

export function NegoTurnLine({ th, turn, you, withTag, onTag }: {
  th: NegotiationSummary; turn: NegotiationTurn; you: boolean; withTag: boolean; onTag?: (th: NegotiationSummary) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: "var(--mac-mono)", fontSize: 11, color: "#000" }}>
        <span style={{ color: "var(--ink-3)", flex: "0 0 auto" }}>{negoClock(turn.createdAt)}</span>
        {withTag && (
          <button type="button" onClick={() => onTag?.(th)} style={{
            flex: "0 0 auto", fontFamily: "var(--mac-mono)", fontSize: 10,
            border: "1px solid #000", background: "#fff", color: "#000",
            padding: "0 5px", cursor: "pointer", width: 76, textAlign: "left",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{negoFirstName(th)}</button>
        )}
        <span style={{ fontWeight: 700, flex: "0 0 auto" }}>{you ? "you.agent" : `${negoFirstName(th)}.agent`}</span>
        <span style={{ flex: "0 0 auto" }}>{you ? "→" : "←"}</span>
        <span style={{
          flex: "0 0 auto", textTransform: "uppercase", letterSpacing: 1,
          background: you ? "#000" : "#fff", color: you ? "#fff" : "#000",
          border: "1px solid #000", padding: "0 6px", fontSize: 10,
        }}>{turn.action || "unknown"}</span>
      </div>
      {turn.message && (
        <div style={{
          marginLeft: withTag ? 156 : 72,
          fontFamily: "var(--mac-mono)", fontSize: 11, lineHeight: 1.45,
          color: "var(--ink-2)", maxWidth: 560,
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
      fontFamily: "var(--mac-mono)", fontSize: 10, letterSpacing: 0.5,
      color: r === "won" ? "#000" : "var(--ink-2)",
    }}>
      <span style={{ color: "var(--ink-4)" }}>{negoClock(th.settledAt || th.updatedAt)}</span>
      <span style={{ flex: "0 0 auto" }}>───</span>
      <span style={{ fontWeight: 700 }}>{withTag ? `${negoFirstName(th)} · ` : ""}closed {g} {negoDetail(th)}</span>
      <span style={{ flex: 1, borderTop: "1px dashed var(--ink-4)" }} />
    </div>
  );
}

export function NegoOpenLine({ th, withTag }: { th: NegotiationSummary; withTag: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      fontFamily: "var(--mac-mono)", fontSize: 10, letterSpacing: 0.5, color: "#FF8A00",
    }}>
      <span style={{ color: "var(--ink-4)" }}>{negoClock(th.updatedAt)}</span>
      <span style={{ flex: "0 0 auto" }}>───</span>
      <span style={{ fontWeight: 700 }}>{withTag ? `${negoFirstName(th)} · ` : ""}open ● {th.turnCount || 0}t</span>
      <span style={{ flex: 1, borderTop: "1px dashed var(--ink-4)" }} />
    </div>
  );
}

export function NegoThreadRow({ th, active, onPick }: { th: NegotiationSummary; active: boolean; onPick: () => void }) {
  const r = negoResult(th);
  const { g, color } = NEGO_RESULT_GLYPH[r];
  return (
    <button type="button" onClick={onPick} style={{
      display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8,
      alignItems: "center", width: "100%", textAlign: "left",
      padding: "7px 10px", cursor: "pointer",
      border: "1px solid #000",
      background: active ? "#000" : "#fff",
      color: active ? "#FF8A00" : "#000",
      fontFamily: "var(--mac-mono)", fontSize: 11,
    }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700 }}>{negoFirstName(th)}</span>
      <span style={{ color: active ? "#FF8A00" : "var(--ink-3)", fontSize: 10 }}>{th.turnCount || 0}t</span>
      <span style={{ color: active ? "#FF8A00" : color, fontWeight: 700 }}>{g}</span>
    </button>
  );
}

export { negoResult };

export function SignalAction({ label, active = false, onClick, danger = false }: {
  label: string; active?: boolean; onClick: () => void; danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const on = active || hover;
  const edge = danger ? "var(--ink-warn)" : "#000";
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: "var(--mac-mono)", fontSize: 11,
        padding: "2px 10px", whiteSpace: "nowrap",
        border: `1px solid ${edge}`,
        background: danger
          ? (active ? "var(--ink-warn)" : hover ? "#FFF3F3" : "#fff")
          : (on ? "#000" : "#fff"),
        color: danger
          ? (active ? "#fff" : "var(--ink-warn)")
          : (on ? "#fff" : "#000"),
        fontWeight: danger && active ? 700 : 400,
        boxShadow: "1px 1px 0 rgba(0,0,0,0.2)",
      }}>{label}</button>
  );
}

export function PipelineFunnel({ stages, activeStage, onClickStage }: {
  stages: Array<{ label: string; count: number; accent?: boolean }>;
  activeStage: string;
  onClickStage: (label: string) => void;
}) {
  const allActive = activeStage === "all";
  return (
    <div style={{
      display: "grid", height: "100%",
      gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`,
      fontFamily: "var(--mac-mono)",
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
            title={`${stage.label} · ${stage.count}`}
            style={{
              position: "relative", minWidth: 0,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
              padding: "0 5px",
              background: "transparent", color: "#111",
              opacity: dim ? 0.45 : 1,
              cursor: "pointer",
              border: "none", borderRadius: 0,
              fontFamily: "var(--mac-mono)",
            }}>
            <span style={{ fontSize: 18, fontWeight: 500, lineHeight: 1, color: stage.accent && stage.count > 0 ? "#F26B1D" : "#111" }}>{stage.count}</span>
            <span style={{
              display: "block", width: "100%", overflow: "hidden", textAlign: "center",
              fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap", lineHeight: 1,
            }}>{stage.label}</span>
            {!last && <span aria-hidden style={{ position: "absolute", right: 0, top: 12, bottom: 12, width: 1.5, background: "#111" }} />}
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
      <div style={{ fontFamily: "var(--mac-mono)", fontSize: 15, fontWeight: 700, letterSpacing: "0.04em", color: "#111", margin: 0 }}>
        hold on, looking for your people
      </div>
    </div>
  );
}

function AgentLabel() {
  return (
    <div style={{ marginBottom: 5, fontFamily: "var(--mac-mono)", fontSize: 11, color: "#8f8f88", textTransform: "uppercase", letterSpacing: "0.05em" }}>
      your agent
    </div>
  );
}

export function AgentFeedNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <MyAgentAvatar size={30} style={{ marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <AgentLabel />
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
              <button type="button" aria-expanded={queriesOpen} onClick={() => setQueriesOpen((value) => !value)} style={{
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
