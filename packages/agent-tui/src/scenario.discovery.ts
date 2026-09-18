import type { Negotiation } from '@indexnetwork/agent';
import { CandidateDiscovery, type EmbeddingGenerator } from '@indexnetwork/discovery';
import { resolveDiscoveryNetworkScope } from '@indexnetwork/protocol';

import type { TuiPrincipal } from './negotiation.tui';

export const SCENARIO_NETWORK_ID = 'local-simulation';

/**
 * Run production discovery against fictional, active intents in one local network.
 * @param users - Scenario principals; private context is never exposed through discovery.
 * @param embedder - The host's real embedding generator, shared by queries and intent indexing.
 * @param negotiations - Current protocol records for recent-rejection evidence.
 * @param isMatchReady - Whether the intent has committed its standing brief.
 * @returns The same candidate pipeline used by the API, with in-memory data and cosine search ports.
 */
export function createScenarioDiscovery(
  users: readonly TuiPrincipal[],
  embedder: EmbeddingGenerator,
  negotiations: (userId: string) => Promise<Negotiation[]>,
  isMatchReady: (intentId: string) => Promise<boolean>,
): CandidateDiscovery {
  let vectors: number[][] | undefined;
  const networkIds = [SCENARIO_NETWORK_ID];
  const assignedNetworks = (intentId: string) => users.some((user) => user.intentId === intentId) ? networkIds : [];
  return new CandidateDiscovery({
    embedder,
    database: {
      getNetworkMemberships: async (userId) => users.some((user) => user.userId === userId) ? [{ networkId: SCENARIO_NETWORK_ID }] : [],
      getActiveIntents: async (userId) => {
        const owned = users.filter((user) => user.userId === userId);
        const ready = await Promise.all(owned.map(async (user) => ({ user, ready: await isMatchReady(user.intentId) })));
        return ready.filter((entry) => entry.ready).map(({ user }) => ({ id: user.intentId, payload: user.intent }));
      },
      getProfile: async (userId) => {
        const user = users.find((user) => user.userId === userId);
        return user ? { identity: { name: user.name } } : null;
      },
      getNetworkIdsForIntent: async (intentId) => assignedNetworks(intentId),
      getDiscoveryScope: async (input) => resolveDiscoveryNetworkScope({
        userNetworkIds: input.userNetworks, networkId: input.networkId, networkScope: input.networkScope,
        ownsRequestedNetwork: false, triggerIntentNetworkIds: assignedNetworks(input.triggerIntentId!),
      }),
      getNetworkContexts: async (ids) => Object.fromEntries(ids.filter((id) => id === SCENARIO_NETWORK_ID).map((id) => [id, 'Local simulation network'])),
      getActiveNetworkMembershipPairs: async (pairs) => pairs.filter((pair) => pair.networkId === SCENARIO_NETWORK_ID && users.some((user) => user.userId === pair.userId)),
      getRecentlyRejectedOpportunityCounterparties: async (userId, candidates, windowMs) => {
        const records = await negotiations(userId);
        return [...new Set(records.filter((record) => record.outcome === 'declined' && record.settledAt
          && Date.parse(record.settledAt) >= Date.now() - windowMs && candidates.includes(record.counterparty.userId))
          .map((record) => record.counterparty.userId))];
      },
    },
    search: {
      searchIntentCandidates: async (query, options) => {
        options.signal?.throwIfAborted();
        if (!vectors) {
          const generated = await embedder.generate(users.map((user) => user.intent), undefined, { signal: options.signal });
          options.signal?.throwIfAborted();
          if (generated.length !== users.length || !generated.every((vector) => Array.isArray(vector) && vector.length === query.length)) {
            throw new Error('Scenario intent embeddings must match the query vector space.');
          }
          vectors = generated as number[][];
        }
        const queryNorm = Math.sqrt(query.reduce((sum, value) => sum + value * value, 0));
        const ready = await Promise.all(users.map(async (user) => isMatchReady(user.intentId)));
        return users.flatMap((user, index) => {
          if (!ready[index] || user.userId === options.excludeUserId || !options.networkScope.includes(SCENARIO_NETWORK_ID)) return [];
          const vector = vectors![index];
          if (vector.length !== query.length) throw new Error('Query embedding dimensions changed.');
          const dot = vector.reduce((sum, value, index) => sum + value * query[index], 0);
          const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
          const score = dot / (queryNorm * norm);
          return score >= options.minScore ? [{ type: 'intent' as const, id: user.intentId, userId: user.userId, networkId: SCENARIO_NETWORK_ID, score }] : [];
        }).sort((a, b) => b.score - a.score).slice(0, options.limit);
      },
    },
  });
}
