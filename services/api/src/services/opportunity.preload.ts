import type { Opportunity, OpportunityStatus } from '@indexnetwork/protocol';
import {
  buildApiChatCardPresentationCacheKey,
  buildRadarCardPresentationCacheKey,
  gatherPresenterContext,
  getPrimaryActionLabel,
  type PresenterDatabase,
} from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { isOpportunityPresentationCacheable } from './opportunity.presentation';

const logger = log.service.from('OpportunityService.preload');
const CHAT_CACHE_TTL = 24 * 60 * 60;

interface PreloadDeps {
  db: PresenterDatabase & { getUser(userId: string): Promise<{ name?: string | null; avatar?: string | null } | null> };
  cache: { set(key: string, value: unknown, options?: { ttl?: number }): Promise<void> };
  presenter: {
    present(input: Awaited<ReturnType<typeof gatherPresenterContext>>): Promise<{
      headline: string;
      personalizedSummary: string;
      suggestedAction?: string;
      mutualIntentsLabel?: string;
      isFallback?: boolean;
    }>;
  };
  gatherContext?: typeof gatherPresenterContext;
}

/**
 * Warm presenter Redis keys for cacheable statuses without blocking write handlers.
 */
export async function preloadOpportunityPresentation(
  deps: PreloadDeps,
  opportunity: Opportunity,
  viewerIds: string[],
  intentId?: string,
): Promise<void> {
  if (!isOpportunityPresentationCacheable(opportunity.status)) return;

  const gather = deps.gatherContext ?? gatherPresenterContext;
  const uniqueViewerIds = [...new Set(viewerIds.filter(Boolean))];

  await Promise.all(uniqueViewerIds.map(async (viewerId) => {
    try {
      const presenterInput = await gather(deps.db, opportunity, viewerId);
      presenterInput.opportunityStatus = opportunity.status;
      const presented = await deps.presenter.present(presenterInput);

      if (opportunity.status === 'accepted') {
        const peer = opportunity.actors.find((actor) => actor.userId !== viewerId);
        const peerUser = peer ? await deps.db.getUser(peer.userId) : null;
        await deps.cache.set(
          buildApiChatCardPresentationCacheKey(opportunity.id, viewerId),
          {
            opportunityId: opportunity.id,
            headline: presented.headline,
            personalizedSummary: presented.personalizedSummary,
            narratorRemark: '',
            peerName: peerUser?.name ?? 'Someone',
            peerAvatar: peerUser?.avatar ?? null,
            acceptedAt: opportunity.updatedAt instanceof Date
              ? opportunity.updatedAt.toISOString()
              : (opportunity.updatedAt ?? null),
          },
          { ttl: CHAT_CACHE_TTL },
        );
      }

      if (presented.isFallback) return;

      const counterpart = opportunity.actors.find((actor) => actor.userId !== viewerId);
      const viewerActor = opportunity.actors.find((actor) => actor.userId === viewerId);
      const counterpartUser = counterpart ? await deps.db.getUser(counterpart.userId) : null;
      await deps.cache.set(
        buildRadarCardPresentationCacheKey(opportunity.id, opportunity.status, viewerId, intentId),
        {
          opportunityId: opportunity.id,
          status: opportunity.status,
          createdAt: opportunity.createdAt instanceof Date
            ? opportunity.createdAt.toISOString()
            : opportunity.createdAt,
          userId: counterpart?.userId ?? '',
          name: counterpartUser?.name ?? 'Unknown',
          avatar: counterpartUser?.avatar ?? null,
          mainText: presented.personalizedSummary,
          cta: presented.suggestedAction ?? presented.headline,
          headline: presented.headline,
          primaryActionLabel: getPrimaryActionLabel(viewerActor?.role ?? 'party'),
          secondaryActionLabel: 'Skip',
          mutualIntentsLabel: presented.mutualIntentsLabel ?? '',
          viewerRole: viewerActor?.role,
        },
        { ttl: CHAT_CACHE_TTL },
      );
    } catch (error) {
      logger.warn('preloadOpportunityPresentation failed for viewer', {
        opportunityId: opportunity.id,
        viewerId,
        status: opportunity.status as OpportunityStatus,
        error,
      });
    }
  }));
}

/**
 * Fire-and-forget wrapper used on write paths.
 */
export function scheduleOpportunityPresentationPreload(
  deps: PreloadDeps,
  opportunity: Opportunity,
  viewerIds: string[],
  intentId?: string,
): void {
  void preloadOpportunityPresentation(deps, opportunity, viewerIds, intentId).catch((error) => {
    logger.warn('preloadOpportunityPresentation batch failed', {
      opportunityId: opportunity.id,
      error,
    });
  });
}
