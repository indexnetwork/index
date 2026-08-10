import { apiClient } from '@/lib/api';
import type { HermesCapabilityAction } from '@/lib/hermes-auth';

export type HermesAuthorizationRequestView = {
  requestId: string;
  installationId: string;
  installationName: string;
  actions: HermesCapabilityAction[];
  expiresAt: string;
};

export type HermesAuthorizationApproval = {
  requestId: string;
  code: string;
  state: string;
};

export type ConnectedHermesAgent = {
  installationId: string;
  installationName: string;
  agentId: string;
  actions: HermesCapabilityAction[];
  activationState: 'pending' | 'active' | 'revoked';
  selected: boolean;
  lastHeartbeatAt: string | null;
  expiresAt: string;
  health: 'pending' | 'active' | 'stale' | 'never_seen' | 'expired' | 'revoked';
  indexCovering: boolean;
};

export const hermesAuthorizationService = {
  getRequest(requestId: string, state: string, redirectUri: string): Promise<HermesAuthorizationRequestView> {
    return apiClient.get(`/hermes-authorizations/${encodeURIComponent(requestId)}?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`);
  },

  approve(requestId: string, state: string, redirectUri: string): Promise<HermesAuthorizationApproval> {
    return apiClient.post(`/hermes-authorizations/${encodeURIComponent(requestId)}/approve`, {
      state,
      redirectUri,
    });
  },
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
