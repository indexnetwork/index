import type { WakeTiming } from '@indexnetwork/agent';
import { CandidateDiscovery, TypeSafeIntentEvaluator, type CandidateDiscoveryData } from '@indexnetwork/discovery';
import { resolveDiscoveryNetworkScope, renderDiscoveryNetworkContext } from '@indexnetwork/protocol';

import { ChatDatabaseAdapter } from '../../adapters/database.adapter';

/**
 * Compose the same exhaustive intent-pair matcher for hosted and external agents.
 * @param timing - Request-local parent for retrieval, evaluation, and profile timings.
 * @returns Authorized database reads and the server-side TypeSafe evaluator.
 * @throws When TYPESAFE_API_KEY is missing; provider and database errors propagate from discovery.
 */
export function createIntentDiscovery(timing?: WakeTiming): CandidateDiscovery {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey?.trim()) throw new Error('TYPESAFE_API_KEY is required for intent matching.');
  const database = new ChatDatabaseAdapter();
  const measure = <T>(operation: string, run: () => Promise<T>, metadata: Record<string, string | number>, signal?: AbortSignal): Promise<T> =>
    timing ? timing.measure(operation, async (child) => {
      const result = await run();
      child.finish(signal?.aborted ? 'cancelled' : 'completed', {
        resultCount: Array.isArray(result) ? result.length : result == null ? 0 : 1,
      });
      return result;
    }, signal, metadata) : run();
  const discoveryData: CandidateDiscoveryData = {
    getNetworkMemberships: (id) => measure('discovery.retrieval.getNetworkMemberships', () => database.getNetworkMemberships(id), { userId: id }),
    getActiveIntents: (id) => measure('discovery.retrieval.getActiveIntents', () => database.getMatchReadyIntents(id), { userId: id }),
    getProfile: (id) => measure('discovery.profileEnrichment', () => database.getProfile(id), { userId: id }),
    getNetworkIdsForIntent: (id) => measure('discovery.retrieval.getNetworkIdsForIntent', () => database.getNetworkIdsForIntent(id), { intentId: id }),
    getActiveNetworkMembershipPairs: (pairs) => measure('discovery.retrieval.getActiveNetworkMembershipPairs', () => database.getActiveNetworkMembershipPairs(pairs), { pairCount: pairs.length }),
    listIntentCandidates: (input, options) => measure('discovery.retrieval.listIntentCandidates', () => database.listIntentCandidates(input, options), {
      excludeUserId: input.excludeUserId, networkCount: input.networkIds.length,
    }, options?.signal),
    getDiscoveryScope: async (input) => {
      const triggerIntentNetworkIds = await discoveryData.getNetworkIdsForIntent(input.triggerIntentId!);
      return resolveDiscoveryNetworkScope({
        userNetworkIds: input.userNetworks,
        networkId: input.networkId,
        networkScope: input.networkScope,
        ownsRequestedNetwork: false,
        triggerIntentNetworkIds,
      });
    },
    getNetworkContexts: async (ids) => {
      const contexts: Record<string, string> = {};
      await Promise.all(ids.map(async (id) => {
        const network = await measure('discovery.retrieval.getNetwork', () => database.getNetwork(id), { networkId: id });
        const context = network ? renderDiscoveryNetworkContext(network) : undefined;
        if (context) contexts[id] = context;
      }));
      return contexts;
    },
  };
  const evaluator = new TypeSafeIntentEvaluator(apiKey);
  return new CandidateDiscovery({
    database: discoveryData,
    evaluator: {
      evaluate: (input, options) => measure('discovery.evaluation', () => evaluator.evaluate(input, options), { pairCount: 1 }, options?.signal),
    },
  });
}
