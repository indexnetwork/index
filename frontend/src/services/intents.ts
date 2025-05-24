export interface Agent {
  id: string;
  name: string;
  role: string;
  avatar: string;
}

export const agents: Agent[] = [
  {
    id: "proofLayer",
    name: "ProofLayer",
    role: "Due Diligence Agent",
    avatar: "/avatars/agents/privado.svg"
  },
  {
    id: "threshold",
    name: "Threshold",
    role: "Network Manager Agent",
    avatar: "/avatars/agents/reputex.svg"
  },
  {
    id: "aspecta",
    name: "Aspecta",
    role: "Reputation Agent",
    avatar: "/avatars/agents/hapi.svg"
  },
  {
    id: "semanticRelevancy",
    name: "Semantic Relevancy",
    role: "Relevancy Agent",
    avatar: "/avatars/agents/trusta.svg"
  }
];

export interface Intent {
  id: string;
  title: string;
  updatedAt: string;
  connections: number;
  status: 'active' | 'archived' | 'suggested';
  indexes: {
    id: string;
    name: string;
    members: number;
  }[];
}

export interface IntentConnection {
  id: string;
  name: string;
  role: string;
  avatar: string;
  connectionRationale: string;
  backers: {
    agentId: string;
    confidence: number;
  }[];
}

import { apiClient } from '../lib/api';
import { getAuthToken } from '../lib/auth';

// Real API service functions
export const intentsService = {
  getIntents: async (status?: 'active' | 'archived' | 'suggested'): Promise<Intent[]> => {
    try {
      const token = getAuthToken();
      const params = status ? `?status=${status}` : '';
      const response = await apiClient.get(`/api/intents${params}`, token || undefined);
      
      // Transform the API response to match our frontend interface
      return response.intents?.map((intent: any) => ({
        id: intent.id,
        title: intent.title,
        updatedAt: new Date(intent.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        connections: intent.intentPairs?.length || 0,
        status: intent.status === 'draft' ? 'suggested' : intent.status,
        indexes: intent.indexes?.map((index: any) => ({
          id: index.id,
          name: index.name,
          members: index._count?.members || 0
        })) || []
      })) || [];
    } catch (error) {
      console.error('Error fetching intents:', error);
      return [];
    }
  },

  getIntent: async (id: string): Promise<Intent | undefined> => {
    try {
      const token = getAuthToken();
      const response = await apiClient.get(`/api/intents/${id}`, token || undefined);
      
      if (!response.intent) return undefined;
      
      const intent = response.intent;
      return {
        id: intent.id,
        title: intent.title,
        updatedAt: new Date(intent.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        connections: intent.intentPairs?.length || 0,
        status: intent.status === 'draft' ? 'suggested' : intent.status,
        indexes: intent.indexes?.map((index: any) => ({
          id: index.id,
          name: index.name,
          members: index.files?.length || 0
        })) || []
      };
    } catch (error) {
      console.error('Error fetching intent:', error);
      return undefined;
    }
  },

  getIntentConnections: async (): Promise<IntentConnection[]> => {
    try {
      // This would need to be implemented in the backend API
      // For now, return empty array until the backend provides this endpoint
      return [];
    } catch (error) {
      console.error('Error fetching intent connections:', error);
      return [];
    }
  },

  createIntent: async (intent: { title: string; indexIds: string[] }): Promise<Intent> => {
    try {
      const token = getAuthToken();
      const response = await apiClient.post('/api/intents', {
        title: intent.title,
        payload: intent.title, // Using title as payload for now
        indexIds: intent.indexIds
      }, token || undefined);
      
      const newIntent = response.intent;
      return {
        id: newIntent.id,
        title: newIntent.title,
        updatedAt: new Date(newIntent.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        connections: 0,
        status: newIntent.status === 'draft' ? 'suggested' : newIntent.status,
        indexes: newIntent.indexes?.map((index: any) => ({
          id: index.id,
          name: index.name,
          members: Math.floor(Math.random() * 10) + 1 // Fallback until we have actual member data
        })) || []
      };
    } catch (error) {
      console.error('Error creating intent:', error);
      throw error;
    }
  },

  updateIntent: async (id: string, updates: Partial<Intent>): Promise<Intent | undefined> => {
    try {
      const token = getAuthToken();
      const response = await apiClient.put(`/api/intents/${id}`, {
        title: updates.title,
        status: updates.status === 'suggested' ? 'draft' : updates.status,
        indexIds: updates.indexes?.map(index => index.id)
      }, token || undefined);
      
      if (!response.intent) return undefined;
      
      const intent = response.intent;
      return {
        id: intent.id,
        title: intent.title,
        updatedAt: new Date(intent.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        connections: intent.intentPairs?.length || 0,
        status: intent.status === 'draft' ? 'suggested' : intent.status,
        indexes: intent.indexes?.map((index: any) => ({
          id: index.id,
          name: index.name,
          members: index.files?.length || 0
        })) || []
      };
    } catch (error) {
      console.error('Error updating intent:', error);
      return undefined;
    }
  },

  deleteIntent: async (id: string): Promise<boolean> => {
    try {
      const token = getAuthToken();
      await apiClient.delete(`/api/intents/${id}`, token || undefined);
      return true;
    } catch (error) {
      console.error('Error deleting intent:', error);
      return false;
    }
  }
}; 