import { ApiClient } from "./api.client";
import type { CredentialStore } from "./auth.store";

/** Result returned by the testable logout workflow. */
export type LogoutResult =
  | { success: true; message: string }
  | { success: false; warning: string };

/** Dependencies that can be replaced by focused logout tests. */
export interface LogoutOptions {
  clientFactory?: (apiUrl: string, token: string) => Pick<ApiClient, "revokeApiKey">;
}

/**
 * Revoke the stored CLI API key before clearing local storage. Legacy
 * credential files without a key ID load as signed out.
 *
 * @param store - Persistent CLI credential store.
 * @param options - Optional API-client factory for tests.
 * @returns A success result only after the required revocation and clear finish.
 */
export async function handleLogout(
  store: Pick<CredentialStore, "load" | "clear">,
  options: LogoutOptions = {},
): Promise<LogoutResult> {
  const credentials = await store.load();
  if (!credentials) {
    return { success: true, message: "Already logged out." };
  }

  const createClient = options.clientFactory
    ?? ((apiUrl: string, token: string) => new ApiClient(apiUrl, token));
  try {
    await createClient(credentials.apiUrl, credentials.token).revokeApiKey(credentials.keyId, credentials.token);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    return {
      success: false,
      warning: `Logout could not revoke the stored CLI API key, so credentials were retained.${detail}`,
    };
  }

  try {
    await store.clear();
  } catch {
    return {
      success: false,
      warning: "The server API key was revoked, but local credential cleanup failed. Remove the local credentials file manually before signing in again.",
    };
  }
  return { success: true, message: "Logged out. CLI API key revoked." };
}
