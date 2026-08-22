/**
 * Discovery pipeline, stage 7: post-persist negotiation.
 *
 * Runs bilateral negotiation per persisted opportunity, passing opportunityId so the
 * negotiation graph's finalize node updates each opportunity's status:
 *   accept → 'pending'  (sender notification follows the pending → notification path)
 *   reject → 'rejected'
 *   timeout/turn_cap → 'stalled'
 * Status updates land in the DB; in-memory state.opportunities is not mutated.
 */

import type { ActiveIntent, OpportunityActor } from '../../platform/database.js';import { NEGOTIATION_MAX_TURNS_AMBIENT, NEGOTIATION_MAX_TURNS_CHAT } from "../../protocol/negotiation-policy.js";
import { requestContext } from '../shared/observability/request-context.js';import { AMBIENT_PARK_WINDOW_MS } from "../negotiations/negotiation.tools.js";
import { negotiateCandidates, type NegotiationCandidate, type OnNegotiationResolved } from "../negotiations/negotiation.graph.js";
import { buildDiscoverySummary, toDiscoveryNegotiation, type NegotiationResolution } from './negotiation-summary.builder.js';
import { resolveOpportunityActorIntent } from './opportunity.actor.js';
import { buildPrioritizedNegotiationIntents } from "./opportunity.existing-negotiation.js";
import { logger, negotiateLog, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

/** Distinguishes "the budget timer won the race" from a real negotiation result. */
const NEGOTIATE_TIMER_SENTINEL = Symbol('negotiate-timer-sentinel');

/**
 * Node 3b: Negotiate (post-persist)
 */
export async function negotiateNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  if (!deps.negotiationGraph) return {};
  if (!state.opportunities || state.opportunities.length === 0) return {};

  const traceEmitter = requestContext.getStore()?.traceEmitter;
  const graphStart = Date.now();
  const persistedById = new Map(
    state.opportunities.map((opportunity) => [opportunity.id, opportunity] as const),
  );
  const attemptBoundaryById = new Map(
    state.opportunities.map((opportunity) => [opportunity.id, opportunity.updatedAt] as const),
  );
  const compensateTasklessNegotiatingOpportunity = async (opportunityId: string): Promise<void> => {
    const opportunity = persistedById.get(opportunityId);
    const expectedUpdatedAt = attemptBoundaryById.get(opportunityId);
    if (opportunity?.status !== 'negotiating' || !expectedUpdatedAt) return;
    const fallbackStatus = opportunity.actors.some((actor) => actor.role === 'introducer')
      ? 'latent'
      : 'draft';
    await deps.database
      .compensateTasklessNegotiatingOpportunity(opportunityId, expectedUpdatedAt, fallbackStatus)
      .catch((error: unknown) => {
        negotiateLog.warn('Failed to compensate taskless negotiating opportunity', {
          opportunityId,
          expectedUpdatedAt,
          fallbackStatus,
          error,
        });
      });
  };
  traceEmitter?.({ type: "graph_start", name: "Negotiation graph" });

  try {
    // Use the same discoveryUserId pattern as evaluationNode
    const discoveryUserId = state.userId as string;

    const sourceAccount = await deps.database.getUser(discoveryUserId).catch(() => null);
    const sourceIntentInputs = (state.indexedIntents ?? []).map((intent) => ({
      id: intent.intentId as string,
      summary: intent.summary ?? null,
      payload: intent.payload ?? null,
    }));
    const sourceHasExactIntent = sourceIntentInputs.some((intent) => intent.id === state.triggerIntentId);
    const sourceFallbackIntent = state.triggerIntentId && !sourceHasExactIntent
      ? await deps.database.getIntent(state.triggerIntentId).catch(() => null)
      : null;
    const ownedSourceFallback = sourceFallbackIntent?.userId === discoveryUserId
      ? sourceFallbackIntent
      : null;

    const sourceUser = {
      id: discoveryUserId,
      intents: buildPrioritizedNegotiationIntents(
        sourceIntentInputs,
        state.triggerIntentId,
        ownedSourceFallback,
      ),
      profile: {
        name: state.sourceProfile?.identity?.name ?? sourceAccount?.name,
        bio: state.sourceProfile?.identity?.bio ?? sourceAccount?.intro ?? undefined,
        location: state.sourceProfile?.identity?.location ?? sourceAccount?.location ?? undefined,
      },
    };

    // Build candidates from persisted opportunities. Each opportunity carries its DB id
    // so the negotiation graph's finalize node can update its status from the outcome.
    negotiateLog.verbose('Building candidates from opportunities', {
      opportunityCount: state.opportunities.length,
      discoveryUserId,
    });

    const filteredBeforeInvocation: string[] = [];
    const candidateEntries = state.opportunities
      .map(opp => {
        // Skip opportunities where any introducer exists but has not yet approved.
        const introducerActors = (opp.actors as OpportunityActor[])
          .filter(a => a.role === 'introducer');
        if (introducerActors.length > 0 && !introducerActors.every(a => a.approved === true)) {
          negotiateLog.verbose('Skipping opportunity: introducer not approved', {
            opportunityId: opp.id,
            introducerCount: introducerActors.length,
            approvedCount: introducerActors.filter(a => a.approved === true).length,
          });
          filteredBeforeInvocation.push(opp.id);
          return null;
        }

        const opportunityActors = opp.actors as Array<{
          userId: string;
          role?: string;
          networkId?: string;
          intent?: string;
          intentId?: string;
        }>;
        const sourceActor = opportunityActors.find(a => a.userId === discoveryUserId && a.role !== 'introducer');
        const candidateActor = opportunityActors.find(a => a.userId !== discoveryUserId && a.role !== 'introducer');
        if (!sourceActor || !candidateActor) {
          negotiateLog.verbose('Skipping opportunity: no candidateActor found', {
            opportunityId: opp.id,
            discoveryUserId,
            actors: (opp.actors as OpportunityActor[])?.map(a => ({ userId: a.userId, role: a.role })) ?? [],
          });
          filteredBeforeInvocation.push(opp.id);
          return null;
        }
        return { opp, sourceActor, candidateActor };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    await Promise.all(filteredBeforeInvocation.map(compensateTasklessNegotiatingOpportunity));

    negotiateLog.verbose('Candidate filtering complete', {
      inputOpportunities: state.opportunities.length,
      outputCandidates: candidateEntries.length,
    });

    const candidates: NegotiationCandidate[] = await Promise.all(
      candidateEntries.map(async ({ opp, sourceActor, candidateActor }) => {
        const userId = candidateActor.userId as string;
        const sourceIntentId = resolveOpportunityActorIntent(sourceActor);
        const candidateIntentId = resolveOpportunityActorIntent(candidateActor);
        const sourceExactActive = sourceIntentId
          ? sourceIntentInputs.find((sourceIntent) => sourceIntent.id === sourceIntentId)
          : undefined;
        const [profile, user, activeIntents, intent, sourceIntent] = await Promise.all([
          deps.database.getProfile(userId).catch(() => null),
          deps.database.getUser(userId).catch(() => null),
          Promise.resolve([] as ActiveIntent[]),
          candidateIntentId
            ? deps.database.getIntent(candidateIntentId).catch(() => null)
            : null,
          sourceIntentId && !sourceExactActive
            ? deps.database.getIntent(sourceIntentId).catch(() => null)
            : null,
        ]);

        const ownedFallbackIntent = intent?.userId === userId ? intent : null;
        const ownedSourceIntent = sourceIntent?.userId === discoveryUserId ? sourceIntent : null;
        const candidateIntents = buildPrioritizedNegotiationIntents(
          activeIntents,
          candidateIntentId,
          ownedFallbackIntent,
        );

        return {
          userId,
          ...(sourceIntentId ? { sourceIntentId } : {}),
          ...(candidateIntentId ? { candidateIntentId } : {}),
          sourceUser: {
            ...sourceUser,
            intents: buildPrioritizedNegotiationIntents(
              sourceIntentInputs,
              sourceIntentId,
              ownedSourceIntent,
            ),
          },
          opportunityId: opp.id as string,
          opportunityStatus: opp.status,
          opportunityUpdatedAt: opp.updatedAt,
          reasoning: (opp.interpretation as { reasoning?: string } | null)?.reasoning ?? '',
          valencyRole: candidateActor.role ?? 'peer',
          networkId: candidateActor.networkId as string,
          ...(state.searchQuery?.trim() && { discoveryQuery: state.searchQuery.trim() }),
          candidateUser: {
            id: userId,
            intents: candidateIntents,
            profile: {
              name: profile?.identity?.name ?? user?.name,
              bio: profile?.identity?.bio ?? user?.intro ?? undefined,
              location: profile?.identity?.location ?? user?.location ?? undefined,
            },
          },
        };
      }),
    );

    const isChatPath = !!state.options?.conversationId;
    const maxTurns = isChatPath
      ? NEGOTIATION_MAX_TURNS_CHAT
      : NEGOTIATION_MAX_TURNS_AMBIENT;

    // Fetch per-candidate index context (group by networkId to avoid duplicate lookups)
    const uniqueIndexIds = [...new Set(candidates.map(c => c.networkId).filter((id): id is string => !!id))];
    const indexContextMap = new Map<string, string>();
    await Promise.all(
      uniqueIndexIds.map(async (networkId) => {
        const ctx = await deps.database.getNetworkMemberContext(networkId, discoveryUserId).catch(() => null);
        const prompt = [ctx?.indexPrompt, ctx?.memberPrompt]
          .filter((v): v is string => !!v?.trim())
          .join('\n\n');
        if (prompt) indexContextMap.set(networkId, prompt);
      }),
    );

    const timeoutMs = await resolveTurnTimeout(isChatPath, uniqueIndexIds, discoveryUserId, deps, candidates.length);

    // Per-candidate hook accumulates negotiation resolutions for discovery
    // question generation, preserving candidate-list order below.
    // Build a stable order index so that resolutions accumulated via the
    // per-candidate async hook can be re-sorted to candidate-list order
    // before being handed to buildQuestionPrompt. Without this the LLM
    // sees negotiations in completion-time order (non-deterministic).
    const candidateOrderById = new Map<string, number>();
    candidates.forEach((c, i) => candidateOrderById.set(c.userId, i));

    const resolutions: Array<NegotiationResolution & { __order: number }> = [];
    const resolvedOpportunityIds = new Set<string>();

    const onCandidateResolved: OnNegotiationResolved = async ({ candidate, turns, outcome }) => {
      if (candidate.opportunityId) resolvedOpportunityIds.add(candidate.opportunityId);
      resolutions.push({
        __order: candidateOrderById.get(candidate.userId) ?? Number.MAX_SAFE_INTEGER,
        candidateUserId: candidate.userId,
        counterpartyHint: (() => {
          const bio = candidate.candidateUser.profile?.bio?.trim();
          if (bio) return bio;
          return (candidate.candidateUser.profile?.interests ?? []).join(", ");
        })(),
        indexContext: candidate.networkId
          ? indexContextMap.get(candidate.networkId) ?? ""
          : "",
        turns,
        outcome,
      });

      if (candidate.opportunityId) {
        await compensateTasklessNegotiatingOpportunity(candidate.opportunityId);
      }
    };

    const negotiationWork = negotiateCandidates(
      deps.negotiationGraph, sourceUser, candidates,
      { networkId: '', prompt: '' }, // base context, overridden per-candidate below
      { maxTurns, traceEmitter: traceEmitter ?? undefined,
        indexContextOverrides: indexContextMap,
        timeoutMs,
        // v2 initiator stamp: every fresh-discovery origin resolves to the
        // discovery user — querying user (chat/tool), intent owner
        // (from-intent), or enriched user (from-enrichment/discovery-run).
        initiatorUserId: discoveryUserId,
        onCandidateResolved },
    );

    /** Order accumulated resolutions back to candidate-list order. */
    const orderResolutions = (): NegotiationResolution[] => [...resolutions]
      .sort((a, b) => a.__order - b.__order)
      .map(({ __order: _o, ...r }) => r as NegotiationResolution);

    // Optionally bound this opportunity-matching continuation phase. When
    // the timer wins, return a `timed_out` trace while the unresolved
    // continuation keeps running in the Bun event loop; each candidate's
    // finalize node persists its opportunity status in the DB. Deliberately
    // do NOT await it, abort it, or add unfinished results to
    // state.opportunities: later opportunity reads observe the persisted
    // continuation state. The budget limits this invocation's wait, not
    // background matching work; orphans heal via maintenance scripts or
    // IND-279 when it lands.
    const budgetMs = state.options.negotiateTimeoutMs;
    let acceptedResults: Awaited<typeof negotiationWork>;
    if (budgetMs !== undefined) {
      let timerId: ReturnType<typeof setTimeout> | undefined;
      const timerWork = new Promise<typeof NEGOTIATE_TIMER_SENTINEL>((resolve) => {
        timerId = setTimeout(() => resolve(NEGOTIATE_TIMER_SENTINEL), budgetMs);
      });
      // try/finally ensures the timer is cleared on every exit path —
      // sentinel-win, work-win, AND `negotiationWork` rejection. Without
      // this, a rejected negotiation would leave the timer pending and
      // keep the event loop alive until `budgetMs` elapses.
      let raced: typeof NEGOTIATE_TIMER_SENTINEL | Awaited<typeof negotiationWork>;
      try {
        raced = await Promise.race([negotiationWork, timerWork]);
      } finally {
        if (timerId !== undefined) clearTimeout(timerId);
      }
      if (raced === NEGOTIATE_TIMER_SENTINEL) {
        // Restore any attempt that is still before its task boundary. A running or
        // parked negotiation already has a task and makes the CAS a no-op; a hung
        // pre-task init becomes owner-actionable while its floating work may retry.
        await Promise.all(
          candidates
            .filter((candidate) => candidate.opportunityId && !resolvedOpportunityIds.has(candidate.opportunityId))
            .map((candidate) => compensateTasklessNegotiatingOpportunity(candidate.opportunityId!)),
        );
        // Floating promise is intentional — see comment above.
        void negotiationWork.catch((err) => {
          negotiateLog.warn('background negotiation failed after timer fired', { error: err });
        });
        negotiateLog.warn('timed out — returning partial results to caller', {
          discoveryUserId,
          candidateCount: candidates.length,
          negotiateTimeoutMs: budgetMs,
        });
        traceEmitter?.({ type: "graph_end", name: "Negotiation graph", durationMs: Date.now() - graphStart });
        const orderedResolutionsPartial = orderResolutions();
        return {
          trace: [{
            node: 'negotiate',
            detail: 'timed_out',
            data: {
              negotiateTimeoutMs: budgetMs,
              candidateCount: candidates.length,
              durationMs: Date.now() - graphStart,
            },
          }],
          discoveryNegotiations: orderedResolutionsPartial.map(toDiscoveryNegotiation),
          discoverySummary: buildDiscoverySummary(orderedResolutionsPartial),
        };
      }
      acceptedResults = raced;
    } else {
      acceptedResults = await negotiationWork;
    }

    // No filtering: every candidate's outcome (accept/reject/stalled) was applied to its
    // opportunity row by the negotiation graph's finalize node via the opportunityId we
    // passed. state.opportunities stays as it was at persist time; DB has the new statuses.
    const acceptedUserIds = new Set(acceptedResults.map(r => r.userId));
    const negotiationDurationMs = Date.now() - graphStart;

    const candidateTraceEntries = candidates.map(c => {
      const accepted = acceptedUserIds.has(c.userId);
      const result = accepted ? acceptedResults.find(r => r.userId === c.userId) : null;
      const name = c.candidateUser.profile?.name ?? c.userId;
      const outcome = accepted ? 'accepted' : 'rejected_or_stalled';
      return {
        node: 'negotiate_candidate',
        detail: `${name}: ${outcome}`,
        data: {
          userId: c.userId,
          opportunityId: c.opportunityId,
          name,
          outcome,
          turns: result?.turnCount ?? 0,
        },
      };
    });

    const acceptedCount = acceptedResults.length;
    const otherCount = candidates.length - acceptedCount;
    const negotiateTrace = [
      {
        node: 'negotiate',
        detail: `${candidates.length} candidate(s) -> ${acceptedCount} accepted, ${otherCount} rejected/stalled`,
        data: {
          durationMs: negotiationDurationMs,
          candidateCount: candidates.length,
          acceptedCount,
          otherCount,
        },
      },
      ...candidateTraceEntries,
    ];

    traceEmitter?.({ type: "graph_end", name: "Negotiation graph", durationMs: Date.now() - graphStart });
    const orderedResolutions = orderResolutions();
    return {
      trace: negotiateTrace,
      discoveryNegotiations: orderedResolutions.map(toDiscoveryNegotiation),
      discoverySummary: buildDiscoverySummary(orderedResolutions),
    };
  } catch (err) {
    await Promise.all(state.opportunities.map((opportunity) =>
      compensateTasklessNegotiatingOpportunity(opportunity.id)));
    negotiateLog.error("Negotiation stage failed", { error: err });
    traceEmitter?.({ type: "graph_end", name: "Negotiation graph", durationMs: Date.now() - graphStart });
    return {
      trace: [{
        node: 'negotiate',
        detail: 'Negotiation failed',
        data: { durationMs: Date.now() - graphStart, error: true },
      }],
      discoveryNegotiations: [],
      discoverySummary: buildDiscoverySummary([]),
    };
  }
}

/**
 * Decide the per-turn timeout.
 *   - Background/queue path (no conversationId): always the park-window
 *     budget (AMBIENT_PARK_WINDOW_MS, 5 min). Turns park in
 *     `waiting_for_agent` and are picked up via polling; the dispatcher
 *     additionally short-circuits to the system agent when no personal
 *     agent has a fresh heartbeat (see AgentDispatcherImpl).
 *   - Chat path with a personal agent authorized: use the same park-window
 *     so the dispatcher parks the turn and the user's personal agent can
 *     pick it up via polling.
 *   - Chat path with no personal agent: use a short timeout (30s) so the
 *     system `Index Negotiator` kicks in without stalling the chat.
 *
 * Check the personal agent per unique candidate network so cross-network
 * chat runs don't get a single authorized agent deciding the timeout for
 * every candidate. Only use the long (polling) timeout when an external
 * (poller) agent is authorized on ALL candidate networks; otherwise fall
 * back to the short timeout so chats don't stall on a network where only
 * the system negotiator is allowed.
 */
async function resolveTurnTimeout(
  isChatPath: boolean,
  uniqueIndexIds: string[],
  discoveryUserId: string,
  deps: OpportunityGraphDeps,
  candidateCount: number,
): Promise<number> {
  const hasExternalAgent = isChatPath && deps.agentDispatcher
    ? (uniqueIndexIds.length > 0
        ? (await Promise.all(
            uniqueIndexIds.map((networkId) =>
              deps.agentDispatcher!.hasExternalAgent(
                discoveryUserId,
                { action: 'manage:negotiations', scopeType: 'network', scopeId: networkId },
              ).catch(() => false),
            ),
          )).every(Boolean)
        : false)
    : false;
  const useLongTimeout = !isChatPath || hasExternalAgent;
  const timeoutMs = useLongTimeout ? AMBIENT_PARK_WINDOW_MS : 30_000;

  logger.info('negotiateNode timeout decision', {
    discoveryUserId,
    isChatPath,
    hasDispatcher: !!deps.agentDispatcher,
    hasExternalAgent,
    useLongTimeout,
    timeoutMs,
    candidateCount,
  });

  return timeoutMs;
}
