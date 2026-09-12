import type { RunOptions } from '../core/types.js';

import { DISCOVERY_MIN_SIMILARITY, validateDiscoveryMinSimilarity, REJECTION_COOLDOWN_MS } from './discovery.constants.js';
import type { CandidateMatch, DiscoveryDeps, DiscoveryInput, DiscoveryState } from './discovery.state.js';

/** One explicit query, one embedding, and one candidate search. The caller owns every decision. */
export class Discovery {
  private readonly minSimilarity: number;

  constructor(private readonly deps: DiscoveryDeps) {
    this.minSimilarity = validateDiscoveryMinSimilarity(deps.retrievalMinSimilarity ?? DISCOVERY_MIN_SIMILARITY);
  }

  /**
   * @param input - An explicit query and owned active intent; requested networks only narrow its assignments.
   * @param options - Cancellation and tracing for this call.
   * @returns Hydrated candidates sorted by retrieval similarity, without explanations or pair opening.
   * @throws On cancellation, invalid query/limits, or failed infrastructure reads.
   */
  async discover(input: DiscoveryInput, options: RunOptions = {}): Promise<DiscoveryState> {
    const query = input.searchQuery?.trim();
    if (!query) throw new Error('An explicit search query is required.');
    const minScore = validateDiscoveryMinSimilarity(input.minSimilarity ?? this.minSimilarity);
    const limit = input.options?.limit ?? 80;
    if (!Number.isInteger(limit) || limit < 1 || limit > 80) throw new Error('Search limit must be between 1 and 80.');
    const { database, embedder, search } = this.deps;
    const { signal, traceEmitter } = options;
    const started = Date.now();
    signal?.throwIfAborted();
    traceEmitter?.({ type: 'agent_start', name: 'opportunity-discovery' });
    try {
      const [memberships, intents] = await Promise.all([
        database.getNetworkMemberships(input.userId), database.getActiveIntents(input.userId),
      ]);
      const empty = { searchQuery: query, networkIds: [], candidates: [] };
      if (!intents.some(intent => intent.id === input.triggerIntentId)) return { ...empty, error: 'Trigger intent is not available for discovery.' };
      const scope = await database.getDiscoveryScope({
        userId: input.userId, userNetworks: memberships.map(m => m.networkId),
        networkId: input.networkId, networkScope: input.networkScope, triggerIntentId: input.triggerIntentId,
      });
      if (scope.error) return { ...empty, error: scope.error };
      if (!scope.networkIds.length) return empty;
      signal?.throwIfAborted();
      const generated = await embedder.generate(query, undefined, { signal });
      const embedding = Array.isArray(generated[0]) ? generated[0] : generated as number[];
      if (!embedding?.length) throw new Error('Query embedding is empty.');
      signal?.throwIfAborted();
      const hits = await search.searchIntentCandidates(embedding, {
        networkScope: scope.networkIds, excludeUserId: input.userId, minScore, limit, signal,
      });
      const eligibleHits = hits.filter(hit => hit.userId !== input.userId && scope.networkIds.includes(hit.networkId)
        && Number.isFinite(hit.score) && hit.score >= minScore);
      const userIds = [...new Set(eligibleHits.map(hit => hit.userId))];
      const [people, contexts, rejected] = await Promise.all([
        Promise.all(userIds.map(async userId => ({ userId, intents: await database.getActiveIntents(userId), profile: await database.getProfile(userId) }))),
        database.getNetworkContexts(scope.networkIds),
        database.getRecentlyRejectedOpportunityCounterparties(input.userId, userIds, REJECTION_COOLDOWN_MS),
      ]);
      const candidates = await Promise.all(eligibleHits.map(async (hit): Promise<CandidateMatch | null> => {
        const person = people.find(person => person.userId === hit.userId)!;
        const intent = person.intents.find(intent => intent.id === hit.id);
        if (!intent || !(await database.getNetworkIdsForIntent(hit.id)).includes(hit.networkId)) return null;
        return {
          candidateUserId: hit.userId, candidateIntentId: hit.id, networkId: hit.networkId,
          similarity: Math.min(1, Math.max(0, hit.score)), candidatePayload: intent.payload,
          candidateSummary: intent.summary ?? undefined, profile: person.profile,
          networkContext: contexts[hit.networkId], recentlyRejected: rejected.includes(hit.userId),
        };
      }));
      // Recheck live source ownership, assignments and both memberships before disclosing results.
      const [activeSource, assignments, activePairs] = await Promise.all([
        database.getActiveIntents(input.userId), database.getNetworkIdsForIntent(input.triggerIntentId),
        database.getActiveNetworkMembershipPairs([
          ...scope.networkIds.map(networkId => ({ userId: input.userId, networkId })),
          ...eligibleHits.map(hit => ({ userId: hit.userId, networkId: hit.networkId })),
        ]),
      ]);
      signal?.throwIfAborted();
      if (!activeSource.some(intent => intent.id === input.triggerIntentId)) return { ...empty, error: 'Trigger intent is not available for discovery.' };
      const member = (userId: string, networkId: string) => activePairs.some(pair => pair.userId === userId && pair.networkId === networkId);
      const networkIds = scope.networkIds.filter(id => assignments.includes(id) && member(input.userId, id));
      const unique = new Map<string, CandidateMatch>();
      for (const candidate of candidates) {
        if (!candidate || !networkIds.includes(candidate.networkId) || !member(candidate.candidateUserId, candidate.networkId)) continue;
        const key = candidate.candidateIntentId + ':' + candidate.networkId;
        if (!unique.has(key) || unique.get(key)!.similarity < candidate.similarity) unique.set(key, candidate);
      }
      const ranked = [...unique.values()].sort((a, b) => b.similarity - a.similarity).slice(0, limit);
      options.logger?.info('Candidate search complete', { candidates: ranked.length, networks: networkIds.length });
      return { searchQuery: query, networkIds, candidates: ranked };
    } finally {
      traceEmitter?.({ type: 'agent_end', name: 'opportunity-discovery', durationMs: Date.now() - started });
    }
  }
}
