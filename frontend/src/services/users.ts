import { useAuthenticatedAPI } from '../lib/api';
import { useMemo } from 'react';
import { User, APIResponse } from '../lib/types';

export const createUsersService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Get user profile by ID
  getUserProfile: async (userId: string): Promise<User> => {
    const response = await api.get<APIResponse<User>>(`/users/${userId}`);
    if (!response.user) {
      throw new Error('Failed to fetch user profile');
    }
    return response.user;
  },
});

export function useUsersService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createUsersService(api), [api]);
}

