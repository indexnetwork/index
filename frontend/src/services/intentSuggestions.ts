
export interface GenerateSuggestionsRequest {
  payload?: string;
  files?: File[];
  maxSuggestions?: number;
  indexCode?: string; // For vibecheck functionality
}

export interface SuggestedIntent {
  payload: string;
  relevanceScore: number;
  reasoning?: string;
}

export interface GenerateSuggestionsResponse {
  success: boolean;
  suggestedIntents: SuggestedIntent[];
  totalSuggestions: number;
  error?: string;
  // Vibecheck-specific properties
  synthesis?: string;
  score?: number;
  tempFiles?: { id: string; name: string; size: number; type: string }[];
}

// Service functions factory that takes an authenticated API instance
export const createIntentSuggestionsService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Generate intent suggestions based on user input
  generateSuggestions: async (data: GenerateSuggestionsRequest): Promise<GenerateSuggestionsResponse> => {
    try {
      // If there are files, we need to use FormData approach
      if (data.files && data.files.length > 0) {
        // For now, we'll use a simplified approach since the API structure isn't clear
        // This would need to be adjusted based on the actual backend API
        const formData = new FormData();
        
        if (data.payload) {
          formData.append('payload', data.payload);
        }
        
        if (data.maxSuggestions) {
          formData.append('maxSuggestions', data.maxSuggestions.toString());
        }
        
        // Add files
        data.files.forEach((file) => {
          formData.append(`files`, file);
        });

        // For now, use uploadFile method with the first file and additional data
        const additionalData: Record<string, string> = {};
        if (data.payload) {
          additionalData.payload = data.payload;
        }
        if (data.maxSuggestions) {
          additionalData.maxSuggestions = data.maxSuggestions.toString();
        }
        if (data.indexCode) {
          additionalData.indexCode = data.indexCode;
        }

        const response = await api.uploadFile<GenerateSuggestionsResponse>(
          '/intents/generate-suggestions', 
          data.files[0], 
          additionalData,
          'files'
        );
        return response;
      } else {
        // Simple JSON request for text-only suggestions
        const requestBody = {
          payload: data.payload,
          maxSuggestions: data.maxSuggestions,
          indexCode: data.indexCode
        };
        
        const response = await api.post<GenerateSuggestionsResponse>('/intents/generate-suggestions', requestBody);
        return response;
      }
    } catch (error) {
      console.error('Error generating intent suggestions:', error);
      return {
        success: false,
        suggestedIntents: [],
        totalSuggestions: 0,
        error: error instanceof Error ? error.message : 'Failed to generate suggestions'
      };
    }
  }
});

// Backward compatibility - service that uses apiClient directly (for non-authenticated requests)
export const intentSuggestionsService = {
  // No methods currently needed for non-authenticated requests
};

// Hook for using intent suggestions service with proper error handling
export function useIntentSuggestionsService() {
  return createIntentSuggestionsService;
}
