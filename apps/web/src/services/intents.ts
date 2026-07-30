import type { Intent, PaginatedResponse, APIResponse } from '../types';

export type IntentLifecycleStatus = 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED';
export type MutableIntentLifecycleStatus = Extract<IntentLifecycleStatus, 'ACTIVE' | 'PAUSED'>;

export interface IntentStatusResult {
  id: string;
  status: MutableIntentLifecycleStatus;
  lifecycleVersionMs: number;
  changed: boolean;
}

function isMutableIntentLifecycleStatus(value: unknown): value is MutableIntentLifecycleStatus {
  return value === 'ACTIVE' || value === 'PAUSED';
}

function parseIntentStatusResponse(value: unknown): IntentStatusResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid signal status response');
  }

  const response = value as Record<string, unknown>;
  const intent = response.intent;
  if (!intent || typeof intent !== 'object') {
    throw new Error('Invalid signal status response');
  }

  const authoritativeIntent = intent as Record<string, unknown>;
  if (
    response.success !== true ||
    typeof response.changed !== 'boolean' ||
    typeof authoritativeIntent.id !== 'string' ||
    !isMutableIntentLifecycleStatus(authoritativeIntent.status) ||
    typeof authoritativeIntent.lifecycleVersionMs !== 'number' ||
    !Number.isFinite(authoritativeIntent.lifecycleVersionMs)
  ) {
    throw new Error('Invalid signal status response');
  }

  return {
    id: authoritativeIntent.id,
    status: authoritativeIntent.status,
    lifecycleVersionMs: authoritativeIntent.lifecycleVersionMs,
    changed: response.changed,
  };
}

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

    return api.post<PaginatedResponse<Intent>>('/intents/list', requestBody);
  },

  // Get single intent by ID
  getIntent: async (id: string): Promise<Intent> => {
    const response = await api.get<APIResponse<Intent>>(`/intents/${id}`);
    if (!response.intent) {
      throw new Error('Signal not found');
    }
    return response.intent;
  },

  // Best-effort explicit human visit ping; generic GET intentionally does not stamp.
  visitIntent: async (id: string): Promise<void> => {
    await api.post(`/intents/${id}/visit`, {});
  },

  // Archive intent
  archiveIntent: async (id: string): Promise<void> => {
    await api.patch(`/intents/${id}/archive`);
  },

  // Pause or resume intent background discovery
  setIntentStatus: async (
    id: string,
    status: MutableIntentLifecycleStatus,
  ): Promise<IntentStatusResult> => {
    const response = await api.patch<unknown>(`/intents/${id}/status`, { status });
    return parseIntentStatusResponse(response);
  },

  // Refine intent with followup text
  refineIntent: async (id: string, followupText: string): Promise<Intent> => {
    const response = await api.post<{ intent: Intent }>(`/intents/${id}/refine`, { followupText });
    if (!response.intent) {
      throw new Error('Failed to refine signal');
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
    return api.post<{
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
  }
});
