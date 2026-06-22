import { ISODateString, UUID } from './common.types';
import { UserSummary } from './users.types';

export type ConnectionAction = 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE';

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
