/**
 * Discovery pipeline, stage 3: candidate retrieval.
 *
 * Three shapes share this node — a direct-connection fast path, a
 * context-sourced path, and the intent/query HyDE path. The retrieval
 * strategies themselves live in `opportunity.graph.discovery-strategies.ts`.
 */

import type { Id } from '../../platform/database.js';
import type { CandidateMatch } from './opportunity.state.js';
import { getModelName } from '../shared/agent/model.config.js';
import { timed } from '../shared/observability/performance.js';
import { withCandidateEvidence } from './opportunity.evidence.js';
import { buildDiscovererContext, discoveryLog, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";
import { collectHydeResults, computeLensStats, mergeStrategyCandidates, runQueryHydeDiscovery, toLensEmbeddings, type DiscoveryStrategyContext } from "./opportunity.graph.discovery-strategies.js";
import { DISCOVERY_MIN_MATCHES } from './discovery.env.js';

/** Trace entries accumulate in the order the frontend renders them. */
type TraceEntry = { node: string; detail?: string; data?: Record<string, unknown> };

// Search limits - fixed values for candidate retrieval
// (The options.limit controls final output, not search pool)
const LIMIT_PER_STRATEGY = 80;
const PER_INDEX_LIMIT = 160;

/**
 * Node 3: Discovery
 * Generates HyDE embeddings and performs semantic search.
 */
export async function discoveryNode(state: OpportunityState, deps: OpportunityGraphDeps) {
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
        perIndexLimit: PER_INDEX_LIMIT,
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
  state: OpportunityState,
  deps: OpportunityGraphDeps,
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
          candidateIntentId: intent.id as Id<'intents'>,
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
      networkId: sharedNetworkIds[0] as Id<'networks'>,
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
          data: { lenses: queryResult.hydeOutput.lenses, model: getModelName("lensInferrer") },
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
        model: getModelName("hydeGenerator"),
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
    model: getModelName("lensInferrer"),
  };
  const hydeResult = await deps.hydeGenerator.invoke({
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
        const results = await deps.embedder.searchWithHydeEmbeddings(lensEmbeddings, {
          indexScope: [targetNetwork.networkId],
          excludeUserId: discoveryUserId,
          limitPerStrategy: ctx.limitPerStrategy,
          limit: ctx.perIndexLimit,
          minScore,
        });
        found.push(...collectHydeResults(results, targetNetwork.networkId));
      })
    );
    return found;
  };

  const byUserAndIndex = new Map<string, CandidateMatch>();
  const mergeIntoPool = (found: CandidateMatch[]) => {
    for (const c of found) {
      const key = `${c.candidateUserId}:${c.networkId}:intent:${c.candidateIntentId}`;
      if (!byUserAndIndex.has(key) || c.similarity > (byUserAndIndex.get(key)?.similarity ?? 0)) {
        byUserAndIndex.set(key, c);
      }
    }
  };

  mergeIntoPool(await searchAllNetworks(deps.retrievalMinSimilarity));

  // The similarity floor can be what keeps a small network under the match
  // floor, not a genuine lack of members. Re-run without it once when the
  // deduped pool doesn't have enough distinct users yet.
  const distinctUsers = new Set(Array.from(byUserAndIndex.values()).map((c) => c.candidateUserId)).size;
  const toppedUp = distinctUsers < DISCOVERY_MIN_MATCHES;
  if (toppedUp) {
    mergeIntoPool(await searchAllNetworks(0));
  }

  const candidates = Array.from(byUserAndIndex.values());
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
      data: { lenses, model: getModelName("lensInferrer") },
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
      model: getModelName("hydeGenerator"),
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
