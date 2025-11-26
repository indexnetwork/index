import { ISODateString, UUID } from './common';
import { UserSummary } from './users';
import { FileRecord } from './files';

export type IndexJoinPolicy = 'anyone' | 'invite_only';

export interface IndexPermissions {
  joinPolicy: IndexJoinPolicy;
  allowGuestVibeCheck?: boolean;
  requireApproval?: boolean;
  invitationLink?: {
    code: string;
  } | null;
}

export interface IndexMember {
  id: UUID; // This is the userId
  name: string;
  email?: string; // Made optional as protocol doesn't always return it
  avatar: string | null;
  permissions: string[];
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
  prompt?: string | null;
  autoAssign?: boolean;
}

export interface Index {
  id: UUID;
  title: string;
  prompt?: string | null;
  permissions?: IndexPermissions | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString | null;
  user: UserSummary; // Owner
  _count?: {
    files?: number;
    members: number;
    intents?: number;
  };
  files?: FileRecord[];
  members?: IndexMember[];
  isMember?: boolean; // Computed field for discovery
}

export interface CreateIndexRequest {
  title: string;
  prompt?: string;
  joinPolicy?: IndexJoinPolicy;
}

export interface UpdateIndexRequest {
  title?: string;
  prompt?: string | null;
  permissions?: {
    joinPolicy?: IndexJoinPolicy;
    allowGuestVibeCheck?: boolean;
    requireApproval?: boolean;
  };
}

export interface IndexSummary<TIntent = any> {
  totalIntents: number;
  exampleIntents: TIntent[];
  members: UserSummary[];
}