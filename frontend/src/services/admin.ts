// Service functions for admin operations
export const createAdminService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Get pending connections for an index
  getPendingConnections: async (indexId: string) => {
    return await api.get<{
      connections: Array<{
        id: string;
        initiator: {
          id: string;
          name: string;
          avatar: string | null;
        };
        receiver: {
          id: string;
          name: string;
          avatar: string | null;
        };
        createdAt: string;
      }>;
    }>(`/admin/${indexId}/pending-connections`);
  },

  // Approve a connection request
  approveConnection: async (indexId: string, initiatorUserId: string, receiverUserId: string) => {
    return await api.post<{
      message: string;
      event: {
        id: string;
        initiatorUserId: string;
        receiverUserId: string;
        eventType: string;
        createdAt: string;
      };
    }>(`/admin/${indexId}/approve-connection`, {
      initiatorUserId,
      receiverUserId
    });
  },

  // Deny a connection request
  denyConnection: async (indexId: string, initiatorUserId: string, receiverUserId: string) => {
    return await api.post<{
      message: string;
      event: {
        id: string;
        initiatorUserId: string;
        receiverUserId: string;
        eventType: string;
        createdAt: string;
      };
    }>(`/admin/${indexId}/deny-connection`, {
      initiatorUserId,
      receiverUserId
    });
  },

  // Get pending connection count for an index
  getPendingCount: async (indexId: string) => {
    return await api.get<{
      count: number;
    }>(`/admin/${indexId}/pending-count`);
  }
});

// Hook for using admin service
export function useAdminService() {
  return createAdminService;
}

