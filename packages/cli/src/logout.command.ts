import type { CredentialStore } from "./auth.store";
import { revokeSession } from "./auth.session";

/** Result returned by the testable logout workflow. */
export type LogoutResult =
  | { success: true; message: string }
  | { success: false; warning: string };

/**
 * Sign out of the CLI. A device session may revoke itself, so the token is
 * killed server-side first and the local credential is cleared either way.
 *
 * @param store - Persistent CLI credential store.
 * @returns A success result once the local credential is gone.
 */
export async function handleLogout(
  store: Pick<CredentialStore, "load" | "clear">,
): Promise<LogoutResult> {
  const credentials = await store.load();
  if (!credentials) {
    return { success: true, message: "Already logged out." };
  }

  const revoked = await revokeSession(credentials.apiUrl, credentials.token);

  try {
    await store.clear();
  } catch {
    return {
      success: false,
      warning: "Local credential cleanup failed. Remove the local credentials file manually before signing in again.",
    };
  }
  return {
    success: true,
    message: revoked
      ? "Logged out."
      : "Logged out locally. The session could not be reached — revoke it in Index web settings if this machine is not yours.",
  };
}
