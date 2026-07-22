/**
 * Shared persist phase for opportunity creation: enrichOrCreate → create (or create+expire) → optional chat injection.
 * Used by the opportunity graph persist node and by the manual opportunity service for consistency.
 */

import type { CreateOpportunityData, IntentScopedOpportunityPersistenceResult, Opportunity, OpportunityDedupConflict, OpportunityNetworkEligibility, OpportunityStatus } from '../shared/interfaces/database.interface.js';
import type { Embedder } from '../shared/interfaces/embedder.interface.js';
import type { EnricherDatabase } from './opportunity.enricher.js';
import { enrichOrCreate } from './opportunity.enricher.js';
import { normalizeCreateOpportunityActorIntents } from './opportunity.actor.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('OpportunityPersist');

export type PersistOpportunityDatabase = EnricherDatabase & {
  createOpportunity(data: CreateOpportunityData): Promise<Opportunity>;
  createOpportunityIfNetworkEligible?(
    data: CreateOpportunityData,
    eligibility: OpportunityNetworkEligibility,
  ): Promise<Opportunity | null>;
  updateOpportunityStatus(id: string, status: OpportunityStatus): Promise<void | Opportunity | null>;
  createOpportunityAndExpireIds?(
    data: CreateOpportunityData,
    expireIds: string[]
  ): Promise<{ created: Opportunity; expired: Opportunity[] }>;
  createOpportunityAndExpireIdsIfNetworkEligible?(
    data: CreateOpportunityData,
    expireIds: string[],
    eligibility: OpportunityNetworkEligibility,
  ): Promise<{ created: Opportunity; expired: Opportunity[] } | null>;
  persistIntentScopedOpportunityIfNetworkEligible?(
    data: CreateOpportunityData,
    expireIds: string[],
    eligibility: OpportunityNetworkEligibility & { triggerIntentId: string },
    dedupWindowMs: number,
  ): Promise<IntentScopedOpportunityPersistenceResult | null>;
  /** Optional: used to populate expired list in non-atomic path. */
  getOpportunity?(id: string): Promise<Opportunity | null>;
};

export interface PersistOpportunitiesParams {
  database: PersistOpportunityDatabase;
  embedder: Embedder;
  items: CreateOpportunityData[];
  injectChat?: (opportunity: Opportunity) => Promise<unknown>;
  /** Require adapter-level membership/assignment locks for discovery-created rows. */
  networkEligibility?: OpportunityNetworkEligibility;
  /** Scope dedup/enrichment and the final atomic re-check to one owned intent. */
  intentDedupScope?: { triggerIntentId: string; dedupWindowMs: number };
}

export interface PersistOpportunitiesError {
  itemIndex: number;
  error: unknown;
}

export interface PersistOpportunitiesConflict extends OpportunityDedupConflict {
  itemIndex: number;
  finalAtomic: true;
}

export interface PersistOpportunitiesResult {
  created: Opportunity[];
  expired: Opportunity[];
  conflicts: PersistOpportunitiesConflict[];
  errors?: PersistOpportunitiesError[];
}

/**
 * Persist one or more opportunities: enrich (merge overlapping), create, expire replaced, optional chat injection.
 * When the database has createOpportunityAndExpireIds and enrichment produced expireIds, uses it for atomic create+expire.
 * Returns both created and expired so callers can emit events (e.g. manual service).
 */
export async function persistOpportunities(params: PersistOpportunitiesParams): Promise<PersistOpportunitiesResult> {
  const { database, embedder, items, injectChat, networkEligibility, intentDedupScope } = params;
  const created: Opportunity[] = [];
  const expired: Opportunity[] = [];
  const conflicts: PersistOpportunitiesConflict[] = [];
  const errors: PersistOpportunitiesError[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const data = items[itemIndex];
    try {
      const normalizedData = normalizeCreateOpportunityActorIntents(data);
      if (
        intentDedupScope
        && intentDedupScope.triggerIntentId !== networkEligibility?.triggerIntentId
      ) {
        throw new Error('Intent-scoped dedup trigger must match network eligibility');
      }
      const enrichment = await enrichOrCreate(database, embedder, normalizedData, intentDedupScope && networkEligibility
        ? {
            ownedIntentScope: {
              triggerIntentId: intentDedupScope.triggerIntentId,
              ownerUserId: networkEligibility.ownerUserId,
            },
          }
        : undefined);
      const toCreate = normalizeCreateOpportunityActorIntents(enrichment.data);
      if (enrichment.enriched) {
        toCreate.status = enrichment.resolvedStatus;
      }

      if (intentDedupScope) {
        if (!networkEligibility?.triggerIntentId) {
          throw new Error('Intent-scoped dedup requires trigger-intent network eligibility');
        }
        if (!database.persistIntentScopedOpportunityIfNetworkEligible) {
          throw new Error('Intent-scoped atomic persistence is required for owned-intent discovery');
        }
        const result = await database.persistIntentScopedOpportunityIfNetworkEligible(
          toCreate,
          enrichment.enriched ? enrichment.expiredIds : [],
          { ...networkEligibility, triggerIntentId: networkEligibility.triggerIntentId },
          intentDedupScope.dedupWindowMs,
        );
        if (!result) continue;
        if ('conflict' in result) {
          conflicts.push({ itemIndex, finalAtomic: true, ...result.conflict });
          continue;
        }
        created.push(result.created);
        expired.push(...result.expired);
      } else if (networkEligibility) {
        if (enrichment.enriched && enrichment.expiredIds.length > 0) {
          if (!database.createOpportunityAndExpireIdsIfNetworkEligible) {
            throw new Error('Network-eligible create+expire is required for discovery persistence');
          }
          const result = await database.createOpportunityAndExpireIdsIfNetworkEligible(
            toCreate,
            enrichment.expiredIds,
            networkEligibility,
          );
          if (!result) continue;
          created.push(result.created);
          expired.push(...result.expired);
        } else {
          if (!database.createOpportunityIfNetworkEligible) {
            throw new Error('Network-eligible create is required for discovery persistence');
          }
          const c = await database.createOpportunityIfNetworkEligible(toCreate, networkEligibility);
          if (!c) continue;
          created.push(c);
        }
      } else if (
        database.createOpportunityAndExpireIds &&
        enrichment.enriched &&
        enrichment.expiredIds.length > 0
      ) {
        const result = await database.createOpportunityAndExpireIds(toCreate, enrichment.expiredIds);
        created.push(result.created);
        expired.push(...result.expired);
      } else {
        const c = await database.createOpportunity(toCreate);
        created.push(c);
        if (enrichment.enriched && enrichment.expiredIds.length > 0) {
          for (const id of enrichment.expiredIds) {
            await database.updateOpportunityStatus(id, 'expired');
          }
          if (database.getOpportunity) {
            for (const id of enrichment.expiredIds) {
              const opp = await database.getOpportunity(id);
              if (opp) expired.push(opp);
            }
          }
        }
      }

      const lastCreated = created[created.length - 1];
      if (lastCreated?.status === 'pending' && injectChat) {
        await injectChat(lastCreated).catch((err) => {
          logger.warn('Chat injection failed', { opportunityId: lastCreated.id, error: err });
        });
      }
    } catch (err) {
      errors.push({ itemIndex, error: err });
      logger.warn('Item failed', { itemIndex, error: err });
    }
  }

  return { created, expired, conflicts, ...(errors.length > 0 ? { errors } : {}) };
}
