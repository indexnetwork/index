import { authClient } from '@/lib/auth-client';

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

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * The user's API keys, managed by Better Auth's apiKey plugin. Every route
 * needs the owner's own session cookie, so a key can never mint a successor.
 */
export const apiKeysService = {
  /** Mint a new key with the given display name. */
  create: async (name: string): Promise<CreateApiKeyResponse> => {
    const { data, error } = await authClient.apiKey.create({ name });
    if (error || !data) throw new Error(error?.message ?? 'Failed to create API key');
    return {
      key: data.key,
      id: data.id,
      name: data.name,
      createdAt: toIso(data.createdAt) ?? new Date().toISOString(),
    };
  },

  /** List the current user's keys. */
  list: async (): Promise<ApiKeyInfo[]> => {
    const { data, error } = await authClient.apiKey.list();
    if (error || !data) throw new Error(error?.message ?? 'Failed to load API keys');
    return data.apiKeys.map((key) => ({
      id: key.id,
      name: key.name,
      start: key.start ?? '',
      createdAt: toIso(key.createdAt) ?? '',
      lastUsedAt: toIso(key.lastRequest),
    }));
  },

  /** Permanently revoke a key by ID. */
  revoke: async (id: string): Promise<void> => {
    const { error } = await authClient.apiKey.delete({ keyId: id });
    if (error) throw new Error(error.message ?? 'Failed to revoke API key');
  },
};
