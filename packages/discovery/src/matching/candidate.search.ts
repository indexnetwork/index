import { getAbortSignalConfig } from '../core/runtime.js';
import type { CandidateSearch, EmbeddingGenerator, IntentCandidate } from '../core/types.js';
import type { CandidateMatch, DiscoveryDeps, DiscoveryState } from './discovery.state.js';
import { discoveryLog } from './discovery.trace.js';
import { mergeMatchEvidence, withCandidateEvidence, withMatchedStrategies } from './match.evidence.js';

/**
 * Retrieval score calibration.
 *
 * A candidate's `similarity` must stay an honest, cosine-derived value. Retrieval
 * awards a bonus when more than one discovery strategy surfaced the same
 * candidate. The bonus is applied to the headroom above the raw score instead of
 * being added and clamped, so it stays strictly monotone in the raw score and
 * strictly below 1.0 unless the vector itself scored 1.0.
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
 * `distinctSignals` is the number of *distinct* signals (strategies) that
 * surfaced this candidate — not the number of matched rows.
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

/** Everything the retrieval helpers need, resolved once by the discovery node. */
export interface DiscoveryStrategyContext {
  state: DiscoveryState;
  deps: DiscoveryDeps;
  discoveryUserId: string;
  limitPerStrategy: number;
  perNetworkLimit: number;
}

/** Embed query text. Empty or failed embeddings return null. */
export async function embedQuery(
  embedder: EmbeddingGenerator,
  searchText: string,
): Promise<number[] | null> {
  const generated = await embedder.generate(searchText, undefined, getAbortSignalConfig());
  const embedding = Array.isArray(generated[0]) ? generated[0] : generated as number[];
  return embedding?.length ? embedding : null;
}

/** Search real intent vectors with one query embedding. */
export async function searchWithQueryEmbedding(
  search: CandidateSearch,
  embedding: number[],
  options: { networkScope: string[]; excludeUserId?: string; limit: number; minScore: number },
): Promise<IntentCandidate[]> {
  return search.searchIntentCandidates(embedding, {
    networkScope: options.networkScope,
    excludeUserId: options.excludeUserId,
    limit: options.limit,
    minScore: options.minScore,
    ...getAbortSignalConfig(),
  });
}

/**
 * Turn embedder hits into candidates.
 *
 * The type filter is defense-in-depth: the embedder only searches intents, but
 * an adapter could still return another type.
 */
export function collectQueryResults(
  results: IntentCandidate[],
  networkId: string,
): CandidateMatch[] {
  const collected: CandidateMatch[] = [];
  for (const r of results.filter((x) => x.type === 'intent')) {
    collected.push(withCandidateEvidence({
      candidateUserId: r.userId as string,
      candidateIntentId: r.id as string,
      networkId,
      similarity: r.score,
      lens: 'query',
      candidatePayload: '',
      candidateSummary: undefined,
      discoverySource: 'query' as const,
    }));
  }
  return collected;
}

/** Embed the query and search every target network at `minScore`. */
export async function searchQueryAcrossNetworks(
  ctx: DiscoveryStrategyContext,
  searchText: string,
  minScore: number,
): Promise<CandidateMatch[]> {
  const embedding = await embedQuery(ctx.deps.embedder, searchText);
  if (!embedding) return [];
  const found: CandidateMatch[] = [];
  await Promise.all(
    ctx.state.targetNetworks.map(async (targetNetwork) => {
      const results = await searchWithQueryEmbedding(ctx.deps.search, embedding, {
        networkScope: [targetNetwork.networkId],
        excludeUserId: ctx.discoveryUserId,
        limit: ctx.perNetworkLimit,
        minScore,
      });
      found.push(...collectQueryResults(results, targetNetwork.networkId));
    })
  );
  discoveryLog.verbose('searchWithQueryEmbedding raw results', { total: found.length, minScore });
  return found;
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
