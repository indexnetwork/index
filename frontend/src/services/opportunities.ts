/**
 * Types and service for user opportunities (GET /opportunities).
 * Matches protocol opportunity list item shape.
 */
export interface OpportunityActor {
  userId: string;
  role: string;
  indexId?: string | null;
}

export interface OpportunityContext {
  indexId?: string | null;
  [key: string]: unknown;
}

export interface OpportunityInterpretation {
  reasoning?: string | null;
  summary?: string | null;
  [key: string]: unknown;
}

export interface OpportunityListItem {
  id: string;
  status: 'latent' | 'draft' | 'pending' | 'accepted' | 'rejected' | 'expired';
  context: OpportunityContext;
  interpretation: OpportunityInterpretation;
  actors: OpportunityActor[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export interface GetOpportunitiesOptions {
  status?: 'pending' | 'accepted' | 'rejected' | 'expired';
  indexId?: string;
  limit?: number;
  offset?: number;
}

/** Home view card item (from GET /opportunities/home). Presenter-driven display contract. */
export interface HomeViewCardItem {
  opportunityId: string;
  userId: string;
  name: string;
  avatar: string | null;
  mainText: string;
  cta: string;
  headline?: string;
  /** Presenter-generated; primary (accept) and secondary (dismiss) button labels. */
  primaryActionLabel: string;
  secondaryActionLabel: string;
  /** Presenter-generated subtitle under the other party name (e.g. "1 mutual intent"). */
  mutualIntentsLabel: string;
  narratorChip?: { name: string; text: string; avatar?: string | null; userId?: string };
  /** Viewer's role in this opportunity (e.g. 'introducer', 'party', 'agent', 'patient', 'peer'). */
  viewerRole?: string;
  /** Whether the counterpart is a ghost (not yet onboarded) user. */
  isGhost?: boolean;
}

/** Home view section (dynamic title, icon, items). */
export interface HomeViewSection {
  id: string;
  title: string;
  subtitle?: string;
  iconName: string;
  items: HomeViewCardItem[];
}

export interface HomeViewResponse {
  sections: HomeViewSection[];
  meta: { totalOpportunities: number; totalSections: number };
}

export interface GetHomeViewOptions {
  indexId?: string;
  limit?: number;
}

export type OpportunityStatus = 'latent' | 'pending' | 'accepted' | 'rejected' | 'expired';

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
  index?: { id: string; title: string };
  introducedBy?: { id: string; name: string; avatar?: string | null };
}

const HOME_VIEW_RECENT_CACHE_TTL_MS = 1500;
const homeViewInFlight = new Map<string, Promise<HomeViewResponse>>();
const homeViewRecent = new Map<string, { data: HomeViewResponse; timestamp: number }>();

export const createOpportunitiesService = (
  api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>
) => ({
  getOpportunities: async (
    options?: GetOpportunitiesOptions
  ): Promise<OpportunityListItem[]> => {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.indexId) params.set('indexId', options.indexId);
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.offset != null) params.set('offset', String(options.offset));
    const qs = params.toString();
    const url = qs ? `/opportunities?${qs}` : '/opportunities';
    const res = await api.get<{ opportunities: OpportunityListItem[] }>(url);
    return res.opportunities ?? [];
  },

  getHomeView: async (
    options?: GetHomeViewOptions
  ): Promise<HomeViewResponse> => {
    const params = new URLSearchParams();
    if (options?.indexId) params.set('indexId', options.indexId);
    if (options?.limit != null) params.set('limit', String(options.limit));
    const qs = params.toString();
    const url = qs ? `/opportunities/home?${qs}` : '/opportunities/home';
    const cacheKey = url;
    const now = Date.now();
    const recent = homeViewRecent.get(cacheKey);
    if (recent && now - recent.timestamp < HOME_VIEW_RECENT_CACHE_TTL_MS) {
      return recent.data;
    }

    const inFlight = homeViewInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = api
      .get<HomeViewResponse>(url)
      .then((res) => {
        homeViewRecent.set(cacheKey, { data: res, timestamp: Date.now() });
        return res;
      })
      .finally(() => {
        homeViewInFlight.delete(cacheKey);
      });

    homeViewInFlight.set(cacheKey, request);
    return request;
  },

  updateStatus: async (
    opportunityId: string,
    status: OpportunityStatus
  ): Promise<OpportunityStatusUpdateResponse> => {
    return api.patch<OpportunityStatusUpdateResponse>(
      `/opportunities/${opportunityId}/status`,
      { status }
    );
  },

  getOpportunity: async (opportunityId: string): Promise<OpportunityDetailResponse> => {
    return api.get<OpportunityDetailResponse>(`/opportunities/${opportunityId}`);
  },

  /** Fetch a pre-generated invite message for a ghost user opportunity. */
  getInviteMessage: async (opportunityId: string): Promise<{ message: string }> => {
    return api.get<{ message: string }>(`/opportunities/${opportunityId}/invite-message`);
  },
});
