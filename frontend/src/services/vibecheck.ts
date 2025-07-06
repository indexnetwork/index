export interface VibeCheckResult {
  success: boolean;
  synthesis?: string;
  score?: number;
  targetUser?: {
    id: string;
    name: string;
    intro: string;
  };
  error?: string;
}

// Service for unauthenticated vibecheck operations
export const vibecheckService = {
  // Run vibecheck with uploaded files against shared index
  runVibeCheckWithFiles: async (code: string, files: File[]): Promise<VibeCheckResult> => {
    try {
      const formData = new FormData();
      
      // Add files to form data
      files.forEach((file) => {
        formData.append('files', file);
      });

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/vibecheck/share/${code}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return result as VibeCheckResult;
    } catch (error) {
      console.error('Vibecheck API error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run vibecheck'
      };
    }
  }
}; 