import { ApiClient } from "./api.client";
import type { Credentials, CredentialStore } from "./auth.store";

/** Result of storing replacement credentials and cleaning up their predecessor. */
export interface CredentialReplacementResult {
  warning?: string;
}

/** Dependencies that can be replaced by focused auth-lifecycle tests. */
export interface CredentialReplacementOptions {
  clientFactory?: (apiUrl: string, token: string) => Pick<ApiClient, "revokeApiKey">;
}

/**
 * Store successful replacement credentials before revoking an older exact API key.
 * Revocation always authenticates with the newly stored credential. A cleanup
 * failure never rolls back a successful login, but it is returned truthfully.
 *
 * @param store - Persistent CLI credential store.
 * @param previous - Credentials captured before the login attempt began.
 * @param replacement - Newly authenticated credentials to persist.
 * @param options - Optional API-client factory for tests.
 * @returns An explicit warning when the previous key may remain active.
 */
export async function storeReplacementCredentials(
  store: Pick<CredentialStore, "save">,
  previous: Credentials | null,
  replacement: Credentials,
  options: CredentialReplacementOptions = {},
): Promise<CredentialReplacementResult> {
  await store.save(replacement);

  if (!previous) return {};
  if (replacement.keyId === previous.keyId) {
    return {};
  }

  const createClient = options.clientFactory
    ?? ((apiUrl: string, token: string) => new ApiClient(apiUrl, token));

  try {
    await createClient(
      replacement.apiUrl,
      replacement.token,
    ).revokeApiKey(previous.keyId, previous.token);
    return {};
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    return {
      warning: `Login succeeded, but the previous CLI API key remains active because it could not be revoked.${detail} It should be removed in Index web settings.`,
    };
  }
}
