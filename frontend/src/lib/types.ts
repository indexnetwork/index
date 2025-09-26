// User types
export interface User {
  id: string;
  privyId: string;
  email: string | null;
  name: string;
  intro: string | null;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
}

// Index types
export interface Index {
  id: string;
  title: string;
  prompt?: string | null;
  permissions?: {
    joinPolicy: 'anyone' | 'invite_only';
    invitationLink: {
      code: string;
    } | null;
    allowGuestVibeCheck: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string;
    email: string | null;
    avatar: string | null;
  };
  _count: {
    files: number;
    members: number;
  };
  files?: FileRecord[];
  members?: IndexMember[];
  suggestedIntents?: SuggestedIntent[];
}

export interface FileRecord {
  id: string;
  name: string;
  type: string;
  size: number | string;
  createdAt: string;
  url?: string;
}

export interface IndexMember {
  userId: string;
  userName: string;
  userEmail: string | null;
  userAvatar: string | null;
  permissions?: string[];
  createdAt?: string;
}

export interface SuggestedIntent {
  id: string;
  payload: string;
  isAdded?: boolean;
}

// Intent types
export interface Intent {
  id: string;
  payload: string;
  summary?: string | null;
  isIncognito: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  user: {
    id: string;
    name: string;
    email: string | null;
    avatar: string | null;
  };
  _count: {
    indexes: number;
  };
  indexes?: IntentIndex[];
}

export interface IntentIndex {
  indexId: string;
  indexTitle: string;
}

export interface IntentStakesByUserResponse {
  user: {
    id: string;
    name: string;
    avatar: string;
  };
  totalStake: string;
  agents: Array<{
    agent: {
      name: string;
      avatar: string;
    };
    stake: string;
  }>;
}

export interface StakesByUserResponse {
  user: {
    id: string;
    name: string;
    avatar: string;
  };
  intents: Array<{
    intent: {
      id: string;
      summary?: string;
      payload: string;
      updatedAt: string;
    };
    totalStake: string;
    agents: Array<{
      agent: {
        name: string;
        avatar: string;
      };
      stake: string;
    }>;
  }>;
}

// Agent types
export interface Agent {
  id: string;
  name: string;
  role: string;
  avatar: string;
}

// Market types
export interface MarketPosition {
  id: string;
  amount: number;
  shares: number;
  outcome: boolean;
  createdAt: string;
}

export interface Market {
  id: string;
  question: string;
  description: string;
  endDate: string;
  totalVolume: number;
  probability: number;
  positions: MarketPosition[];
  createdAt: string;
  updatedAt: string;
}

// API Response types
export interface PaginatedResponse<T> {
  data?: T[];
  indexes?: T[]; // For indexes endpoint
  intents?: T[]; // For intents endpoint
  pagination: {
    current: number;
    total: number;
    count: number;
    totalCount: number;
  };
}

export interface APIResponse<T> {
  data?: T;
  user?: T; // For auth endpoints
  index?: T; // For single index
  intent?: T; // For single intent
  stakes?: T[]; // For intent stakes
  stakesByUser?: T;
  aggregated_reasoning?: string; // For aggregated stake reasonings
  message?: string;
  error?: string;
}

// Request types
export interface CreateIndexRequest {
  title: string;
  prompt?: string;
  joinPolicy?: 'anyone' | 'invite_only';
}

export interface UpdateIndexRequest {
  title?: string;
  prompt?: string | null;
  joinPolicy?: 'anyone' | 'invite_only';
}

export interface CreateIntentRequest {
  payload: string;
  indexIds: string[];
  isIncognito?: boolean;
}

export interface UpdateIntentRequest {
  payload?: string;
  isIncognito?: boolean;
  indexIds?: string[];
}

export interface UpdateProfileRequest {
  name?: string;
  intro?: string;
  avatar?: string;
}

export interface CreateMarketPositionRequest {
  amount: number;
  outcome: boolean;
}

// File upload response
export interface FileUploadResponse {
  file: FileRecord;
  message: string;
}

// Avatar upload response
export interface AvatarUploadResponse {
  message: string;
  avatarFilename: string;
}

// Error response
export interface ErrorResponse {
  error: string;
  errors?: Array<{
    field: string;
    message: string;
  }>;
}

// Connection types
export interface ConnectionEvent {
  id: string;
  initiatorUserId: string;
  receiverUserId: string;
  eventType: 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE';
  createdAt: string;
  initiatorUser?: {
    id: string;
    name: string;
    avatar: string | null;
  };
  receiverUser?: {
    id: string;
    name: string;
    avatar: string | null;
  };
}

export interface ConnectionStatus {
  status: 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE' | null;
  isInitiator: boolean;
  event: ConnectionEvent | null;
}

export interface ConnectionEventsResponse {
  events: ConnectionEvent[];
  pagination: {
    current: number;
    total: number;
    count: number;
    totalCount: number;
  };
}

export interface CreateConnectionActionRequest {
  targetUserId: string;
  action: 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE';
}

export interface UserConnection {
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
  status: 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE';
  isInitiator: boolean;
  lastUpdated: string;
}

export interface ConnectionsByUserResponse {
  connections: UserConnection[];
}
