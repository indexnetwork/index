import { ConnectionEvent, ConnectionsByUserResponse } from '../types';

// Service functions factory that takes an authenticated API instance
export const createConnectionsService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => {
  const performAction = async (
    targetUserId: string,
    action: 'REQUEST' | 'SKIP' | 'ACCEPT' | 'DECLINE' | 'CANCEL'
  ): Promise<ConnectionEvent> => {
    const res = await api.post<{ event: ConnectionEvent }>('/connections/actions', { targetUserId, action });
    return res.event;
  };

  return {
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
    requestConnection: (targetUserId: string): Promise<ConnectionEvent> => performAction(targetUserId, 'REQUEST'),
    skipConnection: (targetUserId: string): Promise<ConnectionEvent> => performAction(targetUserId, 'SKIP'),
    acceptConnection: (targetUserId: string): Promise<ConnectionEvent> => performAction(targetUserId, 'ACCEPT'),
    declineConnection: (targetUserId: string): Promise<ConnectionEvent> => performAction(targetUserId, 'DECLINE'),
    cancelConnection: (targetUserId: string): Promise<ConnectionEvent> => performAction(targetUserId, 'CANCEL'),
  };
};