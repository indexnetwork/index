import { schema, CreateOpportunityInput, OpportunityRow, UserIdentity, and, buildProfileFromUser, db, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, normalizeEmbedding, notInArray, opportunities, or, sql, toOpportunityRow, traceAppOperation } from './database.shared';
import { emitOpportunityLifecycleBestEffort } from '../events/opportunity.event';
import { computeIntentFingerprint } from '../lib/intent/intent.fingerprint';
import { computeOutcomeCounterpartDedupKey, computeOutcomeIdempotencyKey, computeOutcomeSnapshotHash } from '../lib/opportunity/outcome-feedback.identity';
import { acquireIntentScopeAdvisoryLock } from './intent-scope.atomic';
import { acquireNegotiationAttemptLock, acquireNegotiationPairLock, qualifyingActiveNegotiationTaskWhere, qualifyingNegotiationAttemptTaskWhere, qualifyingPairNegotiationTaskWhere } from './negotiation-attempt.atomic';
import { runTasklessNegotiationReactivation } from './negotiation-reactivation.atomic';
import { exactEvidencePoolWhere, exactLivePoolWhere, POOL_LIVE_STATUSES } from './poolquery.shared';

interface OpportunityNetworkEligibilityInput {
  ownerUserId: string;
  allowedNetworkIds: string[];
  triggerIntentId?: string;
}

interface IntentScopedOpportunityPersistenceConflict {
  reason: 'same_trigger_recent_duplicate' | 'pair_active_negotiation';
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
    .filter((actor) => actor.role !== 'introducer')
    .map((actor) => actor.userId))].sort();
}

async function acquireIntentScopedPairLocks(
  tx: DrizzleTx,
  actorUserIds: string[],
  triggerIntentId: string,
): Promise<void> {
  const pairKey = actorUserIds.join('|');
  await acquireNegotiationPairLock(tx, actorUserIds);
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`opportunity-pair-intent:${pairKey}:${triggerIntentId}`}, 0)
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
    (actor) => actor.userId === event.recipientUserId && actor.role !== 'introducer',
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
      .filter((actor) => actor.role !== 'introducer')
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
 * Restore an exact taskless attempt while holding the shared negotiation lock.
 * The opportunity row and qualifying-task query run after lock acquisition, so
 * they observe the committed winner rather than a pre-lock READ COMMITTED snapshot.
 */
export async function compensateTasklessNegotiatingOpportunityInTransaction(
  tx: DrizzleTx,
  id: string,
  expectedUpdatedAt: Date,
  fallbackStatus: 'latent' | 'draft',
): Promise<OpportunityRow | null> {
  await acquireNegotiationAttemptLock(tx, id);

  const [opportunity] = await tx
    .select({ status: opportunities.status, updatedAt: opportunities.updatedAt })
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .for('update');
  if (
    opportunity?.status !== 'negotiating'
    || opportunity.updatedAt.getTime() !== expectedUpdatedAt.getTime()
  ) {
    return null;
  }

  const [qualifyingTask] = await tx
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(qualifyingNegotiationAttemptTaskWhere(id, expectedUpdatedAt))
    .limit(1);
  if (qualifyingTask) return null;

  const [row] = await tx
    .update(opportunities)
    .set({ status: fallbackStatus, acceptedBy: null, updatedAt: new Date() })
    .where(and(
      eq(opportunities.id, id),
      eq(opportunities.status, 'negotiating'),
      eq(opportunities.updatedAt, expectedUpdatedAt),
    ))
    .returning();
  return row ? toOpportunityRow(row) : null;
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
   * Persist one owned-intent discovery result under pair + pair/intent advisory
   * locks, re-checking dedup and active negotiation state at the final boundary.
   */
  async persistIntentScopedOpportunityIfNetworkEligible(
    data: CreateOpportunityInput,
    expireIds: string[],
    eligibility: OpportunityNetworkEligibilityInput & { triggerIntentId: string },
    dedupWindowMs: number,
  ): Promise<IntentScopedOpportunityPersistenceResult | null> {
    const actorNetworkIds = [...new Set(data.actors.map((actor) => actor.networkId))];
    const allowedNetworkIds = new Set(eligibility.allowedNetworkIds);
    const actorUserIds = participantUserIds(data);
    if (
      data.detection.triggeredBy !== eligibility.triggerIntentId
      || actorNetworkIds.length === 0
      || actorNetworkIds.some((id) => !allowedNetworkIds.has(id))
      || actorUserIds.length < 2
      || !data.actors.some((actor) =>
        actor.userId === eligibility.ownerUserId
        && actor.role !== 'introducer'
        && actor.intent === eligibility.triggerIntentId)
      || !Number.isFinite(dedupWindowMs)
      || dedupWindowMs <= 0
    ) return null;

    const requestedPairs = [
      ...data.actors.map((actor) => ({ userId: actor.userId, networkId: actor.networkId })),
      ...actorNetworkIds.map((networkId) => ({ userId: eligibility.ownerUserId, networkId })),
    ];
    const pairs = [...new Map(requestedPairs.map((pair) => [
      `${pair.userId}\u0000${pair.networkId}`,
      pair,
    ] as const)).values()];
    const actorContainment = actorUserIds.map((userId) => sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) elem
      WHERE elem->>'userId' = ${userId}
        AND elem->>'role' IS DISTINCT FROM 'introducer'
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
      await acquireIntentScopedPairLocks(tx, actorUserIds, eligibility.triggerIntentId);

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

      const [activeNegotiationRow] = await tx
        .select({ opportunity: opportunities })
        .from(opportunities)
        .innerJoin(schema.tasks, sql`TRUE`)
        .where(qualifyingPairNegotiationTaskWhere(actorUserIds))
        .orderBy(desc(schema.tasks.updatedAt))
        .limit(1);
      if (activeNegotiationRow) {
        const existing = toOpportunityRow(activeNegotiationRow.opportunity);
        return {
          conflict: {
            reason: 'pair_active_negotiation' as const,
            existingOpportunityId: existing.id,
            existingTriggerIntentId: opportunityTriggerForOwner(existing, eligibility.ownerUserId),
            existingStatus: existing.status,
            existingCreatedAt: existing.createdAt,
          },
        };
      }

      const [sameTriggerRecentRow] = await tx
        .select()
        .from(opportunities)
        .where(and(
          ...actorContainment,
          sameTrigger,
          ne(opportunities.status, 'draft'),
          sql`${opportunities.createdAt} >= NOW() - (${dedupWindowMs} * INTERVAL '1 millisecond')`,
        ))
        .orderBy(desc(opportunities.createdAt))
        .limit(1);
      if (sameTriggerRecentRow) {
        const existing = toOpportunityRow(sameTriggerRecentRow);
        return {
          conflict: {
            reason: 'same_trigger_recent_duplicate' as const,
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

      const expired: OpportunityRow[] = [];
      if (expireIds.length > 0) {
        const now = new Date();
        for (const opportunityId of expireIds) {
          const [row] = await tx
            .update(opportunities)
            .set({ status: 'expired', updatedAt: now })
            .where(and(
              eq(opportunities.id, opportunityId),
              sameTrigger,
            ))
            .returning();
          if (row) expired.push(toOpportunityRow(row));
        }
      }
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

      if (expectedStatus === 'negotiating') {
        return runTasklessNegotiationReactivation({
          acquireAttemptLock: () => acquireNegotiationAttemptLock(tx, id),
          validateEligibility,
          lockOpportunity: async () => {
            const [opportunity] = await tx
              .select({ status: opportunities.status })
              .from(opportunities)
              .where(eq(opportunities.id, id))
              .for('update');
            return opportunity ?? null;
          },
          hasFreshNegotiationTask: async () => {
            const [task] = await tx
              .select({ id: schema.tasks.id })
              .from(schema.tasks)
              .where(qualifyingActiveNegotiationTaskWhere(id))
              .limit(1);
            return Boolean(task);
          },
          reactivate,
        });
      }

      return await validateEligibility() ? reactivate() : null;
    });
    if (updated) emitOpportunityLifecycleBestEffort(updated);
    return updated;
  }

  /**
   * Atomically restores an exact taskless negotiation attempt to its fallback status.
   * Compensation and attempt-bound task creation serialize on the same advisory
   * lock before rechecking the opportunity row and qualifying task existence.
   *
   * @param id - Opportunity ID
   * @param expectedUpdatedAt - Persistence boundary for the negotiation attempt
   * @param fallbackStatus - Status to restore when the guarded update succeeds
   * @returns The compensated opportunity, or null on a status, version, or task race
   */
  async compensateTasklessNegotiatingOpportunity(
    id: string,
    expectedUpdatedAt: Date,
    fallbackStatus: 'latent' | 'draft',
  ): Promise<OpportunityRow | null> {
    return db.transaction((tx) => compensateTasklessNegotiatingOpportunityInTransaction(
      tx,
      id,
      expectedUpdatedAt,
      fallbackStatus,
    ));
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

    // Role-based visibility: who can see depends on actor role and status (and whether introducer exists)
    const visibilityGuard = sql`(
      ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'introducer' }])}::jsonb
      OR ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'peer' }])}::jsonb
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'patient' }])}::jsonb
        AND (${opportunities.status} NOT IN ('latent', 'draft') OR NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
      )
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'agent' }])}::jsonb
        AND (
          ${opportunities.status} IN ('accepted', 'rejected', 'expired')
          OR (${opportunities.status} NOT IN ('latent', 'draft') AND NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
        )
      )
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'party' }])}::jsonb
        AND (${opportunities.status} NOT IN ('latent', 'draft') OR NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
      )
    )`;
    const conditions = [visibilityGuard];
    // Draft visibility: when explicit statuses are requested, the caller decides;
    // otherwise exclude drafts unless a conversationId scopes them to one session.
    const hasExplicitStatuses = (options?.statuses?.length ?? 0) > 0 || !!options?.status;
    if (!hasExplicitStatuses) {
      if (options?.conversationId == null) {
        conditions.push(sql`${opportunities.status} != 'draft'`);
      } else {
        conditions.push(
          sql`(${opportunities.status} != 'draft' OR (${opportunities.context}->>'conversationId') = ${options.conversationId})`
        );
      }
    }
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

  /**
   * Lens-C-only (IND-465): the exact recipient+intent pool INCLUDING terminal
   * statuses ('stalled','accepted','rejected','expired') — negotiation
   * evidence lives on decided negotiations. Lens A discriminator mining must
   * keep using {@link getLivePoolOpportunitiesForIntent}.
   */
  async getEvidencePoolOpportunitiesForIntent(
    recipientUserId: string,
    intentId: string,
  ): Promise<OpportunityRow[]> {
    const rows = await db
      .select()
      .from(opportunities)
      .where(exactEvidencePoolWhere(recipientUserId, intentId))
      .orderBy(desc(opportunities.createdAt));
    return rows.map(toOpportunityRow);
  }

  /**
   * Retrieve opportunities for a user that cite a specific premise in their
   * provenance. An opportunity "cites" the premise when:
   *  - any `metadata.evidence` entry references it as `sourcePremiseId` or
   *    `candidatePremiseId` (recorded by `buildCandidateEvidence` at discovery
   *    time), or
   *  - any actor row carries it as the grounding `premise` (set when
   *    discoverySource is 'premise-similarity').
   *
   * Used by the premise retract/expire cascade so that only opportunities
   * actually motivated by the lapsed premise are invalidated — opportunities
   * evidenced solely by other premises are left untouched (IND-423).
   * @param userId - The user whose opportunities to inspect (must be an actor)
   * @param premiseId - The retracted/expired premise
   * @param options - Optional status filter (e.g. cascade-eligible statuses)
   */
  async getOpportunitiesCitingPremise(
    userId: string,
    premiseId: string,
    options?: { statuses?: string[] },
  ): Promise<OpportunityRow[]> {
    const conditions = [
      sql`${opportunities.actors} @> ${JSON.stringify([{ userId }])}::jsonb`,
      sql`(
        ${opportunities.metadata}->'evidence' @> ${JSON.stringify([{ sourcePremiseId: premiseId }])}::jsonb
        OR ${opportunities.metadata}->'evidence' @> ${JSON.stringify([{ candidatePremiseId: premiseId }])}::jsonb
        OR ${opportunities.actors} @> ${JSON.stringify([{ premise: premiseId }])}::jsonb
      )`,
    ];
    if (options?.statuses?.length) {
      conditions.push(inArray(opportunities.status, options.statuses as Array<typeof opportunities.$inferSelect.status>));
    }
    const rows = await db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));
    return rows.map(toOpportunityRow);
  }

  async getOpportunitiesForNetwork(
    networkId: string,
    options?: { status?: string; statuses?: string[]; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    // Actor-anchored scope: an opportunity belongs to the network when at
    // least one actor was matched there. Replaces an earlier `context.networkId`
    // tag check — that field is a denormalization, not the source of truth, and
    // can drift from `actors[].networkId` in mixed-network introducer flows.
    const conditions = [sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
      WHERE actor->>'networkId' = ${networkId}
    )`];
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
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
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
    if (updated) emitOpportunityLifecycleBestEffort(updated);
    return updated;
  }

  async updateOpportunityActorApproval(
    id: string,
    introducerUserId: string,
    approved: boolean,
  ): Promise<OpportunityRow | null> {
    return db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ actors: opportunities.actors })
        .from(opportunities)
        .where(eq(opportunities.id, id))
        .for('update');
      if (!locked) return null;
      const updatedActors = (locked.actors as schema.OpportunityActor[]).map((actor) =>
        actor.role === 'introducer' && actor.userId === introducerUserId
          ? { ...actor, approved }
          : actor,
      );
      const [row] = await tx
        .update(opportunities)
        .set({ actors: updatedActors, updatedAt: new Date() })
        .where(eq(opportunities.id, id))
        .returning();
      return row ? toOpportunityRow(row) : null;
    });
  }

  async updateOpportunityMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await db.update(opportunities).set({ metadata, updatedAt: new Date() }).where(eq(opportunities.id, id));
  }

  /**
   * Atomically append/replace every answer-driven pool adjustment and matching
   * presentation-safe signal. All rows lock and commit together: a crash or
   * write failure cannot leave half the pool re-ranked (IND-419).
   *
   * @param writes - Opportunity patches keyed by questionId.
   */
  async applyOpportunityPoolAdjustments(
    recipientUserId: string,
    intentId: string,
    expectedIntentFingerprint: string,
    writes: Array<{
      opportunityId: string;
      adjustment: {
        questionId: string;
        recipientUserId: string;
        intentId: string;
        label: string;
        side: string;
        factor: number;
        detail?: string;
        appliedAt: string;
        intentFingerprint?: string;
      };
      signal: schema.OpportunitySignal;
    }>,
  ): Promise<string[] | null> {
    if (writes.length === 0) return [];
    return db.transaction(async (tx) => {
      const [intent] = await tx
        .select({
          userId: schema.intents.userId,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
        })
        .from(schema.intents)
        .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, recipientUserId)))
        .limit(1)
        .for('update');
      if (
        !intent
        || computeIntentFingerprint(intent.payload, intent.summary) !== expectedIntentFingerprint
      ) return null;

      const writeById = new Map(writes.map((write) => [write.opportunityId, write]));
      const lockedRows = await tx
        .select({
          id: opportunities.id,
          detection: opportunities.detection,
          actors: opportunities.actors,
          status: opportunities.status,
          metadata: opportunities.metadata,
          interpretation: opportunities.interpretation,
        })
        .from(opportunities)
        .where(and(
          inArray(opportunities.id, [...writeById.keys()]),
          exactLivePoolWhere(recipientUserId, intentId),
        ))
        .for('update');
      const appliedIds: string[] = [];

      for (const locked of lockedRows) {
        const write = writeById.get(locked.id);
        if (
          !write ||
          locked.detection.triggeredBy !== intentId ||
          !(POOL_LIVE_STATUSES as readonly string[]).includes(locked.status) ||
          !(locked.actors as schema.OpportunityActor[]).some((actor) => actor.userId === recipientUserId) ||
          write.adjustment.recipientUserId !== recipientUserId ||
          write.adjustment.intentId !== intentId ||
          write.signal.recipientUserId !== recipientUserId ||
          write.signal.intentId !== intentId
        ) continue;

        const rawAdjustments = locked.metadata?.poolAdjustments;
        const existingAdjustments = Array.isArray(rawAdjustments)
          ? rawAdjustments.filter((entry) => {
              if (typeof entry !== 'object' || entry === null) return true;
              const candidate = entry as {
                questionId?: unknown;
                recipientUserId?: unknown;
                intentId?: unknown;
              };
              return !(
                candidate.questionId === write.adjustment.questionId &&
                candidate.recipientUserId === recipientUserId &&
                candidate.intentId === intentId
              );
            })
          : [];
        const existingSignals = (locked.interpretation.signals ?? []).filter(
          (entry) => !(
            entry.type === 'pool_discriminator' &&
            entry.questionId === write.adjustment.questionId &&
            entry.recipientUserId === recipientUserId &&
            entry.intentId === intentId
          ),
        );

        await tx
          .update(opportunities)
          .set({
            metadata: { ...(locked.metadata ?? {}), poolAdjustments: [...existingAdjustments, write.adjustment] },
            interpretation: { ...locked.interpretation, signals: [...existingSignals, write.signal] },
            // Ranking metadata is presentation state, not a lifecycle event.
            // Preserve updatedAt so POOL_QUESTIONS_RANKING=off remains
            // byte-identical to the pre-adjustment newest-first ordering.
          })
          .where(eq(opportunities.id, locked.id));
        appliedIds.push(locked.id);
      }
      return appliedIds;
    });
  }

  async stampOpportunityActorAction(
    id: string,
    actorUserId: string,
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
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
    if (updated) emitOpportunityLifecycleBestEffort(updated);
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
      const expired: OpportunityRow[] = [];
      const now = new Date();
      for (const id of expireIds) {
        const [row] = await tx
          .update(opportunities)
          .set({ status: 'expired', updatedAt: now })
          .where(eq(opportunities.id, id))
          .returning();
        if (row) expired.push(toOpportunityRow(row));
      }
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

      const expired: OpportunityRow[] = [];
      const now = new Date();
      for (const opportunityId of expireIds) {
        const [row] = await tx
          .update(opportunities)
          .set({ status: 'expired', updatedAt: now })
          .where(eq(opportunities.id, opportunityId))
          .returning();
        if (row) expired.push(toOpportunityRow(row));
      }
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
    return db.transaction(async (tx) => {
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
      const ids = siblingRows.map((r) => r.id);
      if (ids.length === 0) return [];
      const now = new Date();
      await tx
        .update(opportunities)
        .set({ status: 'accepted', updatedAt: now })
        .where(inArray(opportunities.id, ids));
      return ids;
    });
  }

  async opportunityExistsBetweenActors(actorIds: string[], networkId: string): Promise<boolean> {
    if (actorIds.length === 0) return false;
    const expired = 'expired';
    const conditions = [
      sql`${opportunities.context}->>'networkId' = ${networkId}`,
      ne(opportunities.status, expired),
    ];
    // Require that all given actorIds appear in actors (opportunity may have extra actors, e.g. introducer)
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
      statuses?: ('latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired')[];
      excludeStatuses?: ('latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired')[];
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
              AND elem->>'role' IS DISTINCT FROM 'introducer'
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
   * falls within the last `windowMs` milliseconds AND whose status is `rejected`
   * or `stalled`.
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
    // Find non-draft opps that include discovererId as a non-introducer actor,
    // have been updated within the window, and are in rejected or stalled status.
    const rows = await db
      .select({ actors: opportunities.actors })
      .from(opportunities)
      .where(
        and(
          inArray(opportunities.status, ['rejected', 'stalled']),
          gte(opportunities.updatedAt, cutoff),
          // Discoverer must be a non-introducer actor
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) elem
            WHERE elem->>'userId' = ${discovererId}
              AND elem->>'role' IS DISTINCT FROM 'introducer'
          )`,
        ),
      );
    if (rows.length === 0) return [];

    // Extract counterpart user IDs that appear in the candidate list
    const candidateSet = new Set(candidateUserIds);
    const matched = new Set<string>();
    for (const row of rows) {
      for (const actor of (row.actors as Array<{ userId: string; role: string }>) ?? []) {
        if (actor.role !== 'introducer' && actor.userId !== discovererId && candidateSet.has(actor.userId)) {
          matched.add(actor.userId);
        }
      }
    }
    return [...matched];
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
    return updated.length;
  }

  /**
   * Retrieve premises for a user, optionally filtered by status.
   * Used by the opportunity graph prep node for premise-to-premise discovery.
   * @param userId - The user whose premises to retrieve
   * @param status - Optional status filter
   * @returns Array of premise records
   */
  async getPremisesForUser(userId: string, status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED'): Promise<Array<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[] | null;
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  }>> {
    const conditions: ReturnType<typeof eq>[] = [
      eq(schema.premises.userId, userId),
      isNull(schema.premises.deletedAt),
    ];
    if (status) {
      conditions.push(eq(schema.premises.status, status));
    }
    const rows = await db
      .select()
      .from(schema.premises)
      .where(and(...conditions))
      .orderBy(desc(schema.premises.createdAt));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      assertion: row.assertion as { text: string; tier: 'assertive' | 'contextual'; summary?: string },
      provenance: row.provenance as { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string },
      analysis: row.analysis as { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null,
      validity: row.validity as { validFrom?: string; validUntil?: string; volatile: boolean },
      embedding: row.embedding,
      status: row.status as 'ACTIVE' | 'RETRACTED' | 'EXPIRED',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      retractedAt: row.retractedAt,
    }));
  }

  /**
   * Retrieve a capped set of embedded premises for a user, scoped to target networks.
   * Premises are ordered by network relevancy score, then recency, so the
   * premise-to-premise discovery path searches representative premises instead
   * of every active premise a user has ever accumulated.
   * @param userId - The source user whose premises should seed discovery
   * @param networkIds - Target network IDs that premises must be assigned to
   * @param status - Optional status filter
   * @param limit - Maximum number of source premises to return
   * @returns Scoped premise records with non-null embeddings
   */
  async getPremisesForUserInNetworks(userId: string, networkIds: string[], status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED', limit = 40): Promise<Array<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[];
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  }>> {
    if (networkIds.length === 0 || limit <= 0) return [];
    const statusClause = status ? sql`AND p.status = ${status}` : sql``;
    const rows = await db.execute<{
      id: string;
      userId: string;
      assertion: unknown;
      provenance: unknown;
      analysis: unknown | null;
      validity: unknown;
      // Raw db.execute bypasses Drizzle's vector mapper: a pgvector column
      // arrives as a string here, not number[]. Typed `unknown` so every
      // caller must route through normalizeEmbedding (IND-348).
      embedding: unknown;
      status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
      createdAt: Date;
      updatedAt: Date;
      retractedAt: Date | null;
    }>(sql`
      WITH scoped AS (
        SELECT
          p.id,
          MAX(COALESCE(pn.relevancy_score::double precision, 0)) AS max_relevancy
        FROM ${schema.premises} p
        JOIN ${schema.premiseNetworks} pn ON p.id = pn.premise_id
        WHERE p.user_id = ${userId}
          AND pn.network_id = ANY(ARRAY[${sql.join(networkIds.map(id => sql`${id}`), sql`, `)}]::text[])
          ${statusClause}
          AND p.embedding IS NOT NULL
          AND p.deleted_at IS NULL
        GROUP BY p.id
      )
      SELECT
        p.id AS "id",
        p.user_id AS "userId",
        p.assertion AS "assertion",
        p.provenance AS "provenance",
        p.analysis AS "analysis",
        p.validity AS "validity",
        p.embedding AS "embedding",
        p.status AS "status",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt",
        p.retracted_at AS "retractedAt"
      FROM scoped s
      JOIN ${schema.premises} p ON p.id = s.id
      ORDER BY s.max_relevancy DESC, p.created_at DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      assertion: row.assertion as { text: string; tier: 'assertive' | 'contextual'; summary?: string },
      provenance: row.provenance as { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string },
      analysis: row.analysis as { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null,
      validity: row.validity as { validFrom?: string; validUntil?: string; volatile: boolean },
      // Raw `db.execute` bypasses Drizzle's vector mapper, so `embedding` arrives
      // as a pgvector string here — normalize to number[] before consumers call
      // `.join(',')` to rebuild the vector literal (IND-348).
      embedding: normalizeEmbedding(row.embedding),
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      retractedAt: row.retractedAt,
    }));
  }

  /**
   * Cosine similarity search against premise embeddings, scoped to shared networks.
   * Used by the opportunity graph's premise discovery path (path D).
   * @param params - Search parameters including embedding vector, network scope, and exclusions
   * @returns Matching premises ranked by cosine similarity
   */
  async searchPremisesBySimilarity(params: {
    embedding: number[];
    networkIds: string[];
    excludeUserId: string;
    limit: number;
    minScore?: number;
  }) {
    return traceAppOperation(
      {
        name: 'vector search premises by similarity',
        op: 'db.vector_search',
        attributes: {
          subsystem: 'database',
          'db.system': 'postgresql',
          'db.operation': 'vector_search',
          'search.strategy': 'premise-similarity',
          'search.index_scope_count': params.networkIds.length,
          'search.limit': params.limit,
        },
      },
      async () => {
    const { embedding, networkIds, excludeUserId, limit, minScore } = params;
    const vectorStr = `[${embedding.join(',')}]`;

    const rows = await db.execute<{
      premiseId: string;
      userId: string;
      networkId: string;
      assertionText: string;
      similarity: number;
    }>(sql`
      SELECT
        p.id AS "premiseId",
        p.user_id AS "userId",
        pn.network_id AS "networkId",
        p.assertion->>'text' AS "assertionText",
        1 - (p.embedding <=> ${vectorStr}::vector) AS similarity
      FROM ${schema.premises} p
      JOIN ${schema.premiseNetworks} pn ON p.id = pn.premise_id
      JOIN ${schema.networkMembers} nm
        ON nm.user_id = p.user_id AND nm.network_id = pn.network_id
      JOIN ${schema.networks} n ON n.id = pn.network_id
      WHERE pn.network_id = ANY(ARRAY[${sql.join(networkIds.map(id => sql`${id}`), sql`, `)}]::text[])
        AND p.user_id != ${excludeUserId}
        AND nm.deleted_at IS NULL
        AND n.deleted_at IS NULL
        AND p.status = 'ACTIVE'
        AND p.embedding IS NOT NULL
        AND p.deleted_at IS NULL
        ${minScore !== undefined ? sql`AND 1 - (p.embedding <=> ${vectorStr}::vector) >= ${minScore}` : sql``}
      ORDER BY p.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return rows as Array<{
      premiseId: string;
      userId: string;
      networkId: string;
      assertionText: string;
      similarity: number;
    }>;
      },
    );
  }

  /**
   * Cosine similarity search against user_context embeddings, scoped to shared networks.
   * Matches only per-network context rows (the global networkId-null row is never a
   * candidate), excluding the discovering user. Optional — lightweight-mode
   * context-to-context discovery no-ops when the adapter omits it.
   * @param params - Search parameters including embedding vector, network scope, and exclusions
   * @returns Matching user contexts ranked by cosine similarity
   */
  async searchUserContextsBySimilarity(params: {
    embedding: number[];
    networkIds: string[];
    excludeUserId: string;
    limit: number;
    minScore?: number;
  }) {
    return traceAppOperation(
      {
        name: 'vector search user contexts by similarity',
        op: 'db.vector_search',
        attributes: {
          subsystem: 'database',
          'db.system': 'postgresql',
          'db.operation': 'vector_search',
          'search.strategy': 'context-similarity',
          'search.index_scope_count': params.networkIds.length,
          'search.limit': params.limit,
        },
      },
      async () => {
    const { embedding, networkIds, excludeUserId, limit, minScore } = params;
    const vectorStr = `[${embedding.join(',')}]`;

    const rows = await db.execute<{
      contextId: string;
      userId: string;
      networkId: string;
      text: string;
      similarity: number;
    }>(sql`
      SELECT
        uc.id AS "contextId",
        uc.user_id AS "userId",
        uc.network_id AS "networkId",
        uc.text AS "text",
        1 - (uc.embedding <=> ${vectorStr}::vector) AS similarity
      FROM ${schema.userContexts} uc
      JOIN ${schema.networkMembers} nm
        ON nm.user_id = uc.user_id AND nm.network_id = uc.network_id
      JOIN ${schema.networks} n ON n.id = uc.network_id
      WHERE uc.network_id = ANY(ARRAY[${sql.join(networkIds.map(id => sql`${id}`), sql`, `)}]::text[])
        AND uc.user_id != ${excludeUserId}
        AND nm.deleted_at IS NULL
        AND n.deleted_at IS NULL
        AND uc.embedding IS NOT NULL
        ${minScore !== undefined ? sql`AND 1 - (uc.embedding <=> ${vectorStr}::vector) >= ${minScore}` : sql``}
      ORDER BY uc.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return rows as Array<{
      contextId: string;
      userId: string;
      networkId: string;
      text: string;
      similarity: number;
    }>;
      },
    );
  }

  /**
   * Batched cosine similarity search against premise embeddings, scoped to shared networks.
   * Uses a VALUES CTE plus LATERAL nearest-neighbor searches so OpportunityGraph
   * emits one DB span and one DB round-trip for all selected source premises.
   * @param params - Batch search parameters including source embeddings and candidate scope
   * @returns Matching premises ranked per source premise
   */
  async searchPremisesBySimilarityBatch(params: {
    sources: Array<{ premiseId: string; embedding: number[] }>;
    networkIds: string[];
    excludeUserId: string;
    limitPerSource: number;
    minScore?: number;
  }) {
    if (params.sources.length === 0 || params.networkIds.length === 0 || params.limitPerSource <= 0) return [];
    return traceAppOperation(
      {
        name: 'batch vector search premises by similarity',
        op: 'db.vector_search',
        attributes: {
          subsystem: 'database',
          'db.system': 'postgresql',
          'db.operation': 'vector_search',
          'search.strategy': 'premise-similarity-batch',
          'search.source_premise_count': params.sources.length,
          'search.index_scope_count': params.networkIds.length,
          'search.limit_per_source': params.limitPerSource,
        },
      },
      async () => {
        const sourceValues = sql.join(
          params.sources.map(source => sql`(${source.premiseId}, ${`[${source.embedding.join(',')}]`}::vector)`),
          sql`, `,
        );

        const rows = await db.execute<{
          sourcePremiseId: string;
          premiseId: string;
          userId: string;
          networkId: string;
          assertionText: string;
          similarity: number;
        }>(sql`
          WITH source_embeddings(source_premise_id, embedding) AS (
            VALUES ${sourceValues}
          )
          SELECT
            matches.source_premise_id AS "sourcePremiseId",
            matches.premise_id AS "premiseId",
            matches.user_id AS "userId",
            matches.network_id AS "networkId",
            matches.assertion_text AS "assertionText",
            matches.similarity AS "similarity"
          FROM source_embeddings se
          CROSS JOIN LATERAL (
            SELECT
              se.source_premise_id,
              p.id AS premise_id,
              p.user_id,
              pn.network_id,
              p.assertion->>'text' AS assertion_text,
              1 - (p.embedding <=> se.embedding) AS similarity
            FROM ${schema.premises} p
            JOIN ${schema.premiseNetworks} pn ON p.id = pn.premise_id
            JOIN ${schema.networkMembers} nm
              ON nm.user_id = p.user_id AND nm.network_id = pn.network_id
            JOIN ${schema.networks} n ON n.id = pn.network_id
            WHERE pn.network_id = ANY(ARRAY[${sql.join(params.networkIds.map(id => sql`${id}`), sql`, `)}]::text[])
              AND p.user_id != ${params.excludeUserId}
              AND nm.deleted_at IS NULL
              AND n.deleted_at IS NULL
              AND p.status = 'ACTIVE'
              AND p.embedding IS NOT NULL
              AND p.deleted_at IS NULL
              ${params.minScore !== undefined ? sql`AND 1 - (p.embedding <=> se.embedding) >= ${params.minScore}` : sql``}
            ORDER BY p.embedding <=> se.embedding
            LIMIT ${params.limitPerSource}
          ) matches
        `);

        return rows as Array<{
          sourcePremiseId: string;
          premiseId: string;
          userId: string;
          networkId: string;
          assertionText: string;
          similarity: number;
        }>;
      },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Network Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for Network Graph (intent/network context and assignment).
 */
