import type { CompositeToolDatabase, Opportunity, OpportunityStatus } from '../../platform/database.js';
import { deduplicateByPerson, selectByComposition } from './opportunity.utils.js';

const ACTIONABLE_FEED_STATUSES: OpportunityStatus[] = ['pending'];
const FEED_FETCH_LIMIT = 30;

export interface OpportunityFeedSelectionInput {
  reader: Pick<CompositeToolDatabase, 'getOpportunitiesForUser'>;
  viewerId: string;
  networkId?: string;
  intentScope: { scopeType?: 'intent'; scopeId?: string };
  displayLimit: number;
  warn: (message: string, data: Record<string, unknown>) => void;
}

export interface OpportunityFeedSelection {
  opportunities: Opportunity[];
  dedupedCount: number;
  skippedIds: string[];
  fetchedCount: number;
}

/**
 * Selects actionable opportunities for the chat/feed surface. The caller actor
 * check is deliberately the first post-read filter so non-actor rows cannot
 * affect selection or downstream profile/presentation reads.
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

  const deduped = deduplicateByPerson(callerScoped, args.viewerId);
  const selected = deduped.length > 0
    ? selectByComposition(deduped, args.viewerId)
    : deduped;
  return {
    opportunities: selected.slice(0, args.displayLimit),
    dedupedCount: deduped.length,
    skippedIds,
    fetchedCount: fetched.length,
  };
}
