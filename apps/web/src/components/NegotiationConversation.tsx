import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

import { useNegotiations } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import type { NegotiationDetail } from "@/services/negotiations";
import { cn } from "@/lib/utils";

/** Expand one Radar match's read-only A2A thread without affecting its runtime. */
export default function NegotiationConversation({ intentId, opportunityId, expanded, onToggle }: {
  intentId: string; opportunityId: string; expanded: boolean; onToggle(): void;
}) {
  const { user } = useAuthContext();
  const service = useNegotiations();
  const { negotiations, isConnected, subscribeUserEvent } = useConversation();
  const match = negotiations.find((entry) => entry.opportunityId === opportunityId && entry.intentId === intentId);
  const [detail, setDetail] = useState<NegotiationDetail>();
  const [error, setError] = useState("");
  const history = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    let loading = false;
    let refreshPending = false;
    const refresh = async () => {
      if (loading) { refreshPending = true; return; }
      loading = true;
      refreshPending = false;
      try {
        const record = await service.getNegotiation(opportunityId);
        if (!active) return;
        if (record.intentId !== intentId) throw new Error("This conversation belongs to a different intent.");
        setDetail(record);
        setError("");
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "Could not load this conversation.");
      } finally {
        loading = false;
        if (active && refreshPending) void refresh();
      }
    };
    void refresh();
    let refreshTimer: ReturnType<typeof setTimeout>;
    const unsubscribe = subscribeUserEvent((event) => {
      if (event.type !== 'negotiation.changed' || event.data?.intentId !== intentId
        || event.data.opportunityId && event.data.opportunityId !== opportunityId) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { void refresh(); }, 100);
    });
    return () => { active = false; unsubscribe(); clearTimeout(refreshTimer); };
  }, [expanded, intentId, opportunityId, service, isConnected, subscribeUserEvent]);

  useEffect(() => {
    if (history.current && follow.current) history.current.scrollTop = history.current.scrollHeight;
  }, [expanded, detail?.turnCount]);

  const record = expanded && detail ? detail : match;
  const status = record?.outcome === "agreed" ? "Agents agreed"
    : record?.outcome === "declined" ? "Declined" : record?.settledAt ? "Closed"
      : detail?.protocol.blockedReason === "turn_limit" ? "Turn limit reached · undecided"
        : detail?.protocol.blockedReason === "signal_inactive" ? "Paused" : "In progress";

  return <div className="border-t border-gray-200" data-testid="negotiation-conversation">
    <button type="button" aria-expanded={expanded} aria-controls={`a2a-${opportunityId}`} onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-xs text-gray-600 hover:bg-gray-50">
      <span>
        <span className="font-medium text-gray-900">Agent conversation</span>
        {record && <span className="ml-2">{status} · {record.turnCount} turns</span>}
      </span>
      <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", expanded && "rotate-180")} />
    </button>
    {expanded && <div id={`a2a-${opportunityId}`} className="px-4 pb-4">
      {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
      {!detail ? !error && <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-gray-400" /> : <>
        <p className="mb-3 text-xs text-gray-500" aria-live="polite">{status} · {detail.turnCount}/{detail.protocol.maxTurns} turns</p>
        <div ref={history} className="max-h-96 space-y-3 overflow-y-auto pr-1"
          onScroll={() => { const pane = history.current; if (pane) follow.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80; }}>
          {detail.turns.length === 0 ? <p className="py-4 text-sm text-gray-500">Waiting for the opening proposal.</p>
            : detail.turns.map((turn) => {
              const own = turn.seatUserId === user?.id;
              return <article key={turn.turnIndex} className={cn("rounded-xl border p-3", own ? "border-blue-100 bg-blue-50/60" : "border-gray-200 bg-gray-50")}>
                <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="font-semibold text-gray-800">{own ? "Your agent" : `${detail.counterparty.name ?? "Their"}'s agent`}</span>
                  <span className="capitalize">{turn.action}</span>
                </p>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">{turn.message}</p>
              </article>;
            })}
        </div>
      </>}
    </div>}
  </div>;
}
