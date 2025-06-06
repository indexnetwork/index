import { useAuthenticatedAPI } from '../lib/api';
import { User, APIResponse, UpdateProfileRequest } from '../lib/types';

// Auth service functions
export const authService = {
  // Get current user info
  getCurrentUser: async (): Promise<User> => {
    const api = useAuthenticatedAPI();
    const response = await api.get<APIResponse<User>>('/auth/me');
    if (!response.user) {
      throw new Error('User not found');
    }
    return response.user;
  },

  // Update user profile
  updateProfile: async (data: UpdateProfileRequest): Promise<User> => {
    const api = useAuthenticatedAPI();
    const response = await api.patch<APIResponse<User>>('/auth/profile', data);
    if (!response.user) {
      throw new Error('Failed to update profile');
    }
    return response.user;
  },

  // Delete user account
  deleteAccount: async (): Promise<void> => {
    const api = useAuthenticatedAPI();
    await api.delete('/auth/account');
  }
};

// Hook for using auth service with proper error handling
export function useAuthService() {
  return authService;
} 