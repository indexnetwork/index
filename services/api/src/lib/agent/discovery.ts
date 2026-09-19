import type { DiscoveryClient } from '@indexnetwork/agent';
import { INTENT_MATCH_MODEL } from '@indexnetwork/discovery';
import { decideNegotiationOpening, pairKeyOf } from '@indexnetwork/protocol';
import { and, eq } from 'drizzle-orm';

import type { PrincipalRecordsDatabaseAdapter } from '../../adapters/principal-records.database.adapter';
import { announceOpened, negotiationDatabaseAdapter, type OpenedNegotiation } from '../../adapters/negotiation.database.adapter';
import { intents, negotiations, opportunities } from '../../schemas/database.schema';
import { createIntentDiscovery } from '../intent/discovery';

/**
 * Bind exhaustive TypeSafe matching and atomic delegated opening to one principal.
 * @param store - Principal-bound execution store.
 * @returns Authorized scope, scored pairs, and context-fenced opening operations.
 */
export function createDiscoveryClient(store: PrincipalRecordsDatabaseAdapter): DiscoveryClient {
  const { userId, intentId } = store.execution;
  const discovery = createIntentDiscovery();

  return {
    scope: async (signal) => {
      signal.throwIfAborted();
      const scope = await store.discoveryScope();
      signal.throwIfAborted();
      if (!scope) throw new Error('Intent is no longer available for matching.');
      return scope;
    },

    discoverCounterparties: async (input, scopeVersion, signal) => {
      signal.throwIfAborted();
      const scope = await store.discoveryScope();
      if (!scope || scope.version !== scopeVersion || !input.networkIds.length
        || input.networkIds.some((id) => !scope.networkIds.includes(id))) {
        throw new Error('Intent or matching scope is no longer available.');
      }
      const result = await discovery.discover({ userId, triggerIntentId: intentId, ...input }, { signal });
      signal.throwIfAborted();
      const currentScope = await store.discoveryScope();
      if (!currentScope || currentScope.version !== scope.version) {
        throw new Error('Intent or assignments changed during matching.');
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
        if (!currentTarget || currentTarget.payload !== target.payload) throw new Error('Counterparty intent changed after matching; evaluate it again before opening.');
        let confidence: number;
        let evidence: unknown[];
        if (source.kind === 'match') {
          confidence = source.probability;
          if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
            throw new Error('Automatic opening requires a finite TypeSafe match probability between 0 and 1.');
          }
          evidence = [{ kind: 'typesafe_intent_match', model: INTENT_MATCH_MODEL,
            matchId: source.matchId, networkId: target.networkId, candidateIntentId: target.intentId,
            probability: confidence }];
        } else {
          if (source.negotiationId !== request.expectedLatestNegotiationId) throw new Error('Source session does not match the selected latest session.');
          const [previous] = await tx.select({ confidence: opportunities.confidence }).from(negotiations)
            .innerJoin(opportunities, eq(opportunities.id, negotiations.opportunityId))
            .where(and(eq(negotiations.id, source.negotiationId), eq(negotiations.pairKey, pairKey)));
          if (!previous) throw new Error('Source session does not belong to the selected pair.');
          confidence = Number(previous.confidence);
          evidence = [{ kind: 'previous_negotiation', negotiationId: source.negotiationId, confidence }];
        }
        const pair = await negotiationDatabaseAdapter.open(tx, {
          pairKey, networkId: target.networkId, intentA: intentId, intentB: target.intentId,
          userA: userId, userB: target.userId, score: confidence * 100, reasoning, evidence,
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
