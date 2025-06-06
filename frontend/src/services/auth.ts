import { useAuthenticatedAPI } from '../lib/api';
import { User, APIResponse, UpdateProfileRequest } from '../lib/types';

// Service functions factory that takes an authenticated API instance
export const createAuthService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Get current user info
  getCurrentUser: async (): Promise<User> => {
    const response = await api.get<APIResponse<User>>('/auth/me');
    if (!response.user) {
      throw new Error('User not found');
    }
    return response.user;
  },

  // Update user profile
  updateProfile: async (data: UpdateProfileRequest): Promise<User> => {
    const response = await api.patch<APIResponse<User>>('/auth/profile', data);
    if (!response.user) {
      throw new Error('Failed to update profile');
    }
    return response.user;
  },

  // Delete user account
  deleteAccount: async (): Promise<void> => {
    await api.delete('/auth/account');
  }
});

// Hook for using auth service with proper error handling
export function useAuthService() {
  const api = useAuthenticatedAPI();
  return createAuthService(api);
} 