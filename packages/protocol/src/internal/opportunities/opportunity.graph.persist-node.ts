/**
 * Discovery pipeline, stage 6: persistence.
 *
 * Two persistence paths share the node — chat introductions and plain
 * discovery. Each one decides whether an existing opportunity between the same
 * people should be reactivated, upgraded, or suppressed before any row is
 * written; only what survives that gate reaches `persistOpportunities`.
 */

import type { CreateOpportunityData, Id, Opportunity, OpportunityActor, OpportunityStatus } from '../../platform/database.js';
import type { EvaluatedOpportunity, EvaluatedOpportunityActor } from './opportunity.state.js';
import { timed } from '../shared/observability/performance.js';
import { validateOpportunityActors } from './opportunity.utils.js';
import { hasUnsupportedOpportunityClaim } from '../shared/utils/claim-safety.js';
import { normalizeOpportunityActorIntent } from './opportunity.actor.js';
import { persistOpportunities } from "./opportunity.persist.js";
import { stampEligibleNewbornOpportunities } from "./opportunity.newborn-stamping.js";
import { admitOpportunityPersistence, createEligibleOpportunityStatusUpdater } from "./opportunity.persistence-admission.js";
import { belongsToOwnedIntent, DEDUP_WINDOW_MS, isActiveNegotiationTaskFresh, persistDedupLog, persistLog, persistPathLog, triggerForOwner, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

/** A pairing that was not persisted because an opportunity already covers it. */
type ExistingBetweenActor = {
  candidateUserId: Id<'users'>;
  networkId: Id<'networks'>;
  existingOpportunityId?: Id<'opportunities'>;
  existingStatus?: OpportunityStatus;
  reason?: 'same_trigger_recent_duplicate' | 'pair_active_negotiation' | 'final_atomic_conflict';
  existingTriggerIntentId?: string;
};

/** Applies a status transition only while the pair is still network-eligible. */
type StatusUpdater = ReturnType<typeof createEligibleOpportunityStatusUpdater>;

/**
 * Mutable state shared across the per-opportunity loop: what got reactivated,
 * what got suppressed, and how many cross-trigger matches were let through.
 */
interface PersistLedger {
  reactivated: Opportunity[];
  existingBetweenActors: ExistingBetweenActor[];
  crossTriggerAllowedCount: number;
}

/** Everything the three persistence paths read. */
interface PersistPathContext {
  state: OpportunityState;
  deps: OpportunityGraphDeps;
  ledger: PersistLedger;
  updateStatusIfStillEligible: StatusUpdater;
  initialStatus: OpportunityStatus;
  now: string;
}

/**
 * Only skip 'draft' (chat-only) opportunities during dedup.
 * 'latent' must NOT be skipped — background discovery creates latent opportunities,
 * and excluding them causes the same user pair to get duplicate opportunities
 * when multiple intents trigger separate discovery jobs (IND-166).
 */
const DEDUP_SKIP_STATUSES: Array<'draft'> = ['draft'];

/**
 * Node 5: Persist
 * Creates opportunities from evaluator-proposed actors (networkId, userId, role, optional intent).
 */
export async function persistNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  return timed("OpportunityGraph.persist", async () => {
    const startTime = Date.now();
    const initialStatus = state.options.initialStatus ?? 'pending';
    persistLog.verbose('Starting persistence (dedup-v2)', {
      opportunitiesToCreate: state.evaluatedOpportunities.length,
      initialStatus,
    });

    if (state.evaluatedOpportunities.length === 0) {
      persistLog.verbose('No opportunities to persist', {
        triggerIntentId: state.triggerIntentId,
        reason: state.candidates.length === 0 ? 'no_search_candidates' : 'evaluator_rejected_all',
      });
      return {
        opportunities: [],
        persistenceOutcome: {
          evaluatedCount: 0,
          createdCount: 0,
          reactivatedCount: 0,
          sameTriggerDuplicateSuppressions: 0,
          pairActiveNegotiationSuppressions: 0,
          crossTriggerAllowedCount: 0,
          finalAtomicConflictCount: 0,
        },
      };
    }

    try {
      const finalTriggerIntentId = state.triggerIntentId;
      const admission = await admitOpportunityPersistence(deps.database, {
        ownerUserId: state.userId,
        triggerIntentId: finalTriggerIntentId,
        networkId: state.networkId,
        indexScope: state.indexScope,
        evaluatedOpportunities: state.evaluatedOpportunities,
      });
      if (admission.kind === 'empty_scope') {
        persistLog.info('Skipped persistence because final discovery scope is empty', {
          userId: state.userId,
          triggerIntentId: finalTriggerIntentId,
        });
        return { opportunities: [] };
      }
      const { allowedNetworkIds: finalAllowedNetworkIds, networkEligibility, evaluatedOpportunities: evaluatedToPersist } = admission;
      if (evaluatedToPersist.length < state.evaluatedOpportunities.length) {
        persistLog.info('Skipped opportunities with inactive participant network pairs', {
          before: state.evaluatedOpportunities.length,
          after: evaluatedToPersist.length,
          removed: state.evaluatedOpportunities.length - evaluatedToPersist.length,
        });
      }
      if (evaluatedToPersist.length === 0) return { opportunities: [] };

      const updateStatusIfStillEligible = createEligibleOpportunityStatusUpdater(
        deps.database,
        finalAllowedNetworkIds,
        networkEligibility,
        {
          onUnavailableAdapter: () => {
            persistLog.error('Network-eligible status update adapter is unavailable; failing closed');
          },
        },
      );

      const ledger: PersistLedger = { reactivated: [], existingBetweenActors: [], crossTriggerAllowedCount: 0 };
      const ctx: PersistPathContext = {
        state,
        deps,
        ledger,
        updateStatusIfStillEligible,
        initialStatus,
        now: new Date().toISOString(),
      };

      const itemsToPersist: CreateOpportunityData[] = [];

      for (const evaluated of evaluatedToPersist) {
        persistPathLog.verbose('Selecting persistence path', {
          isIntroduction: !!state.introductionContext,
          stateUserId: state.userId,
          stateIndexId: state.networkId,
          evaluatedActorUserIds: evaluated.actors.map(a => a.userId),
        });

        const data = state.introductionContext
          ? buildIntroductionOpportunity(ctx, evaluated)
          : await buildDiscoveryOpportunity(ctx, evaluated);
        if (!data) continue;

        if (hasUnsupportedOpportunityClaim(data.interpretation.reasoning)) {
          persistLog.warn('Skipping opportunity with unsupported affiliation/presence claim at persistence boundary', {
            source: data.detection.source,
            triggerIntentId: data.detection.triggeredBy,
          });
          continue;
        }

        try {
          validateOpportunityActors(data.actors);
        } catch (err) {
          persistLog.warn('Skipping opportunity with invalid actors', {
            error: err instanceof Error ? err.message : String(err),
            opportunityReasoning: evaluated.reasoning?.slice(0, 80),
          });
          continue;
        }

        itemsToPersist.push(data);
      }

      const itemsForPersistence = await stampEligibleNewbornOpportunities(
        itemsToPersist,
        {
          ownerUserId: state.userId,
          operationMode: state.operationMode,
          hasIntroductionContext: Boolean(state.introductionContext),
          targetUserId: state.targetUserId,
          discoverySource: state.discoverySource,
          resolvedTriggerIntentId: state.resolvedTriggerIntentId,
          indexedIntentIds: state.indexedIntents.map((intent) => intent.intentId),
        },
        deps.stampNewbornOpportunities,
        {
          onUnsafeResult: ({ expected, actual }) => {
            persistLog.warn('Newborn stamper returned unsafe length/order; persisting originals', { expected, actual });
          },
          onFailure: ({ intentId, error }) => {
            persistLog.warn('Newborn stamper failed; persisting originals', {
              intentId,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        },
      );

      const intentDedupScope = finalTriggerIntentId && state.discoverySource === 'intent'
        ? { triggerIntentId: finalTriggerIntentId, dedupWindowMs: DEDUP_WINDOW_MS }
        : undefined;
      const { created: createdList, conflicts } = await persistOpportunities({
        database: deps.database,
        embedder: deps.embedder,
        items: itemsForPersistence,
        networkEligibility,
        intentDedupScope,
      });

      for (const conflict of conflicts) {
        const item = itemsForPersistence[conflict.itemIndex];
        const candidateActor = item?.actors.find((actor) => actor.userId !== state.userId);
        if (!candidateActor) continue;
        ledger.existingBetweenActors.push({
          candidateUserId: candidateActor.userId,
          networkId: candidateActor.networkId,
          existingOpportunityId: conflict.existingOpportunityId as Id<'opportunities'>,
          existingStatus: conflict.existingStatus,
          reason: conflict.reason,
          ...(conflict.existingTriggerIntentId
            ? { existingTriggerIntentId: conflict.existingTriggerIntentId }
            : {}),
        });
        persistDedupLog.info('Final atomic persistence conflict', {
          triggerIntentId: finalTriggerIntentId,
          candidateUserId: candidateActor.userId,
          existingOpportunityId: conflict.existingOpportunityId,
          existingTriggerIntentId: conflict.existingTriggerIntentId,
          existingStatus: conflict.existingStatus,
          existingAgeMs: Date.now() - new Date(conflict.existingCreatedAt).getTime(),
          reason: conflict.reason,
          finalAtomic: true,
        });
      }

      const allOpportunities = [...ledger.reactivated, ...createdList];

      persistLog.verbose('Persistence complete', {
        created: createdList.length,
        reactivated: ledger.reactivated.length,
        existingBetweenActorsCount: ledger.existingBetweenActors.length,
        status: initialStatus,
      });
      const persistenceOutcome = {
        evaluatedCount: state.evaluatedOpportunities.length,
        createdCount: createdList.length,
        reactivatedCount: ledger.reactivated.length,
        sameTriggerDuplicateSuppressions: ledger.existingBetweenActors.filter((entry) =>
          entry.reason === 'same_trigger_recent_duplicate').length,
        pairActiveNegotiationSuppressions: ledger.existingBetweenActors.filter((entry) =>
          entry.reason === 'pair_active_negotiation').length,
        crossTriggerAllowedCount: ledger.crossTriggerAllowedCount,
        finalAtomicConflictCount: conflicts.length,
      };
      return {
        opportunities: allOpportunities,
        existingBetweenActors: ledger.existingBetweenActors,
        persistenceOutcome,
        trace: [{
          node: "persist",
          detail: `Created ${createdList.length}, reactivated ${ledger.reactivated.length}, ${ledger.existingBetweenActors.length} existing skipped`,
          data: {
            created: createdList.length,
            reactivated: ledger.reactivated.length,
            existingSkipped: ledger.existingBetweenActors.length,
            totalOutput: allOpportunities.length,
            persistenceOutcome,
            durationMs: Date.now() - startTime,
          },
        }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      persistLog.error('Failed', { error });
      return {
        opportunities: [],
        existingBetweenActors: [],
        error: 'Failed to persist opportunities.',
        trace: [{
          node: "persist_fatal",
          detail: `Persist failed: ${errMsg}`,
          data: { error: errMsg },
        }],
      };
    }
  });
}

/** Map evaluator actors onto opportunity actors, defaulting the network. */
function toOpportunityActors(
  evaluated: EvaluatedOpportunity,
  fallbackNetworkId: Id<'networks'>,
  premiseLookup?: Map<string, { premiseId: string; similarity: number }>,
): OpportunityActor[] {
  return evaluated.actors.map((a: EvaluatedOpportunityActor) => {
    const intent = normalizeOpportunityActorIntent(a.intentId);
    return {
      networkId: a.networkId ?? fallbackNetworkId,
      userId: a.userId,
      role: a.role,
      ...(intent ? { intent: intent as Id<'intents'> } : {}),
      ...(premiseLookup?.has(a.userId) ? { premise: premiseLookup.get(a.userId)!.premiseId as Id<'premises'> } : {}),
    };
  });
}

/** Append the viewer as an unapproved introducer unless the evaluator already placed them. */
function withIntroducerActor(
  evaluatorActors: OpportunityActor[],
  viewerUserId: Id<'users'>,
  networkId: Id<'networks'>,
): OpportunityActor[] {
  return evaluatorActors.some(a => a.userId === viewerUserId)
    ? evaluatorActors
    : [...evaluatorActors, { networkId, userId: viewerUserId, role: 'introducer' as const, approved: false }];
}

/**
 * Introduction path: manual detection, introducer actor, curator_judgment signal.
 */
function buildIntroductionOpportunity(
  ctx: PersistPathContext,
  evaluated: EvaluatedOpportunity,
): CreateOpportunityData | null {
  const { state, initialStatus, now } = ctx;
  const indexIdForActors = state.networkId ?? evaluated.actors[0]?.networkId;
  if (indexIdForActors === undefined) {
    persistLog.warn('Introduction path missing networkId; skipping opportunity', {
      userId: state.userId,
      actorsCount: evaluated.actors.length,
    });
    return null;
  }
  const actors = withIntroducerActor(
    toOpportunityActors(evaluated, indexIdForActors),
    state.userId,
    indexIdForActors,
  );
  return {
    detection: {
      source: 'manual',
      createdBy: state.userId,
      createdByName: state.introductionContext!.createdByName,
      timestamp: now,
    },
    actors,
    interpretation: {
      category: 'collaboration',
      reasoning: evaluated.reasoning,
      confidence: evaluated.score / 100,
      signals: [
        {
          type: 'curator_judgment',
          weight: 1,
          detail: `Introduction by ${state.introductionContext!.createdByName ?? 'a member'} via chat`,
        },
      ],
    },
    context: {
      networkId: state.networkId ?? indexIdForActors,
      ...(state.options.conversationId ? { conversationId: state.options.conversationId } : {}),
    },
    confidence: String(evaluated.score / 100),
    status: initialStatus,
  };
}

/**
 * Discovery path: opportunity_graph source, no introducer, lifecycle guard for agent/patient.
 */
async function buildDiscoveryOpportunity(
  ctx: PersistPathContext,
  evaluated: EvaluatedOpportunity,
): Promise<CreateOpportunityData | null> {
  const { state, initialStatus, now } = ctx;
  const indexIdForActors = state.networkId ?? evaluated.actors[0]?.networkId;

  // Build premise lookup from discovery candidates for premise tracking.
  // When multiple premise candidates exist for the same user, keep the highest-similarity one.
  const premiseLookup = new Map<string, { premiseId: string; similarity: number }>();
  for (const c of state.candidates ?? []) {
    if (c.candidatePremiseId) {
      const existing = premiseLookup.get(c.candidateUserId);
      if (!existing || c.similarity > existing.similarity) {
        premiseLookup.set(c.candidateUserId, { premiseId: c.candidatePremiseId, similarity: c.similarity });
      }
    }
  }

  const actors = toOpportunityActors(evaluated, indexIdForActors as Id<'networks'>, premiseLookup);
  applyDiscovererLifecycleSwap(actors, state.userId);

  const suppressed = await suppressDiscoveryDuplicate(ctx, evaluated);
  if (suppressed) return null;

  return {
    detection: {
      source: 'opportunity_graph',
      createdBy: 'agent-opportunity-finder',
      ...(state.discoverySource === 'intent' && state.resolvedTriggerIntentId
        ? { triggeredBy: state.resolvedTriggerIntentId }
        : {}),
      timestamp: now,
    },
    actors,
    interpretation: {
      category: 'collaboration',
      reasoning: evaluated.reasoning,
      confidence: evaluated.score / 100,
      signals: [
        {
          type: evaluated.actors.some((a) => a.intentId) ? 'intent_match' : 'profile_match',
          weight: evaluated.score / 100,
          detail: 'Entity-bundle evaluator',
        },
      ],
    },
    context: {
      ...(state.networkId ? { networkId: state.networkId } : {}),
      ...(state.options.conversationId ? { conversationId: state.options.conversationId } : {}),
    },
    confidence: String(evaluated.score / 100),
    status: initialStatus,
    metadata: {
      evidence: evaluated.evidence ?? [],
    },
  };
}

/**
 * The discoverer must be the patient so the opportunity shows up in their
 * lifecycle view; swap roles with the counterpart when the evaluator put them
 * in the agent seat. Introduced opportunities keep the evaluator's roles.
 */
function applyDiscovererLifecycleSwap(actors: OpportunityActor[], discovererUserId: Id<'users'>): void {
  if (actors.some(a => a.role === 'introducer')) return;
  const discovererIdx = actors.findIndex(a => a.userId === discovererUserId);
  if (discovererIdx < 0 || actors[discovererIdx].role !== 'agent') return;
  const counterpartIdx = actors.findIndex((a, i) => i !== discovererIdx && a.role === 'patient');
  actors[discovererIdx] = { ...actors[discovererIdx], role: 'patient' };
  if (counterpartIdx >= 0) {
    actors[counterpartIdx] = { ...actors[counterpartIdx], role: 'agent' };
  }
  persistLog.verbose('Swapped discoverer from agent to patient for lifecycle visibility', {
    discovererId: discovererUserId,
  });
}

/**
 * Index-agnostic dedup: find ANY existing opportunity between these users,
 * regardless of which index it was created in or whether a focused network
 * scope is set. Returns true when the pairing must not be persisted.
 */
async function suppressDiscoveryDuplicate(
  ctx: PersistPathContext,
  evaluated: EvaluatedOpportunity,
): Promise<boolean> {
  const { state, deps, ledger, updateStatusIfStillEligible, initialStatus } = ctx;
  const candidateUserId = evaluated.actors.find((a) => a.userId !== state.userId)?.userId;
  persistDedupLog.verbose('Checking overlapping opportunities', {
    stateUserId: state.userId,
    candidateUserId: candidateUserId ?? 'NONE',
    evaluatedActors: evaluated.actors.map(a => ({ userId: a.userId, role: a.role })),
  });
  const overlapping = candidateUserId
    ? await deps.database.findOpportunitiesByActors(
        [state.userId as Id<'users'>, candidateUserId as Id<'users'>],
        { excludeStatuses: DEDUP_SKIP_STATUSES },
      )
    : [];
  persistDedupLog.verbose('findOpportunitiesByActors result', {
    count: overlapping.length,
    results: overlapping.map(o => ({ id: o.id, status: o.status, actors: o.actors?.map((a: OpportunityActor) => ({ userId: a.userId, role: a.role })) })),
  });

  const ownedIntentTriggerId = state.discoverySource === 'intent'
    && state.triggerIntentId
    && state.resolvedTriggerIntentId === state.triggerIntentId
    ? state.triggerIntentId
    : undefined;

  if (ownedIntentTriggerId && candidateUserId) {
    return suppressOwnedIntentDuplicate(ctx, overlapping, candidateUserId, ownedIntentTriggerId);
  }
  if (overlapping.length === 0) return false;

  const existing = overlapping[0];
  const existingIndexId = (existing.context?.networkId ?? state.networkId ?? state.userNetworks?.[0] ?? '') as Id<'networks'>;
  const isRecent = new Date(existing.createdAt).getTime() > Date.now() - DEDUP_WINDOW_MS;

  if (existing.status === 'expired' || existing.status === 'stalled') {
    // Reactivate expired or stalled opportunities.
    // Stalled opportunities are reactivated regardless of age: a stalled negotiation
    // is still in-flight for this pair, so we resume it rather than create a parallel one.
    const reactivated = await updateStatusIfStillEligible(
      existing.id, initialStatus, existing.actors, existing.status,
    );
    if (reactivated) {
      persistLog.verbose('Reactivated opportunity', {
        opportunityId: existing.id,
        candidateUserId,
        previousStatus: existing.status,
        newStatus: initialStatus,
      });
      ledger.reactivated.push(reactivated);
    }
    return true;
  }
  if (existing.status === 'negotiating') {
    // Orphan heal: if a prior opportunity is stuck in 'negotiating' with a stale task,
    // reactivate it so the new discovery run can reuse it instead of creating a duplicate.
    const priorTask = await deps.database.getNegotiationTaskForOpportunity(existing.id);
    if (priorTask && isActiveNegotiationTaskFresh(priorTask)) {
      // Still active — skip (lock gate in init node will handle)
      ledger.existingBetweenActors.push({
        candidateUserId: candidateUserId as Id<'users'>,
        networkId: existingIndexId,
        existingOpportunityId: existing.id as Id<'opportunities'>,
        existingStatus: existing.status,
      });
      persistLog.verbose('Skipping negotiating opportunity with active task', {
        opportunityId: existing.id,
        candidateUserId,
        taskState: priorTask.state,
      });
      return true;
    }
    // Task is stale or missing — reactivate the orphaned negotiating opportunity
    const reactivated = await updateStatusIfStillEligible(
      existing.id, initialStatus, existing.actors, existing.status,
    );
    if (reactivated) {
      persistLog.info('Resuming orphaned negotiating opportunity', {
        opportunityId: existing.id,
        candidateUserId,
        priorTaskState: priorTask?.state,
      });
      ledger.reactivated.push(reactivated);
    }
    return true;
  }
  if (existing.status === 'latent' && initialStatus !== 'latent') {
    // Upgrade latent (background-discovered) to the higher-priority status (e.g. pending)
    const upgraded = await updateStatusIfStillEligible(
      existing.id, initialStatus, existing.actors, existing.status,
    );
    if (upgraded) {
      persistLog.verbose('Upgraded latent opportunity to higher-priority status', {
        opportunityId: existing.id,
        candidateUserId,
        previousStatus: 'latent',
        newStatus: initialStatus,
      });
      ledger.reactivated.push(upgraded);
    }
    return true;
  }
  if (isRecent && candidateUserId) {
    // Time-gated skip: only skip if opportunity was created within DEDUP_WINDOW_MS
    // This prevents parallel job duplicates while allowing new discoveries for long-connected pairs
    ledger.existingBetweenActors.push({
      candidateUserId: candidateUserId as Id<'users'>,
      networkId: existingIndexId,
      existingOpportunityId: existing.id as Id<'opportunities'>,
      existingStatus: existing.status,
    });
    persistLog.verbose('Skipping recent duplicate; opportunity created within dedup window', {
      candidateUserId,
      existingStatus: existing.status,
      existingOpportunityId: existing.id,
      createdAt: existing.createdAt,
    });
    return true;
  }
  // Else: existing opportunity is old enough (outside the 30-day dedup window), allow new opportunity creation
  persistLog.verbose('Allowing new opportunity; existing is outside dedup window', {
    candidateUserId,
    existingStatus: existing.status,
    existingOpportunityId: existing.id,
    createdAt: existing.createdAt,
  });
  return false;
}

/**
 * Dedup for a discovery run triggered by an intent the owner still holds.
 * A pair-global active negotiation always wins; otherwise only opportunities
 * carrying the *same* trigger intent can suppress this one.
 */
async function suppressOwnedIntentDuplicate(
  ctx: PersistPathContext,
  overlapping: Opportunity[],
  candidateUserId: Id<'users'>,
  ownedIntentTriggerId: string,
): Promise<boolean> {
  const { state, deps, ledger, updateStatusIfStillEligible, initialStatus } = ctx;

  let activeNegotiation: { opportunity: Opportunity; taskState: string } | undefined;
  for (const opportunity of overlapping) {
    if (opportunity.status !== 'negotiating') continue;
    const task = await deps.database.getNegotiationTaskForOpportunity(opportunity.id);
    if (task && isActiveNegotiationTaskFresh(task)) {
      activeNegotiation = { opportunity, taskState: task.state };
      break;
    }
  }

  if (activeNegotiation) {
    const existingTriggerIntentId = triggerForOwner(activeNegotiation.opportunity, state.userId);
    ledger.existingBetweenActors.push({
      candidateUserId,
      networkId: (activeNegotiation.opportunity.context?.networkId ?? state.networkId ?? state.userNetworks?.[0] ?? '') as Id<'networks'>,
      existingOpportunityId: activeNegotiation.opportunity.id as Id<'opportunities'>,
      existingStatus: activeNegotiation.opportunity.status,
      reason: 'pair_active_negotiation',
      ...(existingTriggerIntentId ? { existingTriggerIntentId } : {}),
    });
    persistDedupLog.info('Suppressing owned-intent match for pair-global active negotiation', {
      triggerIntentId: ownedIntentTriggerId,
      candidateUserId,
      existingOpportunityId: activeNegotiation.opportunity.id,
      existingTriggerIntentId,
      existingStatus: activeNegotiation.opportunity.status,
      existingAgeMs: Date.now() - new Date(activeNegotiation.opportunity.createdAt).getTime(),
      taskState: activeNegotiation.taskState,
      reason: 'pair_active_negotiation',
    });
    return true;
  }

  const sameTrigger = overlapping
    .filter((opportunity) => belongsToOwnedIntent(opportunity, state.userId, ownedIntentTriggerId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const otherTrigger = overlapping.filter((opportunity) =>
    !belongsToOwnedIntent(opportunity, state.userId, ownedIntentTriggerId));
  const existing = sameTrigger[0];

  if (!existing) {
    if (otherTrigger.length > 0) {
      ledger.crossTriggerAllowedCount += 1;
      persistDedupLog.info('Allowing cross-trigger match for owned intent', {
        triggerIntentId: ownedIntentTriggerId,
        candidateUserId,
        reason: 'cross_trigger_match_allowed',
        otherTriggers: otherTrigger.map((opportunity) => ({
          opportunityId: opportunity.id,
          triggerIntentId: triggerForOwner(opportunity, state.userId),
          status: opportunity.status,
          ageMs: Date.now() - new Date(opportunity.createdAt).getTime(),
        })),
      });
    }
    return false;
  }

  const existingIndexId = (existing.context?.networkId ?? state.networkId ?? state.userNetworks?.[0] ?? '') as Id<'networks'>;
  const isRecent = new Date(existing.createdAt).getTime() > Date.now() - DEDUP_WINDOW_MS;

  if (existing.status === 'expired' || existing.status === 'stalled') {
    const reactivated = await updateStatusIfStillEligible(
      existing.id, initialStatus, existing.actors, existing.status,
    );
    if (reactivated) {
      persistLog.info('Reactivated same-trigger opportunity', {
        triggerIntentId: ownedIntentTriggerId,
        opportunityId: existing.id,
        candidateUserId,
        previousStatus: existing.status,
        newStatus: initialStatus,
      });
      ledger.reactivated.push(reactivated);
    }
    return true;
  }
  if (existing.status === 'negotiating') {
    const reactivated = await updateStatusIfStillEligible(
      existing.id, initialStatus, existing.actors, existing.status,
    );
    if (reactivated) {
      persistLog.info('Resuming same-trigger orphaned negotiating opportunity', {
        triggerIntentId: ownedIntentTriggerId,
        opportunityId: existing.id,
        candidateUserId,
      });
      ledger.reactivated.push(reactivated);
    }
    return true;
  }
  if (existing.status === 'latent' && initialStatus !== 'latent') {
    const upgraded = await updateStatusIfStillEligible(
      existing.id, initialStatus, existing.actors, existing.status,
    );
    if (upgraded) {
      persistLog.info('Upgraded same-trigger latent opportunity', {
        triggerIntentId: ownedIntentTriggerId,
        opportunityId: existing.id,
        candidateUserId,
        newStatus: initialStatus,
      });
      ledger.reactivated.push(upgraded);
    }
    return true;
  }
  if (isRecent) {
    ledger.existingBetweenActors.push({
      candidateUserId,
      networkId: existingIndexId,
      existingOpportunityId: existing.id as Id<'opportunities'>,
      existingStatus: existing.status,
      reason: 'same_trigger_recent_duplicate',
      existingTriggerIntentId: ownedIntentTriggerId,
    });
    persistDedupLog.info('Suppressing recent same-trigger duplicate', {
      triggerIntentId: ownedIntentTriggerId,
      candidateUserId,
      existingOpportunityId: existing.id,
      existingTriggerIntentId: ownedIntentTriggerId,
      existingStatus: existing.status,
      existingAgeMs: Date.now() - new Date(existing.createdAt).getTime(),
      reason: 'same_trigger_recent_duplicate',
    });
    return true;
  }
  persistDedupLog.info('Allowing same-trigger opportunity outside dedup window', {
    triggerIntentId: ownedIntentTriggerId,
    candidateUserId,
    existingOpportunityId: existing.id,
    existingStatus: existing.status,
    existingAgeMs: Date.now() - new Date(existing.createdAt).getTime(),
  });
  return false;
}

/** Trace summary for {@link persistNode}. */
export function persistTraceSummary(result: unknown): string | undefined {
  const r = result as Record<string, unknown>;
  if (r?.error) return `error: ${r.error}`;
  const opps = r?.opportunities as unknown[];
  return opps ? `Persisted ${opps.length} opportunity(ies)` : undefined;
}
