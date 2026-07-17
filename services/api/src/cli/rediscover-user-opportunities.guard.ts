/**
 * Fail closed when destructive rediscovery would erase state belonging to a
 * paused intent. Operators must explicitly resume those intents first.
 *
 * @param userId - User targeted by the maintenance command.
 * @param pausedIntentIds - Non-archived PAUSED intent IDs found for the user.
 * @throws When at least one paused intent exists.
 */
export function assertNoPausedIntentsForRediscovery(
  userId: string,
  pausedIntentIds: string[],
): void {
  if (pausedIntentIds.length === 0) return;

  throw new Error(
    `Refusing destructive rediscovery for user ${userId}: found ${pausedIntentIds.length} non-archived paused intent(s). `
    + 'Resume them before running this maintenance command; paused Radar and negotiation data were not deleted.',
  );
}
