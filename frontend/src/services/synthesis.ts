import { SynthesisRequest, SynthesisResponse } from '../types';

// Service functions factory that takes an authenticated API instance
export const createSynthesisService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Generate synthesis between current user and target user
  generateVibeCheck: async (request: SynthesisRequest): Promise<SynthesisResponse> => {
    const response = await api.post<SynthesisResponse>('/synthesis/vibecheck', request);
    return response;
  }
});

// Hook for using synthesis service
export function useSynthesisService() {
  return createSynthesisService;
} 