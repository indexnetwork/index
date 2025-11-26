import { useAuthenticatedAPI } from '../lib/api';
import {
  IntegrationResponse,
  AvailableIntegrationType,
  ConnectIntegrationRequest,
  ConnectIntegrationResponse,
  IntegrationStatusResponse,
  DirectorySyncConfig,
  DirectorySyncError
} from '../types';

// Service functions factory that takes an authenticated API instance
export const createIntegrationsService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Get all integrations, optionally filtered by indexId
  getIntegrations: async (indexId?: string): Promise<{ 
    integrations: IntegrationResponse[]; 
    availableTypes: AvailableIntegrationType[] 
  }> => {
    const url = indexId ? `/integrations?indexId=${indexId}` : '/integrations';
    return api.get<{ 
      integrations: IntegrationResponse[]; 
      availableTypes: AvailableIntegrationType[] 
    }>(url);
  },

  // Connect an integration to an index
  connectIntegration: async (
    integrationType: string, 
    data: ConnectIntegrationRequest
  ): Promise<ConnectIntegrationResponse> => {
    return api.post<ConnectIntegrationResponse>(`/integrations/connect/${integrationType}`, data);
  },

  // Check integration status using integrationId
  getIntegrationStatus: async (integrationId: string): Promise<IntegrationStatusResponse> => {
    return api.get<IntegrationStatusResponse>(`/integrations/${integrationId}/status`);
  },

  // Disconnect integration using integrationId
  disconnectIntegration: async (integrationId: string): Promise<{ success: boolean }> => {
    return api.delete<{ success: boolean }>(`/integrations/${integrationId}`);
  },

  // Directory sync methods
  getDirectorySources: async (integrationId: string): Promise<{ sources: Array<{ id: string; name: string; subSources?: Array<{ id: string; name: string }> }> }> => {
    return api.get(`/integrations/${integrationId}/directory/sources`);
  },

  getDirectorySourceSchema: async (integrationId: string, sourceId: string, subSourceId?: string): Promise<{ columns: Array<{ id: string; name: string; type?: string }> }> => {
    const params = subSourceId ? `?subSourceId=${encodeURIComponent(subSourceId)}` : '';
    return api.get(`/integrations/${integrationId}/directory/sources/${sourceId}/schema${params}`);
  },

  getDirectoryConfig: async (integrationId: string): Promise<{ config: DirectorySyncConfig | null }> => {
    return api.get(`/integrations/${integrationId}/directory/config`);
  },

  saveDirectoryConfig: async (integrationId: string, config: Omit<DirectorySyncConfig, 'enabled' | 'lastSyncAt' | 'lastSyncStatus' | 'lastSyncError' | 'memberCount'>): Promise<{ success: boolean; config: DirectorySyncConfig }> => {
    return api.post(`/integrations/${integrationId}/directory/config`, { config });
  },

  syncDirectory: async (integrationId: string): Promise<{ success: boolean; membersAdded: number; errors: DirectorySyncError[]; status: 'success' | 'error' | 'partial' }> => {
    return api.post(`/integrations/${integrationId}/directory/sync`);
  },
});

// Hook for using integrations service with proper error handling
export function useIntegrationsService() {
  const api = useAuthenticatedAPI();
  return createIntegrationsService(api);
}
