import { apiClient } from '@/lib/api';

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
  intro?: string | null;
}

export interface DiscoverResult {
  user: DiscoverUser;
  totalStake: number;
  intents: DiscoverStake[];
}

export interface DiscoverFilters {
  intentIds?: string[];
  userIds?: string[];
  networkIds?: string[];
  sources?: Array<{ type: 'file' | 'integration' | 'link' | 'discovery_form'; id: string }>;
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
    networkIds: string[] | null;
    sources: Array<{ type: 'file' | 'integration' | 'link' | 'discovery_form'; id: string }> | null;
    excludeDiscovered?: boolean;
  };
}

export type IntentActionType = 'create' | 'update' | 'expire';

export interface IntentAction {
  type: IntentActionType;
  id?: string;
  payload?: string;
  score?: number | null;
  reasoning?: string | null;
  reason?: string;
}

export interface DiscoveryRequestResponse {
  success: boolean;
  intents: DiscoverIntent[];
  actions?: IntentAction[]; // Actions performed (create, update, expire)
  filesProcessed: number;
  linksProcessed: number;
  intentsGenerated: number;
}

// Service functions factory that takes an authenticated API instance
export const createDiscoverService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Discover users based on filters
  discoverUsers: async (filters: DiscoverFilters = {}): Promise<DiscoverResponse> => {
    const response = await api.post<DiscoverResponse>('/discover/filter', filters);
    return response;
  },

  submitDiscoveryRequest: async (files: File[], payload?: string): Promise<DiscoveryRequestResponse> => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    if (payload) formData.append('payload', payload);

    return apiClient.uploadFormData<DiscoveryRequestResponse>('/discover/new', formData);
  },
});
