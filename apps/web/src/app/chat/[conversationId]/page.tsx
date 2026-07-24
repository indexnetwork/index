import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { ContentContainer } from '@/components/layout';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { useQuestionsService } from '@/contexts/APIContext';
import { useOpportunityActions } from '@/hooks/useOpportunityActions';
import TurnRail from '@/components/negotiations/TurnRail';
import OutcomeBanner from '@/components/negotiations/OutcomeBanner';
import OutcomeChip from '@/components/negotiations/OutcomeChip';
import ResolvedBanner, { type ResolvedBannerVariant } from '@/components/negotiations/ResolvedBanner';
import { useTickingNow } from '@/components/negotiations/use-ticking-now';
import { deriveSectionLabel, extractTurn, formatRelativeTime, groupTurnsBySession, viewerRoleLabel, type TranscriptTurn } from '@/components/negotiations/negotiation-turns';

const STALL_REASONS = new Set(['turn_cap', 'timeout']);

export default function NegotiationDetailPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { negotiations, messages, loadSessionHistory, loadPreviousSessionMessages, refreshNegotiations, sessionHistory, sessionOpportunityMap } = useConversation();
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

  // IND-565: group turns by negotiation session (one session = one task = one opportunity).
  const sessionGroups = useMemo(() => groupTurnsBySession(turns), [turns]);
  const isMultiSession = sessionGroups.length > 1;

  const opportunityId = lifecycle?.opportunityId ?? null;
  const localStatus = opportunityId ? opportunityStatusMap[opportunityId] : undefined;
  const effectiveOpportunityStatus = localStatus ?? lifecycle?.opportunityStatus ?? null;
  const outcomeReason = lifecycle?.outcome?.reason ?? null;

  // IND-566: Per-task turn count — turns in the latest session only, not cumulative
  // across all prior tasks in this dm_pair. lifecycle.turnCount folds in priorTurnCount
  // from earlier negotiations, so we recount from the loaded session groups instead.
  const latestSessionTurns = useMemo(
    () => sessionGroups[sessionGroups.length - 1]?.turns ?? turns,
    [sessionGroups, turns],
  );
  const latestTaskTurnCount = latestSessionTurns.length > 0 ? latestSessionTurns.length : null;

  // The viewer's last ask_user turn — anchor for the missed-window decay line.
  // Scoped to the latest session (the active task) only.
  const lastAskUserTurnId = useMemo(() => {
    for (let i = latestSessionTurns.length - 1; i >= 0; i -= 1) {
      if (latestSessionTurns[i].action === 'ask_user' && latestSessionTurns[i].senderId === ownAgentId) {
        return latestSessionTurns[i].id;
      }
    }
    return null;
  }, [latestSessionTurns, ownAgentId]);

  // Missed-window decay (IND-559): the negotiation left input_required after
  // an ask_user pause with no answered consultation — the window lapsed (or
  // the question was dismissed) and the negotiator continued without an answer.
  const questionsService = useQuestionsService();
  const [windowMissed, setWindowMissed] = useState(false);
  useEffect(() => {
    if (!opportunityId || !lastAskUserTurnId || lifecycle?.state === 'input_required') {
      setWindowMissed(false);
      return;
    }
    let cancelled = false;
    questionsService.getAnswered({
      mode: 'negotiation_inflight',
      sourceType: 'opportunity',
      sourceId: opportunityId,
    }).then((answered) => {
      if (!cancelled) setWindowMissed(answered.length === 0);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [questionsService, opportunityId, lastAskUserTurnId, lifecycle?.state]);

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

            {/* IND-565: per-opportunity negotiation sections.
                Each sessionId group = one negotiation task over one opportunity.
                Banners are scoped to the latest section so a WITHDRAWN chip in
                an earlier task can’t be misread as applying to the current one. */}
            {isMultiSession ? (
              sessionGroups.map((group, groupIndex) => {
                const isLatest = groupIndex === sessionGroups.length - 1;
                const firstTurn = group.turns[0];

                // IND-570: resolve opportunity attribution for this section.
                // sessionOpportunityMap is keyed by sessionId (populated when
                // session history is loaded). We then look up the viewer's
                // intent title from conversation.via[] using the opportunityId.
                const sessionOpp = group.sessionId ? sessionOpportunityMap.get(group.sessionId) : undefined;
                const viaEntry = sessionOpp?.opportunityId
                  ? conversation?.via.find((v) => v.opportunityId === sessionOpp.opportunityId)
                  : null;
                const opportunityTitle = viaEntry?.title ?? null;
                const opportunityStatus = sessionOpp?.status ?? null;

                // Older sections: show opportunity title + outcome chip + date.
                // Latest section: use the viewer's own opportunity intent title
                // from the conversation's signal provenance (via[0]).
                const sectionLabel = deriveSectionLabel({
                  isLatest,
                  firstTurnCreatedAt: firstTurn?.createdAt ?? null,
                  opportunityTitle,
                  opportunityStatus,
                  latestSectionTitle: conversation?.via[0]?.title ?? null,
                });

                return (
                  <section key={group.sessionId ?? `group-${groupIndex}`} aria-label={sectionLabel}>
                    {/* Section divider — separates this task from the preceding one */}
                    <div className="flex items-center gap-3 py-3" role="separator">
                      <span className="h-px flex-1 bg-gray-200" />
                      {/* IND-570: older attributed sections show title + chip + date inline.
                           Older unattributed sections and the latest section show plain text. */}
                      {!isLatest && opportunityTitle ? (
                        <span className="flex items-center gap-1.5 min-w-0" aria-hidden="true">
                          <span className="text-[10px] font-ibm-plex-mono text-gray-500 truncate max-w-[180px]">
                            {opportunityTitle}
                          </span>
                          <OutcomeChip status={opportunityStatus} />
                          {firstTurn && (
                            <span className="text-[10px] font-ibm-plex-mono text-gray-400 shrink-0">
                              {
                                new Date(firstTurn.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric' })
                              }
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[10px] font-ibm-plex-mono uppercase tracking-[0.12em] text-gray-400" aria-hidden="true">
                          {sectionLabel}
                        </span>
                      )}
                      <span className="h-px flex-1 bg-gray-200" />
                    </div>
                    <TurnRail
                      turns={group.turns}
                      ownAgentId={ownAgentId}
                      participantInfo={participantInfo}
                      counterpartName={counterpartName}
                      now={now}
                      missedWindowTurnId={isLatest && windowMissed ? lastAskUserTurnId : null}
                    />
                    {/* Outcome banners are scoped to the latest section (IND-566). */}
                    {isLatest && showOutcomeBanner && opportunityId && (
                      <OutcomeBanner
                        counterpartName={counterpartName}
                        role={negotiatedRole}
                        turnCount={latestTaskTurnCount}
                        concludedLabel={lifecycle?.updatedAt ? formatRelativeTime(lifecycle.updatedAt, now) : null}
                        loading={opportunityActionLoading[opportunityId] === true}
                        onStartChat={() => void handleOpportunityAction(opportunityId, 'accepted', counterpartUserId, undefined, counterpartName)}
                        onPass={() => void handleOpportunityAction(opportunityId, 'rejected', counterpartUserId, undefined, counterpartName)}
                      />
                    )}
                    {isLatest && resolvedVariant && (
                      <ResolvedBanner
                        variant={resolvedVariant}
                        reason={outcomeReason}
                        turnCount={latestTaskTurnCount}
                        maxTurns={lifecycle?.maxTurns ?? null}
                        onRevive={resolvedVariant === 'stalled' ? () => void handleRevive() : undefined}
                        onLetGo={resolvedVariant === 'stalled' ? () => navigate('/negotiations') : undefined}
                      />
                    )}
                  </section>
                );
              })
            ) : (
              // Single-session (common case): no section divider, but still use
              // latestTaskTurnCount so the banner doesn’t inherit priorTurnCount
              // from earlier tasks that ran before this one (IND-566).
              <>
                <TurnRail
                  turns={turns}
                  ownAgentId={ownAgentId}
                  participantInfo={participantInfo}
                  counterpartName={counterpartName}
                  now={now}
                  missedWindowTurnId={windowMissed ? lastAskUserTurnId : null}
                />
                {showOutcomeBanner && opportunityId && (
                  <OutcomeBanner
                    counterpartName={counterpartName}
                    role={negotiatedRole}
                    turnCount={latestTaskTurnCount}
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
                    turnCount={latestTaskTurnCount}
                    maxTurns={lifecycle?.maxTurns ?? null}
                    onRevive={resolvedVariant === 'stalled' ? () => void handleRevive() : undefined}
                    onLetGo={resolvedVariant === 'stalled' ? () => navigate('/negotiations') : undefined}
                  />
                )}
              </>
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
