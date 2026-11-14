import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useNegotiations } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import type { NegotiationDetail } from "@/services/negotiations";
import { formatChatClock } from "@/lib/utils";

/** Expand one Radar match's read-only A2A thread without affecting its runtime. */
export default function NegotiationConversation({ intentId, opportunityId, expanded, onToggle }: {
  intentId?: string; opportunityId: string; expanded: boolean; onToggle(): void;
}) {
  const { user } = useAuthContext();
  const service = useNegotiations();
  const { negotiations, isConnected } = useConversation();
  const match = negotiations.find((entry) => entry.opportunityId === opportunityId && (!intentId || entry.intentId === intentId));
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
        if (intentId && record.intentId !== intentId) throw new Error("This conversation belongs to a different intent.");
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
  const theirId = detail?.counterparty.userId || match?.counterparty?.userId;

  if (!expanded) return null;

  return <div data-testid="negotiation-conversation" id={`a2a-${opportunityId}`} className="mac-scroll" ref={history}
    onScroll={() => { const pane = history.current; if (pane) follow.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80; }}
    style={{ minHeight: 0, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, background: "#fff" }}>
    {error && <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}>couldn&apos;t load this agent log.</p>}
    {!detail && !error && <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}>loading…</p>}
    {detail && detail.turns.length === 0 && <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}>no turns yet.</p>}
    {detail?.turns.map((turn) => {
      const own = turn.seatUserId === user?.id;
      return (
        <div key={turn.turnIndex} style={{ display: "grid", gap: 4, justifyItems: "stretch" }}>
          <span style={{ fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.08em" }}>
            {own ? "your agent" : theirId
              ? <Link to={`/u/${theirId}`} title="view profile" style={{ color: "inherit", textDecoration: "underline" }}>{first}&apos;s agent</Link>
              : `${first}'s agent`} · {turn.action}
            {turn.createdAt && <time dateTime={turn.createdAt} title={new Date(turn.createdAt).toLocaleString()} style={{ color: "var(--ink-3)" }}> · {formatChatClock(turn.createdAt)}</time>}
          </span>
          {/* Agent text reads in mono: theirs on the selected fill, yours on white. */}
          <div style={{
            border: own ? "1px solid var(--wb-hairline)" : "1px solid transparent",
            background: own ? "#fff" : "var(--wb-selected)", color: "var(--ink)",
            padding: "10px 12px", fontFamily: "var(--wb-code)", fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>{turn.message}</div>
        </div>
      );
    })}
  </div>;
}
