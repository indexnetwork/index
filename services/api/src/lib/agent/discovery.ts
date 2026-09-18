import type { DiscoveryClient } from '@indexnetwork/agent';
import { CandidateDiscovery, type CandidateDiscoveryData } from '@indexnetwork/discovery';
import { decideNegotiationOpening, pairKeyOf, resolveDiscoveryNetworkScope, renderDiscoveryNetworkContext } from '@indexnetwork/protocol';
import { and, eq } from 'drizzle-orm';

import type { PrincipalRecordsDatabaseAdapter } from '../../adapters/principal-records.database.adapter';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { announceOpened, negotiationDatabaseAdapter, type OpenedNegotiation } from '../../adapters/negotiation.database.adapter';
import { intents, negotiations, opportunities } from '../../schemas/database.schema';

/**
 * Creates a host discovery client bound to the current principal and intent execution.
 *
 * Provides authorized explicit-query candidate retrieval through `@indexnetwork/discovery`.
 * Search results exist only within the current activation turn and are never persisted.
 *
 * @param store - Principal-bound execution store.
 * @returns Scope, retrieval and atomic delegated opening operations.
 */
export function createDiscoveryClient(store: PrincipalRecordsDatabaseAdapter): DiscoveryClient {
  const database = new ChatDatabaseAdapter();
  const { userId, intentId } = store.execution;

  const discoveryData: CandidateDiscoveryData = {
    getNetworkMemberships: (id) => database.getNetworkMemberships(id),
    getActiveIntents: (id) => database.getMatchReadyIntents(id),
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

    openNegotiation: async (request, signal) => {
      signal.throwIfAborted();
      const { target, source, reasoning } = request;
      const pairKey = pairKeyOf(target.networkId, intentId, target.intentId);
      let opened: OpenedNegotiation | undefined;
      const result = await store.openNegotiation(request, async (tx) => {
        const [currentTarget] = await tx.select({ payload: intents.payload }).from(intents)
          .where(eq(intents.id, target.intentId)).for('share');
        if (!currentTarget || currentTarget.payload !== target.payload) throw new Error('Candidate changed since selection; review again before opening.');
        let confidence: number;
        let evidence: unknown[];
        if (source.kind === 'search') {
          confidence = source.similarity;
          evidence = [{ kind: 'query_intent', networkId: target.networkId, candidateIntentId: target.intentId,
            payload: target.payload, score: source.similarity }];
        } else {
          if (source.negotiationId !== request.expectedLatestNegotiationId) throw new Error('Source session does not match the selected latest session.');
          const [previous] = await tx.select({ confidence: opportunities.confidence }).from(negotiations)
            .innerJoin(opportunities, eq(opportunities.id, negotiations.opportunityId))
            .where(and(eq(negotiations.id, source.negotiationId), eq(negotiations.pairKey, pairKey)));
          if (!previous) throw new Error('Source session does not belong to the selected pair.');
          confidence = Number(previous.confidence);
          evidence = [{ kind: 'previous_negotiation', negotiationId: source.negotiationId, confidence }];
        }
        const pair = await negotiationDatabaseAdapter.open(tx,
          {
            pairKey,
            networkId: target.networkId,
            intentA: intentId,
            intentB: target.intentId,
            userA: userId,
            userB: target.userId,
            score: confidence * 100,
            reasoning,
            evidence,
            detection: { source: 'personal_agent', createdBy: userId },
          }, decideNegotiationOpening, request);
        if (pair?.created) opened = pair.record;
        return pair ? { opportunityId: pair.record.opportunityId, created: pair.created } : null;
      }, signal);
      if (opened && result.status === 'opened') await announceOpened([opened]);
      return result;
    },
  };
}
