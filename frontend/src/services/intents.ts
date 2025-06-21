import { 
  Intent,
  Agent,
  PaginatedResponse, 
  APIResponse, 
  CreateIntentRequest, 
  UpdateIntentRequest,
  IntentStakesByUserResponse
} from '../lib/types';

// Transform config agents to match Agent interface
export const agents: Agent[] = [
  {
    id: "proofLayer",
    name: "ProofLayer",
    role: "Due Diligence Agent",
    avatar: "/avatars/agents/privado.svg"
  },
  {
    id: "threshold", 
    name: "Threshold",
    role: "Network Manager Agent",
    avatar: "/avatars/agents/reputex.svg"
  },
  {
    id: "aspecta",
    name: "Aspecta", 
    role: "Reputation Agent",
    avatar: "/avatars/agents/hapi.svg"
  },
  {
    id: "semanticRelevancy",
    name: "Semantic Relevancy",
    role: "Relevancy Agent", 
    avatar: "/avatars/agents/trusta.svg"
  }
];



// Service functions factory that takes an authenticated API instance
export const createIntentsService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Get all intents with pagination
  getIntents: async (page: number = 1, limit: number = 10, archived: boolean = false, indexId?: string): Promise<PaginatedResponse<Intent>> => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      archived: archived.toString()
    });
    
    if (indexId) {
      params.append('indexId', indexId);
    }
    
    const response = await api.get<PaginatedResponse<Intent>>(`/intents?${params}`);
    return response;
  },

  // Get single intent by ID
  getIntent: async (id: string): Promise<Intent> => {
    const response = await api.get<APIResponse<Intent>>(`/intents/${id}`);
    if (!response.intent) {
      throw new Error('Intent not found');
    }
    return response.intent;
  },



  // Get stakes by user for an intent
  getIntentStakesByUser: async (intentId: string): Promise<IntentStakesByUserResponse[]> => {
    const response = await api.get<IntentStakesByUserResponse[]>(`/intents/${intentId}/stakes/by-user`);
    return response;
  },

  // Create new intent
  createIntent: async (data: CreateIntentRequest): Promise<Intent> => {
    const response = await api.post<APIResponse<Intent>>('/intents', data);
    if (!response.intent) {
      throw new Error('Failed to create intent');
    }
    return response.intent;
  },

  // Update intent
  updateIntent: async (id: string, data: UpdateIntentRequest): Promise<Intent> => {
    const response = await api.patch<APIResponse<Intent>>(`/intents/${id}`, data);
    if (!response.intent) {
      throw new Error('Failed to update intent');
    }
    return response.intent;
  },

  // Delete intent
  deleteIntent: async (id: string): Promise<void> => {
    await api.delete(`/intents/${id}`);
  },

  // Add indexes to intent
  addIndexesToIntent: async (intentId: string, indexIds: string[]): Promise<void> => {
    await api.post(`/intents/${intentId}/indexes`, { indexIds });
  },

  // Remove indexes from intent
  removeIndexesFromIntent: async (intentId: string, indexIds: string[]): Promise<void> => {
    // For DELETE with body, we can use a POST with _method override or use query params
    // Using query params approach:
    const queryParams = indexIds.map(id => `indexIds[]=${id}`).join('&');
    await api.delete(`/intents/${intentId}/indexes?${queryParams}`);
  },

  // Archive intent
  archiveIntent: async (id: string): Promise<void> => {
    await api.patch(`/intents/${id}/archive`);
  },

  // Unarchive intent
  unarchiveIntent: async (id: string): Promise<void> => {
    await api.patch(`/intents/${id}/unarchive`);
  }
});

// Backward compatibility - service that uses apiClient directly (for non-authenticated requests)
export const intentsService = {
  // No methods currently needed for non-authenticated requests
};

// Hook for using intents service with proper error handling
export function useIntentsService() {
  return createIntentsService;
} 