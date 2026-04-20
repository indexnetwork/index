import { useMemo } from 'react';
import { useAuthenticatedAPI, apiClient } from '../lib/api';
import {
  Network,
  PaginatedResponse,
  APIResponse,
  CreateNetworkRequest,
  UpdateNetworkRequest
} from '../types';

// Re-export types for convenience
export type { Network };

// Member interface for API responses
export interface Member {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  isGhost?: boolean;
  intro?: string | null;
  location?: string | null;
  socials?: {
    x?: string;
    linkedin?: string;
    github?: string;
    websites?: string[];
  } | null;
  permissions: string[];
  metadata?: Record<string, string | string[]> | null;
  createdAt?: string;
  updatedAt?: string;
}

// Response interface for getMembers with pagination
export interface GetMembersResponse {
  members: Member[];
  metadataKeys: string[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const MY_MEMBERS_RECENT_CACHE_TTL_MS = 1500;
const myMembersInFlight = new Map<string, Promise<{ members: Member[] }>>();
const myMembersRecent = new Map<string, { data: { members: Member[] }; timestamp: number }>();

export const createNetworksService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Get all networks with pagination
  getNetworks: async (page: number = 1, limit: number = 10): Promise<PaginatedResponse<Network>> => {
    const response = await api.get<APIResponse<Network>>(`/networks?page=${page}&limit=${limit}`);
    return {
      data: response.networks || [],
      pagination: response.pagination || { current: 1, total: 0, count: 0, totalCount: 0 }
    };
  },

  // Get non-personal networks shared between the current user and a target user
  getSharedNetworks: async (userId: string): Promise<Array<{ id: string; title: string; _count: { members: number } }>> => {
    const response = await api.get<{ networks: Array<{ id: string; title: string; _count: { members: number } }> }>(`/networks/shared/${userId}`);
    return response.networks || [];
  },

  // Discover public networks (networks that anyone can join)
  discoverPublicNetworks: async (page: number = 1, limit: number = 10): Promise<PaginatedResponse<Network & { isMember?: boolean }>> => {
    const response = await api.get<APIResponse<Network & { isMember?: boolean }>>(`/networks/discovery/public?page=${page}&limit=${limit}`);
    return {
      data: response.networks || [],
      pagination: response.pagination || { current: 1, total: 0, count: 0, totalCount: 0 }
    };
  },

  // Get single network by ID
  getNetwork: async (id: string): Promise<Network> => {
    const response = await api.get<APIResponse<Network>>(`/networks/${id}`);
    if (!response.network) {
      throw new Error('Network not found');
    }
    return response.network;
  },

  // Get network by share code (public access)
  getNetworkByShareCode: async (code: string): Promise<Network> => {
    const response = await api.get<APIResponse<Network>>(`/networks/share/${code}`);
    if (!response.network) {
      throw new Error('Network not found');
    }
    return response.network;
  },

  // Get public network by ID (public access - only works for public networks)
  getPublicNetworkById: async (id: string): Promise<Network> => {
    const response = await api.get<APIResponse<Network>>(`/networks/public/${id}`);
    if (!response.network) {
      throw new Error('Network not found');
    }
    return response.network;
  },

  // Upload network image (returns URL to use in create/update)
  uploadNetworkImage: async (file: File): Promise<string> => {
    const result = await api.uploadFile<{ imageUrl?: string }>('/storage/network-images', file, undefined, 'image');
    if (!result?.imageUrl) {
      throw new Error('Failed to upload network image');
    }
    return result.imageUrl;
  },

  // Create new network
  createNetwork: async (data: CreateNetworkRequest): Promise<Network> => {
    const response = await api.post<APIResponse<Network>>('/networks', data);
    if (!response.network) {
      throw new Error('Failed to create network');
    }
    return response.network;
  },

  // Update network
  updateNetwork: async (id: string, data: UpdateNetworkRequest): Promise<Network> => {
    const response = await api.put<APIResponse<Network>>(`/networks/${id}`, data);
    if (!response.network) {
      throw new Error('Failed to update network');
    }
    return response.network;
  },

  // Delete network
  deleteNetwork: async (id: string): Promise<void> => {
    await api.delete(`/networks/${id}`);
  },

  // Member Management
  // Add member to network with specific permissions
  addMember: async (networkId: string, userId: string, permissions: string[]): Promise<Member> => {
    const response = await api.post<{ member: Member; message: string }>(`/networks/${networkId}/members`, {
      userId,
      permissions
    });
    if (!response.member) {
      throw new Error('Failed to add member');
    }
    return response.member;
  },

  // Remove member from network
  removeMember: async (networkId: string, userId: string): Promise<void> => {
    await api.delete(`/networks/${networkId}/members/${userId}`);
  },

  // Update member permissions
  updateMemberPermissions: async (networkId: string, userId: string, permissions: string[]): Promise<Member> => {
    const response = await api.patch<{ member: Member; message: string }>(`/networks/${networkId}/members/${userId}`, {
      permissions
    });
    if (!response.member) {
      throw new Error('Failed to update member permissions');
    }
    return response.member;
  },

  // Get members of a network
  getMembers: async (
    networkId: string,
    options?: {
      searchQuery?: string;
      page?: number;
      limit?: number;
      metadataFilters?: Record<string, string[]>;
    }
  ): Promise<GetMembersResponse> => {
    const params = new URLSearchParams();

    if (options?.searchQuery) {
      params.append('q', options.searchQuery);
    }

    if (options?.page) {
      params.append('page', options.page.toString());
    }

    if (options?.limit) {
      params.append('limit', options.limit.toString());
    }

    // Add metadata filters
    if (options?.metadataFilters) {
      for (const [key, values] of Object.entries(options.metadataFilters)) {
        values.forEach(value => params.append(key, value));
      }
    }

    const url = `/networks/${networkId}/members${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await api.get<GetMembersResponse>(url);

    return {
      members: response.members || [],
      metadataKeys: response.metadataKeys || [],
      pagination: response.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 }
    };
  },

  // Get all members from every network the signed-in user is a member of (deduplicated). For @mentions.
  getMyMembers: async (): Promise<{ members: Member[] }> => {
    const cacheKey = '/networks/my-members';
    const now = Date.now();
    const recent = myMembersRecent.get(cacheKey);
    if (recent && now - recent.timestamp < MY_MEMBERS_RECENT_CACHE_TTL_MS) {
      return recent.data;
    }

    const inFlight = myMembersInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = api
      .get<{ members: Pick<Member, 'id' | 'name' | 'avatar'>[] }>(cacheKey)
      .then((response) => {
        const mapped = {
          members: (response.members || []).map(m => ({
            ...m,
            email: '',
            permissions: [],
            metadata: null,
            createdAt: undefined,
            updatedAt: undefined,
          } as Member))
        };
        myMembersRecent.set(cacheKey, { data: mapped, timestamp: Date.now() });
        return mapped;
      })
      .finally(() => {
        myMembersInFlight.delete(cacheKey);
      });

    myMembersInFlight.set(cacheKey, request);
    return request;
  },

  // Permissions Management
  // Update network permissions (joinPolicy)
  updatePermissions: async (networkId: string, permissions: { joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean }): Promise<Network> => {
    const response = await api.patch<APIResponse<Network>>(`/networks/${networkId}/permissions`, permissions);
    if (!response.network) {
      throw new Error('Failed to update permissions');
    }
    return response.network;
  },

  // Regenerate invitation link for private networks
  regenerateInvitationLink: async (networkId: string): Promise<Network> => {
    const response = await api.patch<APIResponse<Network>>(`/networks/${networkId}/regenerate-invitation`);
    if (!response.network) {
      throw new Error('Failed to regenerate invitation link');
    }
    return response.network;
  },

  // User Search
  // Search users for adding as members
  searchUsers: async (query: string, networkId?: string): Promise<{ id: string; name: string; email: string; avatar?: string }[]> => {
    const params = new URLSearchParams({ q: query });
    if (networkId) {
      params.append('networkId', networkId);
    }
    const response = await api.get<{ users: { id: string; name: string; email: string; avatar?: string }[] }>(`/networks/search-users?${params.toString()}`);
    return response.users || [];
  },

  // Join a public network
  joinNetwork: async (networkId: string): Promise<{ network: Network; membership?: Member; alreadyMember?: boolean }> => {
    const response = await api.post<{
      message: string;
      network: Network;
      membership?: Member;
      alreadyMember?: boolean;
    }>(`/networks/${networkId}/join`);
    return {
      network: response.network,
      membership: response.membership,
      alreadyMember: response.alreadyMember
    };
  },

  // Accept invitation and join network
  acceptInvitation: async (code: string): Promise<{ network: Network; membership: Member; alreadyMember?: boolean }> => {
    const response = await api.post<{
      message: string;
      network: Network;
      membership: Member;
      alreadyMember?: boolean;
    }>(`/networks/invitation/${code}/accept`);
    return {
      network: response.network,
      membership: response.membership,
      alreadyMember: response.alreadyMember
    };
  },

  // Get current user's member settings (including permissions)
  getCurrentUserMemberSettings: async (networkId: string): Promise<{ permissions: string[]; isOwner: boolean }> => {
    const response = await api.get<{ permissions: string[]; isOwner: boolean }>(`/networks/${networkId}/member-settings`);
    return {
      permissions: response.permissions || [],
      isOwner: response.isOwner || false
    };
  },

  // Member Intents Management
  // Get current user's intents in a network
  getMyNetworkIntents: async (networkId: string): Promise<Array<{
    id: string;
    payload: string;
    summary?: string | null;
    createdAt: string;
    userId: string;
    userName: string;
  }>> => {
    const response = await api.get<{ intents: Array<{
      id: string;
      payload: string;
      summary?: string | null;
      createdAt: string;
      userId: string;
      userName: string;
    }> }>(`/networks/${networkId}/my-intents`);
    return response.intents || [];
  },

  // Remove member intent from network (deprecated - kept for backwards compatibility)
  removeMemberIntent: async (networkId: string, intentId: string): Promise<void> => {
    await api.delete(`/networks/${networkId}/member-intents/${intentId}`);
  }
});

// Non-authenticated service for public endpoints
export const networksService = {
  // Get network by share code (public access, no auth required)
  getNetworkByShareCode: async (code: string): Promise<Network> => {
    const response = await apiClient.getPublic<APIResponse<Network>>(`/networks/share/${code}`);
    if (!response.network) {
      throw new Error('Network not found');
    }
    return response.network;
  },

  // Get public network by ID (public access, no auth required - only works for public networks)
  getPublicNetworkById: async (id: string): Promise<Network> => {
    const response = await apiClient.getPublic<APIResponse<Network>>(`/networks/public/${id}`);
    if (!response.network) {
      throw new Error('Network not found');
    }
    return response.network;
  },

  // Legacy methods that require authentication
  getNetworks: () => { throw new Error('Use useNetworkService() hook instead of networksService directly'); },
  getNetwork: () => { throw new Error('Use useNetworkService() hook instead of networksService directly'); },
  createNetwork: () => { throw new Error('Use useNetworkService() hook instead of networksService directly'); },
  updateNetwork: () => { throw new Error('Use useNetworkService() hook instead of networksService directly'); },
  deleteNetwork: () => { throw new Error('Use useNetworkService() hook instead of networksService directly'); },
  addMember: () => { throw new Error('Use useNetworkService() hook instead of networksService directly'); },
  removeMember: () => { throw new Error('Use useNetworkService() hook instead of networksService directly'); },
};

// Hook for using networks service with proper error handling
export function useNetworkService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createNetworksService(api), [api]);
} 

