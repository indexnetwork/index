import { useAuthenticatedAPI } from '../lib/api';
import { 
  Intent,
  IntentConnection,
  Agent,
  PaginatedResponse, 
  APIResponse, 
  CreateIntentRequest, 
  UpdateIntentRequest 
} from '../lib/types';
import { allAgents } from '../config/agents';

// Transform config agents to match Agent interface
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

// Legacy interface for backward compatibility
export interface LegacyIntent {
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

// Mock data for connections (this would come from a separate service)
const mockConnections: IntentConnection[] = [
  {
    id: "1",
    name: "Seref Yarar",
    role: "Co-founder of Index Network", 
    avatar: "https://i.pravatar.cc/300?u=b",
    connectionRationale: "Both share a strong focus on advancing privacy-preserving AI technologies, suggesting a natural alignment in values and vision. Notably, your research has been cited in Arya's work, which highlights an already established intellectual connection and mutual recognition within the academic and technical communities. This foundation could serve as a meaningful basis for further collaboration or shared exploration.",
    backers: [
      {
        agentId: "proofLayer",
        confidence: 0.95
      },
      {
        agentId: "threshold", 
        confidence: 0.88
      },
      {
        agentId: "aspecta",
        confidence: 0.92
      },
      {
        agentId: "semanticRelevancy",
        confidence: 0.85
      }
    ]
  },
  {
    id: "2",
    name: "Arya Mehta",
    role: "Co-founder of Lighthouse",
    avatar: "https://i.pravatar.cc/300", 
    connectionRationale: "Both share a strong focus on advancing privacy-preserving AI technologies, suggesting a natural alignment in values and vision. Notably, your research has been cited in Arya's work, which highlights an already established intellectual connection and mutual recognition within the academic and technical communities. This foundation could serve as a meaningful basis for further collaboration or shared exploration.",
    backers: [
      {
        agentId: "proofLayer",
        confidence: 0.93
      },
      {
        agentId: "threshold",
        confidence: 0.90
      },
      {
        agentId: "aspecta", 
        confidence: 0.87
      },
      {
        agentId: "semanticRelevancy",
        confidence: 0.91
      }
    ]
  }
];

// Service functions using real API
export const intentsService = {
  // Get all intents with pagination
  getIntents: async (page: number = 1, limit: number = 10): Promise<PaginatedResponse<Intent>> => {
    const api = useAuthenticatedAPI();
    const response = await api.get<PaginatedResponse<Intent>>(`/intents?page=${page}&limit=${limit}`);
    return response;
  },

  // Get single intent by ID
  getIntent: async (id: string): Promise<Intent> => {
    const api = useAuthenticatedAPI();
    const response = await api.get<APIResponse<Intent>>(`/intents/${id}`);
    if (!response.intent) {
      throw new Error('Intent not found');
    }
    return response.intent;
  },

  // Get intent connections (mock for now - would need separate connections API)
  getIntentConnections: async (): Promise<IntentConnection[]> => {
    // TODO: Replace with real API when connections endpoint is available
    return new Promise((resolve) => {
      resolve(mockConnections);
    });
  },

  // Create new intent
  createIntent: async (data: CreateIntentRequest): Promise<Intent> => {
    const api = useAuthenticatedAPI();
    const response = await api.post<APIResponse<Intent>>('/intents', data);
    if (!response.intent) {
      throw new Error('Failed to create intent');
    }
    return response.intent;
  },

  // Update intent
  updateIntent: async (id: string, data: UpdateIntentRequest): Promise<Intent> => {
    const api = useAuthenticatedAPI();
    const response = await api.patch<APIResponse<Intent>>(`/intents/${id}`, data);
    if (!response.intent) {
      throw new Error('Failed to update intent');
    }
    return response.intent;
  },

  // Delete intent
  deleteIntent: async (id: string): Promise<void> => {
    const api = useAuthenticatedAPI();
    await api.delete(`/intents/${id}`);
  },

  // Add indexes to intent
  addIndexesToIntent: async (intentId: string, indexIds: string[]): Promise<void> => {
    const api = useAuthenticatedAPI();
    await api.post(`/intents/${intentId}/indexes`, { indexIds });
  },

  // Remove indexes from intent
  removeIndexesFromIntent: async (intentId: string, indexIds: string[]): Promise<void> => {
    const api = useAuthenticatedAPI();
    // For DELETE with body, we can use a POST with _method override or use query params
    // Using query params approach:
    const queryParams = indexIds.map(id => `indexIds[]=${id}`).join('&');
    await api.delete(`/intents/${intentId}/indexes?${queryParams}`);
  }
};

// Hook for using intents service with proper error handling
export function useIntentsService() {
  return intentsService;
} 