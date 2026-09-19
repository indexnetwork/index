import type { CandidateSearch, DiscoveryData, EmbeddingGenerator, IntentCandidate, Profile, RunOptions } from '../core/types.js';

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
  queries: string[];
  minSimilarity: number;
  networkIds: string[];
}

export interface CandidateDiscoveryResult {
  networkIds: string[];
  candidates: CounterpartyCandidate[];
}

const DEFAULT_CANDIDATE_LIMIT = 80;

/**
 * Retrieves candidate intents with five complementary queries within shared intent registrations.
 *
 * One embedding batch, five parallel searches, and one merged candidate ranking.
 * The caller (H2A agent) owns query complementarity, evaluation, refinement, and opening decisions.
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
   * Discovers candidate counterparty intents matching five complementary search queries.
   *
   * @param input - Exactly five distinct nonempty queries and an owned match-ready intent; requested networks must be a subset of its authorized registrations.
   * @param options - Cancellation signal and execution tracing.
   * @returns At most 80 hydrated candidates sorted by their highest query similarity descending.
   * @throws When queries or embeddings are invalid, network scope is invalid, or infrastructure reads fail.
   */
  async discover(input: CandidateDiscoveryInput, options: RunOptions = {}): Promise<CandidateDiscoveryResult> {
    const { queries, minScore, networkIds: requestedNetworks } = this.validateInput(input);
    const { database, embedder, search } = this.deps;
    const { signal, traceEmitter, logger } = options;

    const startedAt = Date.now();
    signal?.throwIfAborted();
    traceEmitter?.({ type: 'agent_start', name: 'opportunity-discovery' });

    try {
      // 1. Verify trigger intent is active and resolve authorized network scope
      const [memberships, userIntents, triggerIntentNetworkIds] = await Promise.all([
        database.getNetworkMemberships(input.userId),
        database.getActiveIntents(input.userId),
        database.getNetworkIdsForIntent(input.triggerIntentId),
      ]);

      signal?.throwIfAborted();

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
        requestedNetworks.every(
          (id) => scope.networkIds.includes(id) && userNetworkIds.includes(id) && triggerIntentNetworkIds.includes(id),
        );

      if (!isScopeAuthorized) {
        throw new Error('Requested networks are outside authorized scope.');
      }

      signal?.throwIfAborted();

      // 2. Generate all five query embeddings in one batch
      const embeddings = await embedder.generate(queries, undefined, { signal });
      signal?.throwIfAborted();

      if (
        embeddings.length !== queries.length ||
        !embeddings.every(
          (embedding): embedding is number[] =>
            Array.isArray(embedding) && embedding.length > 0 && embedding.every(Number.isFinite),
        )
      ) {
        throw new Error('Expected five nonempty query embedding vectors.');
      }

      // 3. Search the same authorized scope in parallel and merge before hydration
      const hitsByQuery = await Promise.all(
        embeddings.map((embedding) => search.searchIntentCandidates(embedding, {
          networkScope: scope.networkIds,
          excludeUserId: input.userId,
          minScore,
          limit: DEFAULT_CANDIDATE_LIMIT,
          signal,
        })),
      );

      signal?.throwIfAborted();

      const uniqueHits = new Map<string, IntentCandidate>();
      for (const hits of hitsByQuery) {
        for (const hit of hits) {
          if (
            hit.userId === input.userId ||
            !scope.networkIds.includes(hit.networkId) ||
            !Number.isFinite(hit.score) ||
            hit.score < minScore
          ) continue;

          const dedupeKey = `${hit.id}:${hit.networkId}`;
          const existing = uniqueHits.get(dedupeKey);
          if (!existing || existing.score < hit.score) {
            uniqueHits.set(dedupeKey, hit);
          }
        }
      }
      const eligibleHits = [...uniqueHits.values()];

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

      signal?.throwIfAborted();

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

      signal?.throwIfAborted();

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

      // 6. Apply live membership guards and cap the merged ranking
      const ranked = hydratedCandidates
        .filter(
          (candidate): candidate is CounterpartyCandidate =>
            candidate !== null &&
            validNetworks.includes(candidate.networkId) &&
            isMember(candidate.candidateUserId, candidate.networkId),
        )
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
    queries: string[];
    minScore: number;
    networkIds: string[];
  } {
    if (!Array.isArray(input.queries) || input.queries.length !== 5) {
      throw new Error('Provide exactly five distinct nonempty search queries.');
    }

    const queries = Array.from(input.queries, (query) =>
      typeof query === 'string' ? query.replace(/\s+/g, ' ').trim() : '',
    );
    if (queries.some((query) => !query) || new Set(queries.map((query) => query.toLowerCase())).size !== 5) {
      throw new Error('Provide exactly five distinct nonempty search queries.');
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

    return { queries, minScore, networkIds: input.networkIds };
  }
}
