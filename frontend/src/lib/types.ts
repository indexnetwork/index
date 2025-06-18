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
  isDiscoverable: boolean;
  linkPermissions?: {
    permissions: string[];
    code: string;
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
  files?: IndexFile[];
  members?: IndexMember[];
  suggestedIntents?: SuggestedIntent[];
}

export interface IndexFile {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  indexId: string;
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
    name: string;
    avatar: string;
  };
  totalStake: string;
  aggregatedSummary: string;
  agents: Array<{
    agent: {
      name: string;
      avatar: string;
    };
    stake: string;
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
}

export interface UpdateIndexRequest {
  title?: string;
  isDiscoverable?: boolean;
  linkPermissions?: {
    permissions: string[];
    code: string;
  } | null;
}

export interface CreateIntentRequest {
  payload: string;
  indexIds: string[];
  isPublic?: boolean;
}

export interface UpdateIntentRequest {
  payload?: string;
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
  file: IndexFile;
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
