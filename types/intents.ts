import { ISODateString, UUID } from './common';
import { UserSummary } from './users';

export interface IntentIndex {
  indexId: UUID;
  indexTitle?: string;
}

export interface Intent {
  id: UUID;
  payload: string;
  summary?: string | null;
  isIncognito: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  archivedAt?: ISODateString | null;
  user: UserSummary;
  _count?: {
    indexes: number;
  };
  indexes?: IntentIndex[];
}

export interface SuggestedIntent {
  id: UUID;
  payload: string;
  isAdded?: boolean;
}

export interface CreateIntentRequest {
  payload: string;
  indexIds: UUID[];
  isIncognito?: boolean;
}

export interface UpdateIntentRequest {
  payload?: string;
  isIncognito?: boolean;
  indexIds?: UUID[];
}

// Stake related types
export interface Agent {
  id: UUID;
  name: string;
  role?: string;
  avatar: string;
}

export interface IntentStake {
  agent: {
    name: string;
    avatar: string;
  };
  stake: string;
}

export interface IntentStakesByUserResponse {
  user: UserSummary;
  totalStake: string;
  agents: IntentStake[];
}

export interface StakesByUserResponse {
  user: UserSummary;
  intents: Array<{
    intent: {
      id: UUID;
      summary?: string;
      payload: string;
      updatedAt: ISODateString;
    };
    totalStake: string;
    agents: IntentStake[];
  }>;
}