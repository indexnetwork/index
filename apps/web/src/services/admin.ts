// Types for opportunity discovery
export interface DiscoveredOpportunity {
  sourceUser: { id: string; name: string; avatar: string | null };
  targetUser: { id: string; name: string; avatar: string | null };
  opportunity: {
    type: 'collaboration' | 'mentorship' | 'networking' | 'other';
    title: string;
    description: string;
    score: number;
  };
}

export interface OpportunityDiscoveryRequest {
  prompt: string;
  memberIds?: string[];
  limit?: number;
}

export interface OpportunityDiscoveryResponse {
  opportunities: DiscoveredOpportunity[];
}

// Service functions for admin operations
export const createAdminService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Discover opportunities for index members
  discoverOpportunities: async (networkId: string, request: OpportunityDiscoveryRequest) => {
    return await api.post<OpportunityDiscoveryResponse>(`/admin/${networkId}/opportunities`, request);
  }
});
