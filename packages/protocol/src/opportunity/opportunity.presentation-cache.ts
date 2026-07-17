/** Cache namespace for opportunity presentation copy. Bump to invalidate copy safety changes. */
export const OPPORTUNITY_PRESENTATION_CACHE_VERSION = "v2";

export function buildHomeCardPresentationCacheKey(
  opportunityId: string,
  status: string,
  viewerId: string,
): string {
  return `home:${OPPORTUNITY_PRESENTATION_CACHE_VERSION}:card:${opportunityId}:${status}:${viewerId}`;
}

export function buildHomeCategoryPresentationCacheKey(
  viewerId: string,
  opportunitySetHash: string,
): string {
  return `home:${OPPORTUNITY_PRESENTATION_CACHE_VERSION}:categories:${viewerId}:${opportunitySetHash}`;
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
