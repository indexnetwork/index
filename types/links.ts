import { ISODateString, UUID } from './common';

export interface LinkRecord {
  id: UUID;
  url: string;
  createdAt?: ISODateString;
  lastSyncAt?: ISODateString | null;
  lastStatus?: string | null;
  lastError?: string | null;
  contentUrl?: string;
}

export interface LinkContentResponse {
  content?: string;
  pending?: boolean;
  url?: string;
  lastStatus?: string | null;
  lastSyncAt?: ISODateString | null;
}

export interface CreateLinkRequest {
  url: string;
}