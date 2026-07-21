/**
 * Checks whether an opportunity actor can see the opportunity at its current status.
 *
 * Mirrors the latent-opportunity visibility matrix:
 * - Introducer/peer: always visible.
 * - Patient/party: visible unless status is latent and an introducer exists.
 * - Agent: visible for terminal statuses, or non-latent when no introducer exists.
 *
 * @param actors - Opportunity actors and their roles.
 * @param status - Current opportunity status.
 * @param userId - User whose visibility is being evaluated.
 * @returns Whether any of the user's roles grants visibility.
 */
export function canActorSeeOpportunity(
  actors: Array<{ userId: string; role: string }>,
  status: string,
  userId: string,
): boolean {
  const hasIntroducer = actors.some((actor) => actor.role === 'introducer');
  const userRoles = actors
    .filter((actor) => actor.userId === userId)
    .map((actor) => actor.role);
  if (userRoles.length === 0) return false;

  return userRoles.some((role) => {
    if (role === 'introducer' || role === 'peer') return true;
    if (role === 'patient' || role === 'party') {
      return status !== 'latent' || !hasIntroducer;
    }
    if (role === 'agent') {
      return (
        ['accepted', 'rejected', 'expired'].includes(status)
        || (status !== 'latent' && !hasIntroducer)
      );
    }
    return false;
  });
}
