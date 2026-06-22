import { useAuthenticatedAPI } from '../lib/api';
import { useMemo } from 'react';
import { User, OnboardingState, AvatarUploadResponse, APIResponse, UpdateProfileRequest } from '../types';

export const createAuthService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Upload avatar
  uploadAvatar: async (file: File): Promise<string> => {
    const result = await api.uploadFile<AvatarUploadResponse>('/storage/avatars', file, undefined, 'avatar');
    return result.avatarUrl;
  },

  // Update user profile
  updateProfile: async (data: UpdateProfileRequest): Promise<User> => {
    const response = await api.patch<APIResponse<User>>('/auth/profile/update', data);
    if (!response.user) {
      throw new Error('Failed to update profile');
    }
    return response.user;
  },

  // Generate intro via profile sync. The sync endpoint returns a flat `intro`
  // sourced from `users.intro` (the canonical identity bio home), so we no longer
  // read the typed `profile.identity.bio` structure.
  generateIntro: async (): Promise<string | null> => {
    const result = await api.post<Record<string, unknown>>('/enrichment/sync');
    const intro = result?.intro as string | undefined;
    return intro ?? null;
  },

  // Permanently delete the authenticated user's account (soft delete)
  deleteAccount: async (): Promise<void> => {
    await api.delete<{ success: boolean }>('/auth/account');
  },

});

export function useAuthService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createAuthService(api), [api]);
}

