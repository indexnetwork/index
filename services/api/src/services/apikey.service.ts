import { apiKeyAdapter, type ApiKeyRecord, type ApiKeyStore, type CreateApiKeyResult } from '../adapters/apikey.adapter';

/** Input proving both the owner and the exact revocation target. */
export interface RevokeOwnApiKeyInput {
  userId: string;
  keyId: string;
  targetKey: string;
}

const DEFAULT_KEY_NAME = 'API Key';

/**
 * Issues and retires user API keys. A key authenticates its owner and carries
 * no agent binding, so there is one mint path for every client.
 */
export class ApiKeyService {
  constructor(private readonly keys: ApiKeyStore = apiKeyAdapter) {}

  /**
   * Mint a key for a user.
   *
   * @param userId - Authenticated owner.
   * @param name - Optional display label.
   * @returns Raw secret (returned once) plus row metadata.
   */
  async create(userId: string, name?: string): Promise<CreateApiKeyResult> {
    return this.keys.create(userId, name?.trim() || DEFAULT_KEY_NAME);
  }

  /**
   * List a user's keys without secrets.
   *
   * @param userId - Authenticated owner.
   * @returns Masked key records.
   */
  async list(userId: string): Promise<ApiKeyRecord[]> {
    return this.keys.list(userId);
  }

  /**
   * Revoke one of the user's keys by ID.
   *
   * @param userId - Authenticated owner.
   * @param keyId - Exact row to delete.
   * @throws Error('Key not found') when the user owns no such key.
   */
  async revoke(userId: string, keyId: string): Promise<void> {
    return this.keys.revoke(userId, keyId);
  }

  /**
   * Retire one key after re-proving its raw secret.
   *
   * @param input - Owner plus the exact target row and its secret.
   * @returns True only after the authoritative row was deleted.
   */
  async revokeOwn(input: RevokeOwnApiKeyInput): Promise<boolean> {
    return this.keys.revokeOwnBySecret(input.userId, input.keyId, input.targetKey);
  }
}

export const apiKeyService = new ApiKeyService();
