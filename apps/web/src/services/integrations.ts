import { useMemo } from 'react';
import { useAuthenticatedAPI } from '../lib/api';

export interface ComposioConnection {
  id: string;
  toolkit: string;
  status: string;
  createdAt: string;
}

export interface ImportContactsResult {
  imported: number;
  skipped: number;
  newContacts: number;
  existingContacts: number;
}

export const createIntegrationsService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  getConnections: async (networkId?: string): Promise<{ connections: ComposioConnection[] }> => {
    const qs = networkId ? `?networkId=${encodeURIComponent(networkId)}` : '';
    return api.get<{ connections: ComposioConnection[] }>(`/integrations${qs}`);
  },

  connect: async (toolkit: string): Promise<{ redirectUrl: string }> => {
    return api.post<{ redirectUrl: string }>(`/integrations/connect/${toolkit}`);
  },

  linkIntegration: async (toolkit: string, networkId: string): Promise<{ success: boolean }> => {
    return api.post<{ success: boolean }>(`/integrations/${toolkit}/link`, { networkId });
  },

  unlinkIntegration: async (toolkit: string, networkId: string): Promise<{ success: boolean }> => {
    return api.delete<{ success: boolean }>(`/integrations/${toolkit}/link?networkId=${encodeURIComponent(networkId)}`);
  },

  disconnect: async (id: string): Promise<{ success: boolean }> => {
    return api.delete<{ success: boolean }>(`/integrations/${id}`);
  },

  importContacts: async (toolkit: string, networkId?: string): Promise<ImportContactsResult> => {
    return api.post<ImportContactsResult>(`/integrations/${toolkit}/import`, { networkId });
  },
});

export function useIntegrationsService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createIntegrationsService(api), [api]);
}
