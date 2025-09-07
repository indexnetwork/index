import { 
  PaginatedResponse,
  APIResponse,
} from '../lib/types';

// Discover-specific types
export interface DiscoverIntent {
  id: string;
  payload: string;
  summary?: string;
  createdAt: string;
}

export interface DiscoverStake {
  intent: DiscoverIntent;
  totalStake: number;
  reasonings: string[];
}

export interface DiscoverUser {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
}

export interface DiscoverResult {
  user: DiscoverUser;
  totalStake: number;
  intents: DiscoverStake[];
}

export interface DiscoverFilters {
  intentIds?: string[];
  userIds?: string[];
  indexIds?: string[];
  excludeDiscovered?: boolean;
  page?: number;
  limit?: number;
}

export interface DiscoverResponse {
  results: DiscoverResult[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  filters: {
    intentIds: string[] | null;
    userIds: string[] | null;
    indexIds: string[] | null;
    excludeDiscovered?: boolean;
  };
}

// Service functions factory that takes an authenticated API instance
export const createDiscoverService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Discover users based on filters
  discoverUsers: async (filters: DiscoverFilters = {}): Promise<DiscoverResponse> => {
    const response = await api.post<DiscoverResponse>('/discover/filter', filters);
    return response;
  },
});
