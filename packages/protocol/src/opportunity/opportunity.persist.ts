/**
 * Shared persist phase for opportunity creation: enrichOrCreate → create (or create+expire) → optional chat injection.
 * Used by the opportunity graph persist node and by the manual opportunity service for consistency.
 */

import type { CreateOpportunityData, Opportunity, OpportunityStatus } from '../shared/interfaces/database.interface.js';
import type { Embedder } from '../shared/interfaces/embedder.interface.js';
import type { EnricherDatabase } from './opportunity.enricher.js';
import { enrichOrCreate } from './opportunity.enricher.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('OpportunityPersist');

export type PersistOpportunityDatabase = EnricherDatabase & {
  createOpportunity(data: CreateOpportunityData): Promise<Opportunity>;
  updateOpportunityStatus(id: string, status: OpportunityStatus): Promise<void | Opportunity | null>;
  createOpportunityAndExpireIds?(
    data: CreateOpportunityData,
    expireIds: string[]
  ): Promise<{ created: Opportunity; expired: Opportunity[] }>;
  /** Optional: used to populate expired list in non-atomic path. */
  getOpportunity?(id: string): Promise<Opportunity | null>;
};

export interface PersistOpportunitiesParams {
  database: PersistOpportunityDatabase;
  embedder: Embedder;
  items: CreateOpportunityData[];
  injectChat?: (opportunity: Opportunity) => Promise<unknown>;
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
  const { database, embedder, items, injectChat } = params;
  const created: Opportunity[] = [];
  const expired: Opportunity[] = [];
  const errors: PersistOpportunitiesError[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const data = items[itemIndex];
    try {
      const enrichment = await enrichOrCreate(database, embedder, data);
      const toCreate = enrichment.data;
      if (enrichment.enriched) {
        toCreate.status = enrichment.resolvedStatus;
      }

      if (
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
          logger.warn('[PersistOpportunities] Chat injection failed', { opportunityId: lastCreated.id, error: err });
        });
      }
    } catch (err) {
      errors.push({ itemIndex, error: err });
      logger.warn('[PersistOpportunities] Item failed', { itemIndex, error: err });
    }
  }

  return { created, expired, ...(errors.length > 0 ? { errors } : {}) };
}
