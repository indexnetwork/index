// Chat keeps its original presentation independently of the surrounding app shell.
import { useState, type ReactNode } from "react";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import { formatChatClock } from "@/lib/utils";
import { discoverySummary } from "@/components/workbench/mac-blocks";

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
