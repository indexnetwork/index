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
  status: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired';
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
  | 'accepted'
  | 'rejected'
  | 'expired';

/** Presented opportunity card from GET /opportunities and write responses. */
export interface PresentedOpportunity {
  opportunityId: string;
  status: OpportunityLifecycleStatus;
  createdAt?: string;
  updatedAt?: string;
  peer: {
    userId: string;
    name: string;
    avatar: string | null;
  };
  viewerRole?: string;
  headline?: string;
  mainText: string;
  cta: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  mutualIntentsLabel: string;
  narratorChip?: { name: string; text: string; avatar?: string | null; userId?: string };
  presentationPending?: boolean;
  personalizedSummary?: string;
  narratorRemark?: string;
  acceptedAt?: string | null;
}

/** Radar card item — alias of the unified presenter card for UI components. */
export type RadarCardItem = PresentedOpportunity & {
  userId?: string;
  name?: string;
  avatar?: string | null;
};

function toRadarCardItem(card: PresentedOpportunity): RadarCardItem {
  return {
    ...card,
    userId: card.peer.userId,
    name: card.peer.name,
    avatar: card.peer.avatar,
  };
}

function toChatContextOpportunity(card: PresentedOpportunity): ChatContextOpportunity {
  return {
    opportunityId: card.opportunityId,
    headline: card.headline ?? card.cta,
    personalizedSummary: card.personalizedSummary ?? card.mainText,
    narratorRemark: card.narratorRemark ?? card.narratorChip?.text ?? '',
    peerName: card.peer.name,
    peerAvatar: card.peer.avatar,
    acceptedAt: card.acceptedAt ?? card.updatedAt ?? null,
  };
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

export type OpportunityStatus = 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired';

export interface OpportunityStatusUpdateResponse {
  opportunity: PresentedOpportunity | null;
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
  ): Promise<PresentedOpportunity[]> => {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.networkId) params.set('networkId', options.networkId);
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.offset != null) params.set('offset', String(options.offset));
    const qs = params.toString();
    const url = qs ? `/opportunities?${qs}` : '/opportunities';
    const res = await api.get<{ opportunities: PresentedOpportunity[] }>(url);
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
    const url = qs ? `/opportunities?${qs}` : '/opportunities';

    const fetchRadar = async () => {
      const res = await api.get<{ opportunities: PresentedOpportunity[]; meta: RadarViewResponse['meta'] }>(url);
      return {
        items: (res.opportunities ?? []).map(toRadarCardItem),
        meta: res.meta ?? { totalOpportunities: res.opportunities?.length ?? 0 },
      };
    };

    // When noCache is set, skip the in-memory dedup cache entirely
    if (options?.noCache) {
      return fetchRadar();
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

    const request = fetchRadar()
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
   * Atomically accept a pending opportunity and resolve the h2h
   * conversation ID in one round-trip. Backs the Start Chat button so the
   * UI can navigate directly to the accepted human chat without a follow-up
   * lookup.
   *
   * Wraps POST /opportunities/:id/start-chat from Plan B Task 8.
   */
  startChat: async (
    opportunityId: string,
    scope?: { scopeType: 'intent'; scopeId: string },
  ): Promise<{
    conversationId: string;
    counterpartUserId: string;
    opportunity: PresentedOpportunity;
  }> => {
    return api.post<{
      conversationId: string;
      counterpartUserId: string;
      opportunity: PresentedOpportunity;
    }>(`/opportunities/${opportunityId}/start-chat`, {
      ...(scope ?? {}),
    });
  },

  /**
   * Fetch accepted opportunities shared between the authenticated user and
   * a peer. Used as inline context inside the h2h chat window.
   */
  getChatContext: async (
    peerUserId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ChatContextOpportunity[]> => {
    const res = await api.get<{ opportunities: PresentedOpportunity[] }>(
      `/opportunities?peerUserId=${encodeURIComponent(peerUserId)}`,
      options,
    );
    return (res.opportunities ?? []).map(toChatContextOpportunity);
  },
});
