export interface Backer {
  name: string;
  feedback: string;
  successRate: number;
  stakedAmount: number;
  avatar?: string;
  role?: string;
}

export interface StakeDistribution {
  relevancy: number;
  reputation: number;
  intentHistory: number;
  urgency: number;
}

export interface Connection {
  id: number;
  name: string;
  role: string;
  avatar: string;
  matchReason: string;
  stakeDistribution: StakeDistribution;
  backers: Backer[];
  createdAt: string;
}

export interface Intent {
  id: number;
  title: string;
  status: 'open' | 'closed';
  pendingConnections: number;
  confirmedConnections: number;
  totalConnections: number;
  connections: Connection[];
} 