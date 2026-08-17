/**
 * Discovery pipeline, stages 4–5: evaluation and ranking.
 *
 * Evaluation builds an entity bundle from the discoverer plus the top candidates,
 * asks the evaluator to score them, and maps the verdicts back onto graph state.
 */

import type { Id } from '../shared/interfaces/database.interface.js';
import type { DebugMetaAgent } from '../agents/agent.module.js';
import type { CandidateMatch, EvaluatedOpportunity } from './opportunity.state.js';
import { OpportunityEvaluator, type EvaluatedOpportunityWithActors, type EvaluatorEntity, type EvaluatorInput } from "./opportunity.evaluator.js";
import { getModelName } from '../shared/agent/model.config.js';
import { timed } from '../shared/observability/performance.js';
import { requestContext } from '../shared/observability/request-context.js';
import { getAbortSignalConfig } from '../shared/agent/model-signal.js';
import type { OpportunityEvidence } from '../shared/schemas/network-assignment.schema.js';
import { mergeOpportunityEvidence } from './opportunity.evidence.js';
import { DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT } from './discovery.env.js';
import { buildEvaluatorEvidenceKey, buildNetworkContexts, evaluationLog, getRejectionCooldownMs, networkMembershipPairKey, rankingLog, REJECTION_COOLDOWN_SIMILARITY_PENALTY, safeOpportunityGraphError, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

/** Pairwise verdict shape the evaluator returns, before actors are resolved. */
type PairwiseOpportunity = {
  reasoning: string;
  score: number;
  actors: Array<{ userId: string; role: 'agent' | 'patient' | 'peer'; intentId?: string | null; evidenceKey?: string | null }>;
};

/** Batch size for one evaluator call. Larger batches time out. */
const EVAL_BATCH_SIZE = 25;

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

    const discoveryUserId = state.onBehalfOfUserId ?? state.userId;
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

    const eligibleCandidatesAfterCooldown = await applyRejectionCooldown(eligibleCandidates, discoveryUserId, deps);

    const batchToEvaluate = eligibleCandidatesAfterCooldown.slice(0, EVAL_BATCH_SIZE);
    const remaining = eligibleCandidatesAfterCooldown.slice(EVAL_BATCH_SIZE);

    // Early termination: if search was query-driven and no query-sourced candidates remain,
    // clear remaining to prevent pointless pagination through non-query leftovers
    const isQueryDriven = !!state.searchQuery?.trim();
    const queryRemaining = remaining.filter(
      (c) => c.discoverySource === 'query' || c.discoverySource == null,
    );
    const effectiveRemaining =
      isQueryDriven && queryRemaining.length === 0 ? [] : remaining;

    if (isQueryDriven && remaining.length > 0 && queryRemaining.length === 0) {
      evaluationLog.info(
        "Early termination: no query-sourced candidates remain",
        {
          droppedCandidates: remaining.length,
        },
      );
    }

    if (effectiveRemaining.length > 0) {
      evaluationLog.verbose('Batched candidates for evaluation', {
        evaluating: batchToEvaluate.length,
        remaining: effectiveRemaining.length,
        total: sortedCandidates.length,
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

      const candidateEntities = await buildCandidateEntities(batchToEvaluate, deps);

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

      const minScore = state.targetUserId
        ? DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT
        : deps.evaluatorMinScore;
      const evaluatorSignalConfig = getAbortSignalConfig();

      const evaluator = typeof (deps.evaluatorAgent as OpportunityEvaluator).invokeEntityBundle === 'function'
        ? (deps.evaluatorAgent as OpportunityEvaluator)
        : new OpportunityEvaluator();

      const runParallel = process.env.RUN_OPPORTUNITY_EVAL_IN_PARALLEL === 'true';
      const networkContexts = await buildNetworkContexts([sourceEntity, ...candidateEntities], deps.database);

      // Declare trace entries early so both parallel and serial paths can push error entries
      const traceEntries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> = [];

      const pairwiseOpportunities: PairwiseOpportunity[] = runParallel
        ? await evaluateInParallel({
            evaluator, sourceEntity, candidateEntities, state, discoveryUserId,
            networkContexts, minScore, evaluatorSignalConfig, agentTimingsAccum, traceEntries,
          })
        : splitBundledVerdicts(
            await evaluateBundled({
              evaluator, sourceEntity, candidateEntities, state, discoveryUserId,
              networkContexts, minScore, evaluatorSignalConfig, agentTimingsAccum,
            }),
            state,
            candidateEntities,
          );

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
      evaluationLog.verbose('Evaluation complete', {
        evaluatedCount: evaluatedOpportunities.length,
        passed: passed.length,
      });

      // Threshold filter trace: how many candidates in this batch were above/below similarity threshold
      const aboveThreshold = batchToEvaluate.filter(
        (candidate) => candidate.similarity >= deps.retrievalMinSimilarity,
      ).length;
      const belowThreshold = batchToEvaluate.length - aboveThreshold;
      traceEntries.push({
        node: "threshold_filter",
        detail: `${aboveThreshold} above ${deps.retrievalMinSimilarity}, ${belowThreshold} below (batch of ${batchToEvaluate.length})`,
        data: {
          aboveThreshold,
          belowThreshold,
          minScore: deps.retrievalMinSimilarity,
          retrievalMinSimilarity: deps.retrievalMinSimilarity,
          evaluatorMinScore: minScore,
          batchSize: batchToEvaluate.length,
        },
      });

      // Create a map of evaluated candidates by userId for quick lookup.
      // Use discoveryUserId (which accounts for onBehalfOfUserId in introducer flow)
      // rather than state.userId (which is the introducer, not present in pairwise actors).
      const evaluatedByUserId = new Map<string, { score: number; reasoning: string }>();
      for (const opp of evaluatedOpportunities) {
        const candidateActor = opp.actors.find(a => a.userId !== discoveryUserId);
        if (candidateActor) {
          evaluatedByUserId.set(candidateActor.userId, { score: opp.score, reasoning: opp.reasoning });
        }
      }

      traceEntries.push({
        node: "evaluation",
        detail: `Evaluated ${candidateEntities.length} candidate(s) → ${passed.length} passed (min score ${minScore})`,
        data: {
          inputCandidates: batchToEvaluate.length,
          returnedFromEvaluator: evaluatedOpportunities.length,
          passedCount: passed.length,
          minScore,
          remaining: effectiveRemaining.length,
          batchNumber: 1,
          durationMs: Date.now() - startTime,
          model: getModelName("opportunityEvaluator"),
        },
      });

      // Individual candidate entries - show ALL candidates that went to evaluator
      for (const entity of candidateEntities) {
        const candidateName = entity.profile?.name || entity.userId.slice(0, 8);
        const evaluated = evaluatedByUserId.get(entity.userId);
        const score = evaluated?.score;
        const didPass = score !== undefined && score >= minScore;
        const status = score !== undefined
          ? (didPass ? '✓ passed' : `✗ score ${score}`)
          : '✗ not scored';

        traceEntries.push({
          node: "candidate",
          detail: `${candidateName}: ${status}`,
          data: {
            userId: entity.userId,
            name: candidateName,
            bio: entity.profile?.bio,
            score: score,
            passed: didPass,
            reasoning: evaluated?.reasoning || 'No evaluation returned for this candidate',
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

      return {
        candidates: eligibleCandidates,
        // Only pass opportunities that passed the threshold to downstream nodes
        evaluatedOpportunities: evaluatedOpportunities.filter((o) => o.score >= minScore),
        remainingCandidates: effectiveRemaining,
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
      const cooldownMs = getRejectionCooldownMs();
      const ids = await (deps.database.getRecentlyRejectedOpportunityCounterparties as NonNullable<typeof deps.database.getRecentlyRejectedOpportunityCounterparties>)(
        discoveryUserId,
        eligibleCandidates.map((c) => c.candidateUserId),
        cooldownMs,
      );
      for (const id of ids) rejectionCooldownIds.add(id);
      if (rejectionCooldownIds.size > 0) {
        evaluationLog.info('IND-567 rejection cool-down: applying similarity penalty', {
          affectedCount: rejectionCooldownIds.size,
          cooldownDays: Math.round(cooldownMs / (24 * 60 * 60 * 1000)),
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

/** Default: single bundled LLM call with all candidates. */
async function evaluateBundled(args: EvaluateArgs): Promise<EvaluatedOpportunityWithActors[]> {
  const { evaluator, sourceEntity, candidateEntities, minScore, evaluatorSignalConfig, agentTimingsAccum } = args;
  const input = buildEvaluatorInput(args, [sourceEntity, ...candidateEntities]);
  // Get ALL scored results for tracing (returnAll: true), filter for persistence later
  const _evalStart = Date.now();
  const _traceEmitterSerial = requestContext.getStore()?.traceEmitter;
  _traceEmitterSerial?.({ type: "agent_start", name: "opportunity-evaluator" });
  try {
    const opportunitiesWithActors = await evaluator.invokeEntityBundle(input, { minScore, returnAll: true, ...evaluatorSignalConfig });
    const _evalDuration = Date.now() - _evalStart;
    agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalDuration });
    _traceEmitterSerial?.({ type: "agent_end", name: "opportunity-evaluator", durationMs: _evalDuration, summary: `Evaluated ${candidateEntities.length} candidate(s)` });
    return opportunitiesWithActors;
  } catch (serialErr) {
    const _evalDuration = Date.now() - _evalStart;
    const _errMsg = safeOpportunityGraphError(serialErr);
    agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalDuration });
    _traceEmitterSerial?.({ type: "agent_end", name: "opportunity-evaluator", durationMs: _evalDuration, summary: `error — ${_errMsg}` });
    throw serialErr; // Re-throw for the outer catch to handle
  }
}

/**
 * Split multi-actor evaluator results into pairwise (viewer + candidate).
 * Each persisted discovery opportunity should have exactly 2 actors.
 * When splitting, build per-candidate reasoning from entity data because
 * the shared reasoning typically describes only one candidate.
 */
function splitBundledVerdicts(
  opportunitiesWithActors: EvaluatedOpportunityWithActors[],
  state: OpportunityState,
  candidateEntities: EvaluatorEntity[],
): PairwiseOpportunity[] {
  const pairwiseOpportunities: PairwiseOpportunity[] = [];
  for (const op of opportunitiesWithActors) {
    const pairwiseSourceId = state.onBehalfOfUserId ?? state.userId;
    const nonViewerActors = op.actors.filter(a => a.userId !== pairwiseSourceId);
    if (nonViewerActors.length <= 1) {
      pairwiseOpportunities.push(op);
      continue;
    }
    evaluationLog.warn('Splitting multi-actor opportunity; LLM returned bundled actors instead of one-per-candidate', {
      actorCount: nonViewerActors.length,
      userIds: nonViewerActors.map(a => a.userId),
    });
    const viewerActor = op.actors.find(a => a.userId === pairwiseSourceId);
    for (const candidate of nonViewerActors) {
      const entity = candidateEntities.find(e => e.userId === candidate.userId);
      const candidateName = entity?.profile?.name ?? '';
      const reasoningLower = op.reasoning.toLowerCase();
      const mentionsCandidate =
        candidateName !== '' &&
        reasoningLower.includes(candidateName.toLowerCase());
      const mentionsOtherCandidate = nonViewerActors
        .filter((actor) => actor.userId !== candidate.userId)
        .map((actor) =>
          candidateEntities.find((e) => e.userId === actor.userId)?.profile?.name?.toLowerCase()
        )
        .some((name) => name != null && reasoningLower.includes(name));
      let reasoning: string;
      if (mentionsCandidate && !mentionsOtherCandidate) {
        reasoning = op.reasoning;
      } else if (entity?.profile) {
        const p = entity.profile;
        const parts = [p.name, p.bio].filter(Boolean);
        if (p.skills?.length) parts.push(`Skills: ${p.skills.join(', ')}`);
        if (p.interests?.length) parts.push(`Interests: ${p.interests.join(', ')}`);
        reasoning = parts.join('. ') || op.reasoning;
      } else {
        reasoning = op.reasoning;
      }
      pairwiseOpportunities.push({
        reasoning,
        score: op.score,
        actors: [
          viewerActor ?? { userId: pairwiseSourceId, role: 'patient' as const, intentId: null },
          candidate,
        ],
      });
    }
  }
  return pairwiseOpportunities;
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
