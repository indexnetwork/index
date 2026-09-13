import type { PursuitClient } from '@indexnetwork/agent';
import { Discovery, type DiscoveryData } from '@indexnetwork/discovery';
import { decideNegotiationOpening, pairKeyOf, resolveDiscoveryNetworkScope, renderDiscoveryNetworkContext } from '@indexnetwork/protocol';

import type { AgentSessionDatabaseAdapter } from '../../adapters/agent-session.database.adapter';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { negotiationDatabaseAdapter } from '../../adapters/negotiation.database.adapter';
import { log } from '../log';

/** Inject authorized retrieval and atomic protocol opening into the existing principal runtime. */
export function createPursuitClient(
  store: AgentSessionDatabaseAdapter,
  payload: string,
  runDatabase: <T>(operation: () => Promise<T>) => Promise<T>,
): PursuitClient {
  const database = new ChatDatabaseAdapter();
  const { userId, intentId } = store.execution;
  const data: DiscoveryData = {
    getNetworkMemberships: id => runDatabase(() => database.getNetworkMemberships(id)),
    getActiveIntents: id => runDatabase(() => database.getActiveIntents(id)),
    getProfile: id => runDatabase(() => database.getProfile(id)),
    getNetworkIdsForIntent: id => runDatabase(() => database.getNetworkIdsForIntent(id)),
    getActiveNetworkMembershipPairs: pairs => runDatabase(() => database.getActiveNetworkMembershipPairs(pairs)),
    getRecentlyRejectedOpportunityCounterparties: (id, candidates, window) => runDatabase(() => database.getRecentlyRejectedOpportunityCounterparties(id, candidates, window)),
    getDiscoveryScope: async input => resolveDiscoveryNetworkScope({
      userNetworkIds: input.userNetworks, networkId: input.networkId, networkScope: input.networkScope,
      ownsRequestedNetwork: false, triggerIntentNetworkIds: await runDatabase(() => database.getNetworkIdsForIntent(input.triggerIntentId)),
    }),
    getNetworkContexts: async ids => {
      const contexts: Record<string, string> = {};
      await Promise.all(ids.map(async id => {
        const network = await runDatabase(() => database.getNetwork(id));
        const context = network && renderDiscoveryNetworkContext(network);
        if (context) contexts[id] = context;
      }));
      return contexts;
    },
  };
  const embedder = new EmbedderAdapter();
  // Share the host's database capacity without holding a slot during embedding requests.
  const discovery = new Discovery({ database: data, embedder,
    search: { searchIntentCandidates: (embedding, options) => runDatabase(() => embedder.searchIntentCandidates(embedding, options)) },
  });
  const logger = log.job.from('AgentPursuit');
  return {
    discoverCounterparties: async (input, signal) => {
      signal.throwIfAborted();
      const scope = await runDatabase(() => store.pursuitScope(payload));
      if (!scope || !input.networkIds.length || input.networkIds.some(id => !scope.networkIds.includes(id))) throw new Error('Intent or search scope is no longer available.');
      const result = await discovery.discover({ userId, triggerIntentId: intentId, searchQuery: input.query,
        networkScope: input.networkIds, minSimilarity: input.minSimilarity }, { signal, logger });
      if (result.error) throw new Error(result.error);
      signal.throwIfAborted();
      const current = await runDatabase(() => store.pursuitScope(payload));
      if (!current || current.version !== scope.version) throw new Error('Intent or assignments changed during search.');
      await runDatabase(() => store.markSearched(result.networkIds));
      return result;
    },
    openNegotiation: async (candidate, reasoning, signal) => {
      signal.throwIfAborted();
      const scope = await runDatabase(() => store.pursuitScope(payload));
      if (!scope || !scope.networkIds.includes(candidate.networkId) || candidate.candidateUserId === userId) throw new Error('Intent or match scope is no longer available.');
      const pairKey = pairKeyOf(candidate.networkId, intentId, candidate.candidateIntentId);
      const [opened] = await runDatabase(() => negotiationDatabaseAdapter.openCounterparties([{
        pairKey, networkId: candidate.networkId, intentA: intentId, intentB: candidate.candidateIntentId,
        userA: userId, userB: candidate.candidateUserId, score: candidate.similarity * 100, reasoning,
        evidence: [{ kind: 'query_intent', networkId: candidate.networkId, candidateIntentId: candidate.candidateIntentId,
          payload: candidate.candidatePayload, score: candidate.similarity }],
        detection: { source: 'personal_agent', createdBy: userId },
      }], decideNegotiationOpening, store.execution));
      // Pair identity is idempotent, including a committed opening whose response was lost.
      return opened ?? runDatabase(() => negotiationDatabaseAdapter.findByPairKey(pairKey));
    },
  };
}
