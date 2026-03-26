import { User, APIResponse } from '../lib/types';

/** Response shape for GET /users/batch */
interface BatchUsersResponse {
  users: User[];
}

export interface NegotiationTurnSummary {
  speaker: { id: string; name: string; avatar: string | null };
  action: string;
  fitScore: number;
  reasoning: string;
  suggestedRoles: { ownUser?: string; otherUser?: string } | null;
  createdAt: string;
}

export interface NegotiationSummary {
  id: string;
  counterparty: { id: string; name: string; avatar: string | null };
  outcome: {
    hasOpportunity: boolean;
    finalScore: number;
    role: string | null;
    turnCount: number;
    reason?: string;
  } | null;
  turns: NegotiationTurnSummary[];
  createdAt: string;
}

export interface NegotiationInsights {
  summary: string | null;
  stats: {
    totalCount: number;
    opportunityCount: number;
    noOpportunityCount: number;
    inProgressCount: number;
    avgScore: number | null;
    roleDistribution: Record<string, number>;
    topCounterparties: Array<{ id: string; name: string; avatar: string | null; count: number }>;
  };
}

export const createUsersService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Get user profile by ID
  getUserProfile: async (userId: string): Promise<User> => {
    const response = await api.get<APIResponse<User>>(`/users/${userId}`);
    if (!response.user) {
      throw new Error('Failed to fetch user profile');
    }
    return response.user;
  },

  /**
   * Get multiple user profiles by ID. Prefers batch endpoint; falls back to parallel single fetches.
   * Returns a Map of id -> User (or null for missing/failed). Only fetches the provided ids (caller should dedupe/cap).
   */
  getUserProfiles: async (ids: string[]): Promise<Map<string, User | null>> => {
    const profileMap = new Map<string, User | null>();
    if (ids.length === 0) return profileMap;

    try {
      const response = await api.get<BatchUsersResponse>(`/users/batch?ids=${encodeURIComponent(ids.join(','))}`);
      const users = response?.users ?? [];
      for (const user of users) {
        profileMap.set(user.id, user);
      }
      for (const id of ids) {
        if (!profileMap.has(id)) {
          profileMap.set(id, null);
        }
      }
      return profileMap;
    } catch {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const profile = await api.get<APIResponse<User>>(`/users/${id}`);
            return [id, profile?.user ?? null] as const;
          } catch {
            return [id, null] as const;
          }
        })
      );
      results.forEach(([id, user]) => profileMap.set(id, user));
      return profileMap;
    }
  },

  /**
   * Manually add a contact by email. Creates a ghost user if not registered.
   */
  addContact: async (email: string, name?: string): Promise<void> => {
    await api.post('/users/contacts', { email, name });
  },

  /**
   * Get negotiation dashboard data: LLM-generated summary + structured stats. Self-only.
   */
  getNegotiationInsights: async (userId: string): Promise<NegotiationInsights | null> => {
    try {
      const response = await api.get<{ insights: NegotiationInsights | null }>(`/users/${userId}/negotiations/insights`);
      return response.insights ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Get past negotiations for a user. Returns mutual negotiations when viewing another user's profile.
   */
  getUserNegotiations: async (userId: string, opts?: { limit?: number; offset?: number; result?: string }): Promise<NegotiationSummary[]> => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    if (opts?.result) params.set('result', opts.result);
    const qs = params.toString();
    const response = await api.get<{ negotiations: NegotiationSummary[] }>(`/users/${userId}/negotiations${qs ? `?${qs}` : ''}`);
    return response.negotiations ?? [];
  },

  /**
   * Trigger a discovery negotiation with the target user.
   */
  triggerDiscoveryNegotiation: async (userId: string): Promise<NegotiationSummary> => {
    const response = await api.post<{ negotiation: NegotiationSummary }>(`/users/${userId}/negotiations`);
    return response.negotiation;
  },
});