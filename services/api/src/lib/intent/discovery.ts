import { CandidateDiscovery, TypeSafeIntentEvaluator, type CandidateDiscoveryData } from '@indexnetwork/discovery';
import { resolveDiscoveryNetworkScope, renderDiscoveryNetworkContext } from '@indexnetwork/protocol';

import { ChatDatabaseAdapter } from '../../adapters/database.adapter';

/**
 * Compose the same exhaustive intent-pair matcher for hosted and external agents.
 * @returns Authorized database reads and the server-side TypeSafe evaluator.
 * @throws When TYPESAFE_API_KEY is missing; provider and database errors propagate from discovery.
 */
export function createIntentDiscovery(): CandidateDiscovery {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey?.trim()) throw new Error('TYPESAFE_API_KEY is required for intent matching.');
  const database = new ChatDatabaseAdapter();
  const discoveryData: CandidateDiscoveryData = {
    getNetworkMemberships: (id) => database.getNetworkMemberships(id),
    getActiveIntents: (id) => database.getMatchReadyIntents(id),
    getProfile: (id) => database.getProfile(id),
    getNetworkIdsForIntent: (id) => database.getNetworkIdsForIntent(id),
    getActiveNetworkMembershipPairs: (pairs) => database.getActiveNetworkMembershipPairs(pairs),
    listIntentCandidates: (input, options) => database.listIntentCandidates(input, options),
    getDiscoveryScope: async (input) => {
      const triggerIntentNetworkIds = await database.getNetworkIdsForIntent(input.triggerIntentId!);
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
        const network = await database.getNetwork(id);
        const context = network ? renderDiscoveryNetworkContext(network) : undefined;
        if (context) contexts[id] = context;
      }));
      return contexts;
    },
  };
  return new CandidateDiscovery({ database: discoveryData, evaluator: new TypeSafeIntentEvaluator(apiKey) });
}
