import {
  Intent,
  PaginatedResponse,
  APIResponse,
} from '../types';
import { apiUrl } from '../lib/api';

export interface SharedIntentData {
  intent: {
    id: string;
    payload: string;
    summary: string | null;
    createdAt: string;
  };
  owner: {
    id: string;
    name: string;
    avatar: string | null;
    intro: string | null;
  };
}

/**
 * Fetches a shared intent by token (public, no auth required).
 */
export async function getSharedIntent(token: string): Promise<SharedIntentData> {
  const res = await fetch(apiUrl(`/api/intents/shared/${token}`));
  if (!res.ok) throw new Error('Shared intent not found');
  return res.json();
}

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
  },

  // Generate a share token for an intent
  shareIntent: async (intentId: string): Promise<string> => {
    const response = await api.post<{ shareToken: string }>(`/intents/${intentId}/share`, {});
    return response.shareToken;
  },
}); 
