/**
 * Opportunity graph utilities: role derivation from corpus type.
 * Used by the opportunity graph to map lens corpus to opportunity actor roles.
 *
 * With lens-based HyDE, strategy selection is handled automatically by the
 * LensInferrer agent. This file provides corpus-to-role mapping for opportunity actors.
 */

import type { HydeTargetCorpus } from '../shared/hyde/lens.inferrer.js';
import { log } from '../shared/observability/log.js';

const logger = log.graph.from('SelectByComposition');
const dedupeByPersonLog = log.graph.from('DeduplicateByPerson');
const digestCandidatesLog = log.graph.from('SelectDigestCandidates');

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
    case 'premises':
      // Premise matches are symmetric: two people whose self-descriptions align.
      // Unlike intents (directional roles), premises express stable identity truths.
      return { sourceRole: 'peer', candidateRole: 'peer' };
    default:
      return { sourceRole: 'peer', candidateRole: 'peer' };
  }
}

/**
 * Validates opportunity actors: if an opportunity has an introducer, it must have
 * one or two non-introducer actors (1 = 1:1 intro e.g. "I want to connect with X";
 * 2 = introducer connecting two others).
 *
 * Also rejects self-matches — the same person occupying both sides of a
 * connection. The discovery/persist pipeline trusts the LLM evaluator's actor
 * list, which can collapse onto a single user; downstream readers then garble
 * identity (e.g. a connect link/greeting rendered in one party's voice while the
 * card shows the viewer "matched with themselves"). Two degenerate shapes are
 * blocked here, at the single persist chokepoint:
 *   - every userId-bearing non-introducer actor collapses to the same user,
 *     e.g. `[X(agent), X(patient)]`
 *   - an introducer who is also a participant ("Amina introduced you to Amina")
 * Only `userId`-bearing actors are checked; role-only actors (legacy/tests) pass.
 * Duplicate rows for one participant are allowed when at least one other distinct
 * participant is present (some callers model multiple intents as multiple actor rows).
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

  // Self-match guard. Compare only actors that carry a userId so role-only
  // shapes (used by some callers/tests) are unaffected.
  const introducerUserIds = new Set(
    actors.filter((a) => a.role === 'introducer' && a.userId).map((a) => a.userId as string),
  );
  const nonIntroducerUserIds = actors
    .filter((a) => a.role !== 'introducer' && a.userId)
    .map((a) => a.userId as string);

  for (const userId of nonIntroducerUserIds) {
    if (introducerUserIds.has(userId)) {
      throw new Error(
        'An opportunity actor cannot be both the introducer and a participant (self-match).'
      );
    }
  }

  const uniqueNonIntroducerUserIds = new Set(nonIntroducerUserIds);
  if (nonIntroducerUserIds.length > 1 && uniqueNonIntroducerUserIds.size === 1) {
    throw new Error('An opportunity cannot match a user with themselves (duplicate participant).');
  }
}

/**
 * Read-level ACL: whether a user is an actor on the opportunity and may fetch
 * its details. Intentionally broader than `isActionableForViewer` — a user can
 * read an opportunity they are not currently expected to act on (e.g. an agent
 * viewing an accepted opportunity).
 *
 * The feed graph and debug controller chain both predicates: an opportunity only
 * reaches the home feed if it passes `canUserSeeOpportunity` first, then
 * `isActionableForViewer`. For `agent with introducer at pending`,
 * `canUserSeeOpportunity` returns false (read gate blocks it), so the opportunity
 * never surfaces even though `isActionableForViewer` Rule 4 would return true in
 * isolation. This is by design — the agent is not granted read access through the
 * home path until the introducer path completes (negotiation → accepted).
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
 * Whether an opportunity should appear on the viewer's home feed (actionable =
 * has a pending action for this user).
 *
 * Rules (see `docs/Latent Opportunity Lifecycle.md` — Role-Visibility Matrix):
 *
 *   (1) `latent`, no introducer                   → all actors actionable
 *   (2) `latent`, introducer `approved !== true`  → introducer only
 *   (3) `latent`, introducer `approved === true`  → all non-introducer actors
 *   (4) `pending` (any introducer config)         → non-introducer actors who have not acted.
 *       Acting is per-user, not per-actor-row: re-detection can append duplicate
 *       actor rows for the same user without `actedAt`, so any viewer row with
 *       `actedAt` means the viewer has already acted.
 *   (5) `accepted`/`rejected`/`expired`/`stalled`/`draft`/`negotiating`
 *                                                 → never actionable
 *
 * The introducer approval signal is stored on the `introducer`-roled actor's
 * `approved: boolean` field within the opportunity's `actors` JSONB. It flips
 * from `false` to `true` when the introducer approves; status stays `latent`
 * across the flip while a background negotiation runs.
 */
export function isActionableForViewer(
  actors: Array<{ userId: string; role: string; approved?: boolean; actedAt?: string | null }>,
  status: string,
  viewerId: string
): boolean {
  const viewerActors = actors.filter((a) => a.userId === viewerId);
  if (viewerActors.length === 0) return false;

  // Per-user acted signal: duplicate actor rows appended by re-detection may
  // lack `actedAt` even though the viewer already accepted/rejected — a single
  // stamped row means the viewer has acted on this opportunity.
  const viewerActed = viewerActors.some((a) => !!a.actedAt);

  const introducer = actors.find((a) => a.role === 'introducer');
  const hasIntroducer = !!introducer;
  const introducerApproved = introducer?.approved === true;

  return viewerActors.some(({ role }) => {
    if (role === 'introducer') {
      // Rule 2: introducer sees own latent opp only while not yet approved.
      return status === 'latent' && !introducerApproved;
    }

    // Non-introducer actors: patient / party / agent / peer.
    if (status === 'latent') {
      // Rule 1: no introducer → visible.
      // Rule 3: introducer approved → visible.
      return !hasIntroducer || introducerApproved;
    }
    if (status === 'pending') {
      // Rule 4: pending is actionable only while the viewer has not acted.
      // Once any of the viewer's actor rows has `actedAt`, the opportunity is
      // waiting on the counterparty and should not appear in the viewer's feed.
      return !viewerActed;
    }
    // Rule 5: never actionable at terminal or internal statuses.
    return false;
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
  const viewerIsIntroducer = opp.actors.some((a) => a.userId === viewerId && a.role === 'introducer');
  if (viewerIsIntroducer) return 'connector-flow';
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

  // Merge in category priority order: connection > connector-flow > expired
  // Within each category, preserve original input order
  const indexMap = new Map(opportunities.map((opp, i) => [opp, i]));
  const sortByOriginal = (a: T, b: T) => (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0);
  selected.connection.sort(sortByOriginal);
  selected['connector-flow'].sort(sortByOriginal);
  selected.expired.sort(sortByOriginal);

  logger.info('Selected opportunities by composition', {
    input: opportunities.length,
    buckets: {
      connection: buckets.connection.length,
      connectorFlow: buckets['connector-flow'].length,
      expired: buckets.expired.length,
    },
    selected: {
      connection: selected.connection.length,
      connectorFlow: selected['connector-flow'].length,
      expired: selected.expired.length,
    },
  });

  return [
    ...selected.connection,
    ...selected['connector-flow'],
    ...selected.expired,
  ];
}

/**
 * Deduplicate opportunities so each counterpart appears at most once.
 * Keeps the opportunity with the highest interpretation.confidence per
 * counterpart userId. On ties, the first encountered wins (stable).
 *
 * Counterpart = first actor whose userId !== viewerId and role !== 'introducer'.
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
      (a) => a.userId !== viewerId && a.role !== 'introducer',
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

/**
 * Days a digest-delivered opportunity stays suppressed before it becomes
 * eligible for a "still open" reminder re-show (when nothing fresh exists).
 */
export const DIGEST_REDELIVERY_COOLDOWN_DAYS = 5;

/** Committed delivery row shape consumed by {@link selectDigestCandidates}. */
export interface DigestDeliveredRow {
  opportunityId: string;
  deliveredAtStatus: string;
  deliveredAt: Date;
}

/**
 * Cross-day digest suppression for scheduled-brief candidates.
 *
 * Three rules, applied in order:
 * 1. **Accepted-counterpart suppression** — a direct-connection candidate whose
 *    counterpart the viewer has already connected with (an `accepted`
 *    opportunity exists with that person) is dropped permanently. A new
 *    discovery run re-minting the same person must not resurface them.
 *    Connector-flow candidates (viewer is the introducer) are exempt: being
 *    connected with someone doesn't make an intro ask on their behalf stale.
 * 2. **Delivery-ledger dedup** — candidates with a committed delivery row at
 *    the same `(opportunityId, status)` key have already been shown. While any
 *    fresh (never-shown) candidate exists, shown ones are dropped entirely.
 * 3. **Cooldown re-show** — when *no* fresh candidate survives, already-shown
 *    candidates whose latest delivery is at least `cooldownDays` old are
 *    returned instead, least-recently-shown first, flagged via
 *    `redeliveryIds` so the digest can frame them as reminders.
 *
 * Pure function — callers fetch accepted counterparts and ledger rows.
 *
 * @param candidates - Deduped, confidence-ordered digest candidates.
 * @param opts.viewerId - The digest recipient.
 * @param opts.acceptedCounterpartIds - userIds the viewer already connected with.
 * @param opts.deliveredRows - Committed ledger rows for the candidate ids.
 * @param opts.now - Clock override for tests.
 * @param opts.cooldownDays - Cooldown override (default {@link DIGEST_REDELIVERY_COOLDOWN_DAYS}).
 * @returns Surviving pool plus the set of candidate ids that are cooldown re-shows.
 */
export function selectDigestCandidates<T extends {
  id: string;
  status: string;
  actors: Array<{ userId: string; role: string }>;
}>(
  candidates: T[],
  opts: {
    viewerId: string;
    acceptedCounterpartIds: ReadonlySet<string>;
    deliveredRows: DigestDeliveredRow[];
    now?: Date;
    cooldownDays?: number;
  },
): { pool: T[]; redeliveryIds: Set<string> } {
  const { viewerId, acceptedCounterpartIds } = opts;

  // Rule 1: accepted-counterpart suppression (direct connections only).
  const afterAccepted = candidates.filter((opp) => {
    const viewerIsIntroducer = opp.actors.some(
      (a) => a.role === 'introducer' && a.userId === viewerId,
    );
    if (viewerIsIntroducer) return true;
    const counterpart = opp.actors.find(
      (a) => a.userId !== viewerId && a.role !== 'introducer',
    );
    return !counterpart || !acceptedCounterpartIds.has(counterpart.userId);
  });
  if (afterAccepted.length < candidates.length) {
    digestCandidatesLog.info('Accepted-counterpart suppression dropped candidates', {
      dropped: candidates.length - afterAccepted.length,
      total: candidates.length,
    });
  }

  // Rule 2: delivery-ledger dedup keyed (opportunityId, deliveredAtStatus).
  // Keep the LATEST committed delivery per key — cooldown measures time since
  // the user last saw the card, not since they first saw it.
  const lastDeliveredByKey = new Map<string, Date>();
  for (const row of opts.deliveredRows) {
    if (!(row.deliveredAt instanceof Date) || Number.isNaN(row.deliveredAt.getTime())) continue;
    const key = `${row.opportunityId}:${row.deliveredAtStatus}`;
    const existing = lastDeliveredByKey.get(key);
    if (!existing || row.deliveredAt > existing) lastDeliveredByKey.set(key, row.deliveredAt);
  }

  const fresh = afterAccepted.filter((opp) => !lastDeliveredByKey.has(`${opp.id}:${opp.status}`));
  if (fresh.length > 0) {
    if (fresh.length < afterAccepted.length) {
      digestCandidatesLog.info('Ledger dedup dropped already-shown candidates', {
        dropped: afterAccepted.length - fresh.length,
      });
    }
    return { pool: fresh, redeliveryIds: new Set<string>() };
  }

  // Rule 3: nothing fresh — re-show the least-recently-shown candidates past cooldown.
  const cooldownMs = (opts.cooldownDays ?? DIGEST_REDELIVERY_COOLDOWN_DAYS) * 86_400_000;
  const now = opts.now ?? new Date();
  const cooled = afterAccepted
    .map((opp) => ({ opp, at: lastDeliveredByKey.get(`${opp.id}:${opp.status}`) }))
    .filter((entry): entry is { opp: T; at: Date } =>
      entry.at instanceof Date && now.getTime() - entry.at.getTime() >= cooldownMs,
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  if (cooled.length > 0) {
    digestCandidatesLog.info('No fresh candidates — re-showing past-cooldown candidates', {
      count: cooled.length,
    });
  }
  return {
    pool: cooled.map((entry) => entry.opp),
    redeliveryIds: new Set(cooled.map((entry) => entry.opp.id)),
  };
}
