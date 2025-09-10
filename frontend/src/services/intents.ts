import { 
  Intent,
  Agent,
  PaginatedResponse, 
  APIResponse, 
  CreateIntentRequest, 
  UpdateIntentRequest,
  IntentStakesByUserResponse,
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
  getIntents: async (page: number = 1, limit: number = 10, archived: boolean = false, indexIds?: string[]): Promise<PaginatedResponse<Intent>> => {
    const requestBody = {
      page,
      limit,
      archived,
      ...(indexIds && indexIds.length > 0 && { indexIds })
    };
    
    const response = await api.post<PaginatedResponse<Intent>>('/intents/list', requestBody);
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
  getIntentStakesByUser: async (intentId: string, indexIds?: string[]): Promise<IntentStakesByUserResponse[]> => {
    const requestBody = {
      ...(indexIds && indexIds.length > 0 && { indexIds })
    };
    
    const response = await api.post<IntentStakesByUserResponse[]>(`/stakes/intent/${intentId}/by-user`, requestBody);
    return response;
  },

  // Get stakes by index code for a shared index
  getStakesByIndexCode: async (code: string): Promise<IntentStakesByUserResponse[]> => {
    const response = await api.get<IntentStakesByUserResponse[]>(`/discover/index/share/${code}/by-user`);
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

  // Create intent via share code
  createIntentViaShareCode: async (code: string, payload: string, isIncognito: boolean = false): Promise<Intent> => {
    const response = await api.post<APIResponse<Intent>>(`/indexes/share/${code}/intents`, {
      payload,
      isIncognito
    });
    if (!response.intent) {
      throw new Error('Failed to create intent via share code');
    }
    return response.intent;
  },

  // Update intent
  updateIntent: async (id: string, data: UpdateIntentRequest): Promise<Intent> => {
    const response = await api.put<APIResponse<Intent>>(`/intents/${id}`, data);
    if (!response.intent) {
      throw new Error('Failed to update intent');
    }
    return response.intent;
  },

  // Delete intent
  deleteIntent: async (id: string): Promise<void> => {
    await api.delete(`/intents/${id}`);
  },


  // Remove intent from index
  removeIntentFromIndex: async (indexId: string, intentId: string): Promise<void> => {
    await api.delete(`/indexes/${indexId}/intents/${intentId}`);
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
