import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";
import UserAvatar from "@/components/UserAvatar";
import { useNegotiations, useUsers } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import type { NegotiationHistoryEntry } from "@/services/users";
import type { NegotiationOutcome, NegotiationTurn } from "@/services/negotiations";

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

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function TurnMessage({ turn, own, isLast }: { turn: NegotiationTurn; own: boolean; isLast: boolean }) {
  const actionInfo = ACTION_LABELS[turn.action] ?? { label: turn.action, color: "text-gray-600" };

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-2 h-2 rounded-full bg-gray-300 mt-2" />
        {!isLast && <div className="w-px flex-1 bg-gray-200 mt-1" />}
      </div>
      <div className="flex-1 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11 }}>
            {own ? "you.agent" : "their.agent"} · {actionInfo.label}
          </span>
        </div>
        <p style={{ margin: "4px 0 0", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.45 }}>{turn.message}</p>
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
    setNegotiations([]);
    setExpandedId(null);
    fetchNegotiations(0)
      .then((results) => {
        if (cancelled) return;
        setNegotiations(results);
        setHasMore(results.length === PAGE_SIZE);
      })
      .catch(() => {
        if (!cancelled) setNegotiations([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [fetchNegotiations]);

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
      {isLoading && <p style={{ fontFamily: "var(--mac-mono)", fontSize: 12 }}>loading…</p>}

      {!isLoading && negotiations.length === 0 && (
        <p style={{ margin: 0, padding: "28px 0", textAlign: "center", fontFamily: "var(--mac-mono)", fontSize: 12, border: "1px dashed #000" }}>no negotiations yet.</p>
      )}

      {negotiations.map((neg) => {
        const isExpanded = expandedId === neg.id;
        const turns = turnsByOpportunity[neg.opportunityId];
        const outcomeInfo = neg.outcome ? OUTCOME_LABELS[neg.outcome] : null;

        return (
          <div key={neg.id} style={{ border: "1px solid #000", background: "#fff" }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => void toggle(neg)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void toggle(neg); } }}
              className="w-full p-4 flex items-center gap-4 text-left hover:bg-gray-100/50 transition-colors cursor-pointer"
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
                    style={{ fontFamily: "var(--mac-mono)", fontSize: 13, fontWeight: 700, color: "#000", textDecoration: "none" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {neg.counterparty.name}
                  </Link>
                  {outcomeInfo ? (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${outcomeInfo.className}`}>
                      {outcomeInfo.label}
                    </span>
                  ) : (
                    <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11 }}>open</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>
                  {neg.turnCount > 0 && (
                    <span>{neg.turnCount} {neg.turnCount === 1 ? "turn" : "turns"}</span>
                  )}
                  <span className="ml-auto">{timeAgo(neg.createdAt)}</span>
                </div>
              </div>

              <span style={{ fontFamily: "var(--mac-mono)", fontSize: 12 }}>{isExpanded ? "▾" : "›"}</span>
            </div>

            {isExpanded && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-200/60">
                {turns === undefined ? (
                  <p style={{ fontFamily: "var(--mac-mono)", fontSize: 11 }}>loading…</p>
                ) : turns.length === 0 ? (
                  <p style={{ fontFamily: "var(--mac-mono)", fontSize: 11, textAlign: "center" }}>no turns yet.</p>
                ) : (
                  <>
                    <p style={{ margin: "8px 0", fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>agents spoke for both of you</p>
                    <div>
                      {turns.map((turn, i) => (
                        <TurnMessage
                          key={`${neg.id}-${turn.turnIndex}`}
                          turn={turn}
                          own={turn.seatUserId === viewer?.id}
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
          style={{ width: "100%", background: "none", border: "none", fontFamily: "var(--mac-mono)", fontSize: 12, cursor: "pointer" }}
        >
          {loadingMore ? "loading…" : "show more"}
        </button>
      )}
    </div>
  );
}
