import type { Cache } from '../shared/interfaces/cache.interface.js';
import type { ChatGraphCompositeDatabase, Opportunity } from '../shared/interfaces/database.interface.js';
import type { CandidateMatch } from './opportunity.state.js';
import type { DiscoverDebugStep, DiscoverResult } from './opportunity.discover.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('OpportunityDiscover');

export interface DiscoveryContinuationCacheSession {
  candidates: CandidateMatch[];
}

export interface DiscoveryContinuationGraphResult {
  trace?: Array<{ node: string; detail?: string; data?: Record<string, unknown> }>;
  error?: string;
  remainingCandidates?: CandidateMatch[];
  opportunities?: Opportunity[];
}

interface DiscoveryContinuationFinalizationInput {
  result: DiscoveryContinuationGraphResult;
  cache: Pick<Cache, 'set' | 'delete'>;
  cacheKey: string;
  cached: DiscoveryContinuationCacheSession;
  userId: string;
  discoveryId: string;
  database: Pick<ChatGraphCompositeDatabase, 'getOpportunitiesByIds'>;
  enrich: (
    opportunities: Opportunity[],
    debugSteps: DiscoverDebugStep[],
  ) => Promise<NonNullable<DiscoverResult['opportunities']>>;
}

/**
 * Finalizes a successful continuation graph result without owning session
 * lookup, scope admission, or graph invocation. Cache failures are advisory;
 * lifecycle refresh and presentation use the graph result regardless.
 */
export async function finalizeDiscoveryContinuation(
  args: DiscoveryContinuationFinalizationInput,
): Promise<DiscoverResult> {
  const debugSteps: DiscoverDebugStep[] = [];
  for (const trace of args.result.trace || []) {
    debugSteps.push({
      step: trace.node,
      detail: trace.detail,
      ...(trace.data ? { data: trace.data } : {}),
    });
  }

  if (args.result.error) {
    logger.warn('continueDiscovery graph returned error', { error: args.result.error });
    return {
      found: false,
      count: 0,
      message: 'Discovery continuation failed. Please start a new search.',
      debugSteps,
    };
  }

  const remaining = args.result.remainingCandidates || [];
  let pagination: DiscoverResult['pagination'] | undefined;
  try {
    if (remaining.length > 0) {
      await args.cache.set(args.cacheKey, {
        ...args.cached,
        candidates: remaining,
      }, { ttl: 1800 });
      pagination = {
        discoveryId: args.discoveryId,
        evaluated: args.cached.candidates.length - remaining.length,
        remaining: remaining.length,
      };
    } else {
      await args.cache.delete(args.cacheKey);
    }
  } catch (cacheErr) {
    logger.warn('Failed to update discovery pagination cache', {
      userId: args.userId,
      discoveryId: args.discoveryId,
      error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
    });
  }

  const opportunities = Array.isArray(args.result.opportunities) ? args.result.opportunities : [];
  const refreshed = opportunities.length > 0
    ? await args.database.getOpportunitiesByIds(opportunities.map((opportunity) => opportunity.id))
    : [];
  const refreshedById = new Map(refreshed.map((opportunity) => [opportunity.id, opportunity] as const));
  const currentOpportunities = opportunities.map((opportunity) =>
    refreshedById.get(opportunity.id) ?? opportunity);

  if (currentOpportunities.length === 0) {
    return {
      found: false,
      count: 0,
      message: 'No more matching opportunities found in the remaining candidates.',
      debugSteps,
      pagination,
    };
  }

  const enriched = await args.enrich(currentOpportunities, debugSteps);
  return {
    found: true,
    count: enriched.length,
    opportunities: enriched,
    debugSteps,
    pagination,
  };
}
