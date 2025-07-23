export interface IntentSuggestion {
  payload: string;
  confidence: number;
}

export interface TempFile {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface IntentSuggestionsResponse {
  success: boolean;
  suggestedIntents: IntentSuggestion[];
  tempFiles: TempFile[];
  // Vibe check results (when indexCode is provided)
  synthesis?: string;
  score?: number;
  targetUser?: {
    id: string;
    name: string;
    intro: string;
  };
  error?: string;
}

// Service for intent suggestions operations
export const intentSuggestionsService = {
  // Generate intent suggestions from files and/or payload, with optional vibe check
  generateSuggestions: async (data: { 
    payload?: string; 
    files?: File[]; 
    indexCode?: string; 
  }): Promise<IntentSuggestionsResponse> => {
    try {
      const { payload, files = [], indexCode } = data;

      // Must have either files or payload
      if (!payload && files.length === 0) {
        throw new Error('Must provide either text or files');
      }

      const formData = new FormData();
      
      // Add payload if provided
      if (payload) {
        formData.append('payload', payload);
      }
      
      // Add indexCode if provided (for vibe check)
      if (indexCode) {
        formData.append('indexCode', indexCode);
      }
      
      // Add files if provided
      files.forEach((file) => {
        formData.append('files', file);
      });

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/vibecheck/intent-suggestion`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Intent suggestions response:', result);
      
      return result as IntentSuggestionsResponse;
    } catch (error) {
      console.error('Intent suggestions API error:', error);
      return {
        success: false,
        suggestedIntents: [],
        tempFiles: [],
        error: error instanceof Error ? error.message : 'Failed to generate intent suggestions'
      };
    }
  },

  // Get temp file URL by ID
  getTempFileUrl: (fileId: string): string => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    return `${apiUrl}/vibecheck/temp/${fileId}`;
  }
}; 