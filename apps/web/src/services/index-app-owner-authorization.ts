import { apiClient } from '@/lib/api';

export type IndexAppOwnerAuthorizationRequestView = {
  requestId: string;
  installationId: string;
  legacyRevocationRequired: boolean;
  expiresAt: string;
};

export const indexAppOwnerAuthorizationService = {
  getRequest(requestId: string, state: string, redirectUri: string): Promise<IndexAppOwnerAuthorizationRequestView> {
    return apiClient.get(`/index-app-owner-authorizations/${encodeURIComponent(requestId)}?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`);
  },
  approve(requestId: string, state: string, redirectUri: string): Promise<{
    requestId: string; code: string; state: string;
  }> {
    return apiClient.post(`/index-app-owner-authorizations/${encodeURIComponent(requestId)}/approve`, {
      state, redirectUri,
    });
  },
};
