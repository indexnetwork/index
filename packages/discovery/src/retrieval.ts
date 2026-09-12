import { mergeMatchEvidence, withCandidateEvidence, withMatchedStrategies } from './explanation.js';
import { DISCOVERY_MIN_MATCHES, buildDiscovererContext, discoveryLog, type CandidateMatch, type DiscoveryDeps, type DiscoveryState } from './discovery.js';
import { DEFAULT_MODEL } from './model.js';
import { getAbortSignalConfig, timed } from './runtime.js';
import type { CandidateSearch, HydeCandidate, LensEmbedding } from './types.js';

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

/**
 * Discovery pipeline, stage 3: candidate retrieval.
 *
 * Three shapes share this node — a direct-connection fast path, a
 * context-sourced path, and the intent/query HyDE path. The retrieval
 * strategies themselves live in `opportunity.graph.discovery-strategies.ts`.
 */


/** Trace entries accumulate in the order the frontend renders them. */
type TraceEntry = { node: string; detail?: string; data?: Record<string, unknown> };

// Search limits - fixed values for candidate retrieval
// (The options.limit controls final output, not search pool)
const LIMIT_PER_STRATEGY = 80;
const PER_NETWORK_LIMIT = 160;

/**
 * Node 3: Discovery
 * Generates HyDE embeddings and performs semantic search.
 */
export async function discoveryNode(state: DiscoveryState, deps: DiscoveryDeps) {
  return timed("OpportunityGraph.discovery", async () => {
    const startTime = Date.now();
    const discoveryUserId = state.userId;

    /** Filter candidates to targetUserId when set (direct-connection mode). */
    const filterByTarget = (candidates: CandidateMatch[]): CandidateMatch[] => {
      if (!state.targetUserId) return candidates;
      const filtered = candidates.filter(c => c.candidateUserId === state.targetUserId);
      discoveryLog.verbose('targetUserId filter applied', {
        targetUserId: state.targetUserId,
        before: candidates.length,
        after: filtered.length,
      });
      return filtered;
    };

    discoveryLog.verbose('Starting semantic search', {
      targetNetworksCount: state.targetNetworks.length,
      discoverySource: state.discoverySource,
      searchQueryPreview: state.searchQuery?.trim().slice(0, 60) ?? '(none)',
    });

    try {
      if (state.targetNetworks.length === 0) {
        discoveryLog.warn('No target networks for search');
        return { candidates: [] };
      }

      if (state.targetUserId) {
        return await discoverDirectConnection(state, deps, discoveryUserId, startTime);
      }

      const ctx: DiscoveryStrategyContext = {
        state,
        deps,
        discoveryUserId,
        limitPerStrategy: LIMIT_PER_STRATEGY,
        perNetworkLimit: PER_NETWORK_LIMIT,
      };

      if (state.discoverySource === 'context') {
        return await discoverFromContext(ctx, filterByTarget, startTime);
      }

      return await discoverFromIntent(ctx, filterByTarget, startTime);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      discoveryLog.error('Failed', { error });
      return {
        candidates: [],
        error: 'Failed to search for candidates.',
        trace: [{
          node: "discovery_fatal",
          detail: `Discovery failed: ${errMsg}`,
          data: { error: errMsg },
        }],
      };
    }
  });
}

/**
 * Direct-connection fast path.
 * When targetUserId is set (user @-mentioned someone), bypass vector search
 * and construct candidates directly from shared networks.
 */
async function discoverDirectConnection(
  state: DiscoveryState,
  deps: DiscoveryDeps,
  discoveryUserId: string,
  startTime: number,
) {
  const targetUserId = state.targetUserId!;
  if (targetUserId === discoveryUserId) {
    discoveryLog.warn('Direct-connection target matches discoverer; skipping self-match', { targetUserId });
    return {
      candidates: [],
      trace: [{
        node: "discovery",
        detail: "Direct connection skipped: target user is discoverer",
        data: { targetUserId },
      }],
    };
  }
  discoveryLog.verbose('Direct-connection mode — bypassing vector search', { targetUserId });
  const targetMemberships = await deps.database.getNetworkMemberships(targetUserId);
  const targetUserNetworkIds = targetMemberships.map(m => m.networkId);
  const sharedNetworkIds = state.targetNetworks
    .filter(tn => targetUserNetworkIds.includes(tn.networkId))
    .map(tn => tn.networkId);

  if (sharedNetworkIds.length === 0) {
    discoveryLog.warn('Target user shares no networks with discoverer', {
      targetUserId,
      discovererNetworks: state.targetNetworks.map(tn => tn.networkId),
    });
    return {
      candidates: [],
      trace: [{
        node: "discovery",
        detail: `Direct connection: target user shares no networks`,
        data: { targetUserId },
      }],
    };
  }

  // Fetch target user's active intents to build intent-level candidates
  const targetIntents = await deps.database.getActiveIntents(targetUserId);
  const directCandidates: CandidateMatch[] = [];

  if (targetIntents.length > 0) {
    // Build one candidate per intent per shared network it belongs to
    for (const intent of targetIntents) {
      const intentNetworkIds = await deps.database.getNetworkIdsForIntent(intent.id);
      const overlapping = sharedNetworkIds.filter(id => intentNetworkIds.includes(id));
      for (const networkId of overlapping) {
        directCandidates.push(withCandidateEvidence({
          candidateUserId: targetUserId,
          candidateIntentId: intent.id as string,
          networkId,
          similarity: 1.0,
          lens: 'explicit_mention',
          candidatePayload: intent.payload,
          candidateSummary: intent.summary ?? undefined,
          discoverySource: 'query',
        }));
      }
    }
  }

  // Always add a profile-level candidate (so evaluation runs even without intents)
  if (directCandidates.length === 0) {
    directCandidates.push(withCandidateEvidence({
      candidateUserId: targetUserId,
      networkId: sharedNetworkIds[0] as string,
      similarity: 1.0,
      lens: 'explicit_mention',
      candidatePayload: '',
      candidateSummary: undefined,
      discoverySource: 'query',
    }));
  }

  discoveryLog.verbose('Direct candidates constructed', {
    count: directCandidates.length,
    sharedNetworks: sharedNetworkIds.length,
    targetIntents: targetIntents.length,
  });

  return {
    candidates: directCandidates,
    trace: [{
      node: "discovery",
      detail: `Direct connection → ${directCandidates.length} candidate(s) from ${sharedNetworkIds.length} shared network(s)`,
      data: {
        targetUserId,
        candidateCount: directCandidates.length,
        sharedNetworks: sharedNetworkIds.length,
        durationMs: Date.now() - startTime,
      },
    }],
  };
}

/**
 * Context source: HyDE (when a search query exists) plus the additive
 * context strategies.
 */
async function discoverFromContext(
  ctx: DiscoveryStrategyContext,
  filterByTarget: (candidates: CandidateMatch[]) => CandidateMatch[],
  startTime: number,
) {
  const { state } = ctx;

  if (state.searchQuery?.trim()) {
    discoveryLog.verbose('Context source with searchQuery → running query HyDE paths', {
      searchQuery: state.searchQuery.trim().substring(0, 80),
    });
    const queryResult = await runQueryHydeDiscovery(ctx);
    const queryCandidates = queryResult?.candidates ?? [];
    discoveryLog.verbose('Query HyDE path complete', { candidatesFound: queryCandidates.length });

    const traceEntries: TraceEntry[] = [];

    // Lens input trace (captured from runQueryHydeDiscovery)
    if (queryResult) {
      traceEntries.push({
        node: "lens_input",
        detail: "Profile context for lens inference",
        data: queryResult.lensInput,
      });

      // Lens output and HyDE document traces
      if (queryResult.hydeOutput.lenses.length > 0) {
        traceEntries.push({
          node: "lens_output",
          detail: `Inferred ${queryResult.hydeOutput.lenses.length} lens(es): ${queryResult.hydeOutput.lenses.map(l => l.label).join(', ')}`,
          data: { lenses: queryResult.hydeOutput.lenses, model: DEFAULT_MODEL },
        });
      }
      for (const [lens, doc] of Object.entries(queryResult.hydeOutput.hydeDocuments)) {
        if (doc?.hydeText) {
          traceEntries.push({
            node: "hyde_query",
            detail: `[${lens}] "${doc.hydeText.slice(0, 120)}${doc.hydeText.length > 120 ? '...' : ''}"`,
            data: { lens, hydeTextPreview: doc.hydeText.slice(0, 300) + (doc.hydeText.length > 300 ? '...' : '') },
          });
        }
      }
    }

    traceEntries.push({
      node: "discovery",
      detail: `HyDE search → ${queryCandidates.length} candidate(s) from query path`,
      data: {
        candidateCount: queryCandidates.length,
        byLens: computeLensStats(queryCandidates),
        searchQuery: state.searchQuery?.trim().slice(0, 80),
        durationMs: Date.now() - startTime,
        model: DEFAULT_MODEL,
      },
    });

    return { candidates: filterByTarget(mergeStrategyCandidates(queryCandidates)), trace: traceEntries };
  }

  // No search query, and no profile corpus to fall back on.
  return { candidates: [] };
}

/**
 * Intent source: HyDE over the resolved intent's payload (or the search query),
 * then the additive strategies on top.
 */
async function discoverFromIntent(
  ctx: DiscoveryStrategyContext,
  filterByTarget: (candidates: CandidateMatch[]) => CandidateMatch[],
  startTime: number,
) {
  const { state, deps, discoveryUserId } = ctx;

  const resolvedIntent = state.resolvedTriggerIntentId
    ? state.indexedIntents.find((i) => i.intentId === state.resolvedTriggerIntentId)
    : state.indexedIntents[0];
  const searchText = state.searchQuery ?? resolvedIntent?.payload ?? '';
  if (!searchText) {
    discoveryLog.warn('No search text available for intent path');
    return { candidates: [] };
  }

  const discovererContext = buildDiscovererContext(state.sourceProfile, state.indexedIntents);
  const discoveryLensInput = {
    profileContext: discovererContext,
    model: DEFAULT_MODEL,
  };
  const hydeResult = await deps.prepareArtifacts({
    sourceType: 'query',
    sourceText: searchText,
    forceRegenerate: false,
    profileContext: discovererContext,
  });
  const hydeEmbeddings = hydeResult.hydeEmbeddings as Record<string, number[]>;
  const lenses = hydeResult.lenses ?? [];
  if (!hydeEmbeddings || Object.keys(hydeEmbeddings).length === 0) {
    return { hydeEmbeddings: {} as Record<string, number[]>, candidates: [] };
  }

  const lensEmbeddings = toLensEmbeddings(hydeEmbeddings, lenses);

  const searchAllNetworks = async (minScore: number): Promise<CandidateMatch[]> => {
    const found: CandidateMatch[] = [];
    await Promise.all(
      state.targetNetworks.map(async (targetNetwork) => {
        const results = await searchWithHydeEmbeddings(deps.search, lensEmbeddings, {
          networkScope: [targetNetwork.networkId],
          excludeUserId: discoveryUserId,
          limitPerStrategy: ctx.limitPerStrategy,
          limit: ctx.perNetworkLimit,
          minScore,
        });
        found.push(...collectHydeResults(results, targetNetwork.networkId));
      })
    );
    return found;
  };

  const byUserAndNetwork = new Map<string, CandidateMatch>();
  const mergeIntoPool = (found: CandidateMatch[]) => {
    for (const c of found) {
      const key = `${c.candidateUserId}:${c.networkId}:intent:${c.candidateIntentId}`;
      if (!byUserAndNetwork.has(key) || c.similarity > (byUserAndNetwork.get(key)?.similarity ?? 0)) {
        byUserAndNetwork.set(key, c);
      }
    }
  };

  mergeIntoPool(await searchAllNetworks(deps.retrievalMinSimilarity));

  // The similarity floor can be what keeps a small network under the match
  // floor, not a genuine lack of members. Re-run without it once when the
  // deduped pool doesn't have enough distinct users yet.
  const distinctUsers = new Set(Array.from(byUserAndNetwork.values()).map((c) => c.candidateUserId)).size;
  const toppedUp = distinctUsers < DISCOVERY_MIN_MATCHES;
  if (toppedUp) {
    mergeIntoPool(await searchAllNetworks(0));
  }

  const candidates = Array.from(byUserAndNetwork.values());
  discoveryLog.verbose('Intent-path discovery complete', { candidatesFound: candidates.length, toppedUp });
  const usedLenses = Object.keys(hydeEmbeddings);

  // Build trace with individual candidate similarity scores
  const traceEntries: TraceEntry[] = [{
    node: "lens_input",
    detail: "Profile context for lens inference",
    data: discoveryLensInput,
  }];

  if (lenses.length > 0) {
    traceEntries.push({
      node: "lens_output",
      detail: `Inferred ${lenses.length} lens(es): ${lenses.map(l => l.label).join(', ')}`,
      data: { lenses, model: DEFAULT_MODEL },
    });
  }

  traceEntries.push({
    node: "discovery",
    detail: `Query: "${searchText.slice(0, 50)}${searchText.length > 50 ? '...' : ''}" → ${candidates.length} candidate(s)`,
    data: {
      query: searchText.slice(0, 100),
      lenses: usedLenses,
      candidateCount: candidates.length,
      byLens: computeLensStats(candidates),
      toppedUp,
      durationMs: Date.now() - startTime,
      model: DEFAULT_MODEL,
    },
  });

  // Show the HyDE-generated hypothetical documents used for search
  const hydeDocuments = hydeResult.hydeDocuments;
  if (hydeDocuments) {
    for (const [lens, doc] of Object.entries(hydeDocuments)) {
      if (doc?.hydeText) {
        traceEntries.push({
          node: "hyde_query",
          detail: `[${lens}] "${doc.hydeText.slice(0, 120)}${doc.hydeText.length > 120 ? '...' : ''}"`,
          data: {
            lens,
            hydeTextPreview: doc.hydeText.slice(0, 160) + (doc.hydeText.length > 160 ? '...' : ''),
          },
        });
      }
    }
  }

  // Add top candidates with similarity scores
  const sortedCandidates = [...candidates].sort((a, b) => b.similarity - a.similarity).slice(0, 10);
  for (const c of sortedCandidates) {
    traceEntries.push({
      node: "match",
      detail: `Similarity ${Math.round(c.similarity * 100)}% via ${c.lens}`,
      data: {
        userId: c.candidateUserId,
        similarity: Math.round(c.similarity * 100),
        lens: c.lens,
        hasIntent: !!c.candidateIntentId,
      },
    });
  }

  const allStrategies = mergeStrategyCandidates(candidates);
  return {
    hydeEmbeddings: hydeEmbeddings as Record<string, number[]>,
    candidates: filterByTarget(allStrategies),
    trace: traceEntries,
  };
}

/** Trace summary for {@link discoveryNode}. */
export function discoveryTraceSummary(result: unknown): string | undefined {
  const r = result as Record<string, unknown>;
  if (r?.error) return `error: ${r.error}`;
  const candidates = r?.candidates as unknown[];
  return candidates ? `Found ${candidates.length} candidate(s)` : undefined;
}
