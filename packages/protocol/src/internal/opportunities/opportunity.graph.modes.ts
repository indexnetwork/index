/**
 * The opportunity operations that are not discovery.
 *
 * These used to be graph nodes reached through an `operationMode` conditional
 * edge at START — nine one-node paths sharing a state machine they never used.
 * They are plain async functions now; callers invoke the one they mean. Only
 * the discovery pipeline still needs a graph.
 *
 * Each returns the same shape the corresponding node returned, so callers read
 * `readResult` / `mutationResult` exactly as before.
 */

import type { Id, NegotiationContinuationReceipt, OpportunityActor } from '../../platform/database.js';
import type { DebugMetaAgent } from "../../protocol/debug-meta.js";
import type { EvaluatedOpportunity, EvaluatedOpportunityActor } from './opportunity.state.js';
import type { EvaluatorEntity, EvaluatorInput, OpportunityEvaluator } from "./opportunity.evaluator.js";import { NEGOTIATION_MAX_TURNS_AMBIENT } from "../../protocol/negotiation-policy.js";
import { timed } from '../shared/observability/performance.js';
import { requestContext } from '../shared/observability/request-context.js';
import { getAbortSignalConfig } from '../shared/agent/model-signal.js';
import { safeFallbackSummary } from "./opportunity.presentation.js";import { AMBIENT_PARK_WINDOW_MS } from "../negotiations/negotiation.tools.js";
import { negotiateCandidates } from "../negotiations/negotiation.graph.js";
import type { OpportunityMutationResult } from "./opportunity.lifecycle.js";
import { approveOpportunityIntroduction, deleteOpportunityLifecycle, sendOpportunityLifecycle, updateOpportunityLifecycle } from "./opportunity.lifecycle.js";
import { negotiateExistingOpportunity } from "./opportunity.existing-negotiation.js";
import { buildNetworkContexts, deleteLog, introEvaluationLog, introValidationLog, negotiateExistingLog, readLog, sendLog, updateLog, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";
import { persistNode } from "./opportunity.graph.persist-node.js";

/** Identifies the caller and the opportunity every mutation mode acts on. */
export interface OpportunityMutationRequest {
  userId: Id<'users'>;
  opportunityId: string | undefined;
}

/** Shape the update/delete/send/approve modes return. */
export interface OpportunityMutationOutcome {
  mutationResult: OpportunityMutationResult;
}

/**
 * Read mode: list opportunities for the user, optionally filtered by networkId.
 * Fast path — no LLM calls.
 */
export async function readOpportunities(
  deps: Pick<OpportunityGraphDeps, 'database'>,
  request: { userId: Id<'users'>; networkId?: Id<'networks'> },
) {
  return timed("OpportunityGraph.read", async () => {
    readLog.verbose('Listing opportunities', {
      userId: request.userId,
      networkId: request.networkId,
    });

    try {
      let indexIdFilter: string | undefined;
      if (request.networkId) {
        const [isMember, isOwner] = await Promise.all([
          deps.database.isNetworkMember(request.networkId, request.userId),
          deps.database.isIndexOwner(request.networkId, request.userId),
        ]);
        if (!isMember && !isOwner) {
          return {
            readResult: { count: 0, opportunities: [], message: 'Network not found or you are not a member.' },
          };
        }
        indexIdFilter = request.networkId;
      }

      const rawList = await deps.database.getOpportunitiesForUser(request.userId, {
        limit: 30,
        ...(indexIdFilter ? { networkId: indexIdFilter } : {}),
      });
      const list = rawList.filter((opp) => opp.status !== 'expired');

      if (list.length === 0) {
        return {
          readResult: {
            count: 0,
            message: 'You have no opportunities yet. Create or refine an approved signal; matching runs in the background. Use list_opportunities later to review persisted results.',
            opportunities: [],
          },
        };
      }

      // Dedupe by counterpart set (same people = one row) so chat does not show "You and X" per index
      const counterpartKey = (opp: (typeof list)[number]) =>
        opp.actors
          .filter((a: OpportunityActor) => a.userId !== request.userId && a.role !== 'introducer')
          .map((a: OpportunityActor) => a.userId)
          .sort()
          .join(',');
      const byKey = new Map<string, (typeof list)[number]>();
      for (const opp of list) {
        const key = counterpartKey(opp);
        const existing = byKey.get(key);
        const conf = Number(opp.interpretation?.confidence ?? opp.confidence ?? 0);
        const existingConf = existing ? Number(existing.interpretation?.confidence ?? existing.confidence ?? 0) : 0;
        const oppTime = opp.updatedAt instanceof Date ? opp.updatedAt.getTime() : new Date(opp.updatedAt).getTime();
        const existingTime = existing
          ? (existing.updatedAt instanceof Date ? existing.updatedAt.getTime() : new Date(existing.updatedAt).getTime())
          : 0;
        if (!existing || conf > existingConf || (conf === existingConf && oppTime > existingTime)) {
          byKey.set(key, opp);
        }
      }
      const dedupedList = [...byKey.values()];

      const enriched = await Promise.all(
        dedupedList.map(async (opp) => {
          // "Other parties" = all actors who are not the current user (exclude introducer for suggestedBy).
          // Opportunity graph persists roles as 'agent'|'patient'|'peer'; manual/createManual use 'party'.
          const otherParties = opp.actors.filter((a: OpportunityActor) => a.userId !== request.userId && a.role !== 'introducer');
          const introducer = opp.actors.find((a: OpportunityActor) => a.role === 'introducer');
          const partyIds = otherParties.map((a: OpportunityActor) => a.userId);
          const idsToResolve = introducer ? [...partyIds, introducer.userId] : partyIds;
          // Use the counterpart's (non-viewer) networkId — it reflects where the match was found.
          // actors[0] is typically the viewer with an arbitrary first-target-index value.
          const counterpartActor = opp.actors.find((a: OpportunityActor) => a.userId !== request.userId);
          const actorIndexId = counterpartActor?.networkId ?? opp.actors[0]?.networkId;
          const [indexRecord, ...profileAndUserPairs] = await Promise.all([
            actorIndexId ? deps.database.getNetwork(actorIndexId) : Promise.resolve(null),
            ...idsToResolve.map(async (uid: string) => {
              const [profile, user] = await Promise.all([
                deps.database.getProfile(uid),
                deps.database.getUser(uid),
              ]);
              return (profile?.identity?.name ?? user?.name ?? 'Unknown') as string;
            }),
          ]);
          const connectedWith = profileAndUserPairs.slice(0, partyIds.length);
          const suggestedBy = introducer ? profileAndUserPairs[partyIds.length] ?? null : null;
          const category = opp.interpretation?.category ?? 'connection';
          const confidence = opp.interpretation?.confidence ?? (opp.confidence ? Number(opp.confidence) : null);
          const source = opp.detection?.source ? (OPPORTUNITY_SOURCE_LABEL[opp.detection.source] ?? opp.detection.source) : null;
          return {
            id: opp.id,
            indexName: indexRecord?.title ?? (actorIndexId ?? ''),
            connectedWith,
            suggestedBy,
            reasoning: safeFallbackSummary(opp.interpretation?.reasoning, {
              counterpartName: connectedWith.join(' and '),
              emptyText: 'Connection opportunity',
            }),
            status: opp.status,
            category,
            confidence: confidence != null ? confidence : null,
            source,
          };
        })
      );

      return {
        readResult: {
          count: enriched.length,
          message: `You have ${enriched.length} opportunity(ies).`,
          opportunities: enriched,
        },
      };
    } catch (err) {
      readLog.error('Failed', { error: err });
      return {
        readResult: { count: 0, opportunities: [], message: 'Failed to list opportunities.' },
      };
    }
  });
}

/** Human-readable label per detection source, for the read-mode listing. */
const OPPORTUNITY_SOURCE_LABEL: Record<string, string> = {
  chat: 'Suggested in chat',
  opportunity_graph: 'System match',
  manual: 'Manual',
  cron: 'Scheduled',
  member_added: 'Member added',
  // Read-only history: nothing stamps this source any more, but old rows carry it.
  introducer_discovery: 'Suggested by contact',
};

/**
 * Update mode: change opportunity status (accept, reject, etc.).
 * For 'accepted', enforces the self-accept guard: the caller's actor entry
 * must not already have `actedAt` set — i.e. the caller has not yet been
 * the one to advance this opportunity's state. Stamps `actedAt` on accept
 * atomically with the status change via `stampOpportunityActorAction`.
 */
export async function updateOpportunityStatus(
  deps: Pick<OpportunityGraphDeps, 'database'>,
  request: OpportunityMutationRequest & { newStatus: string | undefined },
): Promise<OpportunityMutationOutcome> {
  return timed("OpportunityGraph.update", async () => {
    updateLog.verbose('Updating opportunity status', {
      userId: request.userId,
      opportunityId: request.opportunityId,
      newStatus: request.newStatus,
    });

    try {
      return {
        mutationResult: await updateOpportunityLifecycle(deps.database, {
          opportunityId: request.opportunityId,
          actorUserId: request.userId,
          newStatus: request.newStatus,
        }),
      };
    } catch (err) {
      updateLog.error('Failed', { error: err });
      return { mutationResult: { success: false, error: 'Failed to update opportunity.' } };
    }
  });
}

/** Delete mode: expire/archive an opportunity. */
export async function deleteOpportunity(
  deps: Pick<OpportunityGraphDeps, 'database'>,
  request: OpportunityMutationRequest,
): Promise<OpportunityMutationOutcome> {
  return timed("OpportunityGraph.delete", async () => {
    deleteLog.verbose('Expiring opportunity', {
      userId: request.userId,
      opportunityId: request.opportunityId,
    });

    try {
      return {
        mutationResult: await deleteOpportunityLifecycle(deps.database, {
          opportunityId: request.opportunityId,
          actorUserId: request.userId,
        }),
      };
    } catch (err) {
      deleteLog.error('Failed', { error: err });
      return { mutationResult: { success: false, error: 'Failed to delete opportunity.' } };
    }
  });
}

/** Send mode: promote a latent or draft opportunity to pending + queue notification. */
export async function sendOpportunity(
  deps: Pick<OpportunityGraphDeps, 'database' | 'queueNotification'>,
  request: OpportunityMutationRequest,
): Promise<OpportunityMutationOutcome> {
  return timed("OpportunityGraph.send", async () => {
    sendLog.verbose('Sending opportunity', {
      userId: request.userId,
      opportunityId: request.opportunityId,
    });

    try {
      return {
        mutationResult: await sendOpportunityLifecycle(
          deps.database,
          { opportunityId: request.opportunityId, actorUserId: request.userId },
          deps.queueNotification,
        ),
      };
    } catch (err) {
      sendLog.error('Failed', { error: err });
      return { mutationResult: { success: false, error: 'Failed to send opportunity.' } };
    }
  });
}

/**
 * Approve-introduction mode.
 * Called by the introducer to approve a latent introducer-pattern opportunity.
 * Sets approved=true on the introducer actor (status stays latent), then
 * enqueues a negotiate_existing job so the parties negotiate normally.
 */
export async function approveIntroduction(
  deps: Pick<OpportunityGraphDeps, 'database' | 'queueNegotiateExisting'>,
  request: OpportunityMutationRequest,
): Promise<OpportunityMutationOutcome> {
  return {
    mutationResult: await approveOpportunityIntroduction(
      deps.database,
      { opportunityId: request.opportunityId, actorUserId: request.userId },
      deps.queueNegotiateExisting,
    ),
  };
}

/**
 * Negotiate-existing mode: load an existing opportunity by ID and run bilateral negotiation.
 * Used after introducer approval to trigger the normal negotiation flow for a latent opportunity.
 */
export async function negotiateExisting(
  deps: Pick<OpportunityGraphDeps, 'database' | 'negotiationGraph' | 'queueNotification'>,
  request: OpportunityMutationRequest & { continuation?: OpportunityState['options']['negotiationContinuation'] },
): Promise<{ negotiationContinuationReceipt?: NegotiationContinuationReceipt; error?: string }> {
  if (!request.opportunityId) return {};
  if (!deps.negotiationGraph) {
    negotiateExistingLog.warn('No negotiationGraph wired; skipping', {
      opportunityId: request.opportunityId,
    });
    return {};
  }

  try {
    const continuation = request.continuation;
    const result = await negotiateExistingOpportunity(
      deps.database,
      async ({ sourceUser, candidate, indexContextOverrides, continuation: execution }) => {
        let receipt: NegotiationContinuationReceipt | undefined;
        // Deliberately no `initiatorUserId`: re-entries inherit the prior task's
        // stamped seat in negotiation initialization, never re-deriving it here.
        const acceptedResults = await negotiateCandidates(
          deps.negotiationGraph!,
          sourceUser,
          [candidate],
          { networkId: '', prompt: '' },
          {
            maxTurns: NEGOTIATION_MAX_TURNS_AMBIENT,
            indexContextOverrides,
            timeoutMs: AMBIENT_PARK_WINDOW_MS,
            ...(execution ? {
              resumeFromTaskId: execution.taskId,
              continuationSettlementId: execution.settlementId,
              continuationExecution: execution,
              onCandidateResolved: async ({ continuationReceipt }) => {
                if (continuationReceipt?.successorTaskId === execution.successorTaskId) receipt = continuationReceipt;
              },
            } : {}),
          },
        );
        return { accepted: acceptedResults.length > 0, ...(receipt ? { receipt } : {}) };
      },
      { opportunityId: request.opportunityId, actorUserId: request.userId, continuation },
      deps.queueNotification,
      {
        onNotificationFailure: ({ actorId, error }) => {
          negotiateExistingLog.warn('Failed to queue notification', { actorId, error });
        },
      },
    );

    if (result.kind === 'skipped') {
      const messages = {
        not_found: 'Opportunity not found',
        stale_continuation: 'Exact continuation actor binding is stale',
        no_source_actor: 'No source actor found',
        no_candidate_actor: 'No candidate actor found',
      } as const;
      negotiateExistingLog.warn(messages[result.reason], {
        opportunityId: request.opportunityId,
        ...(result.reason === 'stale_continuation' && continuation ? { taskId: continuation.taskId } : {}),
      });
      return {};
    }

    negotiateExistingLog.info('Negotiation complete', {
      opportunityId: result.opportunityId,
      accepted: result.accepted,
      continuationFence: result.continuationFence,
    });
    return result.receipt ? { negotiationContinuationReceipt: result.receipt } : {};
  } catch (err) {
    negotiateExistingLog.error('Failed', { opportunityId: request.opportunityId, error: err });
    return { error: `Failed to load opportunity: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** What the caller supplies to create an introduction. */
export interface IntroductionRequest {
  userId: Id<'users'>;
  networkId?: Id<'networks'>;
  /** Pre-gathered entities (profiles + intents per party). */
  introductionEntities: EvaluatorEntity[];
  /** Optional hint from the introducer. */
  introductionHint?: string;
  /** When set (e.g. chat scope), networkId must match this. */
  requiredNetworkId?: Id<'networks'>;
  options?: Partial<OpportunityState['options']>;
}

/**
 * Introduction mode: validate → evaluate → persist.
 *
 * Validation gates on scope and membership; evaluation asks the evaluator to
 * justify the pairing (falling back to the introducer's own word); persistence
 * reuses the discovery pipeline's persist stage.
 */
export async function createIntroduction(
  deps: OpportunityGraphDeps,
  request: IntroductionRequest,
) {
  const state = introductionState(request);
  const validation = await validateIntroduction(deps, state);
  // Mirrors what the graph produced on this path: the error, and empty results.
  if (validation.error) return { opportunities: [], evaluatedOpportunities: [], agentTimings: [], ...validation };

  const evaluation = await evaluateIntroduction(deps, { ...state, ...validation });
  const persisted = await persistNode({ ...state, ...evaluation } as OpportunityState, deps);
  return { ...evaluation, ...persisted };
}

/**
 * Introduction validation: network scope, membership for introducer and all
 * party users, and no existing opportunity between the parties.
 */
export async function validateIntroduction(
  deps: Pick<OpportunityGraphDeps, 'database'>,
  state: Pick<OpportunityState, 'userId' | 'networkId' | 'introductionEntities' | 'requiredNetworkId'>,
): Promise<{ error?: string; trace?: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> }> {
  return timed("OpportunityGraph.introValidation", async () => {
    introValidationLog.verbose('Starting', {
      userId: state.userId,
      networkId: state.networkId,
      entitiesCount: state.introductionEntities?.length ?? 0,
    });

    try {
      const entities = state.introductionEntities ?? [];
      const primaryNetworkId = (state.networkId ?? entities[0]?.networkId) as Id<'networks'> | undefined;
      const partyUserIds = [...new Set(entities.map((e) => e.userId).filter((id) => id !== state.userId))];

      if (!primaryNetworkId || partyUserIds.length < 1) {
        return {
          error: 'Introduction requires networkId and at least two entities (introducer + one counterpart).',
        };
      }

      if (state.requiredNetworkId && primaryNetworkId !== state.requiredNetworkId) {
        return {
          error: 'This chat is scoped to a different community. You can only introduce members of the current community.',
        };
      }

      const [introducerIsMember, introducerIsOwner] = await Promise.all([
        deps.database.isNetworkMember(primaryNetworkId, state.userId),
        deps.database.isIndexOwner(primaryNetworkId, state.userId),
      ]);
      if (!introducerIsMember && !introducerIsOwner) {
        return {
          error: 'One or more users are not members of the specified community. You can only introduce members who share a network.',
        };
      }
      const partyInScope = await Promise.all(
        partyUserIds.map(async (userId) => {
          const [isMember, isOwner] = await Promise.all([
            deps.database.isNetworkMember(primaryNetworkId, userId),
            deps.database.isIndexOwner(primaryNetworkId, userId),
          ]);
          return isMember || isOwner;
        }),
      );
      const allPartyMembers = partyInScope.every(Boolean);
      if (!allPartyMembers) {
        return {
          error: 'One or more users are not members of the specified community. You can only introduce members who share a network.',
        };
      }

      const exists = await deps.database.opportunityExistsBetweenActors(partyUserIds, primaryNetworkId);
      if (exists) {
        return { error: 'An opportunity already exists between these people.' };
      }

      introValidationLog.verbose('Validation passed');
      return {};
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      introValidationLog.error('Failed', {
        userId: state.userId,
        networkId: state.networkId,
        error: err,
      });
      return {
        error: 'Introduction validation failed.',
        trace: [{
          node: "intro_validation_fatal",
          detail: `IntroValidation failed: ${errMsg}`,
          data: { error: errMsg },
        }],
      };
    }
  });
}

/**
 * Build fallback reasoning and actors when the evaluator returns empty or throws.
 */
function buildIntroFallback(
  entities: EvaluatorEntity[],
  state: Pick<OpportunityState, 'userId' | 'introductionHint'>,
  primaryNetworkId: Id<'networks'>,
  introducerName?: string
): { reasoning: string; score: number; actors: EvaluatedOpportunityActor[] } {
  const reasoning =
    `${introducerName ?? 'A member'} believes these people should connect.` +
    (state.introductionHint ? ` Context: ${state.introductionHint}` : '');
  const score = 70;
  const partyUserIds = entities.map((e) => e.userId).filter((id) => id !== state.userId);
  const actors: EvaluatedOpportunityActor[] = partyUserIds.map((uid) => ({
    userId: uid as Id<'users'>,
    role: 'peer' as const,
    networkId: primaryNetworkId,
  }));
  return { reasoning, score, actors };
}

/**
 * Introduction evaluation: runs the entity-bundle evaluator and sets
 * evaluatedOpportunities (one) + introductionContext.
 */
export async function evaluateIntroduction(
  deps: Pick<OpportunityGraphDeps, 'database' | 'evaluatorAgent'>,
  state: Pick<OpportunityState, 'userId' | 'networkId' | 'introductionEntities' | 'introductionHint' | 'options' | 'error'>,
) {
  return timed("OpportunityGraph.introEvaluation", async () => {
    introEvaluationLog.verbose('Starting', { userId: state.userId });

    if (state.error) {
      return { evaluatedOpportunities: [], agentTimings: [] };
    }

    const entities = state.introductionEntities ?? [];
    const primaryNetworkId = (state.networkId ?? entities[0]?.networkId) as Id<'networks'> | undefined;
    if (!primaryNetworkId || entities.length < 2) {
      return { evaluatedOpportunities: [], error: 'Missing entities or network for introduction.', agentTimings: [] };
    }

    const agentTimingsAccum: DebugMetaAgent[] = [];
    let introducerName: string | undefined;
    let reasoning: string;
    let score: number;
    let actors: EvaluatedOpportunityActor[] = [];

    const _traceEmitterIntro = requestContext.getStore()?.traceEmitter;
    let _introEvalStarted = false;
    let _evalStart = Date.now();
    try {
      const introducerUser = await deps.database.getUser(state.userId);
      introducerName = introducerUser?.name ?? undefined;
      const networkContexts = await buildNetworkContexts(entities, deps.database);
      const input: EvaluatorInput = {
        discovererId: state.userId,
        entities,
        introductionMode: true,
        introducerName,
        introductionHint: state.introductionHint ?? undefined,
        networkContexts,
      };

      _evalStart = Date.now();
      _traceEmitterIntro?.({ type: "agent_start", name: "intro-evaluator" });
      _introEvalStarted = true;
      const evaluated = await (deps.evaluatorAgent as OpportunityEvaluator).invokeEntityBundle(input, { minScore: 0, ...getAbortSignalConfig() });
      const _introDuration = Date.now() - _evalStart;
      agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _introDuration });
      _traceEmitterIntro?.({ type: "agent_end", name: "intro-evaluator", durationMs: _introDuration, summary: "Evaluated introduction" });
      if (evaluated.length > 0) {
        const best = evaluated[0];
        reasoning = best.reasoning;
        score = best.score;
        actors = best.actors.map((a) => ({
          userId: a.userId as Id<'users'>,
          role: a.role,
          intentId: a.intentId ?? undefined,
          networkId: primaryNetworkId,
        }));
      } else {
        const fallback = buildIntroFallback(entities, state, primaryNetworkId, introducerName);
        reasoning = fallback.reasoning;
        score = fallback.score;
        actors = fallback.actors;
      }
    } catch (evalErr) {
      const errMsg = evalErr instanceof Error ? evalErr.message : String(evalErr);
      // Close the intro-evaluator span if it was started before the error
      if (_introEvalStarted) {
        const _introErrDuration = Date.now() - _evalStart;
        _traceEmitterIntro?.({ type: "agent_end", name: "intro-evaluator", durationMs: _introErrDuration, summary: `error — ${errMsg}` });
        agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _introErrDuration });
      }
      introEvaluationLog.warn('Evaluator or getUser failed, using fallback', { error: evalErr });
      const fallback = buildIntroFallback(entities, state, primaryNetworkId, introducerName);
      reasoning = fallback.reasoning;
      score = fallback.score;
      actors = fallback.actors;
      return {
        evaluatedOpportunities: [{ actors, score, reasoning }],
        introductionContext: { createdByName: introducerName },
        options: { ...state.options, initialStatus: state.options.initialStatus ?? 'latent' },
        agentTimings: agentTimingsAccum,
        trace: [{
          node: "intro_evaluation_fatal",
          detail: `IntroEvaluation failed (using fallback): ${errMsg}`,
          data: { error: errMsg },
        }],
      };
    }

    const evaluatedOpportunity: EvaluatedOpportunity = { actors, score, reasoning };

    return {
      evaluatedOpportunities: [evaluatedOpportunity],
      introductionContext: { createdByName: introducerName },
      options: { ...state.options, initialStatus: state.options.initialStatus ?? 'latent' },
      agentTimings: agentTimingsAccum,
    };
  });
}

/**
 * The channel defaults the introduction path relies on. Discovery-only channels
 * stay at their empty values because the introduction path never fills them.
 */
function introductionState(request: IntroductionRequest): OpportunityState {
  return {
    userId: request.userId,
    searchQuery: undefined,
    networkId: request.networkId,
    indexScope: undefined,
    triggerIntentId: undefined,
    targetUserId: undefined,
    options: { ...(request.options ?? {}) },
    operationMode: 'create_introduction',
    introductionEntities: request.introductionEntities,
    introductionHint: request.introductionHint,
    requiredNetworkId: request.requiredNetworkId,
    introductionContext: undefined,
    opportunityId: undefined,
    newStatus: undefined,
    indexedIntents: [],
    userNetworks: [],
    targetNetworks: [],
    indexRelevancyScores: {},
    discoverySource: 'context',
    resolvedTriggerIntentId: undefined,
    sourceProfile: null,
    sourcePremises: [],
    sourceContexts: [],
    resolvedIntentInIndex: false,
    createIntentSuggested: false,
    suggestedIntentDescription: undefined,
    hydeEmbeddings: {},
    candidates: [],
    remainingCandidates: [],
    discoveryId: null,
    evaluatedCandidates: [],
    evaluatedOpportunities: [],
    opportunities: [],
    existingBetweenActors: [],
    persistenceOutcome: undefined,
    negotiationContinuationReceipt: undefined,
    error: undefined,
    readResult: undefined,
    mutationResult: undefined,
    trace: [],
    agentTimings: [],
    discoveryNegotiations: [],
    discoverySummary: null,
  } as unknown as OpportunityState;
}
