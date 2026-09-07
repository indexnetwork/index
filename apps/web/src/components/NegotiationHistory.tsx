import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";
import { Loader2, ChevronDown, Bot } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { useNegotiations, useUsers } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import type { NegotiationHistoryEntry } from "@/services/users";
import type { NegotiationOutcome, NegotiationTurn } from "@/services/negotiations";

const PAGE_SIZE = 5;

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  propose: { label: "Proposed", color: "text-blue-600" },
  counter: { label: "Countered", color: "text-amber-600" },
  accept: { label: "Accepted", color: "text-emerald-600" },
  decline: { label: "Declined", color: "text-red-600" },
};

const OUTCOME_LABELS: Record<NegotiationOutcome, { label: string; className: string }> = {
  agreed: { label: "Agreed", className: "bg-emerald-50 text-emerald-700" },
  declined: { label: "Declined", className: "bg-gray-100 text-gray-500" },
  closed: { label: "Closed", className: "bg-gray-100 text-gray-500" },
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
          <span className="text-sm font-medium text-gray-900 flex items-center gap-1">
            {own ? "Your agent" : "Their agent"}
            <Bot className="w-3 h-3 text-gray-400" />
          </span>
          <span className={`text-xs font-medium ${actionInfo.color}`}>{actionInfo.label}</span>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">{turn.message}</p>
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
      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      )}

      {!isLoading && negotiations.length === 0 && (
        <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
          <p>No negotiations yet</p>
        </div>
      )}

      {negotiations.map((neg) => {
        const isExpanded = expandedId === neg.id;
        const turns = turnsByOpportunity[neg.opportunityId];
        const outcomeInfo = neg.outcome ? OUTCOME_LABELS[neg.outcome] : null;

        return (
          <div key={neg.id} className="bg-[#F8F8F8] rounded-md overflow-hidden">
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
                    className="text-sm font-bold text-gray-900 truncate hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {neg.counterparty.name}'s Agent
                  </Link>
                  {outcomeInfo ? (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${outcomeInfo.className}`}>
                      {outcomeInfo.label}
                    </span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-yellow-50 text-yellow-700">
                      In progress
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  {neg.turnCount > 0 && (
                    <span>{neg.turnCount} {neg.turnCount === 1 ? "turn" : "turns"}</span>
                  )}
                  <span className="ml-auto">{timeAgo(neg.createdAt)}</span>
                </div>
              </div>

              <ChevronDown
                className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              />
            </div>

            {isExpanded && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-200/60">
                {turns === undefined ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  </div>
                ) : turns.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">No turns yet</p>
                ) : (
                  <>
                    <p className="text-xs text-gray-400 mt-2 mb-3 flex items-center gap-1">
                      <Bot className="w-3 h-3" />
                      Agents negotiated on behalf of both parties
                    </p>
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
          className="w-full text-center py-2 text-sm text-gray-600 hover:text-black transition-colors disabled:opacity-50"
        >
          {loadingMore ? (
            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
          ) : (
            "Show more"
          )}
        </button>
      )}
    </div>
  );
}
