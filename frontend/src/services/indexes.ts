import { useMemo } from 'react';
import { useAuthenticatedAPI, apiClient } from '../lib/api';
import { 
  Index, 
  PaginatedResponse, 
  APIResponse, 
  CreateIndexRequest, 
  UpdateIndexRequest
} from '../lib/types';

// Re-export types for convenience
export type { Index };

// Member interface for API responses
interface Member {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  permissions: string[];
  createdAt?: string;
  updatedAt?: string;
}

// Legacy interface for backward compatibility
export interface SuggestedIntent {
  id: string;
  payload: string;
  isAdded?: boolean;
}

export const createIndexesService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Get all indexes with pagination
  getIndexes: async (page: number = 1, limit: number = 10): Promise<PaginatedResponse<Index>> => {
    const response = await api.get<PaginatedResponse<Index>>(`/indexes?page=${page}&limit=${limit}`);
    return response;
  },

  // Discover public indexes (indexes that anyone can join)
  discoverPublicIndexes: async (page: number = 1, limit: number = 10): Promise<PaginatedResponse<Index & { isMember?: boolean }>> => {
    const response = await api.get<PaginatedResponse<Index & { isMember?: boolean }>>(`/indexes/discover/public?page=${page}&limit=${limit}`);
    return response;
  },

  // Get single index by ID
  getIndex: async (id: string): Promise<Index> => {
    const response = await api.get<APIResponse<Index>>(`/indexes/${id}`);
    if (!response.index) {
      throw new Error('Index not found');
    }
    return response.index;
  },

  // Get index by share code (public access)
  getIndexByShareCode: async (code: string): Promise<Index> => {
    const response = await api.get<APIResponse<Index>>(`/indexes/share/${code}`);
    if (!response.index) {
      throw new Error('Index not found');
    }
    return response.index;
  },

  // Get public index by ID (public access - only works for public indexes)
  getPublicIndexById: async (id: string): Promise<Index> => {
    const response = await api.get<APIResponse<Index>>(`/indexes/public/${id}`);
    if (!response.index) {
      throw new Error('Index not found');
    }
    return response.index;
  },

  // Create new index
  createIndex: async (data: CreateIndexRequest): Promise<Index> => {
    const response = await api.post<APIResponse<Index>>('/indexes', data);
    if (!response.index) {
      throw new Error('Failed to create index');
    }
    return response.index;
  },

  // Update index
  updateIndex: async (id: string, data: UpdateIndexRequest): Promise<Index> => {
    const response = await api.put<APIResponse<Index>>(`/indexes/${id}`, data);
    if (!response.index) {
      throw new Error('Failed to update index');
    }
    return response.index;
  },

  // Delete index
  deleteIndex: async (id: string): Promise<void> => {
    await api.delete(`/indexes/${id}`);
  },

  // Member Management
  // Add member to index with specific permissions
  addMember: async (indexId: string, userId: string, permissions: string[]): Promise<Member> => {
    const response = await api.post<{ member: Member; message: string }>(`/indexes/${indexId}/members`, { 
      userId, 
      permissions 
    });
    if (!response.member) {
      throw new Error('Failed to add member');
    }
    return response.member;
  },

  // Remove member from index
  removeMember: async (indexId: string, userId: string): Promise<void> => {
    await api.delete(`/indexes/${indexId}/members/${userId}`);
  },

  // Get members of an index
  getMembers: async (indexId: string): Promise<Member[]> => {
    const response = await api.get<{ members: Member[] }>(`/indexes/${indexId}/members`);
    return response.members || [];
  },

  // Permissions Management
  // Update index permissions (joinPolicy)
  updatePermissions: async (indexId: string, permissions: { joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean }): Promise<Index> => {
    const response = await api.patch<APIResponse<Index>>(`/indexes/${indexId}/permissions`, permissions);
    if (!response.index) {
      throw new Error('Failed to update permissions');
    }
    return response.index;
  },

  // Regenerate invitation link for private indexes
  regenerateInvitationLink: async (indexId: string): Promise<Index> => {
    const response = await api.patch<APIResponse<Index>>(`/indexes/${indexId}/regenerate-invitation`);
    if (!response.index) {
      throw new Error('Failed to regenerate invitation link');
    }
    return response.index;
  },

  // User Search
  // Search users for adding as members
  searchUsers: async (query: string, indexId?: string): Promise<{ id: string; name: string; email: string; avatar?: string }[]> => {
    const params = new URLSearchParams({ q: query });
    if (indexId) {
      params.append('indexId', indexId);
    }
    const response = await api.get<{ users: { id: string; name: string; email: string; avatar?: string }[] }>(`/indexes/search-users?${params.toString()}`);
    return response.users || [];
  },

  // Join a public index
  joinIndex: async (indexId: string): Promise<{ index: Index; membership?: Member; alreadyMember?: boolean }> => {
    const response = await api.post<{ 
      message: string; 
      index: Index; 
      membership?: Member;
      alreadyMember?: boolean;
    }>(`/indexes/${indexId}/join`);
    return {
      index: response.index,
      membership: response.membership,
      alreadyMember: response.alreadyMember
    };
  },

  // Accept invitation and join index
  acceptInvitation: async (code: string): Promise<{ index: Index; membership: Member; alreadyMember?: boolean }> => {
    const response = await api.post<{ 
      message: string; 
      index: Index; 
      membership: Member;
      alreadyMember?: boolean;
    }>(`/indexes/invitation/${code}/accept`);
    return {
      index: response.index,
      membership: response.membership,
      alreadyMember: response.alreadyMember
    };
  },

  // Member Intents Management
  // Get member intents for an index
  getMemberIntents: async (indexId: string): Promise<Array<{
    id: string;
    payload: string;
    summary?: string | null;
    createdAt: string;
    sourceType: 'file' | 'link' | 'integration';
    sourceId: string;
    sourceName: string;
    sourceValue: string | null;
    sourceMeta: string | null;
  }>> => {
    const response = await api.get<{ intents: Array<{
      id: string;
      payload: string;
      summary?: string | null;
      createdAt: string;
      sourceType: 'file' | 'link' | 'integration';
      sourceId: string;
      sourceName: string;
      sourceValue: string | null;
      sourceMeta: string | null;
    }> }>(`/indexes/${indexId}/member-intents`);
    return response.intents || [];
  },

  // Remove member intent from index
  removeMemberIntent: async (indexId: string, intentId: string): Promise<void> => {
    await api.delete(`/indexes/${indexId}/member-intents/${intentId}`);
  }
});

// Non-authenticated service for public endpoints
export const indexesService = {
  // Get index by share code (public access, no auth required)
  getIndexByShareCode: async (code: string): Promise<Index> => {
    const response = await apiClient.get<APIResponse<Index>>(`/indexes/share/${code}`);
    if (!response.index) {
      throw new Error('Index not found');
    }
    return response.index;
  },

  // Get public index by ID (public access, no auth required - only works for public indexes)
  getPublicIndexById: async (id: string): Promise<Index> => {
    const response = await apiClient.get<APIResponse<Index>>(`/indexes/public/${id}`);
    if (!response.index) {
      throw new Error('Index not found');
    }
    return response.index;
  },

  // Legacy methods that require authentication
  getIndexes: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  getIndex: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  createIndex: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  updateIndex: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  deleteIndex: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  addMember: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  removeMember: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  addSuggestedIntent: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); }
};

// Hook for using indexes service with proper error handling
export function useIndexService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createIndexesService(api), [api]);
} 
