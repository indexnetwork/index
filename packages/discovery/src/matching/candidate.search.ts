import { DEFAULT_MODEL } from '../core/model.js';
import { getAbortSignalConfig } from '../core/runtime.js';
import type { CandidateSearch, HydeCandidate, LensEmbedding } from '../core/types.js';
import { buildDiscovererContext } from '../prompts/discovery.prompt.js';
import type { CandidateMatch, DiscoveryDeps, DiscoveryState } from './discovery.state.js';
import { discoveryLog } from './discovery.trace.js';
import { mergeMatchEvidence, withCandidateEvidence, withMatchedStrategies } from './match.evidence.js';

/**
 * Retrieval score calibration.
 *
 * A candidate's `similarity` must stay an honest, cosine-derived value. Retrieval
 * awards a bonus when more than one signal (HyDE lens, or discovery strategy)
 * surfaced the same candidate, and that bonus used to be *added* to the raw score
 * and then clamped: `Math.min(raw + bonus, 1)`. Any candidate with enough
 * overlapping signals landed on exactly 1.0, so dozens of unrelated candidates tied
 * at the top of the ranking and monopolised the by-rank evaluation batch.
 *
 * The bonus is applied to the headroom above the raw score instead. That keeps it
 * strictly monotone in the raw score and strictly below 1.0 unless the vector itself
 * scored 1.0 — a flat ceiling of identical maxima across different documents is
 * impossible by construction.
 */

/** Default bonus per additional distinct signal that surfaced the same candidate. */
export const MULTI_SIGNAL_BONUS_PER_SIGNAL = 0.1;

/** Default ceiling on the total multi-signal bonus fraction. */
export const MULTI_SIGNAL_BONUS_MAX = 0.3;

/**
 * Clamp a raw vector score into [0, 1].
 * pgvector's `1 - (a <=> b)` can return values a float epsilon outside the range,
 * and a non-finite score (bad parse, missing column) must not poison the ranking.
 */
export function normalizeSimilarity(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw <= 0) return 0;
  return raw >= 1 ? 1 : raw;
}

/**
 * Combine a raw similarity with a bounded bonus for multi-signal agreement.
 *
 * `distinctSignals` is the number of *distinct* signals (lenses, strategies) that
 * surfaced this candidate — not the number of matched rows. The same lens hitting
 * three of a user's intents is one signal, not three.
 */
export function withMultiSignalBonus(
  raw: number,
  distinctSignals: number,
  options: { perSignal?: number; maxBonus?: number } = {},
): number {
  const base = normalizeSimilarity(raw);
  const extraSignals = Math.max(0, Math.floor(distinctSignals) - 1);
  if (extraSignals === 0 || base >= 1) return base;
  const perSignal = options.perSignal ?? MULTI_SIGNAL_BONUS_PER_SIGNAL;
  const maxBonus = options.maxBonus ?? MULTI_SIGNAL_BONUS_MAX;
  const bonus = Math.min(extraSignals * perSignal, maxBonus);
  return base + (1 - base) * bonus;
}

/** Retrieve against real intent vectors; profile-voice lenses retain their half budget. */
export async function searchWithHydeEmbeddings(
  search: CandidateSearch,
  lenses: LensEmbedding[],
  options: { networkScope: string[]; excludeUserId?: string; limitPerStrategy: number; limit: number; minScore: number },
): Promise<HydeCandidate[]> {
  const results = await Promise.all(lenses.filter(lens => lens.embedding.length).map(async lens => {
    const candidates = await search.searchIntentCandidates(lens.embedding, {
      networkScope: options.networkScope, excludeUserId: options.excludeUserId,
      limit: lens.corpus === 'intents' ? options.limitPerStrategy : Math.ceil(options.limitPerStrategy / 2),
      minScore: options.minScore, ...getAbortSignalConfig(),
    });
    return candidates.map(candidate => ({ ...candidate, matchedVia: lens.lens }));
  }));
  return mergeAndRankHydeCandidates(results.flat(), options.limit);
}

export function mergeAndRankHydeCandidates(
  candidates: HydeCandidate[],
  limit: number,
): HydeCandidate[] {
  const byUser = new Map<string, HydeCandidate[]>();
  for (const c of candidates) {
    const existing = byUser.get(c.userId) ?? [];
    existing.push(c);
    byUser.set(c.userId, existing);
  }

  const scored = Array.from(byUser.entries()).map(([, matches]) => {
    const bestMatch = matches.reduce((a, b) => (a.score > b.score ? a : b));
    const lenses = [...new Set(matches.map((m) => m.matchedVia))];
    return {
      ...bestMatch,
      score: withMultiSignalBonus(bestMatch.score, lenses.length),
      matchedLenses: lenses.length > 1 ? lenses : undefined,
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * The individual retrieval strategies the discovery node runs, plus the merge
 * that folds their results into one candidate set.
 *
 * These were nested functions inside the discovery closure, capturing the node's
 * locals. They now take an explicit {@link DiscoveryStrategyContext} so each
 * strategy reads on its own.
 */


/** Everything the strategies below need, resolved once by the discovery node. */
export interface DiscoveryStrategyContext {
  state: DiscoveryState;
  deps: DiscoveryDeps;
  discoveryUserId: string;
  limitPerStrategy: number;
  perNetworkLimit: number;
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
  const { state, deps, discoveryUserId, limitPerStrategy, perNetworkLimit } = ctx;
  const searchText = state.searchQuery?.trim() ?? '';
  const lensInput = {
    profileContext: buildDiscovererContext(state.sourceProfile, state.indexedIntents),
    model: DEFAULT_MODEL,
  };
  if (!searchText) return null;
  discoveryLog.verbose('runQueryHydeDiscovery start', { searchText: searchText.slice(0, 80) });
  const hydeResult = await deps.prepareArtifacts({
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
    state.targetNetworks.map(async (targetNetwork) => {
      const results = await searchWithHydeEmbeddings(deps.search, lensEmbeddings, {
        networkScope: [targetNetwork.networkId],
        excludeUserId: discoveryUserId,
        limitPerStrategy,
        limit: perNetworkLimit,
        minScore: deps.retrievalMinSimilarity,
      });
      all.push(...collectHydeResults(results, targetNetwork.networkId));
    })
  );
  discoveryLog.verbose('searchWithHydeEmbeddings raw results', { total: all.length });
  const byKey = new Map<string, CandidateMatch>();
  for (const c of all) {
    // Dedup by candidateUserId + intent, NOT by networkId. Including networkId
    // caused the same user to appear once per network they belong to.
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
  results: HydeCandidate[],
  networkId: string,
): CandidateMatch[] {
  const collected: CandidateMatch[] = [];
  for (const r of results.filter((x) => x.type === 'intent')) {
    collected.push(withCandidateEvidence({
      candidateUserId: r.userId as string,
      candidateIntentId: r.id as string,
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
        const mergedEvidence = mergeMatchEvidence(existing.evidence, c.evidence);
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
      evidence: withMatchedStrategies(mergeMatchEvidence(c.evidence), matchedStrategies),
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
