/**
 * Checks whether an opportunity actor can see the opportunity.
 *
 * Every actor sees the opportunity immediately, at any status — the
 * agent-last/patient-first staggered reveal this used to implement was a
 * function of the (now-removed) evaluator's agent/patient/peer valency
 * judgment. Only actor membership gates visibility.
 *
 * @param actors - Opportunity actors and their roles.
 * @param _status - Current opportunity status (unused; kept for call-site compatibility).
 * @param userId - User whose visibility is being evaluated.
 * @returns Whether the user is one of the opportunity's actors.
 */
export function canActorSeeOpportunity(
  actors: Array<{ userId: string; role: string }>,
  _status: string,
  userId: string,
): boolean {
  return actors.some((actor) => actor.userId === userId);
}
