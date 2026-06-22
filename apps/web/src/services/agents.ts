import { useAuthenticatedAPI } from '../lib/api';

export interface AgentTransport {
  id: string;
  agentId: string;
  channel: 'mcp';
  config: Record<string, unknown>;
  priority: number;
  active: boolean;
  failureCount: number;
}

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
  type: 'personal' | 'system';
  status: 'active' | 'inactive';
  notifyOnOpportunity: boolean;
  dailySummaryEnabled: boolean;
  handleNegotiations: boolean;
  metadata: Record<string, unknown>;
  transports: AgentTransport[];
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

  addTransport: async (
    agentId: string,
    channel: 'mcp',
    config?: Record<string, unknown>,
    priority?: number,
  ): Promise<AgentTransport> => {
    const response = await api.post<{ transport: AgentTransport }>(`/agents/${agentId}/transports`, {
      channel,
      config,
      priority,
    });
    return response.transport;
  },

  removeTransport: async (agentId: string, transportId: string): Promise<void> => {
    await api.delete<void>(`/agents/${agentId}/transports/${transportId}`);
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

  sendTestMessage: async (agentId: string, content: string): Promise<{ id: string }> => {
    const response = await api.post<{ id: string }>(`/agents/${agentId}/test-messages`, { content });
    return response;
  },
});
