/**
 * Types and service for user opportunities (GET /opportunities).
 * Matches protocol opportunity list item shape.
 */
export interface OpportunityActor {
  userId: string;
  role: string;
  networkId?: string | null;
}

export interface OpportunityContext {
  networkId?: string | null;
  [key: string]: unknown;
}

export interface OpportunityInterpretation {
  reasoning?: string | null;
  summary?: string | null;
  [key: string]: unknown;
}

export interface OpportunityListItem {
  id: string;
  status: 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';
  context: OpportunityContext;
  interpretation: OpportunityInterpretation;
  actors: OpportunityActor[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export interface GetOpportunitiesOptions {
  status?: 'pending' | 'accepted' | 'rejected' | 'expired';
  networkId?: string;
  limit?: number;
  offset?: number;
}

/** Full lifecycle status union (see API OpportunityStatus). */
export type OpportunityLifecycleStatus =
  | 'negotiating'
  | 'pending'
  | 'stalled'
  | 'accepted'
  | 'rejected'
  | 'expired';

/** Radar card item (from GET /opportunities/radar). Presenter-driven display contract. */
export interface RadarCardItem {
  opportunityId: string;
  /** Lifecycle status of the underlying opportunity (present for client bucketing, e.g. intent radar). */
  status?: OpportunityLifecycleStatus;
  userId: string;
  name: string;
  avatar: string | null;
  mainText: string;
  cta: string;
  headline?: string;
  /** Presenter-generated; primary (accept) and secondary (dismiss) button labels. */
  primaryActionLabel: string;
  secondaryActionLabel: string;
  /** Presenter-generated subtitle under the other party name (e.g. "1 mutual signal"). */
  mutualIntentsLabel: string;
  narratorChip?: { name: string; text: string; avatar?: string | null; userId?: string };
  /** Viewer's role in this opportunity (e.g. 'party', 'agent', 'patient', 'peer'). */
  viewerRole?: string;
  /**
   * True when this card came from a skeleton-presentation fetch: identity
   * fields are real but mainText/cta are empty (presenter LLM skipped).
   * Render a shimmer body and wait for the full fetch to replace the card.
   */
  presentationPending?: boolean;
}

export interface RadarViewResponse {
  items: RadarCardItem[];
  meta: { totalOpportunities: number };
}

export interface GetRadarViewOptions {
  networkId?: string;
  scopeType?: 'intent';
  scopeId?: string;
  limit?: number;
  noCache?: boolean;
  /** Explicit lifecycle filter — switches the radar view into lifecycle mode (intent radar). */
  statuses?: OpportunityLifecycleStatus[];
  /** 'skeleton' = fast LLM-free response; uncached cards flagged presentationPending. */
  presentation?: 'skeleton';
}

export type OpportunityStatus = 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';

export interface OpportunityStatusUpdateResponse {
  opportunity: OpportunityListItem | null;
  counterpartUserId?: string;
}

export interface OpportunityPresentation {
  title: string;
  description: string;
  callToAction: string;
}

export interface OpportunityDetailResponse {
  id: string;
  presentation: OpportunityPresentation;
  status: OpportunityStatus;
  category?: string;
  confidence?: number;
  network?: { id: string; title: string };
  /** Present when the requested opportunity was superseded by this enriched opportunity. */
  resolvedFromOpportunityId?: string;
}

/** Single opportunity entry returned by GET /opportunities/chat-context. */
export interface ChatContextOpportunity {
  opportunityId: string;
  headline: string;
  personalizedSummary: string;
  narratorRemark: string;
  peerName: string;
  peerAvatar: string | null;
  /** ISO-8601 acceptance time (from opportunities.updatedAt). May be null for legacy rows. */
  acceptedAt: string | null;
}

const RADAR_VIEW_RECENT_CACHE_TTL_MS = 1500;
const radarViewInFlight = new Map<string, Promise<RadarViewResponse>>();
const radarViewRecent = new Map<string, { data: RadarViewResponse; timestamp: number }>();

export const createOpportunitiesService = (
  api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>
) => ({
  getOpportunities: async (
    options?: GetOpportunitiesOptions
  ): Promise<OpportunityListItem[]> => {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.networkId) params.set('networkId', options.networkId);
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.offset != null) params.set('offset', String(options.offset));
    const qs = params.toString();
    const url = qs ? `/opportunities?${qs}` : '/opportunities';
    const res = await api.get<{ opportunities: OpportunityListItem[] }>(url);
    return res.opportunities ?? [];
  },

  getRadarView: async (
    options?: GetRadarViewOptions
  ): Promise<RadarViewResponse> => {
    const params = new URLSearchParams();
    if (options?.networkId) params.set('networkId', options.networkId);
    if (options?.scopeType) params.set('scopeType', options.scopeType);
    if (options?.scopeId) params.set('scopeId', options.scopeId);
    if (options?.statuses?.length) params.set('statuses', options.statuses.join(','));
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.noCache) params.set('noCache', '1');
    if (options?.presentation) params.set('presentation', options.presentation);
    const qs = params.toString();
    const url = qs ? `/opportunities/radar?${qs}` : '/opportunities/radar';

    // When noCache is set, skip the in-memory dedup cache entirely
    if (options?.noCache) {
      return api.get<RadarViewResponse>(url);
    }

    const cacheKey = url;
    const now = Date.now();
    const recent = radarViewRecent.get(cacheKey);
    if (recent && now - recent.timestamp < RADAR_VIEW_RECENT_CACHE_TTL_MS) {
      return recent.data;
    }

    const inFlight = radarViewInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = api
      .get<RadarViewResponse>(url)
      .then((res) => {
        radarViewRecent.set(cacheKey, { data: res, timestamp: Date.now() });
        return res;
      })
      .finally(() => {
        radarViewInFlight.delete(cacheKey);
      });

    radarViewInFlight.set(cacheKey, request);
    return request;
  },

  updateStatus: async (
    opportunityId: string,
    status: OpportunityStatus,
    scope?: { scopeType: 'intent'; scopeId: string },
  ): Promise<OpportunityStatusUpdateResponse> => {
    return api.patch<OpportunityStatusUpdateResponse>(
      `/opportunities/${opportunityId}/status`,
      { status, ...(scope ?? {}) }
    );
  },

  getOpportunity: async (opportunityId: string): Promise<OpportunityDetailResponse> => {
    return api.get<OpportunityDetailResponse>(`/opportunities/${opportunityId}`);
  },

  /**
   * Atomically accept a `pending` or `draft` opportunity and resolve the h2h
   * conversation ID in one round-trip. Backs the Start Chat button on both
   * ambient (pending) and orchestrator (draft) cards so the UI can navigate
   * directly to the accepted human chat without a follow-up lookup.
   *
   * Wraps POST /opportunities/:id/start-chat from Plan B Task 8.
   */
  startChat: async (
    opportunityId: string,
    scope?: { scopeType: 'intent'; scopeId: string },
  ): Promise<{
    conversationId: string;
    counterpartUserId: string;
    opportunity: { id: string; status: OpportunityStatus };
  }> => {
    return api.post<{
      conversationId: string;
      counterpartUserId: string;
      opportunity: { id: string; status: OpportunityStatus };
    }>(`/opportunities/${opportunityId}/start-chat`, {
      ...(scope ?? {}),
    });
  },

  /**
   * Fetch accepted opportunities shared between the authenticated user and
   * a peer. Used as inline context inside the h2h chat window.
   * Wraps GET /opportunities/chat-context?peerUserId=:id.
   */
  getChatContext: async (
    peerUserId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ChatContextOpportunity[]> => {
    const res = await api.get<{ opportunities: ChatContextOpportunity[] }>(
      `/opportunities/chat-context?peerUserId=${encodeURIComponent(peerUserId)}`,
      options,
    );
    return res.opportunities ?? [];
  },
});
