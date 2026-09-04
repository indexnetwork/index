/**
 * Opportunity graph utilities: role derivation from corpus type.
 * Used by the opportunity graph to map lens corpus to opportunity actor roles.
 *
 * With lens-based HyDE, strategy selection is handled automatically by the
 * LensInferrer agent. This file provides corpus-to-role mapping for opportunity actors.
 */

import type { HydeTargetCorpus } from '../../protocol/core.js';
import { log } from '../shared/observability/log.js';

const logger = log.graph.from('SelectByComposition');
const dedupeByPersonLog = log.graph.from('DeduplicateByPerson');

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
 * Only `pending` is actionable, and only while the viewer has not acted.
 * Acting is per-user, not per-actor-row: re-detection can append duplicate
 * actor rows for the same user without `actedAt`, so any viewer row carrying
 * `actedAt` means the viewer has already decided.
 *
 * The old rules 1-3 were about pre-kickoff states and vouching. Neither
 * exists: a pairing is born `negotiating`, and a negotiating pairing is the
 * agents' to work, not the principal's to action.
 */
export function isActionableForViewer(
  actors: Array<{ userId: string; role: string; approved?: boolean; actedAt?: string | null }>,
  status: string,
  viewerId: string
): boolean {
  if (status !== 'pending') return false;
  const viewerActors = actors.filter((a) => a.userId === viewerId);
  if (viewerActors.length === 0) return false;
  return !viewerActors.some((a) => !!a.actedAt);
}

/** Feed category for home composition. */
export type FeedCategory = 'connection' | 'expired';

/** Soft targets for radar composition. */
export const RADAR_SOFT_TARGETS = {
  // 3 + 2 in a second category before that category was removed. The slots move to
  // connections rather than shrinking the feed: the total a radar can hold is
  // unchanged, and connections are the only kind of card left.
  connection: 5,
  expired: 2,
} as const;

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

/**
 * Select opportunities for the radar using soft composition targets.
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
  const buckets: Record<FeedCategory, T[]> = { connection: [], expired: [] };
  for (const opp of opportunities) {
    buckets[classifyOpportunity(opp, viewerId)].push(opp);
  }

  const targets: Record<FeedCategory, number> = {
    connection: RADAR_SOFT_TARGETS.connection,
    expired: RADAR_SOFT_TARGETS.expired,
  };

  // First pass: fill each category up to its target.
  const selected: Record<FeedCategory, T[]> = {
    connection: buckets.connection.slice(0, targets.connection),
    expired: buckets.expired.slice(0, targets.expired),
  };

  // Second pass: redistribute unused slots, connection before expired.
  let unusedSlots = (targets.connection + targets.expired)
    - (selected.connection.length + selected.expired.length);
  for (const category of ['connection', 'expired'] as FeedCategory[]) {
    if (unusedSlots <= 0) break;
    const remaining = buckets[category].slice(selected[category].length);
    const take = Math.min(remaining.length, unusedSlots);
    selected[category].push(...remaining.slice(0, take));
    unusedSlots -= take;
  }

  // Within each category, preserve original input order.
  const indexMap = new Map(opportunities.map((opp, i) => [opp, i]));
  const sortByOriginal = (a: T, b: T) => (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0);
  selected.connection.sort(sortByOriginal);
  selected.expired.sort(sortByOriginal);

  logger.info('Selected opportunities by composition', {
    input: opportunities.length,
    buckets: { connection: buckets.connection.length, expired: buckets.expired.length },
    selected: { connection: selected.connection.length, expired: selected.expired.length },
  });

  return [...selected.connection, ...selected.expired];
}

/**
 * Deduplicate opportunities so each counterpart appears at most once.
 * Keeps the opportunity with the highest interpretation.confidence per
 * counterpart userId. On ties, the first encountered wins (stable).
 *
 * Counterpart = first actor whose userId !== viewerId.
 * Opportunities without a derivable counterpart pass through undeduped.
 *
 * @param opportunities - Pre-sorted opportunities (e.g. by confidence/recency)
 * @param viewerId - The viewing user's ID
 * @returns Deduped subset preserving original input order among winners
 */
export function deduplicateByPerson<T extends {
  actors: Array<{ userId: string; role: string }>;
  interpretation?: { confidence?: number } | null;
}>(opportunities: T[], viewerId: string): T[] {
  const bestByCounterpart = new Map<string, { opp: T; index: number }>();
  const noCounterpart: Array<{ opp: T; index: number }> = [];

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    const counterpart = opp.actors.find(
      (a) => a.userId !== viewerId,
    );

    if (!counterpart) {
      noCounterpart.push({ opp, index: i });
      continue;
    }

    const key = counterpart.userId;
    const existing = bestByCounterpart.get(key);

    if (!existing) {
      bestByCounterpart.set(key, { opp, index: i });
      continue;
    }

    const newConf = opp.interpretation?.confidence ?? -1;
    const oldConf = existing.opp.interpretation?.confidence ?? -1;
    if (newConf > oldConf) {
      bestByCounterpart.set(key, { opp, index: i });
    }
  }

  const all = [...bestByCounterpart.values(), ...noCounterpart];
  all.sort((a, b) => a.index - b.index);

  const result = all.map((entry) => entry.opp);
  if (result.length < opportunities.length) {
    dedupeByPersonLog.info('Deduped opportunities by person', {
      input: opportunities.length,
      output: result.length,
    });
  }
  return result;
}
