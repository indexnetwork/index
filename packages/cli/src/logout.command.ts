import type { CredentialStore } from "./auth.store";

/** Result returned by the testable logout workflow. */
export type LogoutResult =
  | { success: true; message: string }
  | { success: false; warning: string };

/**
 * Clear the stored CLI credential. Only the owner's own browser session can
 * delete a key server-side, so logout is local: the key stays live until it is
 * removed in Index web settings.
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
    message: "Logged out. The API key is still active — remove it in Index web settings.",
  };
}
