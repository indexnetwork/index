import type { CandidateSearch, DiscoveryData, EmbeddingGenerator, Profile, RunOptions } from '../core/types.js';

import { validateDiscoveryMinSimilarity, REJECTION_COOLDOWN_MS } from './discovery.constants.js';

/** Read ports for explicit-query retrieval, independent of artifact generation and evaluation. */
export type CandidateDiscoveryData = Pick<
  DiscoveryData,
  | 'getNetworkMemberships'
  | 'getActiveIntents'
  | 'getProfile'
  | 'getNetworkIdsForIntent'
  | 'getDiscoveryScope'
  | 'getNetworkContexts'
  | 'getActiveNetworkMembershipPairs'
  | 'getRecentlyRejectedOpportunityCounterparties'
>;

export interface CounterpartyCandidate {
  candidateUserId: string;
  candidateIntentId: string;
  networkId: string;
  similarity: number;
  candidatePayload: string;
  candidateSummary?: string;
  profile: Profile | null;
  networkContext?: string;
  recentlyRejected: boolean;
}

export interface CandidateDiscoveryInput {
  userId: string;
  triggerIntentId: string;
  query: string;
  minSimilarity: number;
  networkIds: string[];
}

export interface CandidateDiscoveryResult {
  networkIds: string[];
  candidates: CounterpartyCandidate[];
}

const DEFAULT_CANDIDATE_LIMIT = 80;

/**
 * Executes an explicit-query vector search for candidate intents across authorized networks.
 *
 * One explicit query, one embedding generation, and one candidate retrieval.
 * The caller (H2A agent) owns all evaluation, query refinement, and opening decisions.
 */
export class CandidateDiscovery {
  constructor(
    private readonly deps: {
      database: CandidateDiscoveryData;
      embedder: EmbeddingGenerator;
      search: CandidateSearch;
    },
  ) {}

  /**
   * Discovers candidate counterparty intents matching an explicit search query.
   *
   * @param input - Explicit query and owned active intent; requested networks must be a subset of authorized assignments.
   * @param options - Cancellation signal and execution tracing.
   * @returns Hydrated candidates sorted by similarity descending.
   * @throws When query is empty, network scope is invalid, or infrastructure reads fail.
   */
  async discover(input: CandidateDiscoveryInput, options: RunOptions = {}): Promise<CandidateDiscoveryResult> {
    const { query, minScore, networkIds: requestedNetworks } = this.validateInput(input);
    const { database, embedder, search } = this.deps;
    const { signal, traceEmitter, logger } = options;

    const startedAt = Date.now();
    signal?.throwIfAborted();
    traceEmitter?.({ type: 'agent_start', name: 'opportunity-discovery' });

    try {
      // 1. Verify trigger intent is active and resolve authorized network scope
      const [memberships, userIntents] = await Promise.all([
        database.getNetworkMemberships(input.userId),
        database.getActiveIntents(input.userId),
      ]);

      const triggerIntent = userIntents.find((intent) => intent.id === input.triggerIntentId);
      if (!triggerIntent) {
        throw new Error('Trigger intent is not available for discovery.');
      }

      const userNetworkIds = memberships.map((m) => m.networkId);
      const scope = await database.getDiscoveryScope({
        userId: input.userId,
        userNetworks: userNetworkIds,
        networkScope: requestedNetworks,
        triggerIntentId: input.triggerIntentId,
      });

      if (scope.error) {
        throw new Error(scope.error);
      }

      const isScopeAuthorized =
        scope.networkIds.length === requestedNetworks.length &&
        requestedNetworks.every((id) => scope.networkIds.includes(id));

      if (!isScopeAuthorized) {
        throw new Error('Requested networks are outside authorized scope.');
      }

      signal?.throwIfAborted();

      // 2. Generate embedding for explicit query
      const generated = await embedder.generate(query, undefined, { signal });
      const embedding = Array.isArray(generated[0]) ? generated[0] : (generated as number[]);
      if (!embedding?.length) {
        throw new Error('Query embedding is empty.');
      }

      signal?.throwIfAborted();

      // 3. Search candidate intents in vector store
      const hits = await search.searchIntentCandidates(embedding, {
        networkScope: scope.networkIds,
        excludeUserId: input.userId,
        minScore,
        limit: DEFAULT_CANDIDATE_LIMIT,
        signal,
      });

      const eligibleHits = hits.filter(
        (hit) =>
          hit.userId !== input.userId &&
          scope.networkIds.includes(hit.networkId) &&
          Number.isFinite(hit.score) &&
          hit.score >= minScore,
      );

      if (!eligibleHits.length) {
        return { networkIds: scope.networkIds, candidates: [] };
      }

      // 4. Hydrate candidate details (profiles, intents, network contexts, recent rejections)
      const candidateUserIds = [...new Set(eligibleHits.map((hit) => hit.userId))];

      const [candidateProfiles, networkContexts, recentlyRejectedUserIds] = await Promise.all([
        Promise.all(
          candidateUserIds.map(async (userId) => ({
            userId,
            intents: await database.getActiveIntents(userId),
            profile: await database.getProfile(userId),
          })),
        ),
        database.getNetworkContexts(scope.networkIds),
        database.getRecentlyRejectedOpportunityCounterparties(
          input.userId,
          candidateUserIds,
          REJECTION_COOLDOWN_MS,
        ),
      ]);

      const candidateMap = new Map(candidateProfiles.map((p) => [p.userId, p]));
      const rejectedSet = new Set(recentlyRejectedUserIds);

      const hydratedCandidates = await Promise.all(
        eligibleHits.map(async (hit): Promise<CounterpartyCandidate | null> => {
          const userDetails = candidateMap.get(hit.userId);
          if (!userDetails) return null;

          const candidateIntent = userDetails.intents.find((intent) => intent.id === hit.id);
          if (!candidateIntent) return null;

          const intentNetworks = await database.getNetworkIdsForIntent(hit.id);
          if (!intentNetworks.includes(hit.networkId)) return null;

          return {
            candidateUserId: hit.userId,
            candidateIntentId: hit.id,
            networkId: hit.networkId,
            similarity: Math.min(1, Math.max(0, hit.score)),
            candidatePayload: candidateIntent.payload,
            candidateSummary: candidateIntent.summary ?? undefined,
            profile: userDetails.profile,
            networkContext: networkContexts[hit.networkId],
            recentlyRejected: rejectedSet.has(hit.userId),
          };
        }),
      );

      // 5. Final guard: re-verify source intent and live network memberships before returning
      const [currentSourceIntents, sourceAssignments, activeMembershipPairs] = await Promise.all([
        database.getActiveIntents(input.userId),
        database.getNetworkIdsForIntent(input.triggerIntentId),
        database.getActiveNetworkMembershipPairs([
          ...scope.networkIds.map((networkId) => ({ userId: input.userId, networkId })),
          ...eligibleHits.map((hit) => ({ userId: hit.userId, networkId: hit.networkId })),
        ]),
      ]);

      signal?.throwIfAborted();

      if (!currentSourceIntents.some((intent) => intent.id === input.triggerIntentId)) {
        throw new Error('Trigger intent is not available for discovery.');
      }

      const isMember = (userId: string, networkId: string): boolean =>
        activeMembershipPairs.some((pair) => pair.userId === userId && pair.networkId === networkId);

      const validNetworks = scope.networkIds.filter(
        (networkId) => sourceAssignments.includes(networkId) && isMember(input.userId, networkId),
      );

      if (validNetworks.length !== requestedNetworks.length) {
        throw new Error('Source network scope changed during search.');
      }

      // 6. Deduplicate candidates by (candidateIntentId, networkId) taking highest similarity
      const uniqueCandidates = new Map<string, CounterpartyCandidate>();
      for (const candidate of hydratedCandidates) {
        if (!candidate) continue;
        if (!validNetworks.includes(candidate.networkId)) continue;
        if (!isMember(candidate.candidateUserId, candidate.networkId)) continue;

        const dedupeKey = `${candidate.candidateIntentId}:${candidate.networkId}`;
        const existing = uniqueCandidates.get(dedupeKey);
        if (!existing || existing.similarity < candidate.similarity) {
          uniqueCandidates.set(dedupeKey, candidate);
        }
      }

      const ranked = [...uniqueCandidates.values()]
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, DEFAULT_CANDIDATE_LIMIT);

      logger?.info('Candidate search complete', {
        candidates: ranked.length,
        networks: validNetworks.length,
      });

      return {
        networkIds: validNetworks,
        candidates: ranked,
      };
    } finally {
      traceEmitter?.({
        type: 'agent_end',
        name: 'opportunity-discovery',
        durationMs: Date.now() - startedAt,
      });
    }
  }

  private validateInput(input: CandidateDiscoveryInput): {
    query: string;
    minScore: number;
    networkIds: string[];
  } {
    const query = input.query?.trim();
    if (!query) {
      throw new Error('An explicit search query is required.');
    }

    const minScore = validateDiscoveryMinSimilarity(input.minSimilarity);

    if (
      !Array.isArray(input.networkIds) ||
      !input.networkIds.length ||
      new Set(input.networkIds).size !== input.networkIds.length ||
      input.networkIds.some((id) => typeof id !== 'string' || !id.trim())
    ) {
      throw new Error('Provide distinct nonempty network IDs.');
    }

    return { query, minScore, networkIds: input.networkIds };
  }
}
