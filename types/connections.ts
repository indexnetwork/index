import { ISODateString, UUID } from './common';
import { UserSummary } from './users';

export type ConnectionAction = 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE' | 'OWNER_APPROVE' | 'OWNER_DENY';

export interface ConnectionEvent {
  id: UUID;
  initiatorUserId: UUID;
  receiverUserId: UUID;
  eventType: ConnectionAction;
  createdAt: ISODateString;
  initiatorUser?: UserSummary;
  receiverUser?: UserSummary;
}

export interface ConnectionStatus {
  status: ConnectionAction | null;
  isInitiator: boolean;
  event: ConnectionEvent | null;
}

export interface UserConnection {
  user: UserSummary;
  status: ConnectionAction;
  isInitiator: boolean;
  lastUpdated: ISODateString;
}

export interface ConnectionsByUserResponse {
  connections: UserConnection[];
}

export interface CreateConnectionActionRequest {
  targetUserId: UUID;
  action: ConnectionAction;
}

// Admin specific connection types
export interface PendingConnection {
  id: UUID;
  initiator: UserSummary;
  receiver: UserSummary;
  createdAt: ISODateString;
}

export interface AdminConnectionResponse {
  connections: PendingConnection[];
}

export interface AdminConnectionActionRequest {
  initiatorUserId: UUID;
  receiverUserId: UUID;
}