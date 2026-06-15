import { ConnectionEvent, ConnectionsByUserResponse } from '../types';

// Service functions factory that takes an authenticated API instance
export const createConnectionsService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Get connections by user (aggregated)
  getConnectionsByUser: async (
    type: 'inbox' | 'pending' | 'history' = 'inbox',
    networkIds?: string[]
  ): Promise<ConnectionsByUserResponse> => {
    const requestBody = {
      type,
      ...(networkIds && networkIds.length > 0 && { networkIds })
    };
    const response = await api.post<ConnectionsByUserResponse>('/connections/by-user', requestBody);
    return response;
  },

  // Convenience methods for specific actions
  requestConnection: async (targetUserId: string): Promise<ConnectionEvent> => {
    return await api.post<{event: ConnectionEvent}>('/connections/actions', {
      targetUserId,
      action: 'REQUEST'
    }).then(res => res.event);
  },

  skipConnection: async (targetUserId: string): Promise<ConnectionEvent> => {
    return await api.post<{event: ConnectionEvent}>('/connections/actions', {
      targetUserId,
      action: 'SKIP'
    }).then(res => res.event);
  },

  acceptConnection: async (targetUserId: string): Promise<ConnectionEvent> => {
    return await api.post<{event: ConnectionEvent}>('/connections/actions', {
      targetUserId,
      action: 'ACCEPT'
    }).then(res => res.event);
  },

  declineConnection: async (targetUserId: string): Promise<ConnectionEvent> => {
    return await api.post<{event: ConnectionEvent}>('/connections/actions', {
      targetUserId,
      action: 'DECLINE'
    }).then(res => res.event);
  },

  cancelConnection: async (targetUserId: string): Promise<ConnectionEvent> => {
    return await api.post<{event: ConnectionEvent}>('/connections/actions', {
      targetUserId,
      action: 'CANCEL'
    }).then(res => res.event);
  }
}); 