import { timed } from '../core/runtime.js';
import { mergeStrategyCandidates, searchQueryAcrossNetworks, type DiscoveryStrategyContext } from './candidate.search.js';
import { DISCOVERY_MIN_MATCHES } from './discovery.constants.js';
import type { CandidateMatch, DiscoveryDeps, DiscoveryState, TraceEntry } from './discovery.state.js';
import { discoveryLog } from './discovery.trace.js';
import { withCandidateEvidence } from './match.evidence.js';

// Search limits - fixed values for candidate retrieval
// (The options.limit controls final output, not search pool)
const LIMIT_PER_STRATEGY = 80;
const PER_NETWORK_LIMIT = 160;

/**
 * Node 3: Discovery
 * Embeds the query text and performs semantic search against real intent vectors.
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

      if (state.discoverySource === 'context' && !state.searchQuery?.trim()) {
        return { candidates: [] };
      }

      const resolvedIntent = state.resolvedTriggerIntentId
        ? state.indexedIntents.find((i) => i.intentId === state.resolvedTriggerIntentId)
        : state.indexedIntents[0];
      const searchText = state.searchQuery?.trim() || resolvedIntent?.payload || '';
      if (!searchText) {
        discoveryLog.warn('No search text available');
        return { candidates: [] };
      }

      return await discoverFromQuery(ctx, searchText, filterByTarget, startTime);
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

  const targetIntents = await deps.database.getActiveIntents(targetUserId);
  const directCandidates: CandidateMatch[] = [];

  if (targetIntents.length > 0) {
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

/** Query-embedding retrieval for both intent and context sources. */
async function discoverFromQuery(
  ctx: DiscoveryStrategyContext,
  searchText: string,
  filterByTarget: (candidates: CandidateMatch[]) => CandidateMatch[],
  startTime: number,
) {
  const { deps } = ctx;
  const byKey = new Map<string, CandidateMatch>();
  const mergeIntoPool = (found: CandidateMatch[]) => {
    for (const c of found) {
      const key = `${c.candidateUserId}:${c.networkId}:intent:${c.candidateIntentId}`;
      if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
        byKey.set(key, c);
      }
    }
  };

  mergeIntoPool(await searchQueryAcrossNetworks(ctx, searchText, deps.retrievalMinSimilarity));

  const distinctUsers = new Set(Array.from(byKey.values()).map((c) => c.candidateUserId)).size;
  const toppedUp = distinctUsers < DISCOVERY_MIN_MATCHES;
  if (toppedUp) {
    mergeIntoPool(await searchQueryAcrossNetworks(ctx, searchText, 0));
  }

  const candidates = Array.from(byKey.values());
  discoveryLog.verbose('Query discovery complete', { candidatesFound: candidates.length, toppedUp });

  const traceEntries: TraceEntry[] = [{
    node: "discovery",
    detail: `Query: "${searchText.slice(0, 50)}${searchText.length > 50 ? '...' : ''}" → ${candidates.length} candidate(s)`,
    data: {
      query: searchText.slice(0, 100),
      candidateCount: candidates.length,
      toppedUp,
      durationMs: Date.now() - startTime,
    },
  }];

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

  return {
    candidates: filterByTarget(mergeStrategyCandidates(candidates)),
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
