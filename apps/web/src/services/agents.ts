import { useAuthenticatedAPI } from '../lib/api';

export interface AgentPermission {
  id: string;
  agentId: string;
  userId: string;
  scope: 'global' | 'node' | 'network';
  scopeId: string | null;
  actions: string[];
  createdAt: string;
}

export interface Agent {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  type: 'external' | 'system';
  status: 'active' | 'inactive';
  notifyOnOpportunity: boolean;
  dailySummaryEnabled: boolean;
  handleNegotiations: boolean;
  metadata: Record<string, unknown>;
  permissions: AgentPermission[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentTokenInfo {
  id: string;
  name: string | null;
  start: string;
  createdAt: string;
  lastUsedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AgentTokenCreateResponse {
  id: string;
  key: string;
  name: string | null;
  createdAt: string;
}

export const createAgentsService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  list: async (): Promise<Agent[]> => {
    const response = await api.get<{ agents?: Agent[] } | Agent[]>('/agents');
    if (Array.isArray(response)) {
      return response;
    }

    return Array.isArray(response.agents) ? response.agents : [];
  },

  get: async (agentId: string): Promise<Agent> => {
    const response = await api.get<{ agent: Agent }>(`/agents/${agentId}`);
    return response.agent;
  },

  create: async (name: string, description?: string): Promise<Agent> => {
    const response = await api.post<{ agent: Agent }>('/agents', { name, description });
    return response.agent;
  },

  update: async (
    agentId: string,
    updates: { name?: string; description?: string | null; status?: 'active' | 'inactive'; notifyOnOpportunity?: boolean; dailySummaryEnabled?: boolean; handleNegotiations?: boolean },
  ): Promise<Agent> => {
    const response = await api.patch<{ agent: Agent }>(`/agents/${agentId}`, updates);
    return response.agent;
  },

  delete: async (agentId: string): Promise<void> => {
    await api.delete<void>(`/agents/${agentId}`);
  },

  grantPermission: async (
    agentId: string,
    actions: string[],
    scope?: 'global' | 'node' | 'network',
    scopeId?: string,
  ): Promise<AgentPermission> => {
    const response = await api.post<{ permission: AgentPermission }>(`/agents/${agentId}/permissions`, {
      actions,
      scope,
      scopeId,
    });
    return response.permission;
  },

  revokePermission: async (agentId: string, permissionId: string): Promise<void> => {
    await api.delete<void>(`/agents/${agentId}/permissions/${permissionId}`);
  },

  listTokens: async (agentId: string): Promise<AgentTokenInfo[]> => {
    const response = await api.get<{ tokens: AgentTokenInfo[] }>(`/agents/${agentId}/tokens`);
    return response.tokens;
  },

  createToken: async (agentId: string, name?: string): Promise<AgentTokenCreateResponse> => {
    const response = await api.post<{ token: AgentTokenCreateResponse }>(`/agents/${agentId}/tokens`, { name });
    return response.token;
  },

  revokeToken: async (agentId: string, tokenId: string): Promise<void> => {
    await api.delete<void>(`/agents/${agentId}/tokens/${tokenId}`);
  },
});
