import type { DeliveryLedger } from '../../platform/runtime/delivery-ledger.js';
import type { ChatGraphCompositeDatabase, Opportunity, OpportunityStatus } from '../../platform/database.js';
import { deduplicateByPerson, selectByComposition, selectDigestCandidates, type DigestDeliveredRow } from './opportunity.utils.js';

const ACTIONABLE_FEED_STATUSES: OpportunityStatus[] = ['draft', 'pending', 'latent'];
const FEED_FETCH_LIMIT = 30;
const ACCEPTED_SUPPRESSION_FETCH_LIMIT = 200;

export interface OpportunityFeedSelectionInput {
  reader: Pick<ChatGraphCompositeDatabase, 'getOpportunitiesForUser'>;
  deliveryLedger?: Pick<DeliveryLedger, 'getDeliveredOpportunities'>;
  viewerId: string;
  networkId?: string;
  intentScope: { scopeType?: 'intent'; scopeId?: string };
  isMcp: boolean;
  includeDigestMarkers?: boolean;
  displayLimit: number;
  warn: (message: string, data: Record<string, unknown>) => void;
}

export interface OpportunityFeedSelection {
  opportunities: Opportunity[];
  dedupedCount: number;
  skippedIds: string[];
  redeliveryIds: Set<string>;
  fetchedCount: number;
  isDigestMode: boolean;
}

/**
 * Selects actionable opportunities for the chat/feed surface. The caller actor
 * check is deliberately the first post-read filter so non-actor rows cannot
 * affect digest suppression, selection, or downstream profile/presentation reads.
 */
export async function selectOpportunityFeed(
  args: OpportunityFeedSelectionInput,
): Promise<OpportunityFeedSelection> {
  const fetched = await args.reader.getOpportunitiesForUser(args.viewerId, {
    networkId: args.networkId,
    ...args.intentScope,
    statuses: ACTIONABLE_FEED_STATUSES,
    limit: FEED_FETCH_LIMIT,
  });
  const skippedIds: string[] = [];
  const callerScoped = fetched.filter((opportunity) => {
    if (opportunity.actors.some((actor) => actor.userId === args.viewerId)) return true;
    args.warn('list_opportunities: skipping opportunity where caller is not an actor', {
      opportunityId: opportunity.id,
      viewerId: args.viewerId,
      actorUserIds: opportunity.actors
        .map((actor) => actor.userId)
        .filter((userId): userId is string => typeof userId === 'string'),
    });
    skippedIds.push(opportunity.id);
    return false;
  });

  const visible = callerScoped.filter((opportunity) => {
    if (opportunity.status !== 'latent') return true;
    return opportunity.actors.find((actor) => actor.userId === args.viewerId)?.role === 'introducer';
  });
  const deduped = deduplicateByPerson(visible, args.viewerId);
  const isDigestMode = args.isMcp === true && args.includeDigestMarkers === true;

  let digestPool = deduped;
  let redeliveryIds = new Set<string>();
  if (isDigestMode && deduped.length > 0) {
    const acceptedCounterpartIds = new Set<string>();
    try {
      const acceptedOpportunities = await args.reader.getOpportunitiesForUser(args.viewerId, {
        ...(args.networkId ? { networkId: args.networkId } : {}),
        ...args.intentScope,
        statuses: ['accepted'],
        limit: ACCEPTED_SUPPRESSION_FETCH_LIMIT,
      });
      for (const opportunity of acceptedOpportunities) {
        for (const actor of opportunity.actors) {
          if (actor.userId && actor.userId !== args.viewerId && actor.role !== 'introducer') {
            acceptedCounterpartIds.add(actor.userId);
          }
        }
      }
    } catch (err) {
      args.warn('digest suppression: failed to fetch accepted opportunities, skipping counterpart suppression', { err });
    }

    let deliveredRows: DigestDeliveredRow[] = [];
    if (args.deliveryLedger?.getDeliveredOpportunities) {
      try {
        const rows = await args.deliveryLedger.getDeliveredOpportunities({
          userId: args.viewerId,
          opportunityIds: deduped.map((opportunity) => opportunity.id),
        });
        deliveredRows = rows.map((row) => ({
          opportunityId: row.opportunityId,
          deliveredAtStatus: row.deliveredAtStatus,
          deliveredAt: row.deliveredAt instanceof Date ? row.deliveredAt : new Date(row.deliveredAt),
        }));
      } catch (err) {
        args.warn('digest suppression: failed to read delivery ledger, skipping shown-opportunity dedup', { err });
      }
    }

    const digestSelection = selectDigestCandidates(deduped, {
      viewerId: args.viewerId,
      acceptedCounterpartIds,
      deliveredRows,
    });
    digestPool = digestSelection.pool;
    redeliveryIds = digestSelection.redeliveryIds;
  }

  const selected = digestPool.length > 0
    ? selectByComposition(digestPool, args.viewerId)
    : digestPool;
  return {
    opportunities: selected.slice(0, args.displayLimit),
    dedupedCount: deduped.length,
    skippedIds,
    redeliveryIds,
    fetchedCount: fetched.length,
    isDigestMode,
  };
}
