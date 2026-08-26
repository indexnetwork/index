/**
 * Discovery pipeline, stages 4–5: evaluation and ranking.
 *
 * Evaluation builds an entity bundle from the discoverer plus the top candidates,
 * asks the evaluator to score them, and maps the verdicts back onto graph state.
 */

import type { Id } from '../../platform/database.js';
import type { DebugMetaAgent } from "../../protocol/core.js";
import type { CandidateMatch, EvaluatedOpportunity } from './opportunity.state.js';
import { OpportunityEvaluator, type EvaluatorEntity, type EvaluatorInput, type EvaluatorRejection } from "./opportunity.evaluator.js";
import { getModelName } from '../shared/agent/model.config.js';
import { timed } from '../shared/observability/performance.js';
import { requestContext } from '../shared/observability/request-context.js';
import { getAbortSignalConfig } from '../shared/agent/model-signal.js';
import type { OpportunityEvidence } from '../../protocol/schemas/network-assignment.schema.js';
import { mergeOpportunityEvidence } from './opportunity.evidence.js';
import { DISCOVERY_EVALUATOR_MIN_SCORE, DISCOVERY_MIN_MATCHES } from './discovery.env.js';
import { buildEvaluatorEvidenceKey, buildNetworkContexts, evaluationLog, networkMembershipPairKey, rankingLog, REJECTION_COOLDOWN_MS, REJECTION_COOLDOWN_SIMILARITY_PENALTY, safeOpportunityGraphError, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

/** Pairwise verdict shape the evaluator returns, before actors are resolved. */
type PairwiseOpportunity = {
  reasoning: string;
  score: number;
  actors: Array<{ userId: string; role: 'agent' | 'patient' | 'peer'; intentId?: string | null; evidenceKey?: string | null }>;
  /** Diagnostic-only entry: the evaluator answered, but nothing persistable came of it. */
  rejection?: EvaluatorRejection;
};

/** Pairwise verdict coupled to the authoritative discovery candidate that produced it. */
type CandidateVerdict = PairwiseOpportunity & { candidate: CandidateMatch };

/** Graph trace entry shape. */
type TraceEntry = { node: string; detail?: string; data?: Record<string, unknown> };

/**
 * Every candidate in the pool is evaluated — no early stop, no similarity
 * cutoff (pass rate does not track retrieval similarity). This still bounds
 * the pool by rank so a run can never fan out unboundedly against a very
 * large network.
 */
const MAX_EVALUATION_POOL = 80;

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
      return { candidates: [], evaluatedOpportunities: [], agentTimings: [] };
    }

    if (dedupedCandidates.length < sortedCandidates.length) {
      evaluationLog.info("Deduped candidates by userId", {
        before: sortedCandidates.length,
        after: dedupedCandidates.length,
        removed: sortedCandidates.length - dedupedCandidates.length,
      });
    }

    const pool = await applyRejectionCooldown(eligibleCandidates, discoveryUserId, deps);
    const boundedPool = pool.slice(0, MAX_EVALUATION_POOL);
    if (boundedPool.length < pool.length) {
      evaluationLog.info('Evaluation pool bounded by rank', {
        pool: pool.length,
        evaluated: boundedPool.length,
      });
    }

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

      const { passed, filled, trace: traceEntries } = await evaluateCandidatePool({
        pool: boundedPool,
        sourceEntity,
        state,
        deps,
        discoveryUserId,
        minScore,
        evaluator,
        evaluatorSignalConfig,
        agentTimingsAccum,
      });

      evaluationLog.verbose('Evaluation complete', {
        evaluatedCandidates: boundedPool.length,
        passed: passed.length,
        filled: filled.length,
      });

      return {
        candidates: eligibleCandidates,
        // Passing opportunities are uncapped; best evaluated rejections fill
        // the discovery floor so a sparse market still has a usable inbox.
        evaluatedOpportunities: [...passed, ...filled],
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

/** Everything the evaluation round needs, resolved once per run by {@link evaluationNode}. */
interface CandidatePoolArgs {
  pool: CandidateMatch[];
  sourceEntity: EvaluatorEntity;
  state: OpportunityState;
  deps: OpportunityGraphDeps;
  discoveryUserId: string;
  minScore: number;
  evaluator: OpportunityEvaluator;
  evaluatorSignalConfig: ReturnType<typeof getAbortSignalConfig>;
  agentTimingsAccum: DebugMetaAgent[];
}

/** An {@link EvaluatedOpportunity} plus retrieval similarity for floor tiebreaking. */
type ScoredOpportunity = EvaluatedOpportunity & { _similarity: number };

function stripSimilarity(o: ScoredOpportunity): EvaluatedOpportunity {
  const { _similarity: _drop, ...rest } = o;
  return rest;
}

/**
 * Evaluate the whole candidate pool in one parallel round: hydrate entities,
 * invoke the evaluator once per candidate, map verdicts onto opportunities,
 * and emits diagnostics. Passing candidates are returned uncapped; the best
 * evaluated non-passing candidates fill the discovery floor.
 */
async function evaluateCandidatePool(
  args: CandidatePoolArgs,
): Promise<{ passed: EvaluatedOpportunity[]; filled: EvaluatedOpportunity[]; trace: TraceEntry[] }> {
  const {
    pool, sourceEntity, state, deps, discoveryUserId,
    minScore, evaluator, evaluatorSignalConfig, agentTimingsAccum,
  } = args;
  const evalStart = Date.now();
  const traceEntries: TraceEntry[] = [];

  const candidateEntities = await buildCandidateEntities(pool, deps);
  const similarityByUserId = new Map(pool.map((candidate) => [candidate.candidateUserId, candidate.similarity]));
  const evidenceByEntityKey = new Map<string, OpportunityEvidence[]>();
  const entityKeysByUserId = new Map<string, string[]>();
  for (const e of candidateEntities) {
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

  // One evaluator call per candidate, fired in parallel — the whole pool, one round.
  const evaluatorVerdicts = await evaluateInParallel({
    evaluator, sourceEntity, candidateEntities, candidateMatches: pool, state, discoveryUserId,
    networkContexts, minScore, evaluatorSignalConfig, agentTimingsAccum, traceEntries,
  });

  // Verdicts the evaluator answered but nothing persistable came of. They carry the
  // real score and reasoning, so the per-candidate trace can say what happened
  // instead of claiming the candidate was never evaluated.
  const rejections = evaluatorVerdicts.filter((op) => op.rejection !== undefined);
  const pairwiseOpportunities = evaluatorVerdicts.filter((op) => op.rejection === undefined);

  function mapActors(op: CandidateVerdict): EvaluatedOpportunity['actors'] {
    const { actors, candidate } = op;
    return actors.map((a) => {
      const isSource = a.userId === discoveryUserId;
      if (isSource) {
        return {
          userId: a.userId as Id<'users'>,
          role: a.role,
          intentId: a.intentId as Id<'intents'> | undefined,
          networkId: candidate.networkId,
        };
      }
      return {
        userId: a.userId as Id<'users'>,
        role: a.role,
        intentId: candidate.candidateIntentId,
        networkId: candidate.networkId,
      };
    });
  }

  function toScoredOpportunity(op: CandidateVerdict): ScoredOpportunity {
    const actors = mapActors(op);
    return {
      reasoning: op.reasoning,
      score: op.score,
      evidence: mergeOpportunityEvidence(...actors.map(evidenceForActor)),
      actors,
      _similarity: similarityByUserId.get(op.candidate.candidateUserId) ?? 0,
    };
  }

  const evaluatedOpportunities = pairwiseOpportunities.map(toScoredOpportunity);
  const passed = evaluatedOpportunities.filter((o) => o.score >= minScore);

  const belowScore = evaluatedOpportunities.filter((o) => o.score < minScore);
  const rejectedFillers = rejections
    .filter((op) => op.rejection!.reason === 'not_accepted')
    .map((op) => {
      const candidateId = op.candidate.candidateUserId;
      const actorIds = new Set(op.actors.map((actor) => actor.userId));
      const actors = actorIds.size === 2 && actorIds.has(discoveryUserId) && actorIds.has(candidateId)
        ? op.actors
        : [
          { userId: discoveryUserId, role: 'peer' as const, intentId: state.resolvedTriggerIntentId ?? sourceEntity.intents?.[0]?.intentId ?? null },
          { userId: candidateId, role: 'peer' as const, intentId: op.candidate.candidateIntentId ?? null },
        ];
      return toScoredOpportunity({ ...op, actors });
    });
  const filled = [...belowScore, ...rejectedFillers]
    .sort((a, b) => (b.score - a.score) || (b._similarity - a._similarity))
    .slice(0, Math.max(0, DISCOVERY_MIN_MATCHES - passed.length));
  const filledCandidateIds = new Set(
    filled.map((opportunity) => opportunity.actors.find((actor) => actor.userId !== discoveryUserId)?.userId),
  );

  evaluationLog.verbose('Pool evaluated', {
    evaluatedCount: evaluatedOpportunities.length,
    rejectedCount: rejections.length,
    passed: passed.length,
    filled: filled.length,
  });

  // Threshold filter trace: how many candidates in the pool were above/below the retrieval similarity threshold.
  const aboveThreshold = pool.filter(
    (candidate) => candidate.similarity >= deps.retrievalMinSimilarity,
  ).length;
  const belowThreshold = pool.length - aboveThreshold;
  traceEntries.push({
    node: "threshold_filter",
    detail: `${aboveThreshold} above ${deps.retrievalMinSimilarity}, ${belowThreshold} below (pool of ${pool.length})`,
    data: {
      aboveThreshold,
      belowThreshold,
      minScore: deps.retrievalMinSimilarity,
      retrievalMinSimilarity: deps.retrievalMinSimilarity,
      evaluatorMinScore: minScore,
      poolSize: pool.length,
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
    rejectedByUserId.set(op.candidate.candidateUserId, {
      score: op.score,
      reasoning: op.reasoning,
      reason: rejection.reason,
    });
  }

  traceEntries.push({
    node: "evaluation",
    detail: filled.length > 0
      ? `Evaluated ${candidateEntities.length} candidate(s) → ${passed.length} passed, ${filled.length} filled to reach the ${DISCOVERY_MIN_MATCHES}-match floor (min score ${minScore})`
      : `Evaluated ${candidateEntities.length} candidate(s) → ${passed.length} passed (min score ${minScore})`,
    data: {
      inputCandidates: pool.length,
      returnedFromEvaluator: evaluatedOpportunities.length,
      rejectedByEvaluator: rejections.length,
      passedCount: passed.length,
      filledCount: filled.length,
      matchFloor: DISCOVERY_MIN_MATCHES,
      minScore,
      durationMs: Date.now() - evalStart,
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
    const isFilled = filledCandidateIds.has(entity.userId);
    const status = didPass
      ? '✓ passed'
      : isFilled
        ? `~ filled (score ${score})`
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
        filled: isFilled,
        reasoning: evaluated?.reasoning
          ?? rejected?.reasoning
          ?? 'Evaluator returned no verdict for this candidate',
        rejectionReason: rejected?.reason,
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

  return { passed: passed.map(stripSimilarity), filled: filled.map(stripSimilarity), trace: traceEntries };
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
 * the evaluation pool). This prevents cross-query re-surfacing of
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
  candidateMatches: CandidateMatch[];
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
): Promise<CandidateVerdict[]> {
  const { evaluator, sourceEntity, candidateEntities, candidateMatches, minScore, evaluatorSignalConfig, agentTimingsAccum, traceEntries } = args;
  evaluationLog.verbose('Running parallel evaluation', { candidates: candidateEntities.length });
  const parallelErrors: Array<{ candidateUserId: string; candidateName: string; error: string; durationMs: number }> = [];

  const parallelResults = await Promise.all(
    candidateEntities.map((candidateEntity, index) => {
      const candidate = candidateMatches[index];
      if (!candidate) throw new Error('Candidate entity has no discovery provenance');
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
          return res.map((opportunity) => ({ ...opportunity, candidate }));
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
          return [] as CandidateVerdict[];
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
      const ranked = state.options.limit != null ? sorted.slice(0, state.options.limit) : sorted;

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
