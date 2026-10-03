import { useEffect, useRef, useState } from "react";
import { useNegotiations } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import type { NegotiationDetail } from "@/services/negotiations";

/** Expand one Radar match's read-only A2A thread without affecting its runtime. */
export default function NegotiationConversation({ intentId, opportunityId, expanded, onToggle }: {
  intentId: string; opportunityId: string; expanded: boolean; onToggle(): void;
}) {
  const { user } = useAuthContext();
  const service = useNegotiations();
  const { negotiations, isConnected } = useConversation();
  const match = negotiations.find((entry) => entry.opportunityId === opportunityId && entry.intentId === intentId);
  const [detail, setDetail] = useState<NegotiationDetail>();
  const [error, setError] = useState("");
  const history = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const record = await service.getNegotiation(opportunityId);
        if (!active) return;
        if (record.intentId !== intentId) throw new Error("This conversation belongs to a different intent.");
        setDetail(record);
        setError("");
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "Could not load this conversation.");
      } finally { loading = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [expanded, intentId, opportunityId, service, match?.updatedAt, isConnected]);

  useEffect(() => {
    if (history.current && follow.current) history.current.scrollTop = history.current.scrollHeight;
  }, [expanded, detail?.turnCount]);

  const name = detail?.counterparty.name || match?.counterparty?.name || "them";
  const first = name.split(" ")[0];

  if (!expanded) return null;

  return <div data-testid="negotiation-conversation" id={`a2a-${opportunityId}`} className="mac-scroll" ref={history}
    onScroll={() => { const pane = history.current; if (pane) follow.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80; }}
    style={{ minHeight: 0, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, background: "#fff" }}>
    {error && <p role="alert" style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)", textAlign: "center" }}>couldn&apos;t load this negotiation.</p>}
    {!detail && !error && <p style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)", textAlign: "center" }}>loading…</p>}
    {detail && detail.turns.length === 0 && <p style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)", textAlign: "center" }}>no turns yet.</p>}
    {detail?.turns.map((turn) => {
      const own = turn.seatUserId === user?.id;
      return (
        <div key={turn.turnIndex} style={{ display: "grid", gap: 4, justifyItems: own ? "end" : "start" }}>
          <span style={{ fontFamily: "var(--mac-mono)", fontSize: 10, color: "var(--ink-2)", letterSpacing: 0.5 }}>
            {own ? "your agent" : `${first}'s agent`} · {turn.action}
          </span>
          <div style={{
            maxWidth: "82%", border: "1px solid #000",
            background: own ? "#000" : "#fff", color: own ? "#fff" : "#000",
            padding: "8px 11px", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4, whiteSpace: "pre-wrap",
            boxShadow: own ? "none" : "inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3)",
          }}>{turn.message}</div>
        </div>
      );
    })}
  </div>;
}
