/** Cache namespace for opportunity presentation copy. Bump to invalidate copy safety changes. */
export const OPPORTUNITY_PRESENTATION_CACHE_VERSION = "v2";

export function buildRadarCardPresentationCacheKey(
  opportunityId: string,
  status: string,
  viewerId: string,
): string {
  return `radar:${OPPORTUNITY_PRESENTATION_CACHE_VERSION}:card:${opportunityId}:${status}:${viewerId}`;
}

export function buildDeliveryCardPresentationCacheKey(
  opportunityId: string,
  status: string,
  viewerId: string,
): string {
  return `delivery:${OPPORTUNITY_PRESENTATION_CACHE_VERSION}:card:${opportunityId}:${status}:${viewerId}`;
}

export function buildApiChatCardPresentationCacheKey(
  opportunityId: string,
  viewerId: string,
): string {
  return `chat:${OPPORTUNITY_PRESENTATION_CACHE_VERSION}:card:${opportunityId}:${viewerId}`;
}
