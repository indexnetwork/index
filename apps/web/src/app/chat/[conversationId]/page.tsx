import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { ContentContainer } from '@/components/layout';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { useOpportunityActions } from '@/hooks/useOpportunityActions';
import ConversationHeader from '@/components/chat/ConversationHeader';
import TurnRail from '@/components/negotiations/TurnRail';
import OutcomeBanner from '@/components/negotiations/OutcomeBanner';
import OutcomeChip from '@/components/negotiations/OutcomeChip';
import ResolvedBanner, { type ResolvedBannerVariant } from '@/components/negotiations/ResolvedBanner';
import GateDecisionCard from '@/components/negotiations/GateDecisionCard';
import { resolveGateDecision } from '@/components/negotiations/gate-decision';
import { useTickingNow } from '@/components/negotiations/use-ticking-now';
import { contactTurns, deriveSectionLabel, extractTurn, formatRelativeTime, groupTurnsBySession, terminalTurnAuthor, viewerRoleLabel, type TranscriptTurn } from '@/components/negotiations/negotiation-turns';

// `agent_error` joins the stall reasons rather than the reject ones: a run
// that stopped on repeated agent failures decided nothing, so it must never
// be presented as a filtered-out match.

/* eslint-disable react-hooks/preserve-manual-memoization --
   The React Compiler cannot preserve this page's manual memoization (it
   assumes the imported turn-grouping helpers may mutate their inputs) and
   previously skipped this component silently behind a since-retired
   questions-service effect. Keep the manual memos and opt out of the rule
   rather than restructure the transcript pipeline in the retirement PR. */
export default function NegotiationDetailPage() {

  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthContext();
  const { negotiations, messages, loadSessionHistory, loadPreviousSessionMessages, refreshNegotiations, sessionHistory, sessionOpportunityMap } = useConversation();
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const now = useTickingNow();

  const conversation = negotiations.find((c) => c.id === conversationId);
  const conversationMessages = useMemo(() => messages.get(conversationId!) ?? [], [messages, conversationId]);
  const history = conversationId ? sessionHistory.get(conversationId) : undefined;
  const selectedTaskId = searchParams.get('taskId');
  const selectedOpportunity = conversation?.negotiationOpportunities?.find((opportunity) => opportunity.taskId === selectedTaskId) ?? null;
  // A selected row owns the transcript's lifecycle; plain conversation links
  // preserve the existing latest-session behavior.
  const lifecycle = selectedOpportunity ?? conversation?.negotiation ?? null;
  // A durable A2A conversation may contain sessions for several signals. Keep
  // this transcript and its history navigation inside the represented signal.
  const scopedTaskId = selectedTaskId ?? lifecycle?.taskId ?? undefined;

  const { handleOpportunityAction, opportunityStatusMap, opportunityActionLoading, opportunityModalElement } =
    useOpportunityActions({
      onRemove: () => { void refreshNegotiations(); },
    });

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    loadSessionHistory(conversationId, scopedTaskId ? { taskId: scopedTaskId } : undefined).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [conversationId, scopedTaskId, loadSessionHistory]);

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
  const pauseReason = lifecycle?.pause?.reason ?? null;

  // IND-566: Per-task turn count — turns in the latest session only, not cumulative
  // across all prior tasks in this dm_pair. lifecycle.turnCount folds in priorTurnCount
  // from earlier negotiations, so we recount from the loaded session groups instead.
  const latestSessionTurns = useMemo(
    () => sessionGroups[sessionGroups.length - 1]?.turns ?? turns,
    [sessionGroups, turns],
  );
  const latestTaskTurnCount = latestSessionTurns.length > 0 ? latestSessionTurns.length : null;

  // Resolved-state banner derivation, mirroring lib/negotiation-presentation
  // classification. A negotiation only ends via a verdict write (opportunity
  // status pending/rejected) — there is no more turn-level accept/decline/
  // withdraw, and `counterparty_silent`/`timeout` is a pause, not an outcome.
  const resolvedVariant = useMemo<ResolvedBannerVariant | null>(() => {
    if (!lifecycle) return null;
    if (effectiveOpportunityStatus === 'rejected') return 'rejected';
    if (effectiveOpportunityStatus === 'stalled' || effectiveOpportunityStatus === 'expired') return 'stalled';
    if (effectiveOpportunityStatus === 'pending' || effectiveOpportunityStatus === 'accepted') return null;
    if (pauseReason === 'counterparty_silent') return 'stalled';
    if (lifecycle.state === 'completed') return 'stalled';
    return null;
  }, [lifecycle, effectiveOpportunityStatus, pauseReason]);

  const showOutcomeBanner = !resolvedVariant && effectiveOpportunityStatus === 'pending' && !!opportunityId;

  const contactedTurns = useMemo(() => contactTurns(turns), [turns]);

  // Whether this thread shows any agent message at all — the one fact that can
  // falsify the `screened_out` banner's pre-contact copy, read from the same
  // transcript the banner renders beneath. Conversation-wide on purpose: the
  // claim is about what the reader can see above the banner, and every turn in
  // the rail is visible regardless of which session produced it.
  const contactMade = contactedTurns.length > 0;

  // Who ended it, read from the same turns the banner renders above — and from
  // the LATEST session's turns, because that is the negotiation the banner is
  // scoped to (IND-566). An earlier task in this pair may well have ended the
  // other way round.
  const terminalAuthor = useMemo(
    () => terminalTurnAuthor(latestSessionTurns, ownAgentId),
    [latestSessionTurns, ownAgentId],
  );

  // IND-610: the owner-only outreach-gate card. A `screened_out` negotiation
  // with no turns is the one case where the transcript has nothing to show —
  // it dead-ended at "No messages in this negotiation" — yet a real decision
  // was made on the viewer's behalf. `screenDecision` is projected by the API
  // only to the negotiation's initiator, so a non-owner never has one; both
  // the screen-node pass and an opening-turn refusal arrive here, since they
  // collapse into the same `screened_out` outcome.
  //
  // Not gated on `loading`: the JSX already renders the spinner first, and
  // keeping this stable across the load avoids flashing the generic rejected
  // banner for one frame before the card replaces it.
  const gateDecision = useMemo(
    () => resolveGateDecision({
      turnCount: contactedTurns.length,
      // `screened_out` was only ever produced by the removed outreach gate
      // and the opening-turn withdraw, both gone with the negotiation-graph
      // rewrite (a negotiation always opens with a real outreach turn now).
      // There is no live field left to source this from, so the IND-610 card
      // is now unreachable even for rows still carrying an old
      // `screenDecision` — state this as a known break, not a silent bug.
      outcomeReason: null,
      // Screen decisions are intentionally only projected for the latest task
      // and its owner; an explicitly selected opportunity cannot inherit one.
      screenDecision: selectedOpportunity ? null : conversation?.negotiation?.screenDecision ?? null,
    }),
    [contactedTurns.length, selectedOpportunity, conversation?.negotiation?.screenDecision],
  );

  return (
    <>
      <ConversationHeader>
        <div className="flex items-center gap-3">
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
      </ConversationHeader>

      {/* Transcript */}
      <div className="px-6 lg:px-8 pb-32 flex-1">
        <ContentContainer>
          <div className="space-y-4">
            {history?.hasPreviousSession && conversationId && (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={() => void loadPreviousSessionMessages(conversationId, scopedTaskId)}
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
            ) : gateDecision ? (
              // The gate card replaces both the empty state and the generic
              // rejected banner below: it says the same thing with the actual
              // reasoning, and stacking them would double-report one decision.
              <GateDecisionCard decision={gateDecision} counterpartName={counterpartName} />
            ) : conversationMessages.length === 0 && !resolvedVariant ? (
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
                  latestSectionTitle: selectedOpportunity?.title ?? conversation?.via[0]?.title ?? null,
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
                      missedWindowTurnId={null}
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
                        reason={pauseReason}
                        turnCount={latestTaskTurnCount}
                        maxTurns={null}
                        contactMade={contactMade}
                        terminalAuthor={terminalAuthor}
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
                  missedWindowTurnId={null}
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
                {resolvedVariant && !gateDecision && (
                  <ResolvedBanner
                    variant={resolvedVariant}
                    reason={pauseReason}
                    turnCount={latestTaskTurnCount}
                    maxTurns={null}
                    contactMade={contactMade}
                    terminalAuthor={terminalAuthor}
                    onLetGo={resolvedVariant === 'stalled' ? () => navigate('/negotiations') : undefined}
                  />
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ContentContainer>
      </div>
      {opportunityModalElement}
    </>
  );
}

export const Component = NegotiationDetailPage;
