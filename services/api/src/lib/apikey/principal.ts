/**
 * Shared resolution of the trusted user principal behind an API key.
 *
 * The `apikeys` table carries two nullable principal columns, `userId` and
 * `referenceId`. Today only agent keys populate `referenceId`, and the adapter
 * always sets it equal to `userId`, so a divergence between the two signals a
 * cross-wired or tampered key. Both the MCP auth resolver and
 * `AuthGuard` resolve principals from these columns; routing them
 * through this one helper guarantees the same key can never resolve to a
 * different user depending on the codepath.
 */

/** Raised when an API key's two principal columns are both set but disagree. */
export class ApiKeyPrincipalMismatchError extends Error {
  constructor(message = 'API key principal mismatch') {
    super(message);
    this.name = 'ApiKeyPrincipalMismatchError';
  }
}

/** The principal columns of an `apikeys` row. */
export interface ApiKeyPrincipalRow {
  referenceId: string | null;
  userId: string | null;
}

/**
 * Resolves the user id an API key authenticates as.
 *
 * Prefers a verified session user when one is supplied, then the key's own
 * `userId`, then `referenceId`. When both columns are populated they must
 * agree — otherwise the key is rejected (fail closed) rather than silently
 * resolving to one side.
 *
 * @param row - The key's `userId` / `referenceId` columns.
 * @param sessionUserId - A user id already verified out of band (e.g. a
 *   better-auth session for the same key), preferred when present.
 * @returns The resolved user id, or `null` when no principal is available.
 * @throws ApiKeyPrincipalMismatchError when both columns are set but disagree.
 */
export function resolveApiKeyUserId(
  row: ApiKeyPrincipalRow,
  sessionUserId?: string,
): string | null {
  if (row.userId && row.referenceId && row.userId !== row.referenceId) {
    throw new ApiKeyPrincipalMismatchError();
  }
  return sessionUserId ?? row.userId ?? row.referenceId ?? null;
}
