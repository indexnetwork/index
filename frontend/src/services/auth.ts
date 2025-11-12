import { useAuthenticatedAPI } from '../lib/api';
import { useMemo } from 'react';
import { User, AvatarUploadResponse, APIResponse, OnboardingState } from '../lib/types';

export interface UpdateProfileRequest {
  name?: string;
  intro?: string;
  avatar?: string;
  location?: string;
  socials?: {
    x?: string;
    linkedin?: string;
    github?: string;
    websites?: string[];
  };
}

export const createAuthService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Upload avatar
  uploadAvatar: async (file: File): Promise<string> => {
    const result = await api.uploadFile<AvatarUploadResponse>('/upload/avatar', file, undefined, 'avatar');
    return result.avatarFilename;
  },

  // Update user profile
  updateProfile: async (data: UpdateProfileRequest): Promise<User> => {
    const response = await api.patch<APIResponse<User>>('/auth/profile', data);
    if (!response.user) {
      throw new Error('Failed to update profile');
    }
    return response.user;
  },

  // Update onboarding state
  updateOnboardingState: async (data: Partial<OnboardingState>): Promise<User> => {
    const response = await api.patch<APIResponse<User>>('/auth/onboarding-state', data);
    if (!response.user) {
      throw new Error('Failed to update onboarding state');
    }
    return response.user;
  }
});

export function useAuthService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createAuthService(api), [api]);
}

