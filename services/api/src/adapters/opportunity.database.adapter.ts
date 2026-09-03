import { schema, CreateOpportunityInput, OpportunityRow, UserIdentity, and, buildProfileFromUser, db, desc, eq, gte, inArray, isNotNull, isNull, logger, lte, ne, notInArray, opportunities, or, sql, toOpportunityRow, traceAppOperation } from './database.shared';
import { emitOpportunityLifecycleBestEffort, emitOpportunityTransitionBestEffort } from '../events/opportunity.event';
import { computeIntentFingerprint } from '../lib/intent/intent.fingerprint';
import { computeOutcomeCounterpartDedupKey, computeOutcomeIdempotencyKey, computeOutcomeSnapshotHash } from '../lib/opportunity/outcome-feedback.identity';
import { acquireIntentScopeAdvisoryLock } from './intent-scope.atomic';
import { negotiationDatabaseAdapter } from './negotiation.database.adapter';
import { exactLivePoolWhere } from './poolquery.shared';

interface OpportunityNetworkEligibilityInput {
  ownerUserId: string;
  allowedNetworkIds: string[];
  triggerIntentId?: string;
}

interface IntentScopedOpportunityPersistenceConflict {
  reason: 'same_intent_pair_duplicate';
  existingOpportunityId: string;
  existingTriggerIntentId?: string;
  existingStatus: OpportunityRow['status'];
  existingCreatedAt: Date;
}

type IntentScopedOpportunityPersistenceResult =
  | { created: OpportunityRow; expired: OpportunityRow[] }
  | { conflict: IntentScopedOpportunityPersistenceConflict };

function opportunityTriggerForOwner(opportunity: OpportunityRow, ownerUserId: string): string | undefined {
  return opportunity.detection.triggeredBy
    ?? opportunity.actors.find((actor) => actor.userId === ownerUserId)?.intent;
}

function participantUserIds(data: CreateOpportunityInput): string[] {
  return [...new Set(data.actors
    .map((actor) => actor.userId))].sort();
}

async function acquireIntentScopedPairLock(
  tx: DrizzleTx,
  participantScopeKeys: string[],
): Promise<void> {
  const pairKey = [...new Set(participantScopeKeys)].sort().join('|');
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`opportunity-intent-pair:${pairKey}`}, 0)
    )
  `);
}

/**
 * API-local structural twin of protocol's OutcomeOutbox. Adapters must not
 * import protocol interfaces; TypeScript verifies compatibility at the caller.
 */
export interface AtomicOutcomeOutbox {
  event: unknown;
  actorResolution: 'selected_intent' | 'unique_owned_scope';
  result: { inserted: boolean };
}

/** Drizzle transaction handle type (callback param of db.transaction). */
type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Minimal transaction runner used by the testable atomic-transition wrapper. */
export interface AtomicTransactionRunner {
  transaction<T>(callback: (tx: DrizzleTx) => Promise<T>): Promise<T>;
}

/**
 * Lens B atomic outbox (IND-434): insert the append-only outcome event in the
 * SAME transaction as a winning owner-action transition. Idempotent on
 * idempotencyKey — a duplicate retry writes no new row and sets
 * `outbox.result.inserted = false`, so the caller never re-triggers mining.
 * Callers MUST only invoke this after the transition row is confirmed written.
 */
function getOutcomeEvent(outbox: AtomicOutcomeOutbox): schema.NewOpportunityOutcomeEvent {
  if (!outbox.event || typeof outbox.event !== 'object') {
    throw new Error('Outcome capture precondition failed');
  }
  return outbox.event as schema.NewOpportunityOutcomeEvent;
}

export async function applyOutcomeOutbox(tx: DrizzleTx, outbox: AtomicOutcomeOutbox | undefined): Promise<void> {
  if (!outbox) return;
  outbox.result.inserted = false;
  const event = getOutcomeEvent(outbox);
  const inserted = await tx
    .insert(schema.opportunityOutcomeEvents)
    .values(event)
    .onConflictDoNothing({ target: schema.opportunityOutcomeEvents.idempotencyKey })
    .returning({ id: schema.opportunityOutcomeEvents.id });
  outbox.result.inserted = inserted.length > 0;
}

interface OutcomeTransitionResult {
  actors: schema.OpportunityActor[];
}

/**
 * Revalidate the prepared scope against transaction-held opportunity actors and
 * a share-locked intent row. Any actor, owner, fingerprint, counterpart, or
 * event-integrity drift aborts the whole transaction before event insertion.
 */
export async function revalidateOutcomeOutbox(
  tx: DrizzleTx,
  opportunity: OutcomeTransitionResult,
  outbox: AtomicOutcomeOutbox,
): Promise<void> {
  const event = getOutcomeEvent(outbox);
  if (
    !event.recipientUserId
    || !event.intentId
    || !event.intentFingerprint
    || !event.opportunityId
    || (event.action !== 'accepted' && event.action !== 'rejected')
  ) {
    throw new Error('Outcome capture precondition failed');
  }

  const recipientActors = opportunity.actors.filter(
    (actor) => actor.userId === event.recipientUserId,
  );
  const recipientIntentIds = new Set(
    recipientActors
      .map((actor) => actor.intent?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const actorScopeValid = outbox.actorResolution === 'selected_intent'
    ? recipientActors.some((actor) => actor.intent === event.intentId)
    : recipientIntentIds.size === 1 && recipientIntentIds.has(event.intentId);
  if (!actorScopeValid) throw new Error('Outcome capture precondition failed');

  const participantIds = new Set(
    opportunity.actors
      .map((actor) => actor.userId),
  );
  if (participantIds.size !== 2 || !participantIds.has(event.recipientUserId)) {
    throw new Error('Outcome capture precondition failed');
  }
  const counterpartUserId = [...participantIds].find((userId) => userId !== event.recipientUserId);
  if (
    !counterpartUserId
    || computeOutcomeCounterpartDedupKey(event.recipientUserId, counterpartUserId) !== event.dedupKey
  ) {
    throw new Error('Outcome capture precondition failed');
  }

  const [intent] = await tx
    .select({
      payload: schema.intents.payload,
      summary: schema.intents.summary,
      userId: schema.intents.userId,
    })
    .from(schema.intents)
    .where(and(
      eq(schema.intents.id, event.intentId),
      eq(schema.intents.userId, event.recipientUserId),
    ))
    .for('share');
  if (
    !intent
    || computeIntentFingerprint(intent.payload, intent.summary) !== event.intentFingerprint
    || computeOutcomeSnapshotHash(event.candidateSnapshot) !== event.snapshotHash
    || computeOutcomeIdempotencyKey({
      recipientUserId: event.recipientUserId,
      intentId: event.intentId,
      intentFingerprint: event.intentFingerprint,
      opportunityId: event.opportunityId,
      action: event.action,
    }) !== event.idempotencyKey
  ) {
    throw new Error('Outcome capture precondition failed');
  }
}

/**
 * Execute a winning owner-action transition and its optional outcome event in
 * one database transaction. This is the single atomic choke point used by both
 * status-update and actor-stamp paths. Transaction-held revalidation happens
 * after the winning row update and immediately before insertion, so intent or
 * actor drift rolls back both the owner action and the event.
 */
export async function runAtomicOutcomeTransition<T extends OutcomeTransitionResult>(
  database: AtomicTransactionRunner,
  transition: (tx: DrizzleTx) => Promise<T | null>,
  outbox?: AtomicOutcomeOutbox,
): Promise<T | null> {
  return database.transaction(async (tx) => {
    const updated = await transition(tx);
    if (updated !== null && outbox) {
      await revalidateOutcomeOutbox(tx, updated, outbox);
      await applyOutcomeOutbox(tx, outbox);
    }
    return updated;
  });
}

/**
 * Candidate rows for persisted notification catch-up. This intentionally uses
 * actor membership rather than the legacy UI role-visibility policy; the
 * notification projection applies canonical actionability after the read.
 */
export function notificationSnapshotOpportunityWhere(userId: string) {
  return and(
    sql`${opportunities.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`,
    inArray(opportunities.status, ['pending']),
  )!;
}

/**
 * Statuses that enrichment-superseded expiry must never touch.
 *
 * `pending` means the agents already agreed and the row is waiting on its
 * OWNER's approval — a won match. The protocol enricher's merge-candidate pool
 * (DEFAULT_ENRICHER_EXCLUDE_STATUSES) omits `pending`, so a later sweep that
 * re-finds the same pair hands the pending row back to us in `expireIds`;
 * expiring it evaporates a match the human was about to approve.
 *
 * The invariant this pins: a `pending` opportunity leaves `pending` only by a
 * human decision (accept/reject) or by its signal being archived — never by
 * background churn. The intent-archive and removed-member cascades are
 * deliberate human-caused paths and are unaffected.
 */
export const ENRICHMENT_EXPIRY_PROTECTED_STATUSES = ['pending'] as const;

/**
 * Expire the rows an enrichment merge superseded, skipping protected ones.
 *
 * A skipped row keeps its status AND its `updated_at` — an attempt CAS keyed to
 * that timestamp must not lose its claim to a sweep that decided to leave the
 * row alone. The newly created enriched row is still written, so dedup and
 * suppression handle the duplicate on the read side as they always have.
 *
 * Runs inside the caller's transaction: the candidate statuses are read
 * `FOR UPDATE`, so the skip decision cannot race a concurrent human decision.
 *
 * @param tx - The caller's open transaction
 * @param expireIds - Rows the enricher marked superseded
 * @param extraWhere - Extra predicate the caller scopes its expiry with
 * @returns The rows actually expired
 */
async function expireEnrichmentSupersededIds(
  tx: DrizzleTx,
  expireIds: string[],
  extraWhere?: ReturnType<typeof and>,
): Promise<OpportunityRow[]> {
  const expired: OpportunityRow[] = [];
  if (expireIds.length === 0) return expired;

  const candidates = await tx
    .select({ id: opportunities.id, status: opportunities.status })
    .from(opportunities)
    .where(inArray(opportunities.id, expireIds))
    // Deterministic lock order: two sweeps whose expire sets overlap queue up
    // behind each other instead of deadlocking on a mirrored acquisition order.
    .orderBy(opportunities.id)
    .for('update');
  const protectedIds = candidates
    .filter((row) => (ENRICHMENT_EXPIRY_PROTECTED_STATUSES as readonly string[]).includes(row.status))
    .map((row) => row.id);
  if (protectedIds.length > 0) {
    logger.info('enricher_skipped_pending', { opportunityIds: protectedIds });
  }

  const now = new Date();
  for (const opportunityId of expireIds) {
    if (protectedIds.includes(opportunityId)) continue;
    const [row] = await tx
      .update(opportunities)
      .set({ status: 'expired', updatedAt: now })
      .where(and(
        eq(opportunities.id, opportunityId),
        // Belt-and-braces: the FOR UPDATE read above already settled the skip,
        // so this can only matter if that read is ever removed.
        notInArray(opportunities.status, [...ENRICHMENT_EXPIRY_PROTECTED_STATUSES]),
        ...(extraWhere ? [extraWhere] : []),
      ))
      .returning();
    if (row) expired.push(toOpportunityRow(row));
  }
  return expired;
}

export class OpportunityDatabaseAdapter {
  async getProfile(userId: string): Promise<UserIdentity | null> {
    return buildProfileFromUser(userId);
  }

  async createOpportunity(data: CreateOpportunityInput): Promise<OpportunityRow> {
    const [row] = await db
      .insert(opportunities)
      .values({
        detection: data.detection,
        actors: data.actors,
        interpretation: data.interpretation,
        context: data.context,
        confidence: data.confidence,
        status: data.status ?? 'pending',
        updatedAt: new Date(),
        expiresAt: data.expiresAt ?? null,
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
      })
      .returning();
    if (!row) throw new Error('OpportunityDatabaseAdapter.createOpportunity: no row returned');
    const created = toOpportunityRow(row);
    emitOpportunityLifecycleBestEffort(created);
    return created;
  }

  async createOpportunityIfNetworkEligible(
    data: CreateOpportunityInput,
    eligibility: OpportunityNetworkEligibilityInput,
  ): Promise<OpportunityRow | null> {
    const actorNetworkIds = [...new Set(data.actors.map((actor) => actor.networkId))];
    const allowedNetworkIds = new Set(eligibility.allowedNetworkIds);
    if (actorNetworkIds.length === 0 || actorNetworkIds.some((id) => !allowedNetworkIds.has(id))) return null;
    const requestedPairs = [
      ...data.actors.map((actor) => ({ userId: actor.userId, networkId: actor.networkId })),
      ...actorNetworkIds.map((networkId) => ({ userId: eligibility.ownerUserId, networkId })),
    ];
    const pairs = [...new Map(requestedPairs.map((pair) => [
      `${pair.userId}\u0000${pair.networkId}`,
      pair,
    ] as const)).values()];

    const created = await db.transaction(async (tx) => {
      if (eligibility.triggerIntentId) {
        const [ownedIntent] = await tx
          .select({ id: schema.intents.id })
          .from(schema.intents)
          .where(and(
            eq(schema.intents.id, eligibility.triggerIntentId),
            eq(schema.intents.userId, eligibility.ownerUserId),
            isNull(schema.intents.archivedAt),
            or(isNull(schema.intents.status), eq(schema.intents.status, 'ACTIVE')),
          ))
          .for('share');
        if (!ownedIntent) return null;
        const assignments = await tx
          .select({ networkId: schema.intentNetworks.networkId })
          .from(schema.intentNetworks)
          .where(and(
            eq(schema.intentNetworks.intentId, eligibility.triggerIntentId),
            inArray(schema.intentNetworks.networkId, actorNetworkIds),
          ))
          .for('share');
        if (new Set(assignments.map((row) => row.networkId)).size !== actorNetworkIds.length) return null;
      }

      const activePairs = await tx
        .select({
          userId: schema.networkMembers.userId,
          networkId: schema.networkMembers.networkId,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networks.id, schema.networkMembers.networkId))
        .where(and(
          or(...pairs.map((pair) => and(
            eq(schema.networkMembers.userId, pair.userId),
            eq(schema.networkMembers.networkId, pair.networkId),
          ))),
          isNull(schema.networkMembers.deletedAt),
          isNull(schema.networks.deletedAt),
        ))
        .for('share');
      if (activePairs.length !== pairs.length) return null;

      const [row] = await tx
        .insert(opportunities)
        .values({
          detection: data.detection,
          actors: data.actors,
          interpretation: data.interpretation,
          context: data.context,
          confidence: data.confidence,
          status: data.status ?? 'pending',
          updatedAt: new Date(),
          expiresAt: data.expiresAt ?? null,
          ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        })
        .returning();
      if (!row) throw new Error('OpportunityDatabaseAdapter.createOpportunityIfNetworkEligible: no row returned');
      return toOpportunityRow(row);
    });
    if (created) emitOpportunityLifecycleBestEffort(created);
    return created;
  }

  /**
   * Persist one owned-intent discovery result under intent-scope and exact-pair
   * advisory locks, re-checking exact intent-pair dedup at the final boundary.
   */
  async persistIntentScopedOpportunityIfNetworkEligible(
    data: CreateOpportunityInput,
    expireIds: string[],
    eligibility: OpportunityNetworkEligibilityInput & { triggerIntentId: string },
  ): Promise<IntentScopedOpportunityPersistenceResult | null> {
    const actorNetworkIds = [...new Set(data.actors.map((actor) => actor.networkId))];
    const allowedNetworkIds = new Set(eligibility.allowedNetworkIds);
    const actorUserIds = participantUserIds(data);
    const participantActors = data.actors;
    if (
      data.detection.triggeredBy !== eligibility.triggerIntentId
      || actorNetworkIds.length === 0
      || actorNetworkIds.some((id) => !allowedNetworkIds.has(id))
      || actorUserIds.length < 2
      || participantActors.some((actor) => !actor.intent)
      || !data.actors.some((actor) =>
        actor.userId === eligibility.ownerUserId
        && actor.intent === eligibility.triggerIntentId)
    ) return null;
    const participantScopeKeys = participantActors.map((actor) => `intent:${actor.intent!}`);
    const participantIntentNetworkBindings = [...new Map([
      ...participantActors.map((actor) => ({
        userId: actor.userId,
        intentId: actor.intent!,
        networkId: actor.networkId,
      })),
      ...actorNetworkIds.map((networkId) => ({
        userId: eligibility.ownerUserId,
        intentId: eligibility.triggerIntentId,
        networkId,
      })),
    ].map((binding) => [
      `${binding.userId}\u0000${binding.intentId}\u0000${binding.networkId}`,
      binding,
    ] as const)).values()];

    const requestedPairs = [
      ...data.actors.map((actor) => ({ userId: actor.userId, networkId: actor.networkId })),
      ...actorNetworkIds.map((networkId) => ({ userId: eligibility.ownerUserId, networkId })),
    ];
    const pairs = [...new Map(requestedPairs.map((pair) => [
      `${pair.userId}\u0000${pair.networkId}`,
      pair,
    ] as const)).values()];
    const actorContainment = data.actors
      .map((actor) => sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) elem
        WHERE elem->>'userId' = ${actor.userId}
          AND elem->>'intent' = ${actor.intent!}
      )`);
    const sameTrigger = or(
      sql`${opportunities.detection}->>'triggeredBy' = ${eligibility.triggerIntentId}`,
      sql`${opportunities.actors} @> ${JSON.stringify([{
        userId: eligibility.ownerUserId,
        intent: eligibility.triggerIntentId,
      }])}::jsonb`,
    );

    const result = await db.transaction(async (tx) => {
      // Common recipient+intent lock comes first. Recovery persistence takes
      // the same lock before reading exact-trigger opportunities, preventing a
      // phantom opportunity insert between its final read and question insert.
      await acquireIntentScopeAdvisoryLock(
        tx,
        eligibility.ownerUserId,
        eligibility.triggerIntentId,
      );
      await acquireIntentScopedPairLock(tx, participantScopeKeys);

      const activeAssignedIntents = await tx
        .select({
          id: schema.intents.id,
          userId: schema.intents.userId,
          networkId: schema.intentNetworks.networkId,
        })
        .from(schema.intents)
        .innerJoin(schema.intentNetworks, eq(schema.intentNetworks.intentId, schema.intents.id))
        .where(and(
          or(...participantIntentNetworkBindings.map((binding) => and(
            eq(schema.intents.id, binding.intentId),
            eq(schema.intents.userId, binding.userId),
            eq(schema.intentNetworks.networkId, binding.networkId),
          ))),
          isNull(schema.intents.archivedAt),
          eq(schema.intents.status, 'ACTIVE'),
        ))
        .for('share');
      const activeAssignedIntentKeys = new Set(activeAssignedIntents.map((intent) =>
        `${intent.userId}\u0000${intent.id}\u0000${intent.networkId}`));
      if (participantIntentNetworkBindings.some((binding) =>
        !activeAssignedIntentKeys.has(`${binding.userId}\u0000${binding.intentId}\u0000${binding.networkId}`))) return null;

      const activePairs = await tx
        .select({
          userId: schema.networkMembers.userId,
          networkId: schema.networkMembers.networkId,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networks.id, schema.networkMembers.networkId))
        .where(and(
          or(...pairs.map((pair) => and(
            eq(schema.networkMembers.userId, pair.userId),
            eq(schema.networkMembers.networkId, pair.networkId),
          ))),
          isNull(schema.networkMembers.deletedAt),
          isNull(schema.networks.deletedAt),
        ))
        .for('share');
      if (activePairs.length !== pairs.length) return null;

      const [sameTriggerRecentRow] = await tx
        .select()
        .from(opportunities)
        .where(and(
          ...actorContainment,
          sameTrigger,
        ))
        .orderBy(desc(opportunities.createdAt))
        .limit(1);
      if (sameTriggerRecentRow) {
        const existing = toOpportunityRow(sameTriggerRecentRow);
        return {
          conflict: {
            reason: 'same_intent_pair_duplicate' as const,
            existingOpportunityId: existing.id,
            existingTriggerIntentId: opportunityTriggerForOwner(existing, eligibility.ownerUserId),
            existingStatus: existing.status,
            existingCreatedAt: existing.createdAt,
          },
        };
      }

      const [inserted] = await tx
        .insert(opportunities)
        .values({
          detection: data.detection,
          actors: data.actors,
          interpretation: data.interpretation,
          context: data.context,
          confidence: data.confidence,
          status: data.status ?? 'pending',
          updatedAt: new Date(),
          expiresAt: data.expiresAt ?? null,
          ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        })
        .returning();
      if (!inserted) {
        throw new Error('OpportunityDatabaseAdapter.persistIntentScopedOpportunityIfNetworkEligible: no row returned');
      }

      const expired = await expireEnrichmentSupersededIds(tx, expireIds, sameTrigger);
      return { created: toOpportunityRow(inserted), expired };
    });

    if (result && 'created' in result && result.created) emitOpportunityLifecycleBestEffort(result.created);
    return result;
  }

  /**
   * Reactivates an opportunity only while participant scope and optional source
   * status remain current.
   *
   * @param id - Opportunity ID
   * @param status - Target lifecycle status
   * @param actors - Participant network anchors
   * @param eligibility - Authoritative owner/network/intent scope
   * @param expectedStatus - Optional compare-and-set source status
   * @returns The updated opportunity, or null after scope, status, or active-task drift
   */
  async updateOpportunityStatusIfNetworkEligible(
    id: string,
    status: OpportunityRow['status'],
    actors: Array<{ userId: string; networkId: string }>,
    eligibility: OpportunityNetworkEligibilityInput,
    expectedStatus?: OpportunityRow['status'],
  ): Promise<OpportunityRow | null> {
    const actorNetworkIds = [...new Set(actors.map((actor) => actor.networkId))];
    const allowedNetworkIds = new Set(eligibility.allowedNetworkIds);
    if (actorNetworkIds.length === 0 || actorNetworkIds.some((networkId) => !allowedNetworkIds.has(networkId))) return null;
    const requestedPairs = [
      ...actors.map((actor) => ({ userId: actor.userId, networkId: actor.networkId })),
      ...actorNetworkIds.map((networkId) => ({ userId: eligibility.ownerUserId, networkId })),
    ];
    const pairs = [...new Map(requestedPairs.map((pair) => [
      `${pair.userId}\u0000${pair.networkId}`,
      pair,
    ] as const)).values()];

    const updated = await db.transaction(async (tx) => {
      if (eligibility.triggerIntentId) {
        // Match exact-trigger creation and recovery persistence ordering: the
        // shared recipient+intent lock must precede every row/pair lock.
        await acquireIntentScopeAdvisoryLock(
          tx,
          eligibility.ownerUserId,
          eligibility.triggerIntentId,
        );
      }

      const validateEligibility = async (): Promise<boolean> => {
        if (eligibility.triggerIntentId) {
          const [ownedIntent] = await tx
            .select({ id: schema.intents.id })
            .from(schema.intents)
            .where(and(
              eq(schema.intents.id, eligibility.triggerIntentId),
              eq(schema.intents.userId, eligibility.ownerUserId),
              isNull(schema.intents.archivedAt),
              or(isNull(schema.intents.status), eq(schema.intents.status, 'ACTIVE')),
            ))
            .for('share');
          if (!ownedIntent) return false;
          const assignments = await tx
            .select({ networkId: schema.intentNetworks.networkId })
            .from(schema.intentNetworks)
            .where(and(
              eq(schema.intentNetworks.intentId, eligibility.triggerIntentId),
              inArray(schema.intentNetworks.networkId, actorNetworkIds),
            ))
            .for('share');
          if (new Set(assignments.map((row) => row.networkId)).size !== actorNetworkIds.length) return false;
        }

        const activePairs = await tx
          .select({
            userId: schema.networkMembers.userId,
            networkId: schema.networkMembers.networkId,
          })
          .from(schema.networkMembers)
          .innerJoin(schema.networks, eq(schema.networks.id, schema.networkMembers.networkId))
          .where(and(
            or(...pairs.map((pair) => and(
              eq(schema.networkMembers.userId, pair.userId),
              eq(schema.networkMembers.networkId, pair.networkId),
            ))),
            isNull(schema.networkMembers.deletedAt),
            isNull(schema.networks.deletedAt),
          ))
          .for('share');
        return activePairs.length === pairs.length;
      };

      const reactivate = async (): Promise<OpportunityRow | null> => {
        const [row] = await tx
          .update(opportunities)
          .set({ status, acceptedBy: null, updatedAt: new Date() })
          .where(and(
            eq(opportunities.id, id),
            ...(expectedStatus ? [eq(opportunities.status, expectedStatus)] : []),
          ))
          .returning();
        return row ? toOpportunityRow(row) : null;
      };

      // Reactivating out of `negotiating` races the negotiation itself: lock
      // the row, then refuse while the negotiation attached to it is still
      // unsettled.
      if (expectedStatus === 'negotiating') {
        if (!await validateEligibility()) return null;

        const [locked] = await tx
          .select({ status: opportunities.status })
          .from(opportunities)
          .where(eq(opportunities.id, id))
          .for('update');
        if (locked?.status !== 'negotiating') return null;

        const [live] = await tx
          .select({ id: schema.negotiations.id })
          .from(schema.negotiations)
          .where(and(
            eq(schema.negotiations.opportunityId, id),
            isNull(schema.negotiations.settledAt),
          ))
          .limit(1);
        if (live) return null;

        return reactivate();
      }

      return await validateEligibility() ? reactivate() : null;
    });
    if (updated) {
      emitOpportunityLifecycleBestEffort(updated);
      emitOpportunityTransitionBestEffort(updated);
    }
    return updated;
  }

  async getOpportunity(id: string): Promise<OpportunityRow | null> {
    const rows = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    const row = rows[0];
    return row ? toOpportunityRow(row) : null;
  }

  async findEnrichedReplacementOpportunities(opportunityId: string): Promise<OpportunityRow[]> {
    const rows = await db
      .select()
      .from(opportunities)
      .where(
        sql`${opportunities.detection} @> ${JSON.stringify({ enrichedFrom: [opportunityId] })}::jsonb`,
      )
      .orderBy(desc(opportunities.createdAt));
    return rows.map(toOpportunityRow);
  }

  async getOpportunitiesByIds(ids: string[]): Promise<OpportunityRow[]> {
    if (ids.length === 0) return [];
    const rows = await db.select().from(opportunities).where(inArray(opportunities.id, ids));
    return rows.map(toOpportunityRow);
  }

  /**
   * Resolve an opportunity ID from a full UUID or short prefix.
   * @param idOrPrefix - Full UUID or prefix (e.g. first 8 chars)
   * @param userId - The user ID (for visibility scoping via actors jsonb)
   * @returns Object with resolved id, or null/ambiguous status
   */
  async resolveOpportunityId(idOrPrefix: string, userId: string): Promise<{ id: string } | { ambiguous: true } | null> {
    const normalized = idOrPrefix.trim().toLowerCase();
    const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized);
    if (isFullUuid) {
      return { id: normalized };
    }
    const rows = await db.select({ id: opportunities.id })
      .from(opportunities)
      .where(and(
        sql`${opportunities.id} LIKE ${normalized + '%'}`,
        sql`${opportunities.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`,
      ))
      .limit(2);
    if (rows.length === 0) return null;
    if (rows.length > 1) return { ambiguous: true };
    return { id: rows[0].id };
  }

  async getNotificationSnapshotOpportunities(userId: string): Promise<OpportunityRow[]> {
    const rows = await db
      .select()
      .from(opportunities)
      .where(notificationSnapshotOpportunityWhere(userId))
      .orderBy(desc(opportunities.createdAt));
    return rows.map(toOpportunityRow);
  }

  async getOpportunitiesForUser(
    userId: string,
    options?: { status?: string; statuses?: string[]; networkId?: string; scopeType?: 'intent'; scopeId?: string; role?: string; limit?: number; offset?: number; conversationId?: string }
  ): Promise<OpportunityRow[]> {
    let intentScopeValid = false;
    if (options?.scopeType === 'intent' && options.scopeId) {
      // Scope validity is ownership, not current network assignment: an
      // intent's assigned networks can change after discovery, and gating the
      // scoped read on the *current* assignment orphaned every opportunity
      // anchored on a since-removed network — while countsByIntent (linkage
      // only) still counted them, so badges said N and the intent radar said 0.
      // The scoped view must be a pure narrowing of the unscoped view:
      // unscoped visibility ∩ intent linkage (+ the live-anchor guard below).
      const owned = await db
        .select({ id: schema.intents.id })
        .from(schema.intents)
        .where(and(
          eq(schema.intents.id, options.scopeId),
          eq(schema.intents.userId, userId),
        ))
        .limit(1);
      if (owned.length === 0) return [];
      intentScopeValid = true;
    }

    // The actors on a pairing may see it. This used to branch on role,
    // `latent`/`draft`; neither exists any more.
    const visibilityGuard = sql`(
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
        WHERE actor->>'userId' = ${userId}
      )
    )`;
    const conditions = [visibilityGuard];
    // Draft visibility: when explicit statuses are requested, the caller decides;
    // otherwise exclude drafts unless a conversationId scopes them to one session.
    if (options?.status && !options?.statuses?.length) conditions.push(eq(opportunities.status, options.status as typeof opportunities.$inferSelect.status));
    if (options?.networkId) {
      // Network scope gate (two clauses):
      // 1. The viewer's own actor must be anchored on the bound network. This
      //    alone (the previous fix) closed the case where the viewer wasn't on
      //    the network but a counterpart was.
      // 2. EVERY participant must also be anchored on the bound network —
      //    otherwise a cross-network opportunity (viewer in scope, counterpart
      //    only on another network) passes clause 1 and leaks that counterpart's
      //    user/profile/intent across the network boundary via the card.
      // We key clause 2 on "every participant (distinct actor user) has an
      // in-network anchor" rather than "every actor row is in-network" so that
      // opportunities with redundant actor rows on other networks (same users,
      // duplicate stamps) are not falsely hidden from a scoped reader.
      conditions.push(sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
        WHERE actor->>'userId' = ${userId}
          AND actor->>'networkId' = ${options.networkId}
      )`);
      conditions.push(sql`NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS a_out
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS a_in
          WHERE a_in->>'userId' = a_out->>'userId'
            AND a_in->>'networkId' = ${options.networkId}
        )
      )`);
    }
    if (options?.scopeType === 'intent' && options.scopeId && intentScopeValid) {
      // Selected-intent Radar: the historical linkage predicate. From-intent
      // discovery records `detection.triggeredBy`; older or manually linked
      // rows are selected via the viewer's own actor `intent` stamp.
      conditions.push(sql`(
        ${opportunities.detection}->>'triggeredBy' = ${options.scopeId}
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
          WHERE actor->>'userId' = ${userId}
            AND actor->>'intent' = ${options.scopeId}
        )
      )`);
      // Participant-safe rather than row-strict: every distinct actor user must
      // still hold a live membership on at least one network they are anchored
      // on in this opportunity. This blocks removed-candidate membership leaks
      // while tolerating harmless duplicate actor stamps for the same
      // participant on another network. Anchors are the discovery-time
      // networks stamped on the row — deliberately not the intent's *current*
      // network assignment, which can change after discovery.
      conditions.push(sql`NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS participant
        WHERE NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${opportunities.actors}) AS anchor
          JOIN ${schema.networkMembers} nm
            ON nm.user_id = anchor->>'userId'
           AND nm.network_id = anchor->>'networkId'
          JOIN ${schema.networks} n ON n.id = nm.network_id
          WHERE anchor->>'userId' = participant->>'userId'
            AND nm.deleted_at IS NULL
            AND n.deleted_at IS NULL
        )
      )`);
    }
    if (options?.statuses?.length) {
      conditions.push(inArray(opportunities.status, options.statuses as Array<typeof opportunities.$inferSelect.status>));
    }
    let q = db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));
    if (options?.limit != null) q = q.limit(options.limit) as typeof q;
    if (options?.offset != null) q = q.offset(options.offset) as typeof q;
    const rows = await q;
    return rows.map(toOpportunityRow);
  }

  /**
   * Get the live pool produced exactly by one intent for one visible recipient.
   * This deliberately does not reuse selected-intent scope, whose actor.intent
   * fallback is correct for UI reads but unsafe for answer-driven writes.
   */
  async getLivePoolOpportunitiesForIntent(
    recipientUserId: string,
    intentId: string,
  ): Promise<OpportunityRow[]> {
    const rows = await db
      .select()
      .from(opportunities)
      .where(exactLivePoolWhere(recipientUserId, intentId))
      .orderBy(desc(opportunities.createdAt));
    return rows.map(toOpportunityRow);
  }

  async getOpportunitiesForNetwork(
    networkId: string,
    options?: { status?: string; statuses?: string[]; actorUserId?: string; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    // Actor-anchored scope: an opportunity belongs to the network when at
    // least one actor was matched there. Replaces an earlier `context.networkId`
    // tag check — that field is a denormalization, not the source of truth, and
    // can drift from `actors[].networkId` in mixed-network flows.
    const conditions = [sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
      WHERE actor->>'networkId' = ${networkId}
    )`];
    // Per-actor visibility, as a separate predicate: the network scope asks
    // whether *some* actor was matched here, this asks whether *this user* is
    // one of them. Filtering here rather than after the read keeps limit/offset
    // counting visible rows only.
    if (options?.actorUserId) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
        WHERE actor->>'userId' = ${options.actorUserId}
      )`);
    }
    if (options?.status && !options?.statuses?.length) conditions.push(eq(opportunities.status, options.status as typeof opportunities.$inferSelect.status));
    if (options?.statuses?.length) {
      conditions.push(inArray(opportunities.status, options.statuses as Array<typeof opportunities.$inferSelect.status>));
    }
    let q = db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));
    if (options?.limit != null) q = q.limit(options.limit) as typeof q;
    if (options?.offset != null) q = q.offset(options.offset) as typeof q;
    const rows = await q;
    return rows.map(toOpportunityRow);
  }

  async updateOpportunityStatus(
    id: string,
    status: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
    outbox?: AtomicOutcomeOutbox,
  ): Promise<OpportunityRow | null> {
    if (status === 'accepted' && !acceptedBy) {
      throw new Error('acceptedBy is required when status is accepted');
    }
    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === 'accepted') {
      updates.acceptedBy = acceptedBy;
    } else {
      updates.acceptedBy = null;
    }
    // When an outbox is present, the flip and the outcome-event insert must be
    // atomic (rollback → no event); otherwise keep the cheap single-statement path.
    let row: typeof opportunities.$inferSelect | null | undefined;
    if (outbox) {
      row = await runAtomicOutcomeTransition(
        db as unknown as AtomicTransactionRunner,
        async (tx) => {
          const [updatedRow] = await tx
            .update(opportunities)
            .set(updates)
            .where(eq(opportunities.id, id))
            .returning();
          return updatedRow ?? null;
        },
        outbox,
      );
    } else {
      [row] = await db
        .update(opportunities)
        .set(updates)
        .where(eq(opportunities.id, id))
        .returning();
    }
    const updated = row ? toOpportunityRow(row) : null;
    if (updated) {
      emitOpportunityLifecycleBestEffort(updated);
      emitOpportunityTransitionBestEffort(updated);
    }
    return updated;
  }


  async updateOpportunityMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await db.update(opportunities).set({ metadata, updatedAt: new Date() }).where(eq(opportunities.id, id));
  }

  async stampOpportunityActorAction(
    id: string,
    actorUserId: string,
    status: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
    outbox?: AtomicOutcomeOutbox,
  ): Promise<OpportunityRow | null> {
    if (status === 'accepted' && !acceptedBy) {
      throw new Error('acceptedBy is required when status is accepted');
    }
    const updated = await runAtomicOutcomeTransition(
      db as unknown as AtomicTransactionRunner,
      async (tx) => {
        const [locked] = await tx
          .select({ actors: opportunities.actors })
          .from(opportunities)
          .where(eq(opportunities.id, id))
          .for('update');
        if (!locked) return null;
        const nowIso = new Date().toISOString();
        const updatedActors = (locked.actors as schema.OpportunityActor[]).map((actor) =>
          actor.userId === actorUserId
            ? { ...actor, actedAt: actor.actedAt ?? nowIso }
            : actor,
        );
        const updates: Record<string, unknown> = {
          actors: updatedActors,
          status,
          updatedAt: new Date(),
        };
        if (status === 'accepted') {
          updates.acceptedBy = acceptedBy;
        } else {
          updates.acceptedBy = null;
        }
        const [row] = await tx
          .update(opportunities)
          .set(updates)
          .where(eq(opportunities.id, id))
          .returning();
        return row ? toOpportunityRow(row) : null;
      },
      outbox,
    );
    if (updated) {
      emitOpportunityLifecycleBestEffort(updated);
      emitOpportunityTransitionBestEffort(updated);
    }
    return updated;
  }

  async createOpportunityAndExpireIds(
    data: CreateOpportunityInput,
    expireIds: string[]
  ): Promise<{ created: OpportunityRow; expired: OpportunityRow[] }> {
    const result = await traceAppOperation(
      {
        name: 'db create opportunity and expire ids',
        op: 'db.transaction',
        attributes: {
          subsystem: 'database',
          'db.system': 'postgresql',
          'db.operation': 'transaction',
          'opportunity.expire_count': expireIds.length,
        },
      },
      () => db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(opportunities)
        .values({
          detection: data.detection,
          actors: data.actors,
          interpretation: data.interpretation,
          context: data.context,
          confidence: data.confidence,
          status: data.status ?? 'pending',
          updatedAt: new Date(),
          expiresAt: data.expiresAt ?? null,
          ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        })
        .returning();
      if (!inserted) throw new Error('OpportunityDatabaseAdapter.createOpportunityAndExpireIds: no row returned');
      const created = toOpportunityRow(inserted);
      const expired = await expireEnrichmentSupersededIds(tx, expireIds);
      return { created, expired };
    }),
    );
    emitOpportunityLifecycleBestEffort(result.created);
    return result;
  }

  async createOpportunityAndExpireIdsIfNetworkEligible(
    data: CreateOpportunityInput,
    expireIds: string[],
    eligibility: OpportunityNetworkEligibilityInput,
  ): Promise<{ created: OpportunityRow; expired: OpportunityRow[] } | null> {
    const actorNetworkIds = [...new Set(data.actors.map((actor) => actor.networkId))];
    const allowedNetworkIds = new Set(eligibility.allowedNetworkIds);
    if (actorNetworkIds.length === 0 || actorNetworkIds.some((networkId) => !allowedNetworkIds.has(networkId))) return null;
    const requestedPairs = [
      ...data.actors.map((actor) => ({ userId: actor.userId, networkId: actor.networkId })),
      ...actorNetworkIds.map((networkId) => ({ userId: eligibility.ownerUserId, networkId })),
    ];
    const pairs = [...new Map(requestedPairs.map((pair) => [
      `${pair.userId}\u0000${pair.networkId}`,
      pair,
    ] as const)).values()];

    const result = await db.transaction(async (tx) => {
      if (eligibility.triggerIntentId) {
        const [ownedIntent] = await tx
          .select({ id: schema.intents.id })
          .from(schema.intents)
          .where(and(
            eq(schema.intents.id, eligibility.triggerIntentId),
            eq(schema.intents.userId, eligibility.ownerUserId),
            isNull(schema.intents.archivedAt),
            or(isNull(schema.intents.status), eq(schema.intents.status, 'ACTIVE')),
          ))
          .for('share');
        if (!ownedIntent) return null;
        const assignments = await tx
          .select({ networkId: schema.intentNetworks.networkId })
          .from(schema.intentNetworks)
          .where(and(
            eq(schema.intentNetworks.intentId, eligibility.triggerIntentId),
            inArray(schema.intentNetworks.networkId, actorNetworkIds),
          ))
          .for('share');
        if (new Set(assignments.map((row) => row.networkId)).size !== actorNetworkIds.length) return null;
      }

      const activePairs = await tx
        .select({
          userId: schema.networkMembers.userId,
          networkId: schema.networkMembers.networkId,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networks.id, schema.networkMembers.networkId))
        .where(and(
          or(...pairs.map((pair) => and(
            eq(schema.networkMembers.userId, pair.userId),
            eq(schema.networkMembers.networkId, pair.networkId),
          ))),
          isNull(schema.networkMembers.deletedAt),
          isNull(schema.networks.deletedAt),
        ))
        .for('share');
      if (activePairs.length !== pairs.length) return null;

      const [inserted] = await tx
        .insert(opportunities)
        .values({
          detection: data.detection,
          actors: data.actors,
          interpretation: data.interpretation,
          context: data.context,
          confidence: data.confidence,
          status: data.status ?? 'pending',
          updatedAt: new Date(),
          expiresAt: data.expiresAt ?? null,
          ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        })
        .returning();
      if (!inserted) throw new Error('OpportunityDatabaseAdapter.createOpportunityAndExpireIdsIfNetworkEligible: no row returned');

      const expired = await expireEnrichmentSupersededIds(tx, expireIds);
      return { created: toOpportunityRow(inserted), expired };
    });
    if (result) emitOpportunityLifecycleBestEffort(result.created);
    return result;
  }

  /** Condition: opportunity actors contain both userId and counterpartUserId. */
  private static actorPairCondition(userId: string, counterpartUserId: string) {
    return and(
      sql`${opportunities.actors} @> ${JSON.stringify([{ userId }])}::jsonb`,
      sql`${opportunities.actors} @> ${JSON.stringify([{ userId: counterpartUserId }])}::jsonb`
    );
  }

  async acceptSiblingOpportunities(
    userId: string,
    counterpartUserId: string,
    excludeOpportunityId: string
  ): Promise<string[]> {
    const ids = await db.transaction(async (tx) => {
      const siblingRows = await tx
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(
          and(
            OpportunityDatabaseAdapter.actorPairCondition(userId, counterpartUserId),
            notInArray(opportunities.status, ['accepted', 'expired', 'rejected']),
            ne(opportunities.id, excludeOpportunityId)
          )
        );
      const siblingIds = siblingRows.map((r) => r.id);
      if (siblingIds.length === 0) return [];
      const now = new Date();
      await tx
        .update(opportunities)
        .set({ status: 'accepted', updatedAt: now })
        .where(inArray(opportunities.id, siblingIds));
      return siblingIds;
    });
    for (const id of ids) emitOpportunityTransitionBestEffort({ id, status: 'accepted' });
    return ids;
  }

  async opportunityExistsBetweenActors(actorIds: string[], networkId: string): Promise<boolean> {
    if (actorIds.length === 0) return false;
    const expired = 'expired';
    const conditions = [
      sql`${opportunities.context}->>'networkId' = ${networkId}`,
      ne(opportunities.status, expired),
    ];
    // Require that all given actorIds appear in actors
    for (const actorId of actorIds) {
      conditions.push(
        sql`${opportunities.actors} @> ${JSON.stringify([{ userId: actorId }])}::jsonb`
      );
    }
    const rows = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  }

  async findOpportunitiesByActors(
    actorIds: string[],
    options?: {
      includeIntroducers?: boolean;
      statuses?: ('negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired')[];
      excludeStatuses?: ('negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired')[];
    }
  ): Promise<OpportunityRow[]> {
    if (actorIds.length === 0) return [];
    const includeIntroducers = options?.includeIntroducers ?? false;

    const containmentConditions = includeIntroducers
      ? actorIds.map(
          (uid) => sql`${opportunities.actors} @> ${JSON.stringify([{ userId: uid }])}::jsonb`
        )
      : actorIds.map(
          (uid) => sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) elem
            WHERE elem->>'userId' = ${uid}
          )`
        );

    const conditions = [and(...containmentConditions)!];
    if (options?.statuses && options.statuses.length > 0) {
      conditions.push(inArray(opportunities.status, options.statuses));
    }
    if (options?.excludeStatuses && options.excludeStatuses.length > 0) {
      conditions.push(notInArray(opportunities.status, options.excludeStatuses));
    }

    const rows = await db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.updatedAt));
    return rows.map(toOpportunityRow);
  }

  /**
   * IND-567 Rejection cool-down: returns the subset of `candidateUserIds` that
   * have at least one non-draft opportunity with `discovererId` whose `updatedAt`
   * falls within the last `windowMs` milliseconds AND whose status is `rejected`.
   *
   * Used by the opportunity-graph evaluation node to apply a similarity penalty
   * before sending candidates to the LLM, preventing cross-query re-surfacing of
   * recently-rejected pairs (IND-567).
   */
  async getRecentlyRejectedOpportunityCounterparties(
    discovererId: string,
    candidateUserIds: string[],
    windowMs: number,
  ): Promise<string[]> {
    if (candidateUserIds.length === 0) return [];
    const cutoff = new Date(Date.now() - windowMs);
    // Find non-draft opps that include discovererId as an actor,
    // have been updated within the window, and are in rejected status.
    const rows = await db
      .select({ actors: opportunities.actors })
      .from(opportunities)
      .where(
        and(
          inArray(opportunities.status, ['rejected']),
          gte(opportunities.updatedAt, cutoff),
          // Discoverer must be an actor
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) elem
            WHERE elem->>'userId' = ${discovererId}
          )`,
        ),
      );
    if (rows.length === 0) return [];

    // Extract counterpart user IDs that appear in the candidate list
    const candidateSet = new Set(candidateUserIds);
    const matched = new Set<string>();
    for (const row of rows) {
      for (const actor of (row.actors as Array<{ userId: string; role: string }>) ?? []) {
        if (actor.userId !== discovererId && candidateSet.has(actor.userId)) {
          matched.add(actor.userId);
        }
      }
    }
    return [...matched];
  }

  /**
   * Statuses of every opportunity where (userId, intentId) is an actor side —
   * the input of the own-intent exhaustion predicate
   * (`lib/question/intent-exhaustion.ts`).
   */
  async getOpportunityStatusesForIntentActor(userId: string, intentId: string): Promise<OpportunityRow['status'][]> {
    const rows = await db
      .select({ status: opportunities.status })
      .from(opportunities)
      .where(
        sql`${opportunities.actors} @> ${JSON.stringify([{ userId, intent: intentId }])}::jsonb`
      );
    return rows.map((row) => row.status);
  }

  async expireOpportunitiesByIntent(intentId: string): Promise<number> {
    const rows = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        sql`${opportunities.actors} @> ${JSON.stringify([{ intent: intentId }])}::jsonb`
      );
    if (rows.length === 0) return 0;
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          sql`${opportunities.actors} @> ${JSON.stringify([{ intent: intentId }])}::jsonb`
        )
      )
      .returning({ id: opportunities.id });
    for (const row of updated) emitOpportunityTransitionBestEffort({ id: row.id, status: 'expired' });
    return updated.length;
  }

  async expireOpportunitiesForRemovedMember(networkId: string, userId: string): Promise<number> {
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          sql`${opportunities.context}->>'networkId' = ${networkId}`,
          sql`${opportunities.actors} @> ${JSON.stringify([{ userId }])}::jsonb`
        )
      )
      .returning({ id: opportunities.id });
    for (const row of updated) emitOpportunityTransitionBestEffort({ id: row.id, status: 'expired' });
    return updated.length;
  }

  /** Set status to expired for opportunities with expires_at <= now. Skips terminal statuses (accepted, rejected, expired). */
  async expireStaleOpportunities(): Promise<number> {
    const now = new Date();
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          isNotNull(opportunities.expiresAt),
          lte(opportunities.expiresAt, now),
          notInArray(opportunities.status, ['accepted', 'rejected', 'expired'])
        )
      )
      .returning({ id: opportunities.id });
    await negotiationDatabaseAdapter.closeForOpportunities(updated.map((row) => row.id));
    for (const row of updated) emitOpportunityTransitionBestEffort({ id: row.id, status: 'expired' });
    return updated.length;
  }

}

// ═══════════════════════════════════════════════════════════════════════════════
// Network Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for Network Graph (intent/network context and assignment).
 */
