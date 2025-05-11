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

// Mock data
const mockIntents: Intent[] = [
  {
    id: "1",
    title: "Looking to meet early stage founders building privacy-preserving agent coordination infra.",
    updatedAt: "May 6",
    connections: 4,
    status: "active"
  },
  {
    id: "2",
    title: "Want to connect with investors interested in funding user-centric technologies.",
    updatedAt: "May 6",
    connections: 4,
    status: "active"
  },
  {
    id: "3",
    title: "Looking for AI researchers working on multi-agent systems.",
    updatedAt: "May 5",
    connections: 0,
    status: "suggested"
  },
  {
    id: "4",
    title: "Interested in connecting with developers building privacy-preserving protocols.",
    updatedAt: "May 5",
    connections: 0,
    status: "suggested"
  }
];

const mockConnections: IntentConnection[] = [
  {
    id: "1",
    name: "Seref Yarar",
    role: "Co-founder of Lighthouse",
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

// Mock service functions
export const intentsService = {
  getIntents: (status?: 'active' | 'archived' | 'suggested'): Promise<Intent[]> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (status) {
          resolve(mockIntents.filter(intent => intent.status === status));
        } else {
          resolve(mockIntents);
        }
      }, 500);
    });
  },

  getIntent: (id: string): Promise<Intent | undefined> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(mockIntents.find(intent => intent.id === id));
      }, 500);
    });
  },

  getIntentConnections: (intentId: string): Promise<IntentConnection[]> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(mockConnections);
      }, 500);
    });
  },

  createIntent: (intent: Omit<Intent, 'id'>): Promise<Intent> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const newIntent = {
          ...intent,
          id: Math.random().toString(36).substr(2, 9)
        };
        mockIntents.push(newIntent);
        resolve(newIntent);
      }, 500);
    });
  },

  updateIntent: (id: string, updates: Partial<Intent>): Promise<Intent | undefined> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const index = mockIntents.findIndex(intent => intent.id === id);
        if (index !== -1) {
          mockIntents[index] = { ...mockIntents[index], ...updates };
          resolve(mockIntents[index]);
        } else {
          resolve(undefined);
        }
      }, 500);
    });
  },

  deleteIntent: (id: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const index = mockIntents.findIndex(intent => intent.id === id);
        if (index !== -1) {
          mockIntents.splice(index, 1);
          resolve(true);
        } else {
          resolve(false);
        }
      }, 500);
    });
  }
}; 