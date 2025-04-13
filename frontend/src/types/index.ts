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
  status: 'potential' | 'pending' | 'accepted' | 'declined';
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

export type IntegrationSource = 'linkedin' | 'gmail' | 'calendar';

export interface Integration {
  id: string;
  source: IntegrationSource;
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  lastSyncedAt?: string;
  error?: string;
}

export interface File {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  status: 'encrypted' | 'processing' | 'ready';
  encryptionKey?: string;
  source: IntegrationSource;
  integrationId?: string;
} 