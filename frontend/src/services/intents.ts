import { 
  Intent,
  PaginatedResponse, 
  APIResponse,
} from '../lib/types';

// Service functions factory that takes an authenticated API instance
export const createIntentsService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Get all intents with pagination
  getIntents: async (page: number = 1, limit: number = 10, archived: boolean = false, indexIds?: string[], sourceType?: string): Promise<PaginatedResponse<Intent>> => {
    const requestBody = {
      page,
      limit,
      archived,
      ...(indexIds && indexIds.length > 0 && { indexIds }),
      ...(sourceType && { sourceType })
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

  // Archive intent
  archiveIntent: async (id: string): Promise<void> => {
    await api.patch(`/intents/${id}/archive`);
  },

  // Suggest tags based on user intents and prompt
  suggestTags: async (prompt: string, indexId?: string, maxSuggestions?: number): Promise<{
    suggestions: Array<{
      value: string;
      score: number;
    }>;
    intentCount: number;
  }> => {
    const response = await api.post<{
      suggestions: Array<{
        value: string;
        score: number;
      }>;
      intentCount: number;
    }>('/intents/suggest-tags', {
      prompt,
      indexId,
      maxSuggestions
    });
    return response;
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
