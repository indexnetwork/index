/**
 * Returns true when the enriched name is meaningfully better than the email local-part.
 * A name that is empty, contains '@', or case-insensitively matches the prefix is NOT meaningful.
 */
export function isEnrichedNameMeaningful(email: string, enrichedName: string): boolean {
  const trimmed = enrichedName.trim();
  if (!trimmed || trimmed.includes('@')) return false;
  const localPart = email.split('@')[0].toLowerCase();
  return trimmed.toLowerCase() !== localPart;
}

/**
 * Decides whether to set {@link users.name} from Parallel `enrichment.identity.name` for ghost users.
 * @remarks Real users (Google login, etc.) are never touched. Ghost users always get
 * their name enriched when Parallel returns a non-empty name that isn't an email.
 * @param user - Current user row (must include `email`, `name`, `isGhost`)
 * @param enrichedName - `enrichment.identity.name` from Parallel (may be untrimmed)
 * @returns True if `users.name` should be updated to the enriched full name
 */
export function shouldEnrichGhostDisplayNameFromParallel(
  user: { name: string; email: string; isGhost?: boolean | null },
  enrichedName: string,
): boolean {
  if (!user.isGhost) return false;
  const trimmed = enrichedName.trim();
  if (!trimmed || trimmed.includes("@")) return false;

  // Skip only if exactly the same (case-sensitive)
  if (user.name.trim() === trimmed) return false;

  return true;
}
