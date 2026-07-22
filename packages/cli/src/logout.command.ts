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
 * Revoke revocable CLI API-key credentials before clearing local storage.
 * Legacy session credentials are local-only and can be cleared immediately.
 * ID-less API keys are retained because guessing a key row could revoke a
 * different login.
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

  if (credentials.authKind !== "api_key") {
    await store.clear();
    return { success: true, message: "Logged out. Session cleared." };
  }

  if (!credentials.keyId) {
    return {
      success: false,
      warning: "Stored API-key credentials do not include a revocation ID and were retained. Remove the old key in Index web settings first, then delete the local credentials and sign in again.",
    };
  }

  const createClient = options.clientFactory
    ?? ((apiUrl: string, token: string) => new ApiClient(apiUrl, token, "api_key"));
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
