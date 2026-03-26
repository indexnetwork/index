import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";
import { Loader2, ChevronDown, Bot, Handshake } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { useUsers } from "@/contexts/APIContext";
import type { NegotiationSummary, NegotiationTurnSummary } from "@/services/users";

const PAGE_SIZE = 20;

type ResultFilter = '' | 'has_opportunity' | 'no_opportunity' | 'in_progress';

const FILTERS: { value: ResultFilter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'has_opportunity', label: 'Has opportunities' },
  { value: 'no_opportunity', label: 'No opportunities' },
  { value: 'in_progress', label: 'In progress' },
];

const ROLE_LABELS: Record<string, string> = {
  agent: "Helper",
  patient: "Seeker",
  peer: "Peer",
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  propose: { label: "Proposed", color: "text-blue-600" },
  counter: { label: "Countered", color: "text-amber-600" },
  accept: { label: "Accepted", color: "text-emerald-600" },
  reject: { label: "Rejected", color: "text-red-600" },
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

function TurnMessage({ turn, isLast }: { turn: NegotiationTurnSummary; isLast: boolean }) {
  const actionInfo = ACTION_LABELS[turn.action] ?? { label: turn.action, color: "text-gray-600" };

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <UserAvatar
          id={turn.speaker.id}
          name={turn.speaker.name}
          avatar={turn.speaker.avatar}
          size={28}
        />
        {!isLast && <div className="w-px flex-1 bg-gray-200 mt-1" />}
      </div>
      <div className={`flex-1 pb-4 ${isLast ? "" : ""}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-900 flex items-center gap-1">
            {turn.speaker.name}
            <Bot className="w-3 h-3 text-gray-400" />
          </span>
          <span className={`text-xs font-medium ${actionInfo.color}`}>{actionInfo.label}</span>
          <span className="text-xs text-gray-400 ml-auto">{turn.fitScore}/100</span>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">{turn.reasoning}</p>
      </div>
    </div>
  );
}

interface NegotiationHistoryProps {
  userId: string;
  onTriggerNegotiation?: () => Promise<NegotiationSummary | void>;
  isTriggering?: boolean;
}

export default function NegotiationHistory({ userId, onTriggerNegotiation, isTriggering }: NegotiationHistoryProps) {
  const usersService = useUsers();
  const [negotiations, setNegotiations] = useState<NegotiationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>('');

  const fetchNegotiations = useCallback(async (offset: number) => {
    const results = await usersService.getUserNegotiations(userId, {
      limit: PAGE_SIZE,
      offset,
      result: resultFilter || undefined,
    });
    return results;
  }, [userId, usersService, resultFilter]);

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

  const showFilters = !isLoading || resultFilter;

  return (
    <div className="space-y-2">
      {showFilters && (
        <div className="flex gap-1.5 mb-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setResultFilter(f.value)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                resultFilter === f.value
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      )}

      {!isLoading && negotiations.length === 0 && !resultFilter && (
        <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
          {onTriggerNegotiation ? (
            <div className="space-y-3">
              <p>No negotiations yet</p>
              <button
                onClick={async () => {
                  const result = await onTriggerNegotiation();
                  if (result) {
                    setNegotiations((prev) => [result, ...prev]);
                  }
                }}
                disabled={isTriggering}
                className="inline-flex items-center gap-2 bg-[#041729] text-white px-4 py-2 rounded-sm text-sm font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-50"
              >
                {isTriggering ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Negotiating...
                  </>
                ) : (
                  <>
                    <Handshake className="w-4 h-4" />
                    Peer Agents
                  </>
                )}
              </button>
              <p className="text-xs text-gray-400">Start a discovery negotiation</p>
            </div>
          ) : (
            <p>No negotiations yet</p>
          )}
        </div>
      )}

      {!isLoading && negotiations.length === 0 && resultFilter && (
        <div className="text-sm text-gray-500 py-8 text-center">
          <p>No negotiations match this filter</p>
        </div>
      )}

      {negotiations.map((neg) => {
        const isExpanded = expandedId === neg.id;

        return (
          <div key={neg.id} className="bg-[#F8F8F8] rounded-md overflow-hidden">
            {/* Summary row — clickable to expand */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpandedId(isExpanded ? null : neg.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isExpanded ? null : neg.id); } }}
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
                    {neg.counterparty.name}
                  </Link>
                  {neg.outcome ? (
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        neg.outcome.hasOpportunity
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {neg.outcome.hasOpportunity ? "Opportunity" : "No opportunity"}
                    </span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-yellow-50 text-yellow-700">
                      In progress
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  {neg.outcome?.hasOpportunity && neg.outcome.finalScore > 0 && (
                    <span>Score: {neg.outcome.finalScore}</span>
                  )}
                  {neg.outcome?.role && (
                    <span>{ROLE_LABELS[neg.outcome.role] ?? neg.outcome.role}</span>
                  )}
                  {neg.outcome?.turnCount != null && neg.outcome.turnCount > 0 && (
                    <span>{neg.outcome.turnCount} {neg.outcome.turnCount === 1 ? "turn" : "turns"}</span>
                  )}
                  <span className="ml-auto">{timeAgo(neg.createdAt)}</span>
                </div>
              </div>

              <ChevronDown
                className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              />
            </div>

            {/* Expanded dialogue */}
            {isExpanded && neg.turns.length > 0 && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-200/60">
                <p className="text-xs text-gray-400 mt-2 mb-3 flex items-center gap-1">
                  <Bot className="w-3 h-3" />
                  Agents negotiated on behalf of both parties
                </p>
                <div>
                  {neg.turns.map((turn, i) => (
                    <TurnMessage
                      key={`${neg.id}-${i}`}
                      turn={turn}
                      isLast={i === neg.turns.length - 1}
                    />
                  ))}
                </div>
              </div>
            )}

            {isExpanded && neg.turns.length === 0 && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-200/60">
                <p className="text-xs text-gray-400 text-center py-3">No turn data available</p>
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
