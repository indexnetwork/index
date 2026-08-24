import { apiClient } from '@/lib/api';
import type { HermesCapabilityAction } from '@/lib/hermes-auth';

export type ConnectedHermesAgent = {
  installationId: string;
  installationName: string;
  agentId: string;
  actions: HermesCapabilityAction[];
  activationState: 'active' | 'revoked';
  selected: boolean;
  lastHeartbeatAt: string | null;
  expiresAt: string;
  health: 'active' | 'stale' | 'never_seen' | 'expired' | 'revoked';
  indexCovering: boolean;
};

export const connectedAgentsService = {
  async list(): Promise<ConnectedHermesAgent[]> {
    const response = await apiClient.get<{ connections: ConnectedHermesAgent[] }>('/connected-agents/hermes');
    return response.connections;
  },

  pause(installationId: string): Promise<ConnectedHermesAgent> {
    return apiClient.post(`/connected-agents/hermes/${encodeURIComponent(installationId)}/pause`);
  },

  revoke(installationId: string): Promise<{ revoked: true }> {
    return apiClient.delete(`/connected-agents/hermes/${encodeURIComponent(installationId)}`);
  },
};
