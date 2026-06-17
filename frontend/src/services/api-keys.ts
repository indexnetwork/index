import { useAuthenticatedAPI } from '../lib/api';

/** Info returned when listing API keys (the raw key is never returned after creation). */
export interface ApiKeyInfo {
  id: string;
  name: string | null;
  start: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastRefill: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Response from creating a new API key. The `key` field is only shown once. */
export interface CreateApiKeyResponse {
  key: string;
  id: string;
  name: string | null;
  createdAt: string;
}

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeApiKeyInfo(value: unknown): ApiKeyInfo | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.createdAt !== 'string') {
    return null;
  }

  return {
    id: row.id,
    name: typeof row.name === 'string' || row.name === null ? row.name : null,
    start: typeof row.start === 'string' ? row.start : '',
    createdAt: row.createdAt,
    lastUsedAt: typeof row.lastUsedAt === 'string' || row.lastUsedAt === null ? row.lastUsedAt : null,
    lastRefill: typeof row.lastRefill === 'string' || row.lastRefill === null ? row.lastRefill : null,
    metadata: parseMetadata(row.metadata),
  };
}

function normalizeApiKeyList(values: unknown[]): ApiKeyInfo[] {
  return values.map(normalizeApiKeyInfo).filter((value): value is ApiKeyInfo => value !== null);
}

/** Service factory for API key management via Better Auth endpoints. */
export const createApiKeysService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  /** Create a new API key with the given display name. */
  create: async (name: string, metadata?: Record<string, unknown>): Promise<CreateApiKeyResponse> => {
    return api.post<CreateApiKeyResponse>('/auth/api-key/create', metadata ? { name, metadata } : { name });
  },

  /** List all API keys for the current user. */
  list: async (): Promise<ApiKeyInfo[]> => {
    // Better Auth returns { apiKeys: [...] }
    const response = await api.get<unknown>('/auth/api-key/list');
    if (Array.isArray(response)) return normalizeApiKeyList(response);
    if (response && typeof response === 'object') {
      const obj = response as Record<string, unknown>;
      if (Array.isArray(obj.apiKeys)) {
        return normalizeApiKeyList(obj.apiKeys);
      }
      // Fallback: find any array property
      for (const value of Object.values(obj)) {
        if (Array.isArray(value)) {
          return normalizeApiKeyList(value);
        }
      }
    }
    return [];
  },

  /** Permanently revoke an API key by ID. */
  revoke: async (id: string): Promise<void> => {
    await api.post<{ success: boolean }>('/auth/api-key/delete', { keyId: id });
  },
});
