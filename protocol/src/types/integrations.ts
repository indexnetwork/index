import { ISODateString, UUID } from './common';

export interface DirectorySyncConfig {
  enabled: boolean;
  source: {
    id: string;
    name: string;
    subId?: string;
    subName?: string;
  };
  columnMappings: {
    email: string;
    name?: string;
    intro?: string;
    location?: string;
    twitter?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  };
  excludedColumns?: string[];
  lastSyncAt?: ISODateString;
  lastSyncStatus?: 'success' | 'error' | 'partial';
  lastSyncError?: string;
  memberCount?: number;
}

export interface IntegrationConfigType {
  directorySync?: DirectorySyncConfig;
}

export interface IntegrationResponse {
  id: UUID;
  type: string;
  name: string;
  connected: boolean;
  connectedAt?: ISODateString | null;
  lastSyncAt?: ISODateString | null;
  indexId?: UUID | null;
  status?: string;
}

export interface AvailableIntegrationType {
  type: string;
  name: string;
  toolkit: string;
  capabilities?: any;
}

export interface ConnectIntegrationRequest {
  indexId?: UUID;
  enableUserAttribution?: boolean;
}

export interface ConnectIntegrationResponse {
  redirectUrl: string;
  integrationId: UUID;
}

export interface IntegrationStatusResponse {
  status: 'pending' | 'connected';
  connectedAt?: ISODateString;
}
export interface DirectorySyncError {
  record: Record<string, unknown>;
  error: string;
}
export type SyncProviderName = 'links' | 'notion' | 'slack' | 'discord' | 'airtable' | 'linkedin';

export interface SyncParams {
  indexId?: UUID;
  [key: string]: unknown;
}

export interface SyncResponse {
  accepted: boolean;
}