import { useAuthenticatedAPI } from '../lib/api';

export type NetworkRequestStatus = 'pending' | 'needs_changes';

export interface NetworkRequest {
  id: string;
  title: string;
  status: NetworkRequestStatus;
  purpose?: string;
  audience?: string;
  expectedSize?: string;
  notes?: string;
  reviewNote?: string;
  submittedAt: string;
  requestedBy?: { id: string; name: string; email: string | null };
}

export interface NetworkRequestInput {
  name: string;
  purpose?: string;
  audience?: string;
  expectedSize?: string;
  notes?: string;
}

export const createNetworkRequestsService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Submit a new "create a network" request
  create: async (input: NetworkRequestInput): Promise<NetworkRequest> => {
    const res = await api.post<{ request: NetworkRequest }>('/network-requests', input);
    return res.request;
  },

  // List the caller's own requests
  listMine: async (): Promise<NetworkRequest[]> => {
    const res = await api.get<{ requests: NetworkRequest[] }>('/network-requests');
    return res.requests || [];
  },

  // Staff-only: list all open requests awaiting review
  listPending: async (): Promise<NetworkRequest[]> => {
    const res = await api.get<{ requests: NetworkRequest[] }>('/network-requests/pending');
    return res.requests || [];
  },

  // Update and resubmit the caller's own request
  update: async (id: string, input: NetworkRequestInput): Promise<NetworkRequest> => {
    const res = await api.patch<{ request: NetworkRequest }>(`/network-requests/${id}`, input);
    return res.request;
  },

  // Dismiss (soft-delete) the caller's own request
  dismiss: async (id: string): Promise<void> => {
    await api.delete(`/network-requests/${id}`);
  },

  // Staff-only: approve or request changes on a request
  review: async (id: string, decision: 'approve' | 'needs_changes', reviewNote?: string): Promise<NetworkRequest> => {
    const res = await api.post<{ request: NetworkRequest }>(`/network-requests/${id}/review`, { decision, reviewNote });
    return res.request;
  },
});
