import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";
import UserAvatar from "@/components/UserAvatar";
import { useNegotiations, useUsers } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import type { NegotiationHistoryEntry } from "@/services/users";
import type { NegotiationOutcome, NegotiationTurn } from "@/services/negotiations";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatChatClock } from "@/lib/utils";

const PAGE_SIZE = 5;

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  propose: { label: "propose", color: "" },
  counter: { label: "counter", color: "" },
  accept: { label: "accept", color: "" },
  decline: { label: "decline", color: "" },
};

const OUTCOME_LABELS: Record<NegotiationOutcome, { label: string; className: string }> = {
  agreed: { label: "won", className: "" },
  declined: { label: "lost", className: "" },
  closed: { label: "lost", className: "" },
};

function TurnMessage({ turn, own, isLast, theirId }: { turn: NegotiationTurn; own: boolean; isLast: boolean; theirId: string }) {
  const actionInfo = ACTION_LABELS[turn.action] ?? { label: turn.action, color: "text-gray-600" };

  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ccc", marginTop: 6 }} />
        {!isLast && <div style={{ width: 1, flex: 1, background: "var(--wb-divider)", marginTop: 4 }} />}
      </div>
      <div className="flex-1 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <span style={{ fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-3)" }}>
            {own ? "you.agent" : <Link to={`/u/${theirId}`} title="view profile" style={{ color: "inherit", textDecoration: "underline" }}>their.agent</Link>} · {actionInfo.label}
            {turn.createdAt && <time dateTime={turn.createdAt} title={new Date(turn.createdAt).toLocaleString()} style={{ color: "var(--ink-3)" }}> · {formatChatClock(turn.createdAt)}</time>}
          </span>
        </div>
        <p style={{ margin: "4px 0 0", fontFamily: "var(--wb-code)", fontSize: 12, lineHeight: 1.6, color: "var(--ink)", whiteSpace: "pre-wrap" }}>{turn.message}</p>
      </div>
    </div>
  );
}

interface NegotiationHistoryProps {
  userId: string;
}

export default function NegotiationHistory({ userId }: NegotiationHistoryProps) {
  const usersService = useUsers();
  const negotiationService = useNegotiations();
  const { user: viewer } = useAuthContext();
  const [negotiations, setNegotiations] = useState<NegotiationHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [turnsByOpportunity, setTurnsByOpportunity] = useState<Record<string, NegotiationTurn[]>>({});

  const fetchNegotiations = useCallback(
    (offset: number) => usersService.getUserNegotiations(userId, { limit: PAGE_SIZE, offset }),
    [userId, usersService],
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadFailed(false);
    setNegotiations([]);
    setExpandedId(null);
    fetchNegotiations(0)
      .then((results) => {
        if (cancelled) return;
        setNegotiations(results);
        setHasMore(results.length === PAGE_SIZE);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [fetchNegotiations, reloadKey]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const results = await fetchNegotiations(negotiations.length);
      setNegotiations((prev) => [...prev, ...results]);
      setHasMore(results.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  };

  // The turn log is a second read, and only for the row the viewer opened.
  const toggle = async (entry: NegotiationHistoryEntry) => {
    if (expandedId === entry.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(entry.id);
    if (turnsByOpportunity[entry.opportunityId]) return;
    try {
      const detail = await negotiationService.getNegotiation(entry.opportunityId);
      setTurnsByOpportunity((prev) => ({ ...prev, [entry.opportunityId]: detail.turns }));
    } catch {
      setTurnsByOpportunity((prev) => ({ ...prev, [entry.opportunityId]: [] }));
    }
  };

  return (
    <div className="space-y-2">
      {isLoading && <EmptyState tone="loading" />}

      {!isLoading && loadFailed && (
        <EmptyState
          tone="error"
          framed
          style={{ padding: "28px 16px", borderColor: "var(--wb-hairline)" }}
          message="couldn't load the agent log."
          action={{ label: "try again", onClick: () => setReloadKey((k) => k + 1) }}
        />
      )}

      {!isLoading && !loadFailed && negotiations.length === 0 && (
        <EmptyState
          framed
          style={{ padding: "28px 16px", borderColor: "var(--wb-hairline)" }}
          message="nothing on the wire yet. your agent logs every conversation with other agents here as it happens."
        />
      )}

      {negotiations.map((neg) => {
        const isExpanded = expandedId === neg.id;
        const turns = turnsByOpportunity[neg.opportunityId];
        const outcomeInfo = neg.outcome ? OUTCOME_LABELS[neg.outcome] : null;
        const lastAt = neg.updatedAt || neg.settledAt || neg.createdAt;

        return (
          <div key={neg.id} style={{ border: "1px solid var(--wb-hairline)", borderRadius: 3, background: "#fff" }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => void toggle(neg)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void toggle(neg); } }}
              style={{ width: "100%", padding: 16, display: "flex", alignItems: "center", gap: 16, textAlign: "left", cursor: "pointer", background: isExpanded ? "var(--wb-hover)" : "#fff" }}
            >
              <Link
                to={`/u/${neg.counterparty.id}`}
                className="shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <UserAvatar
                  id={neg.counterparty.id}
                  name={neg.counterparty.name}
                  avatar={neg.counterparty.avatar}
                  size={36}
                />
              </Link>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <Link
                    to={`/u/${neg.counterparty.id}`}
                    style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)", textDecoration: "none" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {neg.counterparty.name}
                  </Link>
                  {outcomeInfo ? (
                    <span style={{ fontSize: 12, fontWeight: 500, color: outcomeInfo.label === "won" ? "var(--wb-live)" : "var(--ink-warn)" }}>
                      {outcomeInfo.label}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>open</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--ink-3)" }}>
                  {neg.turnCount > 0 && (
                    <span>{neg.turnCount} {neg.turnCount === 1 ? "turn" : "turns"}</span>
                  )}
                  <time className="ml-auto" dateTime={lastAt} title={new Date(lastAt).toLocaleString()}>{formatChatClock(lastAt)}</time>
                </div>
              </div>

              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{isExpanded ? "▾" : "›"}</span>
            </div>

            {isExpanded && (
              <div style={{ padding: "8px 16px 16px", borderTop: "1px solid var(--wb-divider)" }}>
                {turns === undefined ? (
                  <p style={{ fontSize: 12, color: "var(--ink-3)" }}>loading…</p>
                ) : turns.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}>no turns yet.</p>
                ) : (
                  <>
                    <p style={{ margin: "8px 0", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-2)" }}>agents spoke for both of you</p>
                    <div>
                      {turns.map((turn, i) => (
                        <TurnMessage
                          key={`${neg.id}-${turn.turnIndex}`}
                          turn={turn}
                          own={turn.seatUserId === viewer?.id}
                          theirId={neg.counterparty.id}
                          isLast={i === turns.length - 1}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          style={{ width: "100%", background: "none", border: "none", fontSize: 12, color: "var(--ink-2)", cursor: "pointer" }}
        >
          {loadingMore ? "loading…" : "show more"}
        </button>
      )}
    </div>
  );
}
