/**
 * Discovery pipeline, stages 4–5: evaluation and ranking.
 *
 * Evaluation builds an entity bundle from the discoverer plus the top candidates
 * and asks a lightweight explainer to write the "why this match" reasoning for
 * each one — it does not judge accept/reject any more (negotiators own that
 * downstream). Every eligible candidate that survives discovery's own similarity
 * floor, membership checks, and the rejection cooldown is persisted; the only
 * reason a candidate is dropped here is an unsupported-claim guard trip.
 */

import type { Id } from '../../platform/database.js';
import type { DebugMetaAgent } from "../../protocol/core.js";
import type { CandidateMatch, EvaluatedOpportunity } from './opportunity.state.js';
import type { EvaluatorEntity, MatchExplainerInput } from "./opportunity.match-explainer.js";
import { getModelName } from '../shared/agent/model.config.js';
import { timed } from '../shared/observability/performance.js';
import { requestContext } from '../shared/observability/request-context.js';
import { getAbortSignalConfig } from '../shared/agent/model-signal.js';
import type { OpportunityEvidence } from '../../protocol/schemas/network-assignment.schema.js';
import { mergeOpportunityEvidence } from './opportunity.evidence.js';
import { buildEvaluatorEvidenceKey, buildNetworkContexts, evaluationLog, networkMembershipPairKey, rankingLog, REJECTION_COOLDOWN_MS, REJECTION_COOLDOWN_SIMILARITY_PENALTY, safeOpportunityGraphError, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

/** Explanation coupled to the authoritative discovery candidate that produced it. */
type CandidateExplanation = {
  reasoning: string;
  droppedUnsupportedClaim?: boolean;
  candidate: CandidateMatch;
};

/** Graph trace entry shape. */
type TraceEntry = { node: string; detail?: string; data?: Record<string, unknown> };

/**
 * Every candidate in the pool is explained and persisted — no score cutoff,
 * no similarity cutoff beyond discovery's own retrieval floor. This still
 * bounds the pool by rank so a run can never fan out unboundedly against a
 * very large network.
 */
const MAX_EVALUATION_POOL = 80;

/**
 * Node 3: Evaluation (Entity bundle)
 * Builds entity bundle from source + candidates, asks the match explainer for
 * reasoning, and maps every survivor to an `EvaluatedOpportunity`.
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

      const explainerSignalConfig = getAbortSignalConfig();

      const { evaluatedOpportunities, trace: traceEntries } = await evaluateCandidatePool({
        pool: boundedPool,
        sourceEntity,
        state,
        deps,
        discoveryUserId,
        explainerSignalConfig,
        agentTimingsAccum,
      });

      evaluationLog.verbose('Evaluation complete', {
        evaluatedCandidates: boundedPool.length,
        explained: evaluatedOpportunities.length,
      });

      return {
        candidates: eligibleCandidates,
        evaluatedOpportunities,
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
  explainerSignalConfig: ReturnType<typeof getAbortSignalConfig>;
  agentTimingsAccum: DebugMetaAgent[];
}

/**
 * Evaluate the whole candidate pool in one parallel round: hydrate entities,
 * invoke the match explainer once per candidate, and map every survivor onto
 * an `EvaluatedOpportunity`. The only candidates dropped here are ones whose
 * explanation tripped the unsupported-claim guard.
 */
async function evaluateCandidatePool(
  args: CandidatePoolArgs,
): Promise<{ evaluatedOpportunities: EvaluatedOpportunity[]; trace: TraceEntry[] }> {
  const {
    pool, sourceEntity, state, deps, discoveryUserId,
    explainerSignalConfig, agentTimingsAccum,
  } = args;
  const evalStart = Date.now();
  const traceEntries: TraceEntry[] = [];

  const candidateEntities = await buildCandidateEntities(pool, deps);
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
    // Avoid leaking unrelated resource evidence when a user has more than one
    // candidate entity collapsed into a single profile-only actor.
    if (keys.length === 1) return evidenceByEntityKey.get(keys[0]);
    return undefined;
  }

  const networkContexts = await buildNetworkContexts([sourceEntity, ...candidateEntities], deps.database);

  // One explainer call per candidate, fired in parallel — the whole pool, one round.
  const explanations = await explainInParallel({
    matchExplainer: deps.matchExplainer, sourceEntity, candidateEntities, candidateMatches: pool, state, discoveryUserId,
    networkContexts, explainerSignalConfig, agentTimingsAccum, traceEntries,
  });

  const dropped = explanations.filter((e) => e.droppedUnsupportedClaim);
  const kept = explanations.filter((e) => !e.droppedUnsupportedClaim);

  function toEvaluatedOpportunity(explanation: CandidateExplanation): EvaluatedOpportunity {
    const { candidate, reasoning } = explanation;
    const actors: EvaluatedOpportunity['actors'] = [
      {
        userId: discoveryUserId as Id<'users'>,
        role: 'peer',
        intentId: state.resolvedTriggerIntentId ?? sourceEntity.intents?.[0]?.intentId as Id<'intents'> | undefined,
        networkId: candidate.networkId,
      },
      {
        userId: candidate.candidateUserId,
        role: 'peer',
        intentId: candidate.candidateIntentId,
        networkId: candidate.networkId,
      },
    ];
    return {
      reasoning,
      score: candidate.similarity * 100,
      evidence: mergeOpportunityEvidence(...actors.map(evidenceForActor)),
      actors,
    };
  }

  const evaluatedOpportunities = kept.map(toEvaluatedOpportunity);

  evaluationLog.verbose('Pool evaluated', {
    evaluatedCount: explanations.length,
    explainedCount: evaluatedOpportunities.length,
    droppedCount: dropped.length,
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
      minSimilarity: deps.retrievalMinSimilarity,
      retrievalMinSimilarity: deps.retrievalMinSimilarity,
      poolSize: pool.length,
    },
  });

  const explainedByUserId = new Map<string, { score: number; reasoning: string }>();
  for (const opp of evaluatedOpportunities) {
    const candidateActor = opp.actors.find(a => a.userId !== discoveryUserId);
    if (candidateActor) {
      explainedByUserId.set(candidateActor.userId, { score: opp.score, reasoning: opp.reasoning });
    }
  }
  const droppedByUserId = new Map<string, true>();
  for (const explanation of dropped) {
    droppedByUserId.set(explanation.candidate.candidateUserId, true);
  }

  traceEntries.push({
    node: "evaluation",
    detail: `Explained ${candidateEntities.length} candidate(s) → ${evaluatedOpportunities.length} persisted, ${dropped.length} dropped by claim-safety guard`,
    data: {
      inputCandidates: pool.length,
      explainedCount: evaluatedOpportunities.length,
      droppedCount: dropped.length,
      durationMs: Date.now() - evalStart,
      model: getModelName("opportunityEvaluator"),
    },
  });

  if (dropped.length > 0) {
    traceEntries.push({
      node: "evaluation_dropped",
      detail: `${dropped.length} explanation(s) dropped by the unsupported-claim guard`,
      data: {
        droppedCount: dropped.length,
        drops: dropped.map((e) => ({ candidateUserId: e.candidate.candidateUserId })),
      },
    });
  }

  // Individual candidate entries - show ALL candidates that went to the explainer
  for (const entity of candidateEntities) {
    const candidateName = entity.profile?.name || entity.userId.slice(0, 8);
    const explained = explainedByUserId.get(entity.userId);
    const wasDropped = droppedByUserId.has(entity.userId);
    const status = explained
      ? '✓ explained'
      : wasDropped
        ? '✗ dropped (unsupported claim)'
        : '✗ no explanation';

    traceEntries.push({
      node: "candidate",
      detail: `${candidateName}: ${status}`,
      data: {
        userId: entity.userId,
        name: candidateName,
        bio: entity.profile?.bio,
        score: explained?.score,
        explained: !!explained,
        dropped: wasDropped,
        reasoning: explained?.reasoning ?? 'No explanation persisted for this candidate',
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

  return { evaluatedOpportunities, trace: traceEntries };
}
/** Dedup by userId — when same similarity, prefer network with highest relevancyScore. */
function dedupeCandidatesByUser(sortedCandidates: CandidateMatch[], state: OpportunityState): CandidateMatch[] {
  const bestByUser = new Map<string, CandidateMatch>();
  for (const c of sortedCandidates) {
    const existing = bestByUser.get(c.candidateUserId);
    if (!existing) {
      bestByUser.set(c.candidateUserId, c);
    } else if (c.similarity > existing.similarity) {
      bestByUser.set(c.candidateUserId, c);
    } else if (c.similarity === existing.similarity) {
      // Tie-break: prefer network with higher relevancy score
      const cScore = state.networkRelevancyScores[c.networkId] ?? 0;
      const existingScore = state.networkRelevancyScores[existing.networkId] ?? 0;
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
 * Candidates with a recently rejected opportunity receive a
 * similarity penalty so they are ranked lower (and often pushed out of
 * the evaluation pool). This prevents cross-query re-surfacing of
 * false-positive matches that were already caught downstream.
 * The persist-node dedup is still the hard gate; this is a soft guard
 * that reduces explainer cost and repeat surfacing of already-rejected pairs.
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

/** Hydrate each candidate into the profile/intent shape the explainer reads. */
async function buildCandidateEntities(
  batchToEvaluate: CandidateMatch[],
  deps: OpportunityGraphDeps,
): Promise<EvaluatorEntity[]> {
  return Promise.all(
    batchToEvaluate.map(async (c) => {
      const profile = await deps.database.getProfile(c.candidateUserId);
      let intentPayload = c.candidatePayload;
      let intentSummary = c.candidateSummary;
      const evidence = c.evidence;
      if (c.candidateIntentId != null && (!intentPayload || intentPayload === '')) {
        const intent = await deps.database.getIntent(c.candidateIntentId);
        if (intent) {
          intentPayload = intent.payload;
          intentSummary = intent.summary ?? undefined;
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

/** Shared arguments for the explainer invocation. */
interface ExplainArgs {
  matchExplainer: OpportunityGraphDeps['matchExplainer'];
  sourceEntity: EvaluatorEntity;
  candidateEntities: EvaluatorEntity[];
  candidateMatches: CandidateMatch[];
  state: OpportunityState;
  discoveryUserId: string;
  networkContexts: Record<string, string>;
  explainerSignalConfig: ReturnType<typeof getAbortSignalConfig>;
  agentTimingsAccum: DebugMetaAgent[];
}

/** Build the explainer input for a given entity pair. */
function buildExplainerInput(args: ExplainArgs, entities: EvaluatorEntity[]): MatchExplainerInput {
  return {
    discovererId: args.discoveryUserId,
    entities,
    existingOpportunities: args.state.options.existingOpportunities,
    ...(args.state.searchQuery?.trim() ? { discoveryQuery: args.state.searchQuery.trim() } : {}),
    networkContexts: args.networkContexts,
  };
}

/** One LLM call per candidate, all fired in parallel. */
async function explainInParallel(
  args: ExplainArgs & { traceEntries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> },
): Promise<CandidateExplanation[]> {
  const { matchExplainer, sourceEntity, candidateEntities, candidateMatches, explainerSignalConfig, agentTimingsAccum, traceEntries } = args;
  evaluationLog.verbose('Running parallel explanation', { candidates: candidateEntities.length });
  const parallelErrors: Array<{ candidateUserId: string; candidateName: string; error: string; durationMs: number }> = [];

  const parallelResults = await Promise.all(
    candidateEntities.map((candidateEntity, index) => {
      const candidate = candidateMatches[index];
      if (!candidate) throw new Error('Candidate entity has no discovery provenance');
      const input = buildExplainerInput(args, [sourceEntity, candidateEntity]);
      const _evalStart = Date.now();
      const _traceEmitter = requestContext.getStore()?.traceEmitter;
      _traceEmitter?.({ type: "agent_start", name: "opportunity-match-explainer" });
      const _candidateName = candidateEntity.profile?.name ?? "Unknown";
      return matchExplainer.explain(input, explainerSignalConfig)
        .then((res): CandidateExplanation => {
          const _evalDuration = Date.now() - _evalStart;
          agentTimingsAccum.push({ name: 'opportunity.match-explainer', durationMs: _evalDuration });
          const _summary = res.droppedUnsupportedClaim ? `${_candidateName}: dropped` : `${_candidateName}: explained`;
          _traceEmitter?.({ type: "agent_end", name: "opportunity-match-explainer", durationMs: _evalDuration, summary: _summary });
          return { ...res, candidate };
        })
        .catch((err): CandidateExplanation => {
          const _evalDuration = Date.now() - _evalStart;
          const _errMsg = safeOpportunityGraphError(err);
          agentTimingsAccum.push({ name: 'opportunity.match-explainer', durationMs: _evalDuration });
          _traceEmitter?.({ type: "agent_end", name: "opportunity-match-explainer", durationMs: _evalDuration, summary: `${_candidateName}: error — ${_errMsg}` });
          evaluationLog.warn('Parallel explanation failed for candidate', {
            candidateUserId: candidateEntity.userId,
            error: _errMsg,
          });
          parallelErrors.push({
            candidateUserId: candidateEntity.userId,
            candidateName: _candidateName,
            error: _errMsg,
            durationMs: _evalDuration,
          });
          return { reasoning: '', droppedUnsupportedClaim: true, candidate };
        });
    })
  );

  // Record trace entries for candidates that failed during parallel explanation
  if (parallelErrors.length > 0) {
    traceEntries.push({
      node: "evaluation_errors",
      detail: `${parallelErrors.length}/${candidateEntities.length} candidate explanation(s) failed`,
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

  return parallelResults;
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
