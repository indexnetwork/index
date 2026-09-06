import { useAuthenticatedAPI } from '../lib/api';

/** Info returned when listing API keys (the raw key is never returned after creation). */
export interface ApiKeyInfo {
  id: string;
  name: string | null;
  start: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Response from creating a new API key. The `key` field is only shown once. */
export interface CreateApiKeyResponse {
  key: string;
  id: string;
  name: string | null;
  createdAt: string;
}

/** Service factory for the user's API keys. A key authenticates its owner. */
export const createApiKeysService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  /** Mint a new key with the given display name. */
  create: async (name: string): Promise<CreateApiKeyResponse> => {
    return api.post<CreateApiKeyResponse>('/auth/keys', { name });
  },

  /** List the current user's keys. */
  list: async (): Promise<ApiKeyInfo[]> => {
    const response = await api.get<{ keys: ApiKeyInfo[] }>('/auth/keys');
    return Array.isArray(response.keys) ? response.keys : [];
  },

  /** Permanently revoke a key by ID. */
  revoke: async (id: string): Promise<void> => {
    await api.delete<void>(`/auth/keys/${id}`);
  },
});
