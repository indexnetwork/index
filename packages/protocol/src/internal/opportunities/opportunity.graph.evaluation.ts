/**
 * Discovery pipeline, stages 4–5: evaluation and ranking.
 *
 * Evaluation builds an entity bundle from the discoverer plus the top candidates,
 * asks the evaluator to score them, and maps the verdicts back onto graph state.
 */

import type { Id } from '../../platform/database.js';
import type { DebugMetaAgent } from "../../protocol/core.js";
import type { CandidateMatch, EvaluatedOpportunity } from './opportunity.state.js';
import { OpportunityEvaluator, type EvaluatedOpportunityWithActors, type EvaluatorEntity, type EvaluatorInput, type EvaluatorRejection } from "./opportunity.evaluator.js";
import { getModelName } from '../shared/agent/model.config.js';
import { timed } from '../shared/observability/performance.js';
import { requestContext } from '../shared/observability/request-context.js';
import { getAbortSignalConfig } from '../shared/agent/model-signal.js';
import type { OpportunityEvidence } from '../../protocol/schemas/network-assignment.schema.js';
import { mergeOpportunityEvidence } from './opportunity.evidence.js';
import { DISCOVERY_EVALUATOR_MIN_SCORE } from './discovery.env.js';
import { buildEvaluatorEvidenceKey, buildNetworkContexts, evaluationLog, networkMembershipPairKey, rankingLog, REJECTION_COOLDOWN_MS, REJECTION_COOLDOWN_SIMILARITY_PENALTY, safeOpportunityGraphError, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

/** Pairwise verdict shape the evaluator returns, before actors are resolved. */
type PairwiseOpportunity = {
  reasoning: string;
  score: number;
  actors: Array<{ userId: string; role: 'agent' | 'patient' | 'peer'; intentId?: string | null; evidenceKey?: string | null }>;
  /** Diagnostic-only entry: the evaluator answered, but nothing persistable came of it. */
  rejection?: EvaluatorRejection;
};

/** Graph trace entry shape. */
type TraceEntry = { node: string; detail?: string; data?: Record<string, unknown> };

/** Batch size for one evaluator call. Larger batches time out. */
const EVAL_BATCH_SIZE = 25;

/**
 * How many batches one discovery run may evaluate.
 *
 * Candidates are taken strictly by rank, so a degenerate head cluster — many
 * candidates the retriever scored alike — used to consume the only batch and
 * strand the genuine matches behind it, reported as `evaluator_rejected_all`.
 * When a batch yields no passes we continue into the tail, bounded so a run can
 * never fan out unboundedly. Whatever is left after the bound is reported as
 * never-evaluated rather than as rejected.
 */
const MAX_EVAL_BATCHES_PER_RUN = 3;

/**
 * Node 3: Evaluation (Entity bundle)
 * Builds entity bundle from source + candidates, invokes entity-bundle evaluator, maps to EvaluatedOpportunity with networkId from entities.
 */
export async function evaluationNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  return timed("OpportunityGraph.evaluation", async () => {
    const startTime = Date.now();
    evaluationLog.verbose('Starting evaluation', {
      candidatesCount: state.candidates.length,
    });

    if (state.candidates.length === 0) {
      evaluationLog.verbose('No candidates to evaluate');
      return { evaluatedOpportunities: [], agentTimings: [] };
    }

    const sortedCandidates = [...state.candidates].sort((a, b) => b.similarity - a.similarity);
    const dedupedCandidates = dedupeCandidatesByUser(sortedCandidates, state);

    const discoveryUserId = state.userId;
    let eligibleCandidates: CandidateMatch[];
    try {
      eligibleCandidates = await filterToActiveMemberships(dedupedCandidates, discoveryUserId, deps);
    } catch (error) {
      evaluationLog.error('Active network membership recheck failed; skipping evaluation', { error });
      return {
        candidates: [],
        evaluatedOpportunities: [],
        remainingCandidates: [],
        error: 'Failed to validate candidate network memberships.',
        agentTimings: [],
      };
    }

    if (eligibleCandidates.length < dedupedCandidates.length) {
      evaluationLog.info('Removed candidates without active network pairs before evaluation', {
        before: dedupedCandidates.length,
        after: eligibleCandidates.length,
        removed: dedupedCandidates.length - eligibleCandidates.length,
      });
    }
    if (eligibleCandidates.length === 0) {
      return { candidates: [], evaluatedOpportunities: [], remainingCandidates: [], agentTimings: [] };
    }

    if (dedupedCandidates.length < sortedCandidates.length) {
      evaluationLog.info("Deduped candidates by userId", {
        before: sortedCandidates.length,
        after: dedupedCandidates.length,
        removed: sortedCandidates.length - dedupedCandidates.length,
      });
    }

    const pool = await applyRejectionCooldown(eligibleCandidates, discoveryUserId, deps);

    // Early termination: if search was query-driven and no query-sourced candidates remain,
    // clear remaining to prevent pointless pagination through non-query leftovers
    const isQueryDriven = !!state.searchQuery?.trim();
    let loggedEarlyTermination = false;
    const remainingAfter = (consumed: number): CandidateMatch[] => {
      const rest = pool.slice(consumed);
      const queryRest = rest.filter(
        (c) => c.discoverySource === 'query' || c.discoverySource == null,
      );
      if (isQueryDriven && rest.length > 0 && queryRest.length === 0) {
        if (!loggedEarlyTermination) {
          loggedEarlyTermination = true;
          evaluationLog.info(
            "Early termination: no query-sourced candidates remain",
            { droppedCandidates: rest.length },
          );
        }
        return [];
      }
      return rest;
    };

    const agentTimingsAccum: DebugMetaAgent[] = [];

    try {
      const sourceProfile = await deps.database.getProfile(discoveryUserId);
      const sourceEntity: EvaluatorEntity = {
        userId: discoveryUserId,
        profile: {
          name: sourceProfile?.identity?.name,
          bio: sourceProfile?.identity?.bio,
          location: sourceProfile?.identity?.location,
          context: sourceProfile?.context,
        },
        intents: state.indexedIntents.slice(0, 5).map((i) => ({
          intentId: i.intentId,
          payload: i.payload,
          summary: i.summary,
        })),
        networkId: '' as Id<'networks'>,  // Placeholder — overwritten per-pairing below
        evidenceKey: `${discoveryUserId}::source`,
        ragScore: undefined,
        matchedVia: undefined,
      };

      const minScore = state.targetUserId
        ? DISCOVERY_EVALUATOR_MIN_SCORE
        : deps.evaluatorMinScore;
      const evaluatorSignalConfig = getAbortSignalConfig();

      const evaluator = typeof (deps.evaluatorAgent as OpportunityEvaluator).invokeEntityBundle === 'function'
        ? (deps.evaluatorAgent as OpportunityEvaluator)
        : new OpportunityEvaluator();

      const traceEntries: TraceEntry[] = [];
      const passedOpportunities: EvaluatedOpportunity[] = [];
      let remaining: CandidateMatch[] = [];
      let consumed = 0;
      let batchesRun = 0;

      // Bounded batch continuation: a batch that passes nothing does not end the
      // run while ranked-lower candidates are still waiting. Candidates arrive by
      // rank, so a head cluster the retriever over-scored would otherwise strand
      // every genuine match behind it.
      while (batchesRun < MAX_EVAL_BATCHES_PER_RUN && consumed < pool.length) {
        const batch = pool.slice(consumed, consumed + EVAL_BATCH_SIZE);
        const batchNumber = batchesRun + 1;
        if (batchNumber > 1) {
          evaluationLog.info('No candidate passed; continuing into the next batch', {
            batchNumber,
            evaluating: batch.length,
            alreadyEvaluated: consumed,
          });
        }
        const batchResult = await evaluateCandidateBatch({
          batch,
          batchNumber,
          sourceEntity,
          state,
          deps,
          discoveryUserId,
          minScore,
          evaluator,
          evaluatorSignalConfig,
          agentTimingsAccum,
        });
        consumed += batch.length;
        batchesRun += 1;
        traceEntries.push(...batchResult.trace);
        passedOpportunities.push(...batchResult.passed);
        remaining = remainingAfter(consumed);
        if (batchResult.passed.length > 0) break;
        if (remaining.length === 0) break;
      }

      // A run that ends on the bound with candidates left must say so. Reporting
      // it as "the evaluator rejected everything" hides an unevaluated tail.
      if (passedOpportunities.length === 0 && remaining.length > 0) {
        evaluationLog.info('Evaluation bound reached with candidates still unevaluated', {
          batchesRun,
          evaluated: consumed,
          unevaluated: remaining.length,
        });
        traceEntries.push({
          node: "evaluation_bound",
          detail: `${remaining.length} candidate(s) never evaluated — stopped after ${batchesRun} batch(es) of ${EVAL_BATCH_SIZE}`,
          data: {
            unevaluatedCandidates: remaining.length,
            evaluatedCandidates: consumed,
            batchesRun,
            maxBatches: MAX_EVAL_BATCHES_PER_RUN,
            batchSize: EVAL_BATCH_SIZE,
          },
        });
      }

      evaluationLog.verbose('Evaluation complete', {
        batchesRun,
        evaluatedCandidates: consumed,
        passed: passedOpportunities.length,
        unevaluated: remaining.length,
      });

      return {
        candidates: eligibleCandidates,
        // Only opportunities that passed the threshold reach downstream nodes
        evaluatedOpportunities: passedOpportunities,
        remainingCandidates: remaining,
        trace: traceEntries,
        agentTimings: agentTimingsAccum,
      };
    } catch (error) {
      const errMsg = safeOpportunityGraphError(error);
      evaluationLog.error('Failed', { error: errMsg });
      return {
        evaluatedOpportunities: [],
        error: 'Failed to evaluate candidates.',
        trace: [{
          node: "evaluation_fatal",
          detail: `Evaluation failed: ${errMsg}`,
          data: {
            error: errMsg,
            candidateCount: state.candidates?.length ?? 0,
            durationMs: Date.now() - startTime,
          },
        }],
        agentTimings: agentTimingsAccum,
      };
    }
  });
}

/** Everything one evaluator batch needs, resolved once per run by {@link evaluationNode}. */
interface CandidateBatchArgs {
  batch: CandidateMatch[];
  batchNumber: number;
  sourceEntity: EvaluatorEntity;
  state: OpportunityState;
  deps: OpportunityGraphDeps;
  discoveryUserId: string;
  minScore: number;
  evaluator: OpportunityEvaluator;
  evaluatorSignalConfig: ReturnType<typeof getAbortSignalConfig>;
  agentTimingsAccum: DebugMetaAgent[];
}

/**
 * Evaluate one batch of candidates: hydrate entities, invoke the evaluator, map
 * verdicts onto opportunities, and emit this batch's slice of the trace.
 */
async function evaluateCandidateBatch(
  args: CandidateBatchArgs,
): Promise<{ passed: EvaluatedOpportunity[]; trace: TraceEntry[] }> {
  const {
    batch, batchNumber, sourceEntity, state, deps, discoveryUserId,
    minScore, evaluator, evaluatorSignalConfig, agentTimingsAccum,
  } = args;
  const batchStart = Date.now();
  const traceEntries: TraceEntry[] = [];

  const candidateEntities = await buildCandidateEntities(batch, deps);

  const userIdToIndexId = new Map<string, Id<'networks'>>();
  const evidenceByEntityKey = new Map<string, OpportunityEvidence[]>();
  const entityKeysByUserId = new Map<string, string[]>();
  for (const e of candidateEntities) {
    if (!userIdToIndexId.has(e.userId)) userIdToIndexId.set(e.userId, e.networkId as Id<'networks'>);
    if (e.evidenceKey) {
      evidenceByEntityKey.set(
        e.evidenceKey,
        mergeOpportunityEvidence(evidenceByEntityKey.get(e.evidenceKey), e.evidence),
      );
      entityKeysByUserId.set(e.userId, [...(entityKeysByUserId.get(e.userId) ?? []), e.evidenceKey]);
    }
  }

  function evidenceForActor(actor: { userId: string; intentId?: string | null; evidenceKey?: string | null }): OpportunityEvidence[] | undefined {
    if (actor.evidenceKey) return evidenceByEntityKey.get(actor.evidenceKey);
    const keys = entityKeysByUserId.get(actor.userId) ?? [];
    const intentKey = actor.intentId ? keys.find((key) => key.endsWith(`:${actor.intentId}`)) : undefined;
    if (intentKey) return evidenceByEntityKey.get(intentKey);
    // Avoid leaking unrelated resource evidence when the evaluator collapsed multiple
    // candidates for the same user into a profile-only actor.
    if (keys.length === 1) return evidenceByEntityKey.get(keys[0]);
    return undefined;
  }

  const networkContexts = await buildNetworkContexts([sourceEntity, ...candidateEntities], deps.database);

  // One evaluator call per candidate, fired in parallel.
  const evaluatorVerdicts: PairwiseOpportunity[] = await evaluateInParallel({
    evaluator, sourceEntity, candidateEntities, state, discoveryUserId,
    networkContexts, minScore, evaluatorSignalConfig, agentTimingsAccum, traceEntries,
  });

  // Verdicts the evaluator answered but nothing persistable came of. They carry the
  // real score and reasoning, so the per-candidate trace can say what happened
  // instead of claiming the candidate was never evaluated.
  const rejections = evaluatorVerdicts.filter((op) => op.rejection !== undefined);
  const pairwiseOpportunities = evaluatorVerdicts.filter((op) => op.rejection === undefined);

  const evaluatedOpportunities: EvaluatedOpportunity[] = pairwiseOpportunities.map((op) => ({
    reasoning: op.reasoning,
    score: op.score,
    evidence: mergeOpportunityEvidence(...op.actors.map(evidenceForActor)),
    actors: op.actors.map((a) => {
      const isSource = a.userId === discoveryUserId;
      if (isSource) {
        // Source actor inherits the counterpart's networkId (shared match context)
        const counterpart = op.actors.find((other) => other.userId !== a.userId);
        const counterpartIndexId = counterpart
          ? userIdToIndexId.get(counterpart.userId) ?? (candidateEntities.find((e) => e.userId === counterpart.userId)?.networkId as Id<'networks'>)
          : undefined;
        return {
          userId: a.userId as Id<'users'>,
          role: a.role,
          intentId: a.intentId as Id<'intents'> | undefined,
          networkId: counterpartIndexId ?? userIdToIndexId.get(a.userId) ?? ('' as Id<'networks'>),
        };
      }
      return {
        userId: a.userId as Id<'users'>,
        role: a.role,
        intentId: a.intentId as Id<'intents'> | undefined,
        networkId: userIdToIndexId.get(a.userId) ?? (candidateEntities.find((e) => e.userId === a.userId)?.networkId as Id<'networks'>),
      };
    }),
  }));

  const passed = evaluatedOpportunities.filter((o) => o.score >= minScore);
  evaluationLog.verbose('Batch evaluated', {
    batchNumber,
    evaluatedCount: evaluatedOpportunities.length,
    rejectedCount: rejections.length,
    passed: passed.length,
  });

  // Threshold filter trace: how many candidates in this batch were above/below similarity threshold
  const aboveThreshold = batch.filter(
    (candidate) => candidate.similarity >= deps.retrievalMinSimilarity,
  ).length;
  const belowThreshold = batch.length - aboveThreshold;
  traceEntries.push({
    node: "threshold_filter",
    detail: `${aboveThreshold} above ${deps.retrievalMinSimilarity}, ${belowThreshold} below (batch ${batchNumber} of ${batch.length})`,
    data: {
      aboveThreshold,
      belowThreshold,
      minScore: deps.retrievalMinSimilarity,
      retrievalMinSimilarity: deps.retrievalMinSimilarity,
      evaluatorMinScore: minScore,
      batchSize: batch.length,
      batchNumber,
    },
  });

  // Create a map of evaluated candidates by userId for quick lookup.
  const evaluatedByUserId = new Map<string, { score: number; reasoning: string }>();
  for (const opp of evaluatedOpportunities) {
    const candidateActor = opp.actors.find(a => a.userId !== discoveryUserId);
    if (candidateActor) {
      evaluatedByUserId.set(candidateActor.userId, { score: opp.score, reasoning: opp.reasoning });
    }
  }
  const rejectedByUserId = new Map<string, { score: number; reasoning: string; reason: EvaluatorRejection['reason'] }>();
  for (const op of rejections) {
    const rejection = op.rejection!;
    rejectedByUserId.set(rejection.candidateId, {
      score: op.score,
      reasoning: op.reasoning,
      reason: rejection.reason,
    });
  }

  traceEntries.push({
    node: "evaluation",
    detail: `Evaluated ${candidateEntities.length} candidate(s) → ${passed.length} passed (min score ${minScore})`,
    data: {
      inputCandidates: batch.length,
      returnedFromEvaluator: evaluatedOpportunities.length,
      rejectedByEvaluator: rejections.length,
      passedCount: passed.length,
      minScore,
      batchNumber,
      durationMs: Date.now() - batchStart,
      model: getModelName("opportunityEvaluator"),
    },
  });

  // Guard drops are not model judgements — surface them so they cannot look like
  // an evaluator that simply had nothing to say.
  const guardDropped = rejections.filter((op) => op.rejection!.reason !== 'not_accepted');
  if (guardDropped.length > 0) {
    traceEntries.push({
      node: "evaluation_dropped",
      detail: `${guardDropped.length} accepted verdict(s) dropped by evaluator guards`,
      data: {
        droppedCount: guardDropped.length,
        batchNumber,
        drops: guardDropped.map((op) => ({
          candidateUserId: op.rejection!.candidateId,
          reason: op.rejection!.reason,
          score: op.score,
        })),
      },
    });
  }

  // Individual candidate entries - show ALL candidates that went to evaluator
  for (const entity of candidateEntities) {
    const candidateName = entity.profile?.name || entity.userId.slice(0, 8);
    const evaluated = evaluatedByUserId.get(entity.userId);
    const rejected = rejectedByUserId.get(entity.userId);
    const score = evaluated?.score ?? rejected?.score;
    const didPass = evaluated !== undefined && evaluated.score >= minScore;
    const status = didPass
      ? '✓ passed'
      : score !== undefined
        ? `✗ score ${score}`
        : '✗ no verdict';

    traceEntries.push({
      node: "candidate",
      detail: `${candidateName}: ${status}`,
      data: {
        userId: entity.userId,
        name: candidateName,
        bio: entity.profile?.bio,
        score: score,
        passed: didPass,
        reasoning: evaluated?.reasoning
          ?? rejected?.reasoning
          ?? 'Evaluator returned no verdict for this candidate',
        rejectionReason: rejected?.reason,
        batchNumber,
        matchedVia: entity.matchedVia,
        ragScore: entity.ragScore,
        model: getModelName("opportunityEvaluator"),
        intents: entity.intents?.map((i: { intentId?: string; payload?: string; summary?: string }) => ({
          intentId: i.intentId,
          summary: (i.summary || i.payload || '').slice(0, 100),
        })),
        profile: entity.profile ? {
          name: entity.profile.name,
          location: entity.profile.location,
        } : undefined,
      },
    });
  }

  return { passed, trace: traceEntries };
}
/** Dedup by userId — when same similarity, prefer index with highest relevancyScore. */
function dedupeCandidatesByUser(sortedCandidates: CandidateMatch[], state: OpportunityState): CandidateMatch[] {
  const bestByUser = new Map<string, CandidateMatch>();
  for (const c of sortedCandidates) {
    const existing = bestByUser.get(c.candidateUserId);
    if (!existing) {
      bestByUser.set(c.candidateUserId, c);
    } else if (c.similarity > existing.similarity) {
      bestByUser.set(c.candidateUserId, c);
    } else if (c.similarity === existing.similarity) {
      // Tie-break: prefer index with higher relevancy score
      const cScore = state.indexRelevancyScores[c.networkId] ?? 0;
      const existingScore = state.indexRelevancyScores[existing.networkId] ?? 0;
      if (cScore > existingScore) {
        bestByUser.set(c.candidateUserId, c);
      }
    }
  }
  const deduped = Array.from(bestByUser.values());
  // Re-sort by similarity descending (Map iteration order doesn't guarantee sort)
  deduped.sort((a, b) => b.similarity - a.similarity);
  return deduped;
}

/** Both sides of every pairing must still hold an active membership in the shared network. */
async function filterToActiveMemberships(
  dedupedCandidates: CandidateMatch[],
  discoveryUserId: string,
  deps: OpportunityGraphDeps,
): Promise<CandidateMatch[]> {
  const requestedPairs = dedupedCandidates.flatMap((candidate) => [
    { userId: discoveryUserId, networkId: candidate.networkId },
    { userId: candidate.candidateUserId, networkId: candidate.networkId },
  ]);
  const activePairs = await deps.database.getActiveNetworkMembershipPairs(requestedPairs);
  const activePairKeys = new Set(
    activePairs.map((pair) => networkMembershipPairKey(pair.userId, pair.networkId)),
  );
  return dedupedCandidates.filter((candidate) =>
    activePairKeys.has(networkMembershipPairKey(discoveryUserId, candidate.networkId))
    && activePairKeys.has(networkMembershipPairKey(candidate.candidateUserId, candidate.networkId)),
  );
}

/**
 * IND-567: Rejection cool-down penalty.
 *
 * Candidates with a recently rejected or stalled opportunity receive a
 * similarity penalty so they are ranked lower (and often pushed out of
 * the evaluation batch). This prevents cross-query re-surfacing of
 * false-positive matches that were already caught downstream.
 * The persist-node dedup is still the hard gate; this is a soft guard
 * that reduces evaluator cost and LLM false-positive rate.
 */
async function applyRejectionCooldown(
  eligibleCandidates: CandidateMatch[],
  discoveryUserId: string,
  deps: OpportunityGraphDeps,
): Promise<CandidateMatch[]> {
  const rejectionCooldownIds = new Set<string>();
  if (
    eligibleCandidates.length > 0
    && typeof deps.database.getRecentlyRejectedOpportunityCounterparties === 'function'
  ) {
    try {
      const ids = await (deps.database.getRecentlyRejectedOpportunityCounterparties as NonNullable<typeof deps.database.getRecentlyRejectedOpportunityCounterparties>)(
        discoveryUserId,
        eligibleCandidates.map((c) => c.candidateUserId),
        REJECTION_COOLDOWN_MS,
      );
      for (const id of ids) rejectionCooldownIds.add(id);
      if (rejectionCooldownIds.size > 0) {
        evaluationLog.info('IND-567 rejection cool-down: applying similarity penalty', {
          affectedCount: rejectionCooldownIds.size,
          cooldownDays: Math.round(REJECTION_COOLDOWN_MS / (24 * 60 * 60 * 1000)),
          penalty: REJECTION_COOLDOWN_SIMILARITY_PENALTY,
        });
      }
    } catch (err) {
      evaluationLog.warn('IND-567 rejection cool-down: lookup failed, skipping penalty', {
        error: safeOpportunityGraphError(err),
      });
    }
  }

  // Apply penalty and re-sort so penalised candidates fall to the back.
  return rejectionCooldownIds.size > 0
    ? eligibleCandidates
        .map((c) =>
          rejectionCooldownIds.has(c.candidateUserId)
            ? { ...c, similarity: c.similarity * REJECTION_COOLDOWN_SIMILARITY_PENALTY }
            : c,
        )
        .sort((a, b) => b.similarity - a.similarity)
    : eligibleCandidates;
}

/** Hydrate each candidate into the profile/intent shape the evaluator reads. */
async function buildCandidateEntities(
  batchToEvaluate: CandidateMatch[],
  deps: OpportunityGraphDeps,
): Promise<EvaluatorEntity[]> {
  return Promise.all(
    batchToEvaluate.map(async (c) => {
      const profile = await deps.database.getProfile(c.candidateUserId);
      let intentPayload = c.candidatePayload;
      let intentSummary = c.candidateSummary;
      let evidence = c.evidence;
      if (c.candidateIntentId != null && (!intentPayload || intentPayload === '')) {
        const intent = await deps.database.getIntent(c.candidateIntentId);
        if (intent) {
          intentPayload = intent.payload;
          intentSummary = intent.summary ?? undefined;
        }
      }
      if (c.candidatePremiseId != null && (!intentPayload || intentPayload === '')) {
        const premise = await deps.database.getPremise(c.candidatePremiseId);
        if (premise) {
          intentPayload = premise.assertion.text;
          intentSummary = premise.assertion.summary;
          evidence = (c.evidence ?? []).map((item) => item.candidatePremiseId === c.candidatePremiseId
            ? { ...item, payload: premise.assertion.text, summary: premise.assertion.summary, assertionText: premise.assertion.text }
            : item);
        }
      }
      return {
        userId: c.candidateUserId,
        profile: {
          name: profile?.identity?.name,
          bio: profile?.identity?.bio,
          location: profile?.identity?.location,
          context: profile?.context,
        },
        intents:
          c.candidateIntentId != null
            ? [{ intentId: c.candidateIntentId, payload: intentPayload ?? '', summary: intentSummary }]
            : undefined,
        networkId: c.networkId,
        evidenceKey: buildEvaluatorEvidenceKey(c),
        ragScore: c.similarity * 100,
        matchedVia: c.lens,
        evidence,
      };
    })
  );
}

/** Shared arguments for the two evaluator invocation shapes. */
interface EvaluateArgs {
  evaluator: OpportunityEvaluator;
  sourceEntity: EvaluatorEntity;
  candidateEntities: EvaluatorEntity[];
  state: OpportunityState;
  discoveryUserId: string;
  networkContexts: Record<string, string>;
  minScore: number;
  evaluatorSignalConfig: ReturnType<typeof getAbortSignalConfig>;
  agentTimingsAccum: DebugMetaAgent[];
}

/** Build the evaluator input for a given entity set. */
function buildEvaluatorInput(args: EvaluateArgs, entities: EvaluatorEntity[]): EvaluatorInput {
  return {
    discovererId: args.discoveryUserId,
    entities,
    existingOpportunities: args.state.options.existingOpportunities,
    ...(args.state.searchQuery?.trim() ? { discoveryQuery: args.state.searchQuery.trim() } : {}),
    networkContexts: args.networkContexts,
  };
}

/** Experimental: one LLM call per candidate, all fired in parallel. */
async function evaluateInParallel(
  args: EvaluateArgs & { traceEntries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> },
): Promise<PairwiseOpportunity[]> {
  const { evaluator, sourceEntity, candidateEntities, minScore, evaluatorSignalConfig, agentTimingsAccum, traceEntries } = args;
  evaluationLog.verbose('Running parallel evaluation', { candidates: candidateEntities.length });
  const parallelErrors: Array<{ candidateUserId: string; candidateName: string; error: string; durationMs: number }> = [];

  const parallelResults = await Promise.all(
    candidateEntities.map((candidateEntity) => {
      const input = buildEvaluatorInput(args, [sourceEntity, candidateEntity]);
      const _evalStart = Date.now();
      const _traceEmitter = requestContext.getStore()?.traceEmitter;
      _traceEmitter?.({ type: "agent_start", name: "opportunity-evaluator" });
      const _candidateName = candidateEntity.profile?.name ?? "Unknown";
      return evaluator.invokeEntityBundle(input, { minScore, returnAll: true, ...evaluatorSignalConfig })
        .then((res) => {
          const _evalDuration = Date.now() - _evalStart;
          agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalDuration });
          const _topScore = res.length > 0 ? Math.max(...res.map(r => r.score)) : -1;
          const _summary = _topScore < 0 ? `${_candidateName}: no match` : `${_candidateName}: ${_topScore}`;
          _traceEmitter?.({ type: "agent_end", name: "opportunity-evaluator", durationMs: _evalDuration, summary: _summary });
          return res;
        })
        .catch((err) => {
          const _evalDuration = Date.now() - _evalStart;
          const _errMsg = safeOpportunityGraphError(err);
          agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalDuration });
          _traceEmitter?.({ type: "agent_end", name: "opportunity-evaluator", durationMs: _evalDuration, summary: `${_candidateName}: error — ${_errMsg}` });
          evaluationLog.warn('Parallel eval failed for candidate', {
            candidateUserId: candidateEntity.userId,
            error: _errMsg,
          });
          parallelErrors.push({
            candidateUserId: candidateEntity.userId,
            candidateName: _candidateName,
            error: _errMsg,
            durationMs: _evalDuration,
          });
          return [] as PairwiseOpportunity[];
        });
    })
  );

  // Record trace entries for candidates that failed during parallel evaluation
  if (parallelErrors.length > 0) {
    traceEntries.push({
      node: "evaluation_errors",
      detail: `${parallelErrors.length}/${candidateEntities.length} candidate evaluation(s) failed`,
      data: {
        failedCount: parallelErrors.length,
        totalCandidates: candidateEntities.length,
        errors: parallelErrors.map(e => ({
          candidateUserId: e.candidateUserId,
          candidateName: e.candidateName,
          error: e.error,
          durationMs: e.durationMs,
        })),
      },
    });
  }

  // Each call is already pairwise (source + 1 candidate) — flatten directly
  return parallelResults.flat();
}

/**
 * Node 4: Ranking
 * Sorts evaluated opportunities by score, applies limit, dedupes by actor-set hash.
 */
export async function rankingNode(state: OpportunityState) {
  return timed("OpportunityGraph.ranking", async () => {
    rankingLog.verbose('Starting ranking', {
      evaluatedCount: state.evaluatedOpportunities.length,
    });

    try {
      const sorted = [...state.evaluatedOpportunities].sort((a, b) => b.score - a.score);
      const limit = state.options.limit ?? 20;
      const ranked = sorted.slice(0, limit);

      const actorSetKey = (opp: EvaluatedOpportunity) =>
        opp.actors
          .map((a) => `${a.userId}:${a.networkId}`)
          .sort()
          .join('|');
      const seen = new Set<string>();
      const deduplicated = ranked.filter((opp) => {
        const key = actorSetKey(opp);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      rankingLog.verbose('Ranking complete', {
        sorted: sorted.length,
        afterLimit: ranked.length,
        afterDedup: deduplicated.length,
      });
      return { evaluatedOpportunities: deduplicated };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      rankingLog.error('Failed', { error });
      return {
        evaluatedOpportunities: [],
        error: 'Failed to rank opportunities.',
        trace: [{
          node: "ranking_fatal",
          detail: `Ranking failed: ${errMsg}`,
          data: { error: errMsg },
        }],
      };
    }
  });
}

/** Trace summary for {@link rankingNode}. */
export function rankingTraceSummary(result: unknown): string | undefined {
  const r = result as Record<string, unknown>;
  if (r?.error) return `error: ${r.error}`;
  const opps = r?.evaluatedOpportunities as unknown[];
  return opps ? `Ranked ${opps.length} opportunity(ies)` : undefined;
}
