import { UUID, PaginationInfo } from './common';
import { User } from './users';
import { Index } from './indexes';
import { Intent, IntentStake } from './intents';

// Generic API Response wrapper
export interface APIResponse<T> {
  data?: T;
  user?: T; // For auth endpoints
  index?: T; // For single index
  indexes?: T[]; // For list of indexes
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
  indexIds?: UUID[];
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