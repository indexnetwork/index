import { useMemo } from 'react';
import type { Network } from '@/types';
import type { PaginatedResponse } from '@/types';
import { apiClient } from '@/lib/api';

/** Response shape from GET /networks (member + personal networks; "Everywhere" is static in UI). */
export interface NetworkListV2Response {
  networks: Network[];
  pagination: { current: number; total: number; count: number; totalCount: number };
}

export function createIndexesServiceV2() {
  return {
    getIndexes: async (): Promise<PaginatedResponse<Network>> => {
      const data = await apiClient.get<NetworkListV2Response>('/networks');
      return {
        data: data.networks ?? [],
        pagination: data.pagination ?? { current: 1, total: 0, count: 0, totalCount: 0 },
      };
    },

    getPublicIndexes: async (): Promise<PaginatedResponse<Network>> => {
      const data = await apiClient.get<NetworkListV2Response>('/networks/discovery/public');
      return {
        data: data.networks ?? [],
        pagination: data.pagination ?? { current: 1, total: 0, count: 0, totalCount: 0 },
      };
    },

    joinPublicNetwork: async (networkId: string): Promise<Network> => {
      const data = await apiClient.post<{ network: Network }>(`/networks/${networkId}/join`);
      return data.network;
    },
  };
}

export function useIndexesV2() {
  return useMemo(() => createIndexesServiceV2(), []);
}
