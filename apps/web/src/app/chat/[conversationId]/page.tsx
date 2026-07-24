import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { ContentContainer } from '@/components/layout';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { useOpportunityActions } from '@/hooks/useOpportunityActions';
import TurnRail from '@/components/negotiations/TurnRail';
import OutcomeBanner from '@/components/negotiations/OutcomeBanner';
import ResolvedBanner, { type ResolvedBannerVariant } from '@/components/negotiations/ResolvedBanner';
import { useTickingNow } from '@/components/negotiations/use-ticking-now';
import { extractTurn, formatRelativeTime, viewerRoleLabel, type TranscriptTurn } from '@/components/negotiations/negotiation-turns';

const STALL_REASONS = new Set(['turn_cap', 'timeout']);

export default function NegotiationDetailPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { negotiations, messages, loadSessionHistory, loadPreviousSessionMessages, refreshNegotiations, sessionHistory } = useConversation();
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const now = useTickingNow();

  const conversation = negotiations.find((c) => c.id === conversationId);
  const conversationMessages = useMemo(() => messages.get(conversationId!) ?? [], [messages, conversationId]);
  const history = conversationId ? sessionHistory.get(conversationId) : undefined;
  const lifecycle = conversation?.negotiation ?? null;

  const { handleOpportunityAction, opportunityStatusMap, opportunityActionLoading, inviteModalElement } =
    useOpportunityActions({
      onRemove: () => { void refreshNegotiations(); },
    });

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    loadSessionHistory(conversationId).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [conversationId, loadSessionHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationMessages]);

  const participants = useMemo(() => conversation?.participants ?? [], [conversation]);

  // Build lookup: participantId -> { name (agent), ownerName (user), avatar }
  const participantInfo = useMemo(() => {
    const map = new Map<string, { agentName: string; ownerName: string; avatar: string | null }>();
    for (const p of participants) {
      map.set(p.participantId, {
        agentName: p.name ?? 'Agent',
        ownerName: p.ownerName ?? p.participantId.replace('agent:', ''),
        avatar: p.avatar,
      });
    }
    return map;
  }, [participants]);

  // Determine which participant represents "our" side (the current user's agent)
  const ownAgentId = user?.id ? `agent:${user.id}` : null;

  const counterpart = participants.find((p) => p.participantId !== ownAgentId);
  const counterpartUserId = counterpart?.participantId.replace(/^agent:/, '') ?? '';
  const counterpartName = counterpart?.ownerName ?? conversation?.metadata?.title ?? counterpart?.name ?? 'them';

  const turns = useMemo(
    () => conversationMessages.map(extractTurn).filter((turn): turn is TranscriptTurn => turn !== null),
    [conversationMessages],
  );
  const negotiatedRole = useMemo(() => viewerRoleLabel(turns, ownAgentId), [turns, ownAgentId]);

  const opportunityId = lifecycle?.opportunityId ?? null;
  const localStatus = opportunityId ? opportunityStatusMap[opportunityId] : undefined;
  const effectiveOpportunityStatus = localStatus ?? lifecycle?.opportunityStatus ?? null;
  const outcomeReason = lifecycle?.outcome?.reason ?? null;

  // Resolved-state banner derivation, mirroring lib/negotiation-inbox classification.
  const resolvedVariant = useMemo<ResolvedBannerVariant | null>(() => {
    if (!lifecycle) return null;
    if (effectiveOpportunityStatus === 'rejected') return 'rejected';
    if (effectiveOpportunityStatus === 'stalled' || effectiveOpportunityStatus === 'expired') return 'stalled';
    if (effectiveOpportunityStatus === 'pending' || effectiveOpportunityStatus === 'accepted') return null;
    if (lifecycle.outcome?.hasOpportunity === false) {
      return STALL_REASONS.has(outcomeReason ?? '') ? 'stalled' : 'rejected';
    }
    if (['failed', 'canceled', 'auth_required'].includes(lifecycle.state)) return 'stalled';
    if (lifecycle.state === 'rejected') return 'rejected';
    return null;
  }, [lifecycle, effectiveOpportunityStatus, outcomeReason]);

  const showOutcomeBanner = !resolvedVariant && effectiveOpportunityStatus === 'pending' && !!opportunityId;

  // Revival CTA routes through the user's own agent (the negotiator DM), with
  // the questions inbox as fallback when no negotiator session exists yet.
  const handleRevive = useCallback(async () => {
    try {
      const { sessions } = await apiClient.get<{ sessions: { id: string }[] }>('/chat/sessions?persona=negotiator');
      navigate(sessions[0]?.id ? `/d/${sessions[0].id}` : '/questions');
    } catch {
      navigate('/questions');
    }
  }, [navigate]);

  return (
    <>
      {/* Header */}
      <div className="sticky top-0 bg-white z-10 px-4 py-3 flex items-center gap-3 min-h-[68px]">
        <button onClick={() => navigate('/chat')} className="text-[#3D3D3D] hover:text-black transition-colors text-xl mr-2">&larr;</button>
        <div>
          <h2 className="font-ibm-plex-mono font-bold text-lg text-black">Negotiation</h2>
          <p className="text-xs text-gray-400">
            {participants.map((p) => {
              const info = participantInfo.get(p.participantId);
              return info ? `${info.agentName} (${info.ownerName})` : p.participantId;
            }).join(' vs ')}
          </p>
        </div>
      </div>

      {/* Transcript */}
      <div className="px-6 lg:px-8 pb-32 flex-1">
        <ContentContainer>
          <div className="space-y-4">
            {history?.hasPreviousSession && conversationId && (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={() => void loadPreviousSessionMessages(conversationId)}
                  disabled={history.loadingPrevious}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-ibm-plex-mono text-gray-600 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
                  aria-label="Load previous messages"
                >
                  {history.loadingPrevious ? 'Loading previous messages…' : 'Load Previous Messages'}
                </button>
              </div>
            )}
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : conversationMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-[#3D3D3D]">
                <p className="text-sm">No messages in this negotiation</p>
              </div>
            ) : null}

            <TurnRail
              turns={turns}
              ownAgentId={ownAgentId}
              participantInfo={participantInfo}
              counterpartName={counterpartName}
              now={now}
            />

            {showOutcomeBanner && opportunityId && (
              <OutcomeBanner
                counterpartName={counterpartName}
                role={negotiatedRole}
                turnCount={lifecycle?.turnCount ?? null}
                concludedLabel={lifecycle?.updatedAt ? formatRelativeTime(lifecycle.updatedAt, now) : null}
                loading={opportunityActionLoading[opportunityId] === true}
                onStartChat={() => void handleOpportunityAction(opportunityId, 'accepted', counterpartUserId, undefined, counterpartName)}
                onPass={() => void handleOpportunityAction(opportunityId, 'rejected', counterpartUserId, undefined, counterpartName)}
              />
            )}

            {resolvedVariant && (
              <ResolvedBanner
                variant={resolvedVariant}
                reason={outcomeReason}
                turnCount={lifecycle?.turnCount ?? null}
                maxTurns={lifecycle?.maxTurns ?? null}
                onRevive={resolvedVariant === 'stalled' ? () => void handleRevive() : undefined}
                onLetGo={resolvedVariant === 'stalled' ? () => navigate('/negotiations') : undefined}
              />
            )}
            <div ref={messagesEndRef} />
          </div>
        </ContentContainer>
      </div>
      {inviteModalElement}
    </>
  );
}

export const Component = NegotiationDetailPage;
