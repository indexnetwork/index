import { useAuthenticatedAPI } from '@/lib/api';

export type SyncProviderName = 'links' | 'notion' | 'slack' | 'discord' | 'airtable' | 'linkedin';

export interface SyncParams {
  indexId?: string;
  [key: string]: unknown;
}

export interface SyncResponse {
  accepted: boolean;
}

// Create sync service with authenticated API
export function createSyncService(api: ReturnType<typeof useAuthenticatedAPI>) {
  return {
    // Trigger sync for a provider
    async syncNow(
      provider: SyncProviderName,
      params?: SyncParams
    ): Promise<SyncResponse> {
      return api.post<SyncResponse>('/sync/now', {
        provider,
        params: params || {}
      });
    },

    // Sync specific link
    async syncLink(linkId: string, params?: SyncParams): Promise<SyncResponse> {
      return this.syncNow('links', { ...params, linkId });
    },

    // Sync specific integration using integrationId
    async syncIntegration(
      integrationType: SyncProviderName,
      integrationId: string
    ): Promise<SyncResponse> {
      return this.syncNow(integrationType, { integrationId });
    }
  };
}

// Hook for using sync service with proper error handling
export function useSyncService() {
  const api = useAuthenticatedAPI();
  return createSyncService(api);
}
