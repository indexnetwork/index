import { useAuthenticatedAPI } from '@/lib/api';

export interface Integration {
  id: string;
  name: string;
  connected: boolean;
  connectedAt?: string;
  connectionId?: string;
}

export interface ConnectionRequest {
  redirectUrl: string;
  connectionRequestId: string;
}

export interface ConnectionStatus {
  status: 'pending' | 'connected' | 'disconnected';
  connectedAt?: string;
  connectionId?: string;
}

// Create integrations service with authenticated API
export function createIntegrationsService(api: ReturnType<typeof useAuthenticatedAPI>) {
  return {
    // Get all user integrations status
    async getIntegrations(): Promise<{ integrations: Integration[] }> {
      return api.get<{ integrations: Integration[] }>('/integrations');
    },

    // Initiate OAuth flow for an integration
    async connectIntegration(integrationType: string): Promise<ConnectionRequest> {
      return api.post<ConnectionRequest>(`/integrations/connect/${integrationType}`);
    },

    // Check connection status
    async checkConnectionStatus(connectionRequestId: string): Promise<ConnectionStatus> {
      return api.get<ConnectionStatus>(`/integrations/status/${connectionRequestId}`);
    },

    // Disconnect an integration
    async disconnectIntegration(integrationType: string): Promise<{ success: boolean }> {
      return api.delete<{ success: boolean }>(`/integrations/${integrationType}`);
    }
  };
}

// Hook for using integrations service with proper error handling
export function useIntegrationsService() {
  const api = useAuthenticatedAPI();
  return createIntegrationsService(api);
} 