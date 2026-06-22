import { UUID, PaginationInfo } from './common.types';

// Generic API Response wrapper
export interface APIResponse<T> {
  data?: T;
  user?: T; // For auth endpoints
  network?: T; // For single network
  networks?: T[]; // For list of networks
  intent?: T; // For single intent
  stakes?: T[]; // For intent stakes
  stakesByUser?: T;
  aggregated_reasoning?: string; // For aggregated stake reasonings
  message?: string;
  error?: string;
  pagination?: PaginationInfo;
}

// Error response structure
export interface ErrorResponse {
  error: string;
  errors?: Array<{
    field: string;
    message: string;
  }>;
}

// Synthesis types
export interface SynthesisRequest {
  targetUserId: UUID;
  initiatorId?: UUID;
  intentIds?: UUID[];
  networkIds?: UUID[];
  options?: {
    characterLimit?: number;
    [key: string]: unknown;
  };
}

export interface SynthesisResponse {
  synthesis: string;
  targetUserId: UUID;
  contextUserId: UUID;
  connectingStakes: number;
}
export interface JobTypeCounts {
  pending: number;
  active: number;
  completed: number;
}

export interface QueueStatusResponse {
  jobCounts: {
    [jobType: string]: JobTypeCounts;
  };
  totalPending: number;
}
