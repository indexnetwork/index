/**
 * The individual retrieval strategies the discovery node runs, plus the merge
 * that folds their results into one candidate set.
 *
 * These were nested functions inside the discovery closure, capturing the node's
 * locals. They now take an explicit {@link DiscoveryStrategyContext} so each
 * strategy reads on its own.
 */

import type { Id } from '../../shared/interfaces/database.interface.js';
import type { CandidateMatch } from '../domain/opportunity.state.js';
import type { LensEmbedding } from '../../shared/interfaces/embedder.interface.js';
import { getModelName } from '../../shared/agent/model.config.js';
import { selectHydeDocumentsForGeneration, getHydeGenerationMode } from '../../discovery/index.js';
import { mergeOpportunityEvidence, withCandidateEvidence, withMatchedStrategies } from '../domain/opportunity.evidence.js';
import { discoveryProfileMatchingEnabled, discoveryProfileSource, discoveryIntentMatchingEnabled } from '../discovery.env.js';
import { buildDiscovererContext, discoveryLog, getSourcePremiseDiscoveryLimit, PREMISE_MATCH_LIMIT_PER_SOURCE, type OpportunityGraphDeps, type OpportunityState } from './opportunity.graph.shared.js';

/** Corpus gating passed through to the embedder on every HyDE search. */
export interface DiscoveryCorpusGating {
  readonly intents: boolean;
  readonly profile: boolean;
  readonly profileCorpus: ReturnType<typeof discoveryProfileSource>;
}

/** Everything the strategies below need, resolved once by the discovery node. */
export interface DiscoveryStrategyContext {
  state: OpportunityState;
  deps: OpportunityGraphDeps;
  discoveryUserId: string;
  limitPerStrategy: number;
  perIndexLimit: number;
  corpusGating: DiscoveryCorpusGating;
  intentResultsEnabled: boolean;
  premiseResultsEnabled: boolean;
  contextResultsEnabled: boolean;
}

/** Trace payload the query-HyDE path produces alongside its candidates. */
export interface QueryHydeDiscoveryResult {
  candidates: CandidateMatch[];
  lensInput: { profileContext: string | undefined; model: string };
  hydeOutput: { lenses: Array<{ label: string; corpus: string }>; hydeDocuments: Record<string, { hydeText?: string }> };
}

/**
 * Query-driven HyDE retrieval: generate hypothetical documents from the search
 * text, then search every target network with the resulting lens embeddings.
 */
export async function runQueryHydeDiscovery(ctx: DiscoveryStrategyContext): Promise<QueryHydeDiscoveryResult | null> {
  const { state, deps, discoveryUserId, limitPerStrategy, perIndexLimit, corpusGating } = ctx;
  const searchText = state.searchQuery?.trim() ?? '';
  const lensInput = {
    profileContext: buildDiscovererContext(state.sourceProfile, state.indexedIntents),
    model: getModelName("lensInferrer"),
  };
  if (!searchText) return null;
  discoveryLog.verbose('runQueryHydeDiscovery start', { searchText: searchText.slice(0, 80) });
  const hydeResult = await deps.hydeGenerator.invoke({
    sourceType: 'query',
    sourceText: searchText,
    forceRegenerate: false,
    profileContext: lensInput.profileContext,
  });
  const hydeEmbeddings = hydeResult.hydeEmbeddings as Record<string, number[]>;
  const lenses = hydeResult.lenses ?? [];
  const hydeOutput = {
    lenses: lenses as Array<{ label: string; corpus: string }>,
    hydeDocuments: (hydeResult.hydeDocuments ?? {}) as Record<string, { hydeText?: string }>,
  };
  const embeddingKeys = hydeEmbeddings ? Object.keys(hydeEmbeddings) : [];
  discoveryLog.verbose('HyDE generator result', {
    lensCount: embeddingKeys.length,
    lenses: embeddingKeys,
  });
  if (!hydeEmbeddings || Object.keys(hydeEmbeddings).length === 0) {
    return { candidates: [], lensInput, hydeOutput };
  }
  const lensEmbeddings = toLensEmbeddings(hydeEmbeddings, lenses);
  const all: CandidateMatch[] = [];
  await Promise.all(
    state.targetNetworks.map(async (targetIndex) => {
      const results = await deps.embedder.searchWithHydeEmbeddings(lensEmbeddings, {
        indexScope: [targetIndex.networkId],
        excludeUserId: discoveryUserId,
        limitPerStrategy,
        limit: perIndexLimit,
        minScore: deps.retrievalMinSimilarity,
        corpusGating,
      });
      all.push(...collectHydeResults(results, targetIndex.networkId, ctx));
    })
  );
  const intentCount = all.filter((c) => c.candidateIntentId).length;
  const premiseCount = all.filter((c) => c.candidatePremiseId).length;
  discoveryLog.verbose('searchWithHydeEmbeddings raw results', {
    total: all.length,
    fromIntent: intentCount,
    fromPremise: premiseCount,
    fromContext: all.filter((c) => c.candidateContextId).length,
  });
  const byKey = new Map<string, CandidateMatch>();
  for (const c of all) {
    // Dedup by candidateUserId + entity (intent or premise), NOT by indexId.
    // Including indexId caused the same user to appear once per index they belong to.
    const key = `${c.candidateUserId}:${entityKey(c)}`;
    if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
      byKey.set(key, c);
    }
  }
  return { candidates: Array.from(byKey.values()), lensInput, hydeOutput };
}

/** `intent:`/`premise:`/`context:` discriminator used by the dedup keys. */
function entityKey(c: CandidateMatch): string {
  return c.candidateIntentId
    ? `intent:${c.candidateIntentId}`
    : c.candidatePremiseId
      ? `premise:${c.candidatePremiseId}`
      : `context:${c.candidateContextId}`;
}

/** Map HyDE embeddings back onto their lens metadata. */
export function toLensEmbeddings(
  hydeEmbeddings: Record<string, number[]>,
  lenses: Array<{ label: string; corpus: 'profiles' | 'intents' | 'premises' }>,
): LensEmbedding[] {
  const lensMap = new Map(lenses.map(l => [l.label, l]));
  const lensEmbeddings: LensEmbedding[] = [];
  for (const [label, emb] of Object.entries(hydeEmbeddings)) {
    if (emb?.length) {
      const lens = lensMap.get(label);
      lensEmbeddings.push({ lens: label, corpus: lens?.corpus ?? 'profiles', embedding: emb });
    }
  }
  return lensEmbeddings;
}

/**
 * Turn embedder hits into candidates, honouring the match-type gates.
 *
 * Result filtering here is defense-in-depth: corpusGating already scopes the
 * embedder's corpus searches, but adapters may still return other types.
 */
export function collectHydeResults(
  results: Awaited<ReturnType<OpportunityGraphDeps['embedder']['searchWithHydeEmbeddings']>>,
  networkId: Id<'networks'>,
  ctx: Pick<DiscoveryStrategyContext, 'intentResultsEnabled' | 'premiseResultsEnabled' | 'contextResultsEnabled'>,
): CandidateMatch[] {
  const collected: CandidateMatch[] = [];
  if (ctx.intentResultsEnabled) for (const r of results.filter((x) => x.type === 'intent')) {
    collected.push(withCandidateEvidence({
      candidateUserId: r.userId as Id<'users'>,
      candidateIntentId: r.id as Id<'intents'>,
      networkId,
      similarity: r.score,
      lens: r.matchedVia,
      candidatePayload: '',
      candidateSummary: undefined,
      discoverySource: 'query' as const,
    }));
  }
  if (ctx.premiseResultsEnabled) for (const r of results.filter((x) => x.type === 'premise')) {
    collected.push(withCandidateEvidence({
      candidateUserId: r.userId as Id<'users'>,
      candidatePremiseId: r.id as Id<'premises'>,
      networkId,
      similarity: r.score,
      lens: r.matchedVia,
      candidatePayload: '',
      candidateSummary: undefined,
      discoverySource: 'query' as const,
    }));
  }
  if (ctx.contextResultsEnabled) for (const r of results.filter((x) => x.type === 'user_context')) {
    collected.push(withCandidateEvidence({
      candidateUserId: r.userId as Id<'users'>,
      candidateContextId: r.id,
      networkId,
      similarity: r.score,
      lens: r.matchedVia,
      candidatePayload: r.text ?? '',
      candidateSummary: undefined,
      discoverySource: 'query' as const,
    }));
  }
  return collected;
}

/**
 * Premise-to-premise discovery (path D).
 * Searches for other users' premises similar to the discoverer's premises,
 * scoped to target networks. Additive — merges into existing candidates.
 */
export async function runPremiseDiscovery(ctx: DiscoveryStrategyContext): Promise<CandidateMatch[]> {
  const { state, deps, discoveryUserId } = ctx;
  const targetNetworkIds = state.targetNetworks.map(t => t.networkId);
  if (targetNetworkIds.length === 0) return [];

  if (!discoveryProfileMatchingEnabled() || discoveryProfileSource() === 'user_context') {
    discoveryLog.verbose('runPremiseDiscovery disabled by DISCOVERY_ALLOWED_TYPES/DISCOVERY_PROFILE_SOURCE');
    return [];
  }

  const sourceLimit = getSourcePremiseDiscoveryLimit();
  if (sourceLimit === 0) {
    discoveryLog.verbose('runPremiseDiscovery disabled by DISCOVERY_SOURCE_PREMISE_LIMIT=0');
    return [];
  }

  const sourcePremisesFromDb = deps.database.getPremisesForUserInNetworks
    ? await deps.database.getPremisesForUserInNetworks(discoveryUserId, targetNetworkIds, 'ACTIVE', sourceLimit)
    : await deps.database.getPremisesForUser(discoveryUserId, 'ACTIVE');
  const sourcePremises = (sourcePremisesFromDb.length > 0
    ? sourcePremisesFromDb
        .filter(p => Array.isArray(p.embedding) && p.embedding.length > 0)
        .slice(0, sourceLimit)
        .map(p => ({ premiseId: p.id as Id<'premises'>, embedding: p.embedding! }))
    : (state.sourcePremises ?? []).slice(0, sourceLimit)
  );

  if (sourcePremises.length === 0) return [];

  discoveryLog.verbose('runPremiseDiscovery start', {
    premiseCount: sourcePremises.length,
    sourceLimit,
    targetNetworks: targetNetworkIds.length,
    batched: !!deps.database.searchPremisesBySimilarityBatch,
  });

  const rawResults = deps.database.searchPremisesBySimilarityBatch
    ? await deps.database.searchPremisesBySimilarityBatch({
        sources: sourcePremises,
        networkIds: targetNetworkIds,
        excludeUserId: discoveryUserId,
        limitPerSource: PREMISE_MATCH_LIMIT_PER_SOURCE,
        minScore: deps.retrievalMinSimilarity,
      })
    : (await Promise.all(
        sourcePremises.map(async (sp) => {
          const results = await deps.database.searchPremisesBySimilarity({
            embedding: sp.embedding,
            networkIds: targetNetworkIds,
            excludeUserId: discoveryUserId,
            limit: PREMISE_MATCH_LIMIT_PER_SOURCE,
            minScore: deps.retrievalMinSimilarity,
          });
          return results.map((r) => ({ ...r, sourcePremiseId: sp.premiseId }));
        })
      )).flat();

  const premiseCandidates: CandidateMatch[] = [];
  for (const r of rawResults) {
    premiseCandidates.push(withCandidateEvidence({
      candidateUserId: r.userId as Id<'users'>,
      sourcePremiseId: r.sourcePremiseId as Id<'premises'> | undefined,
      candidatePremiseId: r.premiseId as Id<'premises'>,
      networkId: r.networkId as Id<'networks'>,
      similarity: typeof r.similarity === 'number' ? r.similarity : parseFloat(String(r.similarity)),
      lens: 'premise_match',
      candidatePayload: r.assertionText ?? '',
      discoverySource: 'premise-similarity',
    }));
  }

  // Dedup by userId + premiseId + networkId (a premise can appear in multiple networks)
  const deduped = dedupeBestBy(premiseCandidates, (c) => `${c.candidateUserId}:${c.candidatePremiseId ?? 'none'}:${c.networkId}`);
  discoveryLog.verbose('runPremiseDiscovery complete', {
    sourcePremiseCount: sourcePremises.length,
    rawCount: premiseCandidates.length,
    dedupedCount: deduped.length,
  });
  return deduped;
}

/**
 * Context-to-intent discovery: searches intents using context HyDE embeddings.
 * When HyDE documents exist for a context, uses optimised hypothetical-document
 * embeddings via searchWithHydeEmbeddings. Falls back to raw context embedding
 * via searchIntentsByContextEmbedding when no HyDE docs are available.
 */
export async function runContextToIntentDiscovery(ctx: DiscoveryStrategyContext): Promise<CandidateMatch[]> {
  const { state, deps, discoveryUserId, limitPerStrategy, corpusGating } = ctx;
  if (!state.sourceContexts?.length) return [];
  const contextToIntentEnabled = process.env.DISCOVERY_CONTEXT_TO_INTENT !== '0';
  if (!contextToIntentEnabled) return [];
  if (!discoveryProfileMatchingEnabled() || discoveryProfileSource() !== 'user_context' || !discoveryIntentMatchingEnabled()) return [];

  const targetNetworkIds = state.targetNetworks.map(t => t.networkId);
  if (targetNetworkIds.length === 0) return [];

  discoveryLog.verbose('runContextToIntentDiscovery start', {
    contextCount: state.sourceContexts.length,
    targetNetworks: targetNetworkIds.length,
  });

  const contextCandidates: CandidateMatch[] = [];

  for (const context of state.sourceContexts.filter(c => targetNetworkIds.includes(c.networkId))) {
    // Attempt HyDE-enhanced search first
    const persistedHydeDocs = await deps.database.getHydeDocumentsForSource('context', context.contextId);
    const hydeDocs = selectHydeDocumentsForGeneration(
      persistedHydeDocs,
      getHydeGenerationMode(),
      context.text,
    );
    const lensEmbeddings: LensEmbedding[] = hydeDocs
      .filter(d => d.hydeEmbedding?.length > 0)
      .map(d => ({
        lens: d.strategy,
        corpus: (d.targetCorpus === 'intents' ? 'intents' : d.targetCorpus === 'premises' ? 'premises' : 'intents') as 'intents' | 'premises' | 'profiles',
        embedding: d.hydeEmbedding,
      }));

    if (lensEmbeddings.length > 0) {
      // HyDE-enhanced search: same path as query HyDE, scoped to this context's network
      const results = await deps.embedder.searchWithHydeEmbeddings(lensEmbeddings, {
        indexScope: [context.networkId],
        excludeUserId: discoveryUserId,
        limitPerStrategy: limitPerStrategy,
        limit: 20,
        minScore: deps.retrievalMinSimilarity,
        corpusGating,
      });
      for (const r of results.filter(r => r.type === 'intent')) {
        contextCandidates.push(withCandidateEvidence({
          candidateUserId: r.userId as Id<'users'>,
          candidateIntentId: r.id as Id<'intents'>,
          sourceContextId: context.contextId,
          networkId: context.networkId,
          similarity: r.score,
          lens: r.matchedVia,
          candidatePayload: '',
          candidateSummary: undefined,
          discoverySource: 'context-to-intent',
        }));
      }
    } else {
      // Fallback: raw context embedding search (no HyDE docs yet)
      const results = await deps.database.searchIntentsByContextEmbedding({
        embedding: context.embedding,
        networkIds: [context.networkId],
        excludeUserId: discoveryUserId,
        limit: 20,
        minScore: deps.retrievalMinSimilarity,
      });
      for (const r of results) {
        contextCandidates.push(withCandidateEvidence({
          candidateUserId: r.userId as Id<'users'>,
          candidateIntentId: r.intentId as Id<'intents'>,
          sourceContextId: context.contextId,
          networkId: r.networkId as Id<'networks'>,
          similarity: typeof r.similarity === 'number' ? r.similarity : parseFloat(String(r.similarity)),
          lens: 'context_match',
          candidatePayload: r.payload ?? '',
          candidateSummary: r.summary ?? undefined,
          discoverySource: 'context-to-intent',
        }));
      }
    }
  }

  const deduped = dedupeBestBy(contextCandidates, (c) => `${c.candidateUserId}:${c.candidateIntentId ?? 'none'}:${c.networkId}`);
  discoveryLog.verbose('runContextToIntentDiscovery complete', {
    rawCount: contextCandidates.length,
    dedupedCount: deduped.length,
  });
  return deduped;
}

/**
 * Context-to-context discovery (lightweight profile mode only).
 * Raw network-scoped context embeddings → candidate user_contexts.
 * No HyDE: both sides are the same document type (synthesized
 * 3–6 sentence paragraphs), so direct paragraph similarity is correct
 * (same rationale as raw premise-to-premise).
 */
export async function runContextToContextDiscovery(ctx: DiscoveryStrategyContext): Promise<CandidateMatch[]> {
  const { state, deps, discoveryUserId, contextResultsEnabled } = ctx;
  if (!contextResultsEnabled) return [];
  if (!state.sourceContexts?.length) return [];
  if (typeof deps.database.searchUserContextsBySimilarity !== 'function') return [];

  const targetNetworkIds = state.targetNetworks.map(t => t.networkId);
  if (targetNetworkIds.length === 0) return [];

  const contextCandidates: CandidateMatch[] = [];
  for (const context of state.sourceContexts.filter(c => targetNetworkIds.includes(c.networkId))) {
    const results = await deps.database.searchUserContextsBySimilarity({
      embedding: context.embedding,
      networkIds: [context.networkId],
      excludeUserId: discoveryUserId,
      limit: 20,
      minScore: deps.retrievalMinSimilarity,
    });
    for (const r of results) {
      contextCandidates.push(withCandidateEvidence({
        candidateUserId: r.userId as Id<'users'>,
        candidateContextId: r.contextId,
        sourceContextId: context.contextId,
        networkId: r.networkId as Id<'networks'>,
        similarity: typeof r.similarity === 'number' ? r.similarity : parseFloat(String(r.similarity)),
        lens: 'context_match',
        candidatePayload: r.text ?? '',
        discoverySource: 'context-similarity' as const,
      }));
    }
  }

  // Dedup by userId + contextId + networkId (mirror premise dedup)
  const deduped = dedupeBestBy(contextCandidates, (c) => `${c.candidateUserId}:${c.candidateContextId ?? 'none'}:${c.networkId}`);
  discoveryLog.verbose('runContextToContextDiscovery complete', {
    rawCount: contextCandidates.length,
    dedupedCount: deduped.length,
  });
  return deduped;
}

/** Keep the highest-similarity candidate per composite key. */
function dedupeBestBy(candidates: CandidateMatch[], keyOf: (c: CandidateMatch) => string): CandidateMatch[] {
  const byKey = new Map<string, CandidateMatch>();
  for (const c of candidates) {
    const key = keyOf(c);
    if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
      byKey.set(key, c);
    }
  }
  return Array.from(byKey.values());
}

/**
 * Run the three additive strategies concurrently, in the order the discovery
 * node reports them: premise-to-premise, context-to-intent, context-to-context.
 */
export function runAuxiliaryStrategies(
  ctx: DiscoveryStrategyContext,
): Promise<[CandidateMatch[], CandidateMatch[], CandidateMatch[]]> {
  return Promise.all([
    runPremiseDiscovery(ctx),
    runContextToIntentDiscovery(ctx),
    runContextToContextDiscovery(ctx),
  ]);
}

/**
 * Merge candidates from multiple strategies. Deduplicates by userId + networkId + entityId,
 * keeps the highest similarity, tracks which strategies found each candidate,
 * and applies a multi-strategy boost (+0.05 per additional strategy, boost capped at 0.15,
 * final similarity capped at 1.0).
 */
export function mergeStrategyCandidates(...groups: CandidateMatch[][]): CandidateMatch[] {
  const merged = new Map<string, CandidateMatch & { _strategies: Set<string> }>();
  for (const group of groups) {
    for (const c of group) {
      const entityId = c.candidateIntentId ?? c.candidatePremiseId ?? c.candidateContextId ?? 'none';
      const key = `${c.candidateUserId}:${c.networkId}:${entityId}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...c, _strategies: new Set([c.discoverySource ?? 'unknown']) });
      } else {
        existing._strategies.add(c.discoverySource ?? 'unknown');
        const mergedEvidence = mergeOpportunityEvidence(existing.evidence, c.evidence);
        if (c.similarity > existing.similarity) {
          Object.assign(existing, { ...c, evidence: mergedEvidence });
        } else {
          existing.evidence = mergedEvidence;
        }
      }
    }
  }
  return Array.from(merged.values()).map(({ _strategies, ...c }) => {
    const matchedStrategies = Array.from(_strategies);
    const boost = Math.min((_strategies.size - 1) * 0.05, 0.15);
    return {
      ...c,
      similarity: Math.min(c.similarity + boost, 1.0),
      matchedStrategies,
      evidence: withMatchedStrategies(mergeOpportunityEvidence(c.evidence), matchedStrategies),
    };
  });
}

/** Per-lens candidate counts and mean similarity, for the discovery trace. */
export function computeLensStats(candidates: CandidateMatch[]): Record<string, { count: number; avgSimilarity: number }> {
  const lensStats: Record<string, { count: number; avgSimilarity: number }> = {};
  for (const c of candidates) {
    const s = c.lens || 'unknown';
    if (!lensStats[s]) lensStats[s] = { count: 0, avgSimilarity: 0 };
    lensStats[s].count++;
    lensStats[s].avgSimilarity += c.similarity;
  }
  for (const s of Object.values(lensStats)) {
    s.avgSimilarity = s.count > 0 ? Math.round((s.avgSimilarity / s.count) * 1000) / 1000 : 0;
  }
  return lensStats;
}

/** One `strategy` trace line per auxiliary strategy that produced candidates. */
export function auxiliaryStrategyTraces(
  premiseCands: CandidateMatch[],
  contextCands: CandidateMatch[],
  contextSimCands: CandidateMatch[],
): Array<{ node: string; detail?: string; data?: Record<string, unknown> }> {
  const entries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> = [];
  if (premiseCands.length > 0) {
    entries.push({ node: "strategy", detail: `premise-to-premise → ${premiseCands.length} candidate(s)` });
  }
  if (contextCands.length > 0) {
    entries.push({ node: "strategy", detail: `context-to-intent → ${contextCands.length} candidate(s)` });
  }
  if (contextSimCands.length > 0) {
    entries.push({ node: "strategy", detail: `context-to-context → ${contextSimCands.length} candidate(s)` });
  }
  return entries;
}
