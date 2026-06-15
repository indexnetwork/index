import { Intent, PaginatedResponse, APIResponse } from '../types';

// Service functions factory that takes an authenticated API instance
export const createIntentsService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Get all intents with pagination
  getIntents: async (page: number = 1, limit: number = 10, archived: boolean = false, networkIds?: string[], sourceType?: string): Promise<PaginatedResponse<Intent>> => {
    const requestBody = {
      page,
      limit,
      archived,
      ...(networkIds && networkIds.length > 0 && { networkIds }),
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

  // Refine intent with followup text
  refineIntent: async (id: string, followupText: string): Promise<Intent> => {
    const response = await api.post<{ intent: Intent }>(`/intents/${id}/refine`, { followupText });
    if (!response.intent) {
      throw new Error('Failed to refine intent');
    }
    return response.intent;
  },

  // Get refinement suggestions for an intent
  getIntentSuggestions: async (id: string): Promise<Array<{ label: string; type: 'direct' | 'prompt'; followupText?: string; prefill?: string }>> => {
    const response = await api.get<{ suggestions: Array<{ label: string; type: 'direct' | 'prompt'; followupText?: string; prefill?: string }> }>(`/intents/${id}/suggestions`);
    return response.suggestions || [];
  },

  // Suggest tags based on user intents and prompt
  suggestTags: async (prompt: string, networkId?: string, maxSuggestions?: number): Promise<{
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
      networkId,
      maxSuggestions
    });
    return response;
  }
}); 
