import { readUserContext, schema, ActiveIntentRow, ArchiveResultShape, CreateIntentInput, CreatedIntentRow, IntentLifecycleStatus, IntentListRow, UpdateIntentInput, activeIntentLifecycleWhere, activeOwnIntentsWhere, and, count, db, desc, eq, inArray, isNull, logger, ne, ownIntentsListWhere, sql } from './database.shared';

import { IntentEvents } from '../events/intent.event';
import { emitOpportunityTransitionBestEffort } from '../events/opportunity.event';
import { canApplyExpectedIntentUpdate, computeIntentFingerprint } from '../lib/intent/intent.fingerprint';
import { intentProposalAnalysisSchema, mapProposalAnalysisToIntent } from '../lib/intent/intent-proposal';


/** Scope type of the per-signal DM the personal agent speaks into. */
const NEGOTIATOR_INTENT_SCOPE_TYPE = 'negotiator-intent';

export class IntentDatabaseAdapter {
  /**
   * Retrieve a single user_context row (global when networkId is null), or null.
   * Mirrors {@link ChatDatabaseAdapter.getUserContext} for the intent graph.
   */
  async getUserContext(userId: string, networkId: string | null) {
    return readUserContext(userId, networkId);
  }

  async getActiveIntents(userId: string): Promise<ActiveIntentRow[]> {
    try {
      const result = await db.select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        createdAt: schema.intents.createdAt,
      })
        .from(schema.intents)
        .where(activeOwnIntentsWhere(userId))
        .orderBy(desc(schema.intents.createdAt));
      return result;
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.getActiveIntents error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Monotonically record an explicit owner visit without touching updatedAt.
   *
   * @param intentId - Intent being viewed.
   * @param userId - Expected owner.
   * @returns The authoritative visit timestamp, or null for missing/foreign rows.
   */
  async visitIntent(intentId: string, userId: string): Promise<Date | null> {
    const [visited] = await db
      .update(schema.intents)
      .set({
        lastVisitedAt: sql`GREATEST(COALESCE(${schema.intents.lastVisitedAt}, '-infinity'::timestamptz), NOW())`,
      })
      .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, userId)))
      .returning({ lastVisitedAt: schema.intents.lastVisitedAt });
    return visited?.lastVisitedAt ?? null;
  }

  async createIntent(data: CreateIntentInput): Promise<CreatedIntentRow> {
    try {
      const [created] = await db.insert(schema.intents)
        .values({
          userId: data.userId,
          payload: data.payload,
          summary: data.summary ?? null,
          embedding: data.embedding,
          isIncognito: data.isIncognito ?? false,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          semanticEntropy: data.semanticEntropy ?? undefined,
          referentialAnchor: data.referentialAnchor ?? undefined,
          felicityAuthority: data.felicityAuthority ?? undefined,
          felicitySincerity: data.felicitySincerity ?? undefined,
          felicityClarity: data.felicityClarity ?? undefined,
          intentMode: data.intentMode ?? undefined,
          speechActType: data.speechActType ?? undefined,
        })
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });
      if (!created) throw new Error('Insert did not return a row');
      return created;
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.createIntent error', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Atomically confirm one proposal with optional network assignment.
   * The durable proposal row is locked before its owner, expiry, exact payload,
   * verifier output, and current membership are checked. Intent insertion,
   * optional assignment, and proposal consumption commit together.
   *
   * @param input - Client binding plus the server-generated embedding.
   * @returns A discriminated confirmation result.
   */
  async confirmProposalIntent(
    input: {
      proposalId: string;
      userId: string;
      description: string;
      networkId?: string;
      embedding: number[];
    },
  ): Promise<
    | { kind: 'created'; intent: CreatedIntentRow }
    | { kind: 'replay'; intent: { id: string; archivedAt: Date | null } }
    | { kind: 'missing' }
    | { kind: 'expired' }
    | { kind: 'consumed' }
    | { kind: 'payload_mismatch' }
    | { kind: 'analysis_missing' }
    | { kind: 'membership_required' }
  > {
    return db.transaction(async (tx) => {
      const [proposal] = await tx
        .select()
        .from(schema.intentProposals)
        .where(eq(schema.intentProposals.id, input.proposalId))
        .limit(1)
        .for('update');
      if (!proposal || proposal.userId !== input.userId) return { kind: 'missing' } as const;

      const payloadMatches = proposal.description === input.description
        && proposal.networkId === (input.networkId ?? null);
      if (!payloadMatches) return { kind: 'payload_mismatch' } as const;

      if (proposal.status === 'consumed') {
        if (!proposal.consumedIntentId) return { kind: 'consumed' } as const;
        const [intent] = await tx
          .select({ id: schema.intents.id, archivedAt: schema.intents.archivedAt })
          .from(schema.intents)
          .where(and(
            eq(schema.intents.id, proposal.consumedIntentId),
            eq(schema.intents.userId, input.userId),
          ))
          .limit(1);
        return intent ? { kind: 'replay', intent } as const : { kind: 'consumed' } as const;
      }
      if (proposal.status !== 'pending') return { kind: 'consumed' } as const;
      if (proposal.expiresAt.getTime() <= Date.now()) return { kind: 'expired' } as const;

      const parsedAnalysis = intentProposalAnalysisSchema.safeParse(proposal.analysis);
      if (!parsedAnalysis.success) return { kind: 'analysis_missing' } as const;
      const mappedAnalysis = mapProposalAnalysisToIntent(parsedAnalysis.data);

      if (proposal.networkId) {
        const [membership] = await tx
          .select({ networkId: schema.networkMembers.networkId })
          .from(schema.networkMembers)
          .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
          .where(and(
            eq(schema.networkMembers.networkId, proposal.networkId),
            eq(schema.networkMembers.userId, input.userId),
            isNull(schema.networkMembers.deletedAt),
            isNull(schema.networks.deletedAt),
            sql`${schema.networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`,
          ))
          .limit(1)
          .for('update');
        if (!membership) return { kind: 'membership_required' } as const;
      }

      const [created] = await tx.insert(schema.intents)
        .values({
          userId: input.userId,
          payload: proposal.description,
          embedding: input.embedding,
          sourceType: 'discovery_form',
          sourceId: proposal.id,
          ...mappedAnalysis,
        })
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });
      if (!created) throw new Error('Insert did not return a row');

      if (proposal.networkId) {
        await tx.insert(schema.intentNetworks).values({
          intentId: created.id,
          networkId: proposal.networkId,
          relevancyScore: null,
        });
      }

      await tx
        .update(schema.intentProposals)
        .set({
          status: 'consumed',
          consumedAt: new Date(),
          consumedIntentId: created.id,
        })
        .where(eq(schema.intentProposals.id, proposal.id));

      return { kind: 'created', intent: created } as const;
    });
  }

  async updateIntent(intentId: string, data: UpdateIntentInput): Promise<CreatedIntentRow | null> {
    try {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.payload !== undefined) updateData.payload = data.payload;
      if (data.summary !== undefined) updateData.summary = data.summary;
      if (data.embedding !== undefined) updateData.embedding = data.embedding;
      if (data.isIncognito !== undefined) updateData.isIncognito = data.isIncognito;
      if (data.semanticEntropy !== undefined) updateData.semanticEntropy = data.semanticEntropy;
      if (data.referentialAnchor !== undefined) updateData.referentialAnchor = data.referentialAnchor;
      if (data.felicityAuthority !== undefined) updateData.felicityAuthority = data.felicityAuthority;
      if (data.felicitySincerity !== undefined) updateData.felicitySincerity = data.felicitySincerity;
      if (data.felicityClarity !== undefined) updateData.felicityClarity = data.felicityClarity;
      if (data.intentMode !== undefined) updateData.intentMode = data.intentMode;
      if (data.speechActType !== undefined) updateData.speechActType = data.speechActType;

      const result = await db.transaction(async (tx) => {
        const [before] = await tx.select({
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          userId: schema.intents.userId,
          status: schema.intents.status,
          archivedAt: schema.intents.archivedAt,
        }).from(schema.intents).where(eq(schema.intents.id, intentId)).limit(1).for('update');
        if (!before) return null;
        const oldFingerprint = computeIntentFingerprint(before.payload, before.summary);
        if (!canApplyExpectedIntentUpdate(
          before,
          data.expectedIntentFingerprint,
          data.expectedIntentUserId,
        )) return null;
        const [updated] = await tx.update(schema.intents)
          .set(updateData)
          .where(eq(schema.intents.id, intentId))
          .returning({
            id: schema.intents.id,
            payload: schema.intents.payload,
            summary: schema.intents.summary,
            isIncognito: schema.intents.isIncognito,
            createdAt: schema.intents.createdAt,
            updatedAt: schema.intents.updatedAt,
            userId: schema.intents.userId,
          });
        if (!updated) return null;
        return {
          updated,
          oldFingerprint,
          newFingerprint: computeIntentFingerprint(updated.payload, updated.summary),
        };
      });
      if (!result) return null;
      if (result.oldFingerprint !== result.newFingerprint) {
        await IntentEvents.onMaterialUpdated({
          intentId,
          userId: result.updated.userId,
          oldFingerprint: result.oldFingerprint,
          newFingerprint: result.newFingerprint,
        });
      }
      return result.updated;
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.updateIntent error', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Atomically transition an owned intent between ACTIVE and PAUSED.
   * The row is locked for the transaction, terminal/archived records are
   * rejected, and an optional network scope is enforced again in the UPDATE.
   * Idempotent calls preserve `updatedAt`; real transitions advance it
   * monotonically so the timestamp is a stable resume-dedup lifecycle version.
   *
   * @param input - Owner, intent, target status, and optional bound network.
   * @returns The transition outcome and stable lifecycle version on success.
   */
  async transitionIntentLifecycle(input: {
    intentId: string;
    userId: string;
    status: 'ACTIVE' | 'PAUSED';
    networkScopeId?: string | null;
    expectedUpdatedAtMs?: number;
  }): Promise<
    | { kind: 'success'; id: string; status: 'ACTIVE' | 'PAUSED'; changed: boolean; lifecycleVersionMs: number }
    | { kind: 'not_found' }
    | { kind: 'scope_violation' }
    | { kind: 'stale' }
    | { kind: 'conflict'; status: IntentLifecycleStatus | null; archived: boolean }
  > {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: schema.intents.id,
          status: schema.intents.status,
          archivedAt: schema.intents.archivedAt,
          updatedAt: schema.intents.updatedAt,
        })
        .from(schema.intents)
        .where(and(
          eq(schema.intents.id, input.intentId),
          eq(schema.intents.userId, input.userId),
        ))
        .limit(1)
        .for('update');
      const current = rows[0];
      if (!current) return { kind: 'not_found' } as const;

      if (input.expectedUpdatedAtMs !== undefined && current.updatedAt.getTime() !== input.expectedUpdatedAtMs) {
        return { kind: 'stale' } as const;
      }

      if (input.networkScopeId) {
        const scoped = await tx
          .select({ intentId: schema.intentNetworks.intentId })
          .from(schema.intentNetworks)
          .where(and(
            eq(schema.intentNetworks.intentId, input.intentId),
            eq(schema.intentNetworks.networkId, input.networkScopeId),
          ))
          .limit(1);
        if (scoped.length === 0) return { kind: 'scope_violation' } as const;
      }

      if (current.archivedAt || current.status === 'FULFILLED' || current.status === 'EXPIRED') {
        return {
          kind: 'conflict',
          status: current.status,
          archived: current.archivedAt !== null,
        } as const;
      }

      const normalizedCurrent = current.status ?? 'ACTIVE';
      if (normalizedCurrent === input.status) {
        return {
          kind: 'success',
          id: current.id,
          status: input.status,
          changed: false,
          lifecycleVersionMs: current.updatedAt.getTime(),
        } as const;
      }

      const updatedAt = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
      const scopeCondition = input.networkScopeId
        ? sql`EXISTS (
            SELECT 1 FROM ${schema.intentNetworks} lifecycle_scope
            WHERE lifecycle_scope.intent_id = ${schema.intents.id}
              AND lifecycle_scope.network_id = ${input.networkScopeId}
          )`
        : sql`true`;
      const [updated] = await tx
        .update(schema.intents)
        .set({ status: input.status, updatedAt })
        .where(and(
          eq(schema.intents.id, input.intentId),
          eq(schema.intents.userId, input.userId),
          isNull(schema.intents.archivedAt),
          scopeCondition,
        ))
        .returning({
          id: schema.intents.id,
          status: schema.intents.status,
          updatedAt: schema.intents.updatedAt,
        });
      if (!updated) {
        return input.networkScopeId
          ? { kind: 'scope_violation' } as const
          : { kind: 'not_found' } as const;
      }
      return {
        kind: 'success',
        id: updated.id,
        status: updated.status as 'ACTIVE' | 'PAUSED',
        changed: true,
        lifecycleVersionMs: updated.updatedAt.getTime(),
      } as const;
    });
  }

  /**
   * Compare-and-set a resume made by this request back to PAUSED when its
   * enqueue acknowledgement fails. The lifecycle version makes this a narrow
   * compensation: a concurrent lifecycle write is never overwritten.
   *
   * @param input - Resume owner, scope, and exact lifecycle version to undo.
   * @returns The authoritative visible lifecycle state, or null if no longer visible.
   */
  async compensateFailedResume(input: {
    intentId: string;
    userId: string;
    lifecycleVersionMs: number;
    networkScopeId?: string | null;
  }): Promise<{ status: IntentLifecycleStatus; lifecycleVersionMs: number } | null> {
    const scopeCondition = input.networkScopeId
      ? sql`EXISTS (
          SELECT 1 FROM ${schema.intentNetworks} lifecycle_scope
          WHERE lifecycle_scope.intent_id = ${schema.intents.id}
            AND lifecycle_scope.network_id = ${input.networkScopeId}
        )`
      : sql`true`;
    const expectedUpdatedAt = new Date(input.lifecycleVersionMs);
    const compensatedAt = new Date(Math.max(Date.now(), input.lifecycleVersionMs + 1));
    const [compensated] = await db
      .update(schema.intents)
      .set({ status: 'PAUSED', updatedAt: compensatedAt })
      .where(and(
        eq(schema.intents.id, input.intentId),
        eq(schema.intents.userId, input.userId),
        eq(schema.intents.status, 'ACTIVE'),
        isNull(schema.intents.archivedAt),
        eq(schema.intents.updatedAt, expectedUpdatedAt),
        scopeCondition,
      ))
      .returning({
        status: schema.intents.status,
        updatedAt: schema.intents.updatedAt,
      });
    if (compensated) {
      return {
        status: compensated.status as IntentLifecycleStatus,
        lifecycleVersionMs: compensated.updatedAt.getTime(),
      };
    }

    const [current] = await db
      .select({ status: schema.intents.status, updatedAt: schema.intents.updatedAt })
      .from(schema.intents)
      .where(and(
        eq(schema.intents.id, input.intentId),
        eq(schema.intents.userId, input.userId),
        scopeCondition,
      ))
      .limit(1);
    if (!current) return null;
    return {
      status: current.status ?? 'ACTIVE',
      lifecycleVersionMs: current.updatedAt.getTime(),
    };
  }

  async archiveIntent(intentId: string): Promise<ArchiveResultShape> {
    try {
      const [archived] = await db.update(schema.intents)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.intents.id, intentId))
        .returning({ id: schema.intents.id });
      if (!archived) return { success: false, error: 'Intent not found' };
      return { success: true };
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.archiveIntent error', { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async deleteIntentIndexAssociations(intentId: string): Promise<void> {
    await db.delete(schema.intentNetworks)
      .where(eq(schema.intentNetworks.intentId, intentId));
  }

  /**
   * Expires all non-expired opportunities where the given intent appears in the actors JSONB array.
   * @param intentId - The intent ID to match inside actors[].intent
   * @returns The number of opportunities expired
   */
  async expireOpportunitiesByIntentActor(intentId: string): Promise<number> {
    const result = await db.update(schema.opportunities)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(
        sql`${schema.opportunities.actors} @> ${JSON.stringify([{ intent: intentId }])}::jsonb`,
        ne(schema.opportunities.status, 'expired'),
      ))
      .returning({ id: schema.opportunities.id });
    for (const row of result) emitOpportunityTransitionBestEffort({ id: row.id, status: 'expired' });
    return result.length;
  }

  async getIntentsInIndexForMember(userId: string, indexNameOrId: string): Promise<ActiveIntentRow[]> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let networkId: string | null;

    if (uuidRegex.test(indexNameOrId.trim())) {
      const membership = await db
        .select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            eq(schema.networkMembers.networkId, indexNameOrId.trim()),
            isNull(schema.networks.deletedAt)
          )
        )
        .limit(1);
      networkId = membership[0]?.networkId ?? null;
    } else {
      const memberships = await db
        .select({
          networkId: schema.networkMembers.networkId,
          networkTitle: schema.networks.title,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            isNull(schema.networks.deletedAt)
          )
        );
      const needle = indexNameOrId.trim().toLowerCase();
      const match = memberships.find(
        (m) => (m.networkTitle ?? '').toLowerCase() === needle || (m.networkTitle ?? '').toLowerCase().includes(needle)
      );
      networkId = match?.networkId ?? null;
    }

    if (!networkId) {
      return [];
    }

    try {
      const result = await db
        .select({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          createdAt: schema.intents.createdAt,
          relevancyScore: schema.intentNetworks.relevancyScore,
        })
        .from(schema.intents)
        .innerJoin(schema.intentNetworks, eq(schema.intents.id, schema.intentNetworks.intentId))
        .where(
          and(
            eq(schema.intentNetworks.networkId, networkId),
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt),
            activeIntentLifecycleWhere(),
          )
        );
      return result.map((r) => ({
        id: r.id,
        payload: r.payload,
        summary: r.summary,
        createdAt: r.createdAt,
        relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
      }));
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.getIntentsInIndexForMember error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async listIntents(userId: string, options: {
    page: number;
    limit: number;
    archived: boolean;
    sourceType?: string;
  }): Promise<{ rows: IntentListRow[]; total: number; totalWaitingOpportunities: number }> {
    const offset = (options.page - 1) * options.limit;
    const where = ownIntentsListWhere(userId, { archived: options.archived, sourceType: options.sourceType });

    const [rows, totalResult] = await Promise.all([
      db.select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        status: schema.intents.status,
        isIncognito: schema.intents.isIncognito,
        createdAt: schema.intents.createdAt,
        updatedAt: schema.intents.updatedAt,
        archivedAt: schema.intents.archivedAt,
        sourceType: schema.intents.sourceType,
        sourceId: schema.intents.sourceId,
        firstDiscoverySucceededAt: schema.intents.firstDiscoverySucceededAt,
      })
        .from(schema.intents)
        .where(where)
        .orderBy(desc(schema.intents.createdAt))
        .offset(offset)
        .limit(options.limit),
      db.select({ count: count() }).from(schema.intents).where(where),
    ]);

    const { rows: withExtras, totalWaitingOpportunities } = await this.attachIntentExtras(rows, userId, false);
    return {
      // Progress is intentionally a single-signal owner detail contract; keep
      // the existing list payload stable and inexpensive for dashboards.
      rows: withExtras,
      total: Number(totalResult[0]?.count ?? 0),
      totalWaitingOpportunities,
    };
  }

  /**
   * Enrich a page of intent list rows with their registered networks, the
   * per-intent counts the UI surfaces (pending questions, waiting
   * opportunities), the fresh-intent discovery state, and whether the signal's
   * own agent is holding an unanswered question. Runs the grouped queries in
   * parallel and joins in memory, so it stays O(1) round-trips regardless of
   * page size.
   *
   * @param rows - The paginated base intent rows to enrich.
   * @param userId - Owner, used to scope the waiting-opportunity actor match.
   * @returns The rows with `networks`, `pendingQuestionCount`,
   *   `waitingOpportunityCount` and `awaitingReply` populated (empty/zero/false
   *   when none), plus a deduplicated total of waiting opportunities across
   *   the page's signals.
   */
  private async attachIntentExtras(
    rows: (Omit<IntentListRow, 'networks' | 'pendingQuestionCount' | 'waitingOpportunityCount' | 'warming' | 'awaitingReply'> & {
      /** Stamped by the from-intent queue on first successful discovery (IND-482). */
      firstDiscoverySucceededAt: Date | null;
    })[],
    userId: string,
    includeDiscoveryProgress = true,
  ): Promise<{ rows: IntentListRow[]; totalWaitingOpportunities: number }> {
    if (rows.length === 0) return { rows: [], totalWaitingOpportunities: 0 };
    const intentIds = rows.map(r => r.id);
    const warmingCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [networks, countResult, progress, awaitingReply] = await Promise.all([
      this.networksByIntent(intentIds),
      this.countsByIntent(intentIds, userId),
      includeDiscoveryProgress ? this.discoveryProgressByIntent(intentIds, userId) : Promise.resolve(new Map()),
      this.awaitingReplyByIntent(intentIds, userId),
    ]);
    return {
      rows: rows.map(({ firstDiscoverySucceededAt, ...r }) => ({
        ...r,
        networks: networks.get(r.id) ?? [],
        pendingQuestionCount: countResult.byIntent.get(r.id)?.questions ?? 0,
        waitingOpportunityCount: countResult.byIntent.get(r.id)?.opportunities ?? 0,
        awaitingReply: awaitingReply.has(r.id),
        warming: r.createdAt > warmingCutoff
          && firstDiscoverySucceededAt == null,
        ...(includeDiscoveryProgress ? { discoveryProgress: progress.get(r.id) ?? {
          // Legacy signals have no durable worker row. Do not infer a run from
          // freshness; report the absence honestly, except known historical success.
          status: firstDiscoverySucceededAt ? 'completed' : 'unknown',
          attempt: 0, maxAttempts: 3, assignedCommunityCount: (networks.get(r.id) ?? []).length,
          processedCommunityCount: 0, possibleOverlapCount: 0, conversationsStartedCount: 0,
          queuedAt: null, startedAt: null, completedAt: firstDiscoverySucceededAt, updatedAt: null,
        }} : {}),
      })),
      totalWaitingOpportunities: countResult.totalWaitingOpportunities,
    };
  }

  /**
   * The signals whose agent is waiting on the owner: the newest message in the
   * signal's ('negotiator-intent', intentId) DM is agent-authored AND offered
   * canned replies, so it is a question nobody has answered yet. A later
   * message of any kind — the owner's typed answer or their tapped chip, both
   * ordinary user messages — makes the newest row theirs and clears the flag.
   *
   * Derived, never stored: there is no "answered" bit to drift out of sync,
   * and one DISTINCT ON read covers the whole page.
   *
   * @param intentIds - The page's signals
   * @param userId - Owner, scoping the DM lookup
   * @returns The subset of ids whose DM is waiting on an answer
   */
  private async awaitingReplyByIntent(intentIds: string[], userId: string): Promise<Set<string>> {
    const waiting = new Set<string>();
    if (intentIds.length === 0) return waiting;
    const rows = await db
      .selectDistinctOn([schema.chatSessionScopes.scopeId], {
        intentId: schema.chatSessionScopes.scopeId,
        role: schema.messages.role,
        metadata: schema.messages.metadata,
      })
      .from(schema.chatSessionScopes)
      .innerJoin(
        schema.messages,
        eq(schema.messages.conversationId, schema.chatSessionScopes.conversationId),
      )
      .where(and(
        eq(schema.chatSessionScopes.userId, userId),
        eq(schema.chatSessionScopes.scopeType, NEGOTIATOR_INTENT_SCOPE_TYPE),
        inArray(schema.chatSessionScopes.scopeId, intentIds),
      ))
      .orderBy(
        schema.chatSessionScopes.scopeId,
        desc(schema.messages.createdAt),
        desc(schema.messages.id),
      );
    for (const row of rows) {
      if (row.role !== 'agent') continue;
      const options = (row.metadata as { options?: unknown } | null)?.options;
      if (Array.isArray(options) && options.length > 0) waiting.add(row.intentId);
    }
    return waiting;
  }

  private async discoveryProgressByIntent(intentIds: string[], userId: string): Promise<Map<string, NonNullable<IntentListRow['discoveryProgress']>>> {
    const result = new Map<string, NonNullable<IntentListRow['discoveryProgress']>>();
    if (!intentIds.length) return result;
    const rows = await db.select().from(schema.intentDiscoveryProgress).where(and(
      inArray(schema.intentDiscoveryProgress.intentId, intentIds),
      eq(schema.intentDiscoveryProgress.userId, userId),
    ));
    for (const row of rows) {
      // A worker heartbeat is the durable row's update time. Do not present a
      // retained/dead BullMQ job as active after a worker crash or redelivery
      // gap; its precise state is no longer knowable.
      const stale = (row.status === 'queued' || row.status === 'running')
        && Date.now() - row.updatedAt.getTime() > 30 * 60 * 1000;
      result.set(row.intentId, {
        status: stale ? 'unknown' : row.status === 'succeeded' ? 'completed' : row.status === 'failed'
          ? (row.attempt < row.maxAttempts ? 'retrying' : 'failed') : row.status,
        attempt: row.attempt, maxAttempts: row.maxAttempts,
        assignedCommunityCount: row.assignedCommunityCount,
        processedCommunityCount: row.processedCommunityCount,
        possibleOverlapCount: row.possibleOverlapCount,
        conversationsStartedCount: row.conversationsStartedCount,
        queuedAt: row.queuedAt, startedAt: row.startedAt, completedAt: row.completedAt, updatedAt: row.updatedAt,
      });
    }
    return result;
  }


  /**
   * Group each intent's registered networks (excluding soft-deleted networks)
   * into a map, in a single query.
   */
  private async networksByIntent(intentIds: string[]): Promise<Map<string, { id: string; title: string }[]>> {
    const byIntent = new Map<string, { id: string; title: string }[]>();
    if (intentIds.length === 0) return byIntent;
    const memberships = await db
      .select({
        intentId: schema.intentNetworks.intentId,
        networkId: schema.networks.id,
        title: schema.networks.title,
      })
      .from(schema.intentNetworks)
      .innerJoin(schema.networks, eq(schema.intentNetworks.networkId, schema.networks.id))
      .where(and(
        inArray(schema.intentNetworks.intentId, intentIds),
        isNull(schema.networks.deletedAt),
      ));
    for (const m of memberships) {
      const list = byIntent.get(m.intentId) ?? [];
      list.push({ id: m.networkId, title: m.title });
      byIntent.set(m.intentId, list);
    }
    return byIntent;
  }

  /**
   * Per-intent counts of pending intent-scoped questions and opportunities
   * awaiting the viewer. The opportunity query also returns one deduplicated
   * total across every requested signal. Every requested ID is present in the
   * returned map (zero when it has none).
   */
  private async countsByIntent(
    intentIds: string[],
    userId: string,
  ): Promise<{
    byIntent: Map<string, { questions: number; opportunities: number }>;
    totalWaitingOpportunities: number;
  }> {
    const byIntent = new Map<string, { questions: number; opportunities: number }>();
    if (intentIds.length === 0) return { byIntent, totalWaitingOpportunities: 0 };
    for (const id of intentIds) byIntent.set(id, { questions: 0, opportunities: 0 });
    const idList = sql.join(intentIds.map(id => sql`${id}`), sql`, `);

    const [questionRows, oppRows] = await Promise.all([
      // Mirror the intent-scoped pending-questions filter used on the detail
      // page (questioner.adapter.findPending): pending, not expired, actor-owned
      // by the user, attributed to the intent via intent-mode sourceId or
      // triggeredBy. (The opportunity-sourced branch is omitted — rare and
      // expensive.) Group key is the attributed intent id.
      db.execute(sql`
        SELECT key AS intent_id, COUNT(*)::int AS cnt
        FROM (
          SELECT CASE
            WHEN ${schema.questions.detection}->>'mode' = 'intent'
              AND ${schema.questions.detection}->>'sourceType' = 'intent'
              THEN ${schema.questions.detection}->>'sourceId'
            ELSE ${schema.questions.detection}->>'triggeredBy'
          END AS key
          FROM ${schema.questions}
          WHERE ${schema.questions.status} = 'pending'
            AND (${schema.questions.expiresAt} IS NULL OR ${schema.questions.expiresAt} > NOW())
            AND ${schema.questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb
        ) sub
        WHERE key IN (${idList})
        GROUP BY key
      `) as unknown as Array<{ intent_id: string; cnt: number }>,
      db.execute(sql`
        WITH matching AS (
          SELECT DISTINCT
            ${schema.opportunities.id} AS opportunity_id,
            requested.intent_id
          FROM ${schema.opportunities}
          CROSS JOIN LATERAL jsonb_array_elements(${schema.opportunities.actors}) AS actor
          CROSS JOIN LATERAL unnest(ARRAY[${idList}]::text[]) AS requested(intent_id)
          WHERE ${schema.opportunities.status} = 'pending'
            AND actor->>'userId' = ${userId}
            AND actor->>'role' IS DISTINCT FROM 'introducer'
            AND actor->>'actedAt' IS NULL
            AND (
              ${schema.opportunities.detection}->>'triggeredBy' = requested.intent_id
              OR actor->>'intent' = requested.intent_id
            )
        )
        SELECT intent_id, COUNT(DISTINCT opportunity_id)::int AS cnt
        FROM matching
        GROUP BY GROUPING SETS ((intent_id), ())
      `) as unknown as Array<{ intent_id: string | null; cnt: number }>,
    ]);

    for (const r of questionRows) {
      const entry = byIntent.get(r.intent_id);
      if (entry) entry.questions = Number(r.cnt);
    }
    let totalWaitingOpportunities = 0;
    for (const r of oppRows) {
      if (r.intent_id == null) {
        totalWaitingOpportunities = Number(r.cnt);
        continue;
      }
      const entry = byIntent.get(r.intent_id);
      if (entry) entry.opportunities = Number(r.cnt);
    }
    return { byIntent, totalWaitingOpportunities };
  }

  async getIntentById(intentId: string, userId: string): Promise<IntentListRow | null> {
    const row = await db.select({
      id: schema.intents.id,
      payload: schema.intents.payload,
      summary: schema.intents.summary,
      status: schema.intents.status,
      isIncognito: schema.intents.isIncognito,
      createdAt: schema.intents.createdAt,
      updatedAt: schema.intents.updatedAt,
      archivedAt: schema.intents.archivedAt,
      sourceType: schema.intents.sourceType,
      sourceId: schema.intents.sourceId,
      firstDiscoverySucceededAt: schema.intents.firstDiscoverySucceededAt,
    })
      .from(schema.intents)
      .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, userId)))
      .limit(1);

    if (!row[0]) return null;
    const { rows: [withExtras] } = await this.attachIntentExtras(row, userId);
    return withExtras ?? null;
  }

  /**
   * Resolve an intent ID from a full UUID or short prefix.
   * @param idOrPrefix - Full UUID or prefix (e.g. first 8 chars)
   * @param userId - The owning user's ID (for ownership scoping)
   * @returns Object with resolved id, or null/ambiguous status
   */
  async resolveIntentId(
    idOrPrefix: string,
    userId: string,
    networkScopeId?: string | null,
  ): Promise<{ id: string } | { ambiguous: true } | null> {
    const normalized = idOrPrefix.trim().toLowerCase();
    const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized);
    if (isFullUuid) {
      return { id: normalized };
    }
    const scopeCondition = networkScopeId
      ? sql`EXISTS (
          SELECT 1 FROM ${schema.intentNetworks} resolve_scope
          WHERE resolve_scope.intent_id = ${schema.intents.id}
            AND resolve_scope.network_id = ${networkScopeId}
        )`
      : sql`true`;
    const rows = await db.select({ id: schema.intents.id })
      .from(schema.intents)
      .where(and(
        sql`${schema.intents.id} LIKE ${normalized + '%'}`,
        eq(schema.intents.userId, userId),
        scopeCondition,
      ))
      .limit(2);
    if (rows.length === 0) return null;
    if (rows.length > 1) return { ambiguous: true };
    return { id: rows[0].id };
  }

  async isOwnedByUser(intentId: string, userId: string): Promise<boolean> {
    const row = await db.select({ id: schema.intents.id })
      .from(schema.intents)
      .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, userId)))
      .limit(1);
    return row.length > 0;
  }

  /**
   * Finds an intent by sourceId and userId (e.g. for idempotent proposal confirmation).
   * @param sourceId - The source identifier (e.g. proposalId from chat).
   * @param userId - The owning user's ID.
   * @returns The intent id if found, otherwise null.
   * @throws May throw database/query errors.
   */
  async getIntentBySourceId(sourceId: string, userId: string): Promise<{ id: string; archivedAt: Date | null } | null> {
    const rows = await db.select({ id: schema.intents.id, archivedAt: schema.intents.archivedAt })
      .from(schema.intents)
      .where(and(
        eq(schema.intents.sourceId, sourceId),
        eq(schema.intents.userId, userId),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Associates an intent with an index (inserts intent_indexes row).
   * @param intentId - The intent identifier.
   * @param networkId - The network identifier.
   * @returns Promise that resolves when the row is inserted.
   * @throws May throw on database insertion errors (db.insert/schema.intentNetworks).
   */
  async assignIntentToNetwork(
    intentId: string,
    networkId: string,
    relevancyScore?: number,
    assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
  ): Promise<void> {
    await db.insert(schema.intentNetworks)
      .values({
        intentId,
        networkId,
        relevancyScore: relevancyScore != null ? String(relevancyScore) : null,
        ...(assignmentMetadata !== undefined ? { assignmentMetadata } : {}),
      })
      .onConflictDoUpdate({
        target: [schema.intentNetworks.intentId, schema.intentNetworks.networkId],
        set: {
          relevancyScore: relevancyScore != null ? String(relevancyScore) : null,
          ...(assignmentMetadata !== undefined ? { assignmentMetadata } : {}),
        },
      });
  }

  /**
   * Atomically assign an existing owned intent while its network membership is current.
   *
   * @param userId - Exact authenticated owner and member.
   * @param intentId - Existing intent to assign.
   * @param networkId - Existing active network requiring accepted membership.
   * @param relevancyScore - Optional assignment score.
   * @param assignmentMetadata - Optional durable assignment decision metadata.
   * @returns A discriminated final-authority result.
   */
  async assignIntentToNetworkIfMember(
    userId: string,
    intentId: string,
    networkId: string,
    relevancyScore?: number,
    assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
  ): Promise<import('@indexnetwork/protocol').IntentNetworkFinalAssignmentResult> {
    return db.transaction(async (tx) => {
      const [intent] = await tx
        .select({ userId: schema.intents.userId, archivedAt: schema.intents.archivedAt })
        .from(schema.intents)
        .where(eq(schema.intents.id, intentId))
        .limit(1)
        .for('update');
      if (!intent || intent.userId !== userId || intent.archivedAt !== null) {
        return { kind: 'intent_not_owned_or_not_found' } as const;
      }

      const [network] = await tx
        .select({ deletedAt: schema.networks.deletedAt })
        .from(schema.networks)
        .where(eq(schema.networks.id, networkId))
        .limit(1)
        .for('update');
      if (!network || network.deletedAt !== null) {
        return { kind: 'membership_required' } as const;
      }

      const [membership] = await tx
        .select({ permissions: schema.networkMembers.permissions })
        .from(schema.networkMembers)
        .where(and(
          eq(schema.networkMembers.networkId, networkId),
          eq(schema.networkMembers.userId, userId),
          isNull(schema.networkMembers.deletedAt),
          sql`${schema.networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`,
        ))
        .limit(1)
        .for('update');
      if (!membership) {
        return { kind: 'membership_required' } as const;
      }

      const [existing] = await tx
        .select({ intentId: schema.intentNetworks.intentId })
        .from(schema.intentNetworks)
        .where(and(
          eq(schema.intentNetworks.intentId, intentId),
          eq(schema.intentNetworks.networkId, networkId),
        ))
        .limit(1);
      if (existing) {
        return { kind: 'already_assigned' } as const;
      }

      await tx.insert(schema.intentNetworks).values({
        intentId,
        networkId,
        relevancyScore: relevancyScore != null ? String(relevancyScore) : null,
        ...(assignmentMetadata !== undefined ? { assignmentMetadata } : {}),
      });
      return { kind: 'assigned' } as const;
    });
  }

  /**
   * Delete all intents for a user (for test teardown).
   */
  async deleteByUserId(userId: string): Promise<void> {
    const userIntentIds = db
      .select({ id: schema.intents.id })
      .from(schema.intents)
      .where(eq(schema.intents.userId, userId));
    await db.delete(schema.intentNetworks).where(inArray(schema.intentNetworks.intentId, userIntentIds));
    await db.delete(schema.intents).where(eq(schema.intents.userId, userId));
  }

  // --- Read mode methods (required by IntentGraphDatabase for queryNode) ---

  async getUser(userId: string) {
    const result = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const user = result[0];
    if (!user) return null;
    const socialRows = await db.select()
      .from(schema.userSocials)
      .where(eq(schema.userSocials.userId, userId));
    return {
      id: user.id,
      name: user.name ?? '',
      email: user.email ?? '',
      intro: user.intro ?? null,
      avatar: user.avatar ?? null,
      location: user.location ?? null,
      socials: socialRows.map(s => ({ id: s.id, userId: s.userId, label: s.label, value: s.value })),
      onboarding: user.onboarding ?? null,
      deletedAt: user.deletedAt ?? null,
    };
  }

  async isNetworkMember(networkId: string, userId: string): Promise<boolean> {
    const result = await db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
      .where(
        and(
          eq(schema.networkMembers.networkId, networkId),
          eq(schema.networkMembers.userId, userId),
          isNull(schema.networkMembers.deletedAt),
          isNull(schema.networks.deletedAt),
          sql`${schema.networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`
        )
      )
      .limit(1);
    return result.length > 0;
  }

  async getNetworkIntentsForMember(
    networkId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const isMember = await this.isNetworkMember(networkId, requestingUserId);
    if (!isMember) throw new Error('Access denied: Not a member of this network');

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const result = await db
      .select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        userId: schema.intents.userId,
        userName: schema.users.name,
        createdAt: schema.intents.createdAt,
        relevancyScore: schema.intentNetworks.relevancyScore,
      })
      .from(schema.intents)
      .innerJoin(schema.intentNetworks, eq(schema.intents.id, schema.intentNetworks.intentId))
      .leftJoin(schema.users, eq(schema.intents.userId, schema.users.id))
      .where(
        and(
          eq(schema.intentNetworks.networkId, networkId),
          isNull(schema.intents.archivedAt),
          activeIntentLifecycleWhere(),
        )
      )
      .orderBy(desc(schema.intents.createdAt))
      .limit(limit)
      .offset(offset);

    return result.map((r) => ({
      id: r.id,
      payload: r.payload,
      summary: r.summary,
      userId: r.userId,
      userName: r.userName ?? 'Unknown',
      createdAt: r.createdAt,
      relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
    }));
  }

  async getActiveIntentsAcrossIndexes(userId: string, indexIds: string[]) {
    try {
      if (indexIds.length === 0) return [];

      const rows = await db
        .selectDistinctOn([schema.intents.id], {
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          createdAt: schema.intents.createdAt,
        })
        .from(schema.intents)
        .innerJoin(schema.intentNetworks, eq(schema.intentNetworks.intentId, schema.intents.id))
        .where(
          and(
            activeOwnIntentsWhere(userId),
            inArray(schema.intentNetworks.networkId, indexIds),
          ),
        )
        .orderBy(schema.intents.id, desc(schema.intents.createdAt));

      return rows;
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.getActiveIntentsAcrossIndexes error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Chat Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

// Chat Session and Message interfaces — exported so the unified ConversationService can use them.
