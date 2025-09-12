import { useMemo } from 'react';
import { useAuthenticatedAPI, apiClient } from '../lib/api';
import { 
  Index, 
  Intent,
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

  // Update member permissions
  updateMemberPermissions: async (indexId: string, userId: string, permissions: string[]): Promise<Member> => {
    const response = await api.patch<{ member: Member; message: string }>(`/indexes/${indexId}/members/${userId}`, { 
      permissions 
    });
    if (!response.member) {
      throw new Error('Failed to update member permissions');
    }
    return response.member;
  },

  // Get members of an index
  getMembers: async (indexId: string): Promise<Member[]> => {
    const response = await api.get<{ members: Member[] }>(`/indexes/${indexId}/members`);
    return response.members || [];
  },

  // Public Permissions Management
  // Update link permissions for direct link sharing
  updateLinkPermissions: async (indexId: string, permissions: string[]): Promise<Index> => {
    const response = await api.patch<APIResponse<Index>>(`/indexes/${indexId}/link-permissions`, { 
      permissions 
    });
    if (!response.index) {
      throw new Error('Failed to update link permissions');
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

  // Leave index (remove current user as member)
  leaveIndex: async (indexId: string, userId: string): Promise<void> => {
    await api.delete(`/indexes/${indexId}/members/${userId}`);
  },

  // Get suggested intents for an index
  getSuggestedIntents: async (indexId: string): Promise<{
    intents: { payload: string; confidence: number }[];
    fromCache?: boolean;
    processingTime?: number;
  }> => {
    const response = await api.get<{
      intents: { payload: string; confidence: number }[];
      fromCache: boolean;
      processingTime?: number;
    }>(`/indexes/${indexId}/suggested_intents`);
    return {
      intents: response.intents,
      fromCache: response.fromCache,
      processingTime: response.processingTime
    };
  },

  // Get intent preview with contextual integrity processing
  getIntentPreview: async (indexId: string, payload: string): Promise<string> => {
    const response = await api.get<{ payload: string }>(`/indexes/${indexId}/suggested_intents/preview?payload=${encodeURIComponent(payload)}`);
    return response.payload;
  },

  // Replace a single suggestion with a new one
  replaceSuggestion: async (indexId: string, removedSuggestion: string): Promise<{
    newSuggestion: { payload: string; confidence: number };
  }> => {
    const response = await api.post<{
      newSuggestion: { payload: string; confidence: number };
    }>(`/indexes/${indexId}/suggested_intents/replace?removedSuggestion=${encodeURIComponent(removedSuggestion)}`);
    return response;
  },

  // Get intents for a specific index with pagination
  getIndexIntents: async (indexId: string, page: number = 1, limit: number = 10, archived: boolean = false): Promise<PaginatedResponse<Intent>> => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      archived: archived.toString()
    });
    
    const response = await api.get<PaginatedResponse<Intent>>(`/indexes/${indexId}/intents?${params}`);
    return response;
  },

  // Legacy methods for backward compatibility (these would need intent service integration)
  addSuggestedIntent: async (indexId: string, intentId: string): Promise<boolean> => {
    try {
      await api.post(`/intents/${intentId}/indexes`, { indexIds: [indexId] });
      return true;
    } catch {
      return false;
    }
  },


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
