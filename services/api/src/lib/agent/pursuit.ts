import type { PursuitClient } from '@indexnetwork/agent';
import { Discovery, type DiscoveryData } from '@indexnetwork/discovery';
import { decideNegotiationOpening, pairKeyOf, resolveDiscoveryNetworkScope, renderDiscoveryNetworkContext } from '@indexnetwork/protocol';

import type { AgentSessionDatabaseAdapter } from '../../adapters/agent-session.database.adapter';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { negotiationDatabaseAdapter } from '../../adapters/negotiation.database.adapter';
import { log } from '../log';

/** Inject authorized retrieval and atomic protocol opening into the existing principal runtime. */
export function createPursuitClient(store: AgentSessionDatabaseAdapter, payload: string): PursuitClient {
  const database = new ChatDatabaseAdapter();
  const { userId, intentId } = store.execution;
  const data: DiscoveryData = {
    getNetworkMemberships: id => database.getNetworkMemberships(id),
    getActiveIntents: id => database.getActiveIntents(id),
    getProfile: id => database.getProfile(id),
    getNetworkIdsForIntent: id => database.getNetworkIdsForIntent(id),
    getActiveNetworkMembershipPairs: pairs => database.getActiveNetworkMembershipPairs(pairs),
    getRecentlyRejectedOpportunityCounterparties: (id, candidates, window) => database.getRecentlyRejectedOpportunityCounterparties(id, candidates, window),
    getDiscoveryScope: async input => resolveDiscoveryNetworkScope({
      userNetworkIds: input.userNetworks, networkId: input.networkId, networkScope: input.networkScope,
      ownsRequestedNetwork: false, triggerIntentNetworkIds: await database.getNetworkIdsForIntent(input.triggerIntentId),
    }),
    getNetworkContexts: async ids => {
      const contexts: Record<string, string> = {};
      await Promise.all(ids.map(async id => {
        const network = await database.getNetwork(id);
        const context = network && renderDiscoveryNetworkContext(network);
        if (context) contexts[id] = context;
      }));
      return contexts;
    },
  };
  const embedder = new EmbedderAdapter();
  const discovery = new Discovery({ database: data, search: embedder, embedder });
  const logger = log.job.from('AgentPursuit');
  return {
    discoverCounterparties: async (input, signal) => {
      signal.throwIfAborted();
      const scope = await store.pursuitScope(payload);
      if (!scope || !input.networkIds.length || input.networkIds.some(id => !scope.networkIds.includes(id))) throw new Error('Intent or search scope is no longer available.');
      const result = await discovery.discover({ userId, triggerIntentId: intentId, searchQuery: input.query,
        networkScope: input.networkIds, minSimilarity: input.minSimilarity }, { signal, logger });
      if (result.error) throw new Error(result.error);
      signal.throwIfAborted();
      const current = await store.pursuitScope(payload);
      if (!current || current.version !== scope.version) throw new Error('Intent or assignments changed during search.');
      await store.markSearched(result.networkIds);
      return result;
    },
    openNegotiation: async (candidate, reasoning, signal) => {
      signal.throwIfAborted();
      const scope = await store.pursuitScope(payload);
      if (!scope || !scope.networkIds.includes(candidate.networkId) || candidate.candidateUserId === userId) throw new Error('Intent or match scope is no longer available.');
      const pairKey = pairKeyOf(candidate.networkId, intentId, candidate.candidateIntentId);
      const [opened] = await negotiationDatabaseAdapter.openCounterparties([{
        pairKey, networkId: candidate.networkId, intentA: intentId, intentB: candidate.candidateIntentId,
        userA: userId, userB: candidate.candidateUserId, score: candidate.similarity * 100, reasoning,
        evidence: [{ kind: 'query_intent', networkId: candidate.networkId, candidateIntentId: candidate.candidateIntentId,
          payload: candidate.candidatePayload, score: candidate.similarity }],
        detection: { source: 'personal_agent', createdBy: userId },
      }], decideNegotiationOpening, store.execution);
      // Pair identity is idempotent, including a committed opening whose response was lost.
      return opened ?? negotiationDatabaseAdapter.findByPairKey(pairKey);
    },
  };
}
