import { useAuthenticatedAPI } from '../lib/api';

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
  createdAt: string;
  updatedAt: string;
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
});
