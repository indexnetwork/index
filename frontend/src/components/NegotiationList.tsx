"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, ChevronDown, ChevronRight, User, Calendar, CheckCircle2, XCircle, Clock, MessageSquare, Handshake } from "lucide-react";
import { useNegotiations } from "@/contexts/APIContext";
import { cn } from "@/lib/utils";
import type { NegotiationListItem, NegotiationDetail, NegotiationTurn } from "@/services/negotiations";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  initiated: { bg: "bg-blue-50", text: "text-blue-700", label: "Initiated" },
  in_progress: { bg: "bg-yellow-50", text: "text-yellow-700", label: "In Progress" },
  resolved: { bg: "bg-green-50", text: "text-green-700", label: "Resolved" },
  expired: { bg: "bg-gray-50", text: "text-gray-500", label: "Expired" },
};

const OUTCOME_STYLES: Record<string, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
  opportunity: { bg: "bg-green-100", text: "text-green-700", label: "Opportunity", icon: <CheckCircle2 className="w-3 h-3" /> },
  disengaged: { bg: "bg-red-100", text: "text-red-600", label: "Declined", icon: <XCircle className="w-3 h-3" /> },
  deferred: { bg: "bg-amber-100", text: "text-amber-700", label: "Deferred", icon: <Clock className="w-3 h-3" /> },
};

const DECISION_STYLES: Record<string, { bg: string; text: string }> = {
  continue: { bg: "bg-gray-100", text: "text-gray-600" },
  accept: { bg: "bg-green-100", text: "text-green-700" },
  decline: { bg: "bg-red-100", text: "text-red-600" },
  defer: { bg: "bg-amber-100", text: "text-amber-700" },
  extend: { bg: "bg-blue-100", text: "text-blue-700" },
};

function DecisionBadge({ decision }: { decision: string }) {
  const style = DECISION_STYLES[decision] || DECISION_STYLES.continue;
  return (
    <span className={cn("capitalize px-1.5 py-0.5 rounded text-[10px] font-medium", style.bg, style.text)}>
      {decision}
    </span>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function NegotiationTurnDisplay({ turn, isLast }: { turn: NegotiationTurn; isLast: boolean }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const speakerName = turn.participantName || `Agent ${turn.participantUserId.slice(0, 6)}`;
  
  return (
    <div className="relative pl-6">
      {/* Timeline connector line */}
      {!isLast && (
        <div className="absolute left-[7px] top-6 bottom-0 w-0.5 bg-gray-200" />
      )}
      
      {/* Timeline dot */}
      <div className="absolute left-0 top-1.5 w-4 h-4 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-gray-400" />
      </div>
      
      {/* Turn content */}
      <div className="pb-4">
        {/* Speaker + Decision header */}
        <div className="flex items-center gap-2 text-xs mb-2">
          <span className="font-medium text-gray-900">{speakerName}&apos;s Agent</span>
          <DecisionBadge decision={turn.decision} />
        </div>
        
        {/* Message content */}
        <div className="text-sm text-gray-700 space-y-1">
          <p>{turn.message.context}</p>
          {turn.message.upside && <p className="text-gray-600">{turn.message.upside}</p>}
          {turn.message.invitation && <p className="text-gray-600 italic">{turn.message.invitation}</p>}
        </div>
        
        {/* Collapsible reasoning */}
        {turn.reasoning && (
          <div className="mt-2">
            <button
              onClick={() => setShowReasoning(!showReasoning)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ChevronRight className={cn("w-3 h-3 transition-transform", showReasoning && "rotate-90")} />
              <span>Internal reasoning</span>
            </button>
            {showReasoning && (
              <p className="text-xs text-gray-400 mt-1 pl-4 border-l border-gray-200">{turn.reasoning}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NegotiationCard({ negotiation: item }: { negotiation: NegotiationListItem }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<NegotiationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const negotiationsService = useNegotiations();

  const statusStyle = STATUS_STYLES[item.status] || STATUS_STYLES.initiated;
  const outcomeStyle = item.outcome ? OUTCOME_STYLES[item.outcome] : null;

  const handleToggle = useCallback(async () => {
    if (!expanded && !detail) {
      setLoadingDetail(true);
      try {
        const d = await negotiationsService.getNegotiation(item.id);
        setDetail(d);
      } catch {
        // Silently fail - detail will remain null
      } finally {
        setLoadingDetail(false);
      }
    }
    setExpanded(!expanded);
  }, [expanded, detail, negotiationsService, item.id]);

  const otherParticipant = item.participants.find(p => p.role === "responder") || item.participants[1];
  const otherParticipantName = otherParticipant?.name || `User ${otherParticipant?.userId.slice(0, 8)}`;

  return (
    <div className="border border-gray-200 rounded-lg bg-white hover:border-gray-300 transition-colors">
      <button
        onClick={handleToggle}
        className="w-full p-4 flex items-start gap-3 text-left"
      >
        <div className="mt-0.5 text-gray-400">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Handshake className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-900 truncate">
              Negotiation with {otherParticipantName}
            </span>
            <span className={cn("px-1.5 py-0.5 text-[10px] font-medium rounded", statusStyle.bg, statusStyle.text)}>
              {statusStyle.label}
            </span>
            {outcomeStyle && (
              <span className={cn("flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded", outcomeStyle.bg, outcomeStyle.text)}>
                {outcomeStyle.icon}
                {outcomeStyle.label}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              {item.currentTurn}/{item.maxTurns} turns
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatDate(item.createdAt)}
            </span>
            {item.trigger.source && (
              <span className="capitalize px-1.5 py-0.5 bg-gray-100 rounded">
                {item.trigger.source}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          {loadingDetail ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : detail ? (
            <div>
              {detail.turns.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No turns recorded yet</p>
              ) : (
                <div className="ml-2">
                  {detail.turns.map((turn, idx) => (
                    <NegotiationTurnDisplay
                      key={turn.turn}
                      turn={turn}
                      isLast={idx === detail.turns.length - 1}
                    />
                  ))}
                </div>
              )}
              {detail.resolution && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <div className="text-xs font-medium text-gray-600 mb-1">Resolution</div>
                  <p className="text-sm text-gray-700">{detail.resolution.reasoning}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">Unable to load details</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function NegotiationList() {
  const [negotiations, setNegotiations] = useState<NegotiationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const negotiationsService = useNegotiations();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const result = await negotiationsService.listNegotiations({ limit: 50 });
        if (mounted) setNegotiations(result);
      } catch {
        if (mounted) setNegotiations([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [negotiationsService]);

  const sorted = useMemo(() => {
    return [...negotiations].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [negotiations]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
        <p>No negotiations yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((n) => (
        <NegotiationCard key={n.id} negotiation={n} />
      ))}
    </div>
  );
}
