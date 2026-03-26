/**
 * Opportunity graph utilities: role derivation from corpus type.
 * Used by the opportunity graph to map lens corpus to opportunity actor roles.
 *
 * With lens-based HyDE, strategy selection is handled automatically by the
 * LensInferrer agent. This file provides corpus-to-role mapping for opportunity actors.
 */

import type { HydeTargetCorpus } from '../agents/lens.inferrer';

/** Actor roles in the opportunity model (agent / patient / peer). */
export type OpportunityActorRole = 'agent' | 'patient' | 'peer';

/** Result of mapping a corpus to source and candidate roles. */
export interface DerivedRoles {
  sourceRole: OpportunityActorRole;
  candidateRole: OpportunityActorRole;
}

/**
 * Derive actor roles from the corpus type of a lens match.
 *
 * When a candidate is found via:
 * - "profiles" corpus → found by who they are → candidate can help → agent
 * - "intents" corpus → found by what they need → candidate needs something → patient
 *
 * @param corpus - The target corpus that produced the match ('profiles' | 'intents')
 * @returns Roles for the source (intent owner) and the candidate (matched user/intent)
 */
export function deriveRolesFromCorpus(corpus: HydeTargetCorpus): DerivedRoles {
  switch (corpus) {
    case 'profiles':
      // Source seeks someone who can help → source is patient, candidate can help → agent
      return { sourceRole: 'patient', candidateRole: 'agent' };
    case 'intents':
      // Source offers or needs; candidate has complementary goal → source is agent, candidate is patient
      return { sourceRole: 'agent', candidateRole: 'patient' };
    default:
      return { sourceRole: 'peer', candidateRole: 'peer' };
  }
}

/**
 * Validates opportunity actors: if an opportunity has an introducer, it must have
 * one or two non-introducer actors (1 = 1:1 intro e.g. "I want to connect with X";
 * 2 = introducer connecting two others).
 *
 * @param actors - Array of actors with at least a role and optional userId
 * @throws Error when the actor set is invalid
 */
export function validateOpportunityActors(actors: Array<{ userId?: string; role: string }>): void {
  const introducerCount = actors.filter((a) => a.role === 'introducer').length;
  const nonIntroducerCount = actors.filter((a) => a.role !== 'introducer').length;

  if (introducerCount > 0 && (nonIntroducerCount < 1 || nonIntroducerCount > 2)) {
    throw new Error(
      'An opportunity with an introducer must have one or two other actors.'
    );
  }
}

/**
 * Role-based visibility (Latent Opportunity Lifecycle).
 * A user can see an opportunity iff they are an actor and the rule below allows it.
 *
 * Compact Visibility Rule (from lifecycle doc):
 * - Introducer or peer: always see.
 * - Patient or party: see if (status is not latent, or there is no introducer).
 * - Agent: see if (status is accepted/rejected/expired, or (status is not latent and there is no introducer)).
 */
export function canUserSeeOpportunity(
  actors: Array<{ userId: string; role: string }>,
  status: string,
  userId: string
): boolean {
  const hasIntroducer = actors.some((a) => a.role === 'introducer');
  const userRoles = actors.filter((a) => a.userId === userId).map((a) => a.role);
  if (userRoles.length === 0) return false;

  return userRoles.some((role) => {
    if (role === 'introducer') return true;
    if (role === 'peer') return true;
    if (role === 'patient' || role === 'party')
      return status !== 'latent' || !hasIntroducer;
    if (role === 'agent')
      return (
        ['accepted', 'rejected', 'expired'].includes(status) ||
        (status !== 'latent' && !hasIntroducer)
      );
    return false;
  });
}

/**
 * Whether an opportunity should appear on the Home feed for the viewer (actionable = has a pending action).
 * Encodes the role-visibility matrix from the Latent Opportunity Lifecycle.
 */
export function isActionableForViewer(
  actors: Array<{ userId: string; role: string }>,
  status: string,
  viewerId: string
): boolean {
  const viewerActors = actors.filter((a) => a.userId === viewerId);
  if (viewerActors.length === 0) return false;

  const hasIntroducer = actors.some((a) => a.role === 'introducer');

  return viewerActors.some(({ role }) => {
    switch (role) {
      case 'introducer':
        return status === 'latent';
      case 'patient':
      case 'party':
        return hasIntroducer
          ? status === 'pending'
          : status === 'latent';
      case 'agent':
        return hasIntroducer
          ? status === 'accepted'
          : status === 'pending';
      case 'peer':
        return status === 'latent' || status === 'pending';
      default:
        return false;
    }
  });
}

/** Feed category for home composition. */
export type FeedCategory = 'connection' | 'connector-flow' | 'expired';

/** Soft targets for home feed composition. */
export const FEED_SOFT_TARGETS = {
  connection: 3,
  connectorFlow: 2,
  expired: 2,
} as const;

/**
 * Classify an actionable opportunity into a feed category.
 * Assumes the opportunity already passed isActionableForViewer or is expired.
 *
 * @param opp - Opportunity with actors and status
 * @param viewerId - The viewing user's ID
 * @returns Feed category
 */
export function classifyOpportunity(
  opp: { actors: Array<{ userId: string; role: string }>; status: string },
  viewerId: string
): FeedCategory {
  if (opp.status === 'expired') return 'expired';
  const hasIntroducer = opp.actors.some((a) => a.role === 'introducer');
  if (hasIntroducer) return 'connector-flow';
  return 'connection';
}

/**
 * Select opportunities for the home feed using soft composition targets.
 * Fills each category up to its target, then redistributes unused slots
 * to categories that have more items available. Preserves input order.
 *
 * @param opportunities - Pre-sorted opportunities (by confidence/recency)
 * @param viewerId - The viewing user's ID
 * @returns Composition-balanced subset
 */
export function selectByComposition<T extends { actors: Array<{ userId: string; role: string }>; status: string }>(
  opportunities: T[],
  viewerId: string
): T[] {
  const buckets: Record<FeedCategory, T[]> = {
    connection: [],
    'connector-flow': [],
    expired: [],
  };

  for (const opp of opportunities) {
    const category = classifyOpportunity(opp, viewerId);
    buckets[category].push(opp);
  }

  const targets: Record<FeedCategory, number> = {
    connection: FEED_SOFT_TARGETS.connection,
    'connector-flow': FEED_SOFT_TARGETS.connectorFlow,
    expired: FEED_SOFT_TARGETS.expired,
  };

  // First pass: fill each category up to its target
  const selected: Record<FeedCategory, T[]> = {
    connection: buckets.connection.slice(0, targets.connection),
    'connector-flow': buckets['connector-flow'].slice(0, targets['connector-flow']),
    expired: buckets.expired.slice(0, targets.expired),
  };

  // Calculate unused slots and remaining items
  const totalTarget = targets.connection + targets['connector-flow'] + targets.expired;
  const usedSlots = selected.connection.length + selected['connector-flow'].length + selected.expired.length;
  let unusedSlots = totalTarget - usedSlots;

  // Second pass: redistribute unused slots to categories with remaining items
  // Priority: connection > connector-flow > expired
  const redistOrder: FeedCategory[] = ['connection', 'connector-flow', 'expired'];
  for (const category of redistOrder) {
    if (unusedSlots <= 0) break;
    const remaining = buckets[category].slice(selected[category].length);
    const take = Math.min(remaining.length, unusedSlots);
    selected[category].push(...remaining.slice(0, take));
    unusedSlots -= take;
  }

  // Merge and sort by original position to preserve input order
  const indexMap = new Map(opportunities.map((opp, i) => [opp, i]));
  const result = [
    ...selected.connection,
    ...selected['connector-flow'],
    ...selected.expired,
  ].sort((a, b) => (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0));

  return result;
}
