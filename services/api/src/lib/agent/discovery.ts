import type { DiscoveryClient } from '@indexnetwork/agent';
import { CandidateDiscovery, type CandidateDiscoveryData } from '@indexnetwork/discovery';
import { decideNegotiationOpening, pairKeyOf, resolveDiscoveryNetworkScope, renderDiscoveryNetworkContext } from '@indexnetwork/protocol';

import type { AgentSessionDatabaseAdapter } from '../../adapters/agent-session.database.adapter';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { negotiationDatabaseAdapter } from '../../adapters/negotiation.database.adapter';

/**
 * Creates a host discovery client bound to the current principal and intent execution.
 *
 * Provides authorized explicit-query candidate retrieval through `@indexnetwork/discovery`.
 * Search results exist only within the current activation turn and are never persisted.
 *
 * @param store - Principal-bound execution store.
 * @returns Discovery client port exposing scope resolution and counterparty retrieval.
 */
export function createDiscoveryClient(store: AgentSessionDatabaseAdapter): DiscoveryClient {
  const database = new ChatDatabaseAdapter();
  const { userId, intentId } = store.execution;

  const discoveryData: CandidateDiscoveryData = {
    getNetworkMemberships: (id) => database.getNetworkMemberships(id),
    getActiveIntents: (id) => database.getActiveIntents(id),
    getProfile: (id) => database.getProfile(id),
    getNetworkIdsForIntent: (id) => database.getNetworkIdsForIntent(id),
    getActiveNetworkMembershipPairs: (pairs) => database.getActiveNetworkMembershipPairs(pairs),
    getRecentlyRejectedOpportunityCounterparties: (id, candidates, window) =>
      database.getRecentlyRejectedOpportunityCounterparties(id, candidates, window),

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
      await Promise.all(
        ids.map(async (id) => {
          const network = await database.getNetwork(id);
          const renderedContext = network ? renderDiscoveryNetworkContext(network) : undefined;
          if (renderedContext) {
            contexts[id] = renderedContext;
          }
        }),
      );
      return contexts;
    },
  };

  const embedder = new EmbedderAdapter();
  const discovery = new CandidateDiscovery({
    database: discoveryData,
    embedder,
    search: embedder,
  });

  return {
    scope: async (signal) => {
      signal.throwIfAborted();
      const scope = await store.discoveryScope();
      signal.throwIfAborted();

      if (!scope) {
        throw new Error('Intent is no longer available for discovery.');
      }
      return scope;
    },

    discoverCounterparties: async (input, scopeVersion, signal) => {
      signal.throwIfAborted();

      const scope = await store.discoveryScope();
      const isScopeValid =
        scope &&
        scope.version === scopeVersion &&
        input.networkIds.length > 0 &&
        input.networkIds.every((id) => scope.networkIds.includes(id));

      if (!isScopeValid) {
        throw new Error('Intent or search scope is no longer available.');
      }

      const result = await discovery.discover(
        { userId, triggerIntentId: intentId, ...input },
        { signal },
      );

      signal.throwIfAborted();

      // Ensure scope did not drift while embedding or vector search was running
      const currentScope = await store.discoveryScope();
      if (!currentScope || currentScope.version !== scope.version) {
        throw new Error('Intent or assignments changed during search.');
      }

      await store.markSearched(result.networkIds);
      signal.throwIfAborted();

      return result;
    },

    openNegotiation: async (candidate, reasoning, _brief, signal) => {
      signal.throwIfAborted();
      const scope = await store.discoveryScope();
      if (!scope || !scope.networkIds.includes(candidate.networkId) || candidate.candidateUserId === userId) {
        throw new Error('Intent or match scope is no longer available.');
      }
      const pairKey = pairKeyOf(candidate.networkId, intentId, candidate.candidateIntentId);
      const [opened] = await negotiationDatabaseAdapter.openCounterparties(
        [
          {
            pairKey,
            networkId: candidate.networkId,
            intentA: intentId,
            intentB: candidate.candidateIntentId,
            userA: userId,
            userB: candidate.candidateUserId,
            score: candidate.similarity * 100,
            reasoning,
            evidence: [
              {
                kind: 'query_intent',
                networkId: candidate.networkId,
                candidateIntentId: candidate.candidateIntentId,
                payload: candidate.candidatePayload,
                score: candidate.similarity,
              },
            ],
            detection: { source: 'personal_agent', createdBy: userId },
          },
        ],
        decideNegotiationOpening,
      );

      const opportunity = opened ?? (await negotiationDatabaseAdapter.findByPairKey(pairKey));
      if (!opportunity) return { status: 'unavailable' };
      return { status: 'opened', opportunityId: opportunity.opportunityId };
    },
  };
}
