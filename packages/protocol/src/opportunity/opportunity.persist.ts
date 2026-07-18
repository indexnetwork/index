/**
 * Shared persist phase for opportunity creation: enrichOrCreate → create (or create+expire) → optional chat injection.
 * Used by the opportunity graph persist node and by the manual opportunity service for consistency.
 */

import type { CreateOpportunityData, Opportunity, OpportunityNetworkEligibility, OpportunityStatus } from '../shared/interfaces/database.interface.js';
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
}

export interface PersistOpportunitiesError {
  itemIndex: number;
  error: unknown;
}

export interface PersistOpportunitiesResult {
  created: Opportunity[];
  expired: Opportunity[];
  errors?: PersistOpportunitiesError[];
}

/**
 * Persist one or more opportunities: enrich (merge overlapping), create, expire replaced, optional chat injection.
 * When the database has createOpportunityAndExpireIds and enrichment produced expireIds, uses it for atomic create+expire.
 * Returns both created and expired so callers can emit events (e.g. manual service).
 */
export async function persistOpportunities(params: PersistOpportunitiesParams): Promise<PersistOpportunitiesResult> {
  const { database, embedder, items, injectChat, networkEligibility } = params;
  const created: Opportunity[] = [];
  const expired: Opportunity[] = [];
  const errors: PersistOpportunitiesError[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const data = items[itemIndex];
    try {
      const normalizedData = normalizeCreateOpportunityActorIntents(data);
      const enrichment = await enrichOrCreate(database, embedder, normalizedData);
      const toCreate = normalizeCreateOpportunityActorIntents(enrichment.data);
      if (enrichment.enriched) {
        toCreate.status = enrichment.resolvedStatus;
      }

      if (networkEligibility) {
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

  return { created, expired, ...(errors.length > 0 ? { errors } : {}) };
}
