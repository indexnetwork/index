// no external type imports needed here

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
  indexIds?: string[];
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
    indexIds: string[] | null;
    sources: Array<{ type: 'file' | 'integration' | 'link' | 'discovery_form'; id: string }> | null;
    excludeDiscovered?: boolean;
  };
}

export interface DiscoveryRequestResponse {
  success: boolean;
  intents: DiscoverIntent[];
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

  // Submit discovery request with files and text
  // This returns a function that accepts the getAccessToken callback
  submitDiscoveryRequest: (files: File[], payload?: string) => async (getAccessToken: () => Promise<string | null>): Promise<DiscoveryRequestResponse> => {
    const formData = new FormData();
    
    // Add files
    files.forEach((file) => {
      formData.append('files', file);
    });
    
    // Add payload if provided
    if (payload) {
      formData.append('payload', payload);
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL!;
    const response = await fetch(`${API_BASE_URL}/discover/new`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to submit discovery request');
    }

    return response.json();
  },
});
