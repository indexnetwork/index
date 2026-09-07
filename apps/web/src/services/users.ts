import { User, APIResponse } from '../lib/types';

/** Response shape for GET /users/batch */
interface BatchUsersResponse {
  users: User[];
}

import type { NegotiationOutcome } from './negotiations';

/** One entry of a profile's negotiation history. The turn log lives on `/negotiations/:opportunityId`. */
export interface NegotiationHistoryEntry {
  id: string;
  opportunityId: string;
  counterparty: { id: string; name: string; avatar: string | null };
  outcome: NegotiationOutcome | null;
  settledAt: string | null;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

export const createUsersService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
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
   * The viewer's negotiation history with a profile: all of their own on their
   * own profile, the shared ones on someone else's.
   */
  getUserNegotiations: async (userId: string, opts?: { limit?: number; offset?: number }): Promise<NegotiationHistoryEntry[]> => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    const response = await api.get<{ negotiations: NegotiationHistoryEntry[] }>(`/users/${userId}/negotiations${qs ? `?${qs}` : ''}`);
    return response.negotiations ?? [];
  },
});

/** Fetch a user profile without authentication (public endpoint). */
export async function getPublicUserProfile(userId: string): Promise<User> {
  const { apiClient } = await import('../lib/api');
  const response = await apiClient.getPublic<APIResponse<User>>(`/users/${userId}`);
  if (!response.user) {
    throw new Error('Failed to fetch user profile');
  }
  return response.user;
}
