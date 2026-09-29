/**
 * Validates opportunity actors.
 *
 * Rejects self-matches — the same person occupying both sides of a pairing.
 * The evaluator's actor list can collapse onto a single user; downstream
 * readers then garble identity (a greeting rendered in one party's voice while
 * the card shows the viewer "matched with themselves"). Only `userId`-bearing
 * actors are checked; role-only actors (tests) pass. Duplicate rows for one
 * participant are allowed when at least one other distinct participant is
 * present.
 *
 * @param actors - Array of actors with at least a role and optional userId
 * @throws Error when the actor set is invalid
 */
export function validateOpportunityActors(actors: Array<{ userId?: string; role: string }>): void {
  const userIds = actors.filter((a) => a.userId).map((a) => a.userId as string);
  if (userIds.length > 1 && new Set(userIds).size === 1) {
    throw new Error('An opportunity cannot match a user with themselves (duplicate participant).');
  }
}

/**
 * Read-level ACL: whether a user is an actor on the opportunity and may fetch
 * its details.
 *
 * This used to be a four-way rule keyed on role, `latent`, and whether an
 * a third party had vouched. None of that exists any
 * more — an opportunity is born `negotiating` when a principal's agent opens
 * it — so every branch collapsed to the same answer: the actors on a pairing
 * may read it.
 */
export function canUserSeeOpportunity(
  actors: Array<{ userId: string; role: string }>,
  _status: string,
  userId: string
): boolean {
  return actors.some((a) => a.userId === userId);
}

/**
 * Whether an opportunity should appear on the viewer's radar (actionable =
 * has a pending action for this user).
 *
 * Only `pending` is actionable, and only while the viewer has no `committed` event.
 *
 * The old rules 1-3 were about pre-kickoff states and vouching. Neither
 * exists: a pairing is born `negotiating`, and a negotiating pairing is the
 * agents' to work, not the principal's to action.
 */
export function isActionableForViewer(
  actors: Array<{ userId: string; role: string }>,
  status: string,
  viewerId: string,
  committedActorIds: readonly string[] = [],
): boolean {
  if (status !== 'pending') return false;
  if (!actors.some((actor) => actor.userId === viewerId)) return false;
  return !committedActorIds.includes(viewerId);
}

/** Feed category for home composition. */
export type FeedCategory = 'connection' | 'expired';

/**
 * Classify an actionable opportunity into a feed category.
 * Assumes the opportunity already passed isActionableForViewer or is expired.
 *
 * @param opp - Opportunity with actors and status
 * @param _viewerId - Unused; retained for call-site compatibility
 * @returns Feed category
 */
export function classifyOpportunity(
  opp: { actors: Array<{ userId: string; role: string }>; status: string },
  _viewerId: string
): FeedCategory {
  if (opp.status === 'expired') return 'expired';
  return 'connection';
}
