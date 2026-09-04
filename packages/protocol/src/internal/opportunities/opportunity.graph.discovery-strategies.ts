/**
 * The individual retrieval strategies the discovery node runs, plus the merge
 * that folds their results into one candidate set.
 *
 * These were nested functions inside the discovery closure, capturing the node's
 * locals. They now take an explicit {@link DiscoveryStrategyContext} so each
 * strategy reads on its own.
 */

import type { Id } from '../../platform/database.js';
import type { CandidateMatch } from './opportunity.state.js';
import type { LensEmbedding } from '../../platform/discovery/embedder.js';
import { getModelName } from '../shared/agent/model.config.js';
import { mergeOpportunityEvidence, withCandidateEvidence, withMatchedStrategies } from './opportunity.evidence.js';
import { withMultiSignalBonus } from './opportunity.similarity.js';
import { buildDiscovererContext, discoveryLog, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

/** Everything the strategies below need, resolved once by the discovery node. */
export interface DiscoveryStrategyContext {
  state: OpportunityState;
  deps: OpportunityGraphDeps;
  discoveryUserId: string;
  limitPerStrategy: number;
  perIndexLimit: number;
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
  const { state, deps, discoveryUserId, limitPerStrategy, perIndexLimit } = ctx;
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
      });
      all.push(...collectHydeResults(results, targetIndex.networkId));
    })
  );
  discoveryLog.verbose('searchWithHydeEmbeddings raw results', { total: all.length });
  const byKey = new Map<string, CandidateMatch>();
  for (const c of all) {
    // Dedup by candidateUserId + intent, NOT by indexId. Including indexId
    // caused the same user to appear once per index they belong to.
    const key = `${c.candidateUserId}:intent:${c.candidateIntentId}`;
    if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
      byKey.set(key, c);
    }
  }
  return { candidates: Array.from(byKey.values()), lensInput, hydeOutput };
}

/** Map HyDE embeddings back onto their lens metadata. */
export function toLensEmbeddings(
  hydeEmbeddings: Record<string, number[]>,
  lenses: Array<{ label: string; corpus: 'profiles' | 'intents' }>,
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
 * Turn embedder hits into candidates.
 *
 * The type filter is defense-in-depth: the embedder only searches intents, but
 * an adapter could still return another type.
 */
export function collectHydeResults(
  results: Awaited<ReturnType<OpportunityGraphDeps['embedder']['searchWithHydeEmbeddings']>>,
  networkId: Id<'networks'>,
): CandidateMatch[] {
  const collected: CandidateMatch[] = [];
  for (const r of results.filter((x) => x.type === 'intent')) {
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
  return collected;
}

/** Bonus fraction per additional strategy that surfaced the same candidate. */
const MULTI_STRATEGY_BONUS_PER_STRATEGY = 0.05;
/** Ceiling on the total multi-strategy bonus fraction. */
const MULTI_STRATEGY_BONUS_MAX = 0.15;

/**
 * Merge candidates from multiple strategies. Deduplicates by userId + networkId + entityId,
 * keeps the highest similarity, tracks which strategies found each candidate,
 * and applies a multi-strategy boost (+5% of the headroom above the raw score per
 * additional strategy, capped at 15%). The boost consumes headroom rather than being
 * added and clamped, so it can never manufacture a tie at 1.0.
 */
export function mergeStrategyCandidates(...groups: CandidateMatch[][]): CandidateMatch[] {
  const merged = new Map<string, CandidateMatch & { _strategies: Set<string> }>();
  for (const group of groups) {
    for (const c of group) {
      const entityId = c.candidateIntentId ?? c.candidateContextId ?? 'none';
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
    return {
      ...c,
      similarity: withMultiSignalBonus(c.similarity, _strategies.size, {
        perSignal: MULTI_STRATEGY_BONUS_PER_STRATEGY,
        maxBonus: MULTI_STRATEGY_BONUS_MAX,
      }),
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
