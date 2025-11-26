export interface DiscoverIntent {
  id: string;
  payload: string;
  summary?: string;
  createdAt: string;
}

export interface DiscoverStake {
  intent: DiscoverIntent;
  totalStake: number;
  reasonings: string[];
}

export interface DiscoverUser {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  intro?: string | null;
}

export interface DiscoverResult {
  user: DiscoverUser;
  totalStake: number;
  intents: DiscoverStake[];
}

export interface DiscoverFilters {
  intentIds?: string[];
  userIds?: string[];
  indexIds?: string[];
  sources?: Array<{ type: 'file' | 'integration' | 'link' | 'discovery_form'; id: string }>;
  excludeDiscovered?: boolean;
  page?: number;
  limit?: number;
}

export interface DiscoverResponse {
  results: DiscoverResult[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  filters: {
    intentIds: string[] | null;
    userIds: string[] | null;
    indexIds: string[] | null;
    sources: Array<{ type: 'file' | 'integration' | 'link' | 'discovery_form'; id: string }> | null;
    excludeDiscovered?: boolean;
  };
}

export interface DiscoveryRequestResponse {
  success: boolean;
  intents: DiscoverIntent[];
  filesProcessed: number;
  linksProcessed: number;
  intentsGenerated: number;
}