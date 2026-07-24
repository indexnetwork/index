import { readUserContext, readPremisesForUser, upsertIntentNetworkAssignment, schema, ActiveIntentRow, ArchiveResultShape, CreateIntentInput, CreateOpportunityInput, CreatedIntentRow, HydeDocumentRow, Id, NetworkMembershipEvents, NetworkMembershipRow, OnboardingState, OpportunityRow, SaveHydeDocumentInput, UpdateIntentInput, UserIdentity, activeIntentLifecycleWhere, activeOwnIntentsWhere, and, buildProfileFromUser, buildProfileWithIdFromUser, count, db, desc, ensurePersonalNetwork, eq, getPersonalIndexId, gt, gte, ilike, inArray, intentNetworks, intents, isNotNull, isNull, logger, networkMembers, networks, notInArray, or, persistProfileIdentityToUser, sql, traceAppOperation, userContexts, users } from './database.shared';

import { tasks } from '../schemas/conversation.schema';

import { EnrichmentDatabaseAdapter } from './enrichment.database.adapter';
import { IntentDatabaseAdapter } from './intent.database.adapter';
import { PremiseEvents } from '../events/premise.event';
import { IntentEvents } from '../events/intent.event';
import { canApplyExpectedIntentUpdate, computeIntentFingerprint } from '../lib/intent/intent.fingerprint';
import { OpportunityDatabaseAdapter } from './opportunity.database.adapter';
import { HydeDatabaseAdapter } from './hyde.database.adapter';
import { ConversationDatabaseAdapter } from './conversation.database.adapter';
import { _convDb } from './conversation.database.adapter';
import { QuestionerAdapter, type AnsweredNegotiationOwnerAnswer } from './questioner.adapter';

export class ChatDatabaseAdapter {
  private readonly hydeAdapter = new HydeDatabaseAdapter();
  private readonly intentAdapter = new IntentDatabaseAdapter();
  private _opportunityAdapter: OpportunityDatabaseAdapter | null = null;
  private get opportunityAdapter(): OpportunityDatabaseAdapter {
    if (!this._opportunityAdapter) this._opportunityAdapter = new OpportunityDatabaseAdapter();
    return this._opportunityAdapter;
  }
  private _questionerAdapter: QuestionerAdapter | null = null;
  private get questionerAdapter(): QuestionerAdapter {
    if (!this._questionerAdapter) this._questionerAdapter = new QuestionerAdapter(db);
    return this._questionerAdapter;
  }

  // Negotiation context methods — required by HomeGraphDatabase
  async getNegotiationTaskForOpportunity(opportunityId: string) { return _convDb().getNegotiationTaskForOpportunity(opportunityId); }
  async getNegotiationTasksForOpportunity(opportunityId: string) { return _convDb().getNegotiationTasksForOpportunity(opportunityId); }
  async getMessagesForConversation(conversationId: string) { return _convDb().getMessagesForConversation(conversationId); }
  async getMessagesByTaskIds(taskIds: string[]) { return _convDb().getMessagesByTaskIds(taskIds); }
  async getArtifactsForTask(taskId: string) { return _convDb().getArtifactsForTask(taskId); }

  // ─────────────────────────────────────────────────────────────────────────────
  // Chat Graph Methods (Profiles, Intents, Indexes)
  // ─────────────────────────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<UserIdentity | null> {
    return buildProfileFromUser(userId);
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
      logger.error('ChatDatabaseAdapter.getActiveIntents error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Returns aggregate activity counts for one user's own signals, questions,
   * opportunities, and opportunity negotiations. Counterparty data is never
   * selected by these queries.
   *
   * @param userId - Authenticated owner whose records are summarized.
   * @param input - Requested reporting window, clamped to 1-168 hours.
   * @returns Reproducible owner-scoped activity totals.
   */
  async getAgentActivitySummary(
    userId: string,
    input: { sinceHours: number },
  ): Promise<{
    sinceHours: number;
    liveSignalsWatched: number;
    opportunitiesSurfaced: number;
    opportunitiesBySignal: Array<{ intentId: string; title: string; count: number }>;
    pendingQuestionCount: number;
    questionsAnswered: number;
    negotiationsStarted: number;
    negotiationsCompleted: number;
  }> {
    const sinceHours = Math.max(1, Math.min(168, Math.trunc(input.sinceHours)));
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    const ownActor = sql`${schema.opportunities.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`;
    const ownIntentOpportunity = sql`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${schema.opportunities.actors}) AS actor
      JOIN ${schema.intents} AS owned_intent
        ON owned_intent.id = actor->>'intent'
       AND owned_intent.user_id = ${userId}
      WHERE actor->>'userId' = ${userId}
    )`;
    const ownQuestion = sql`${schema.questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`;

    const [liveRows, surfacedRows, bySignalRows, pendingRows, answeredRows, negotiationRows] = await Promise.all([
      db.select({ count: count() })
        .from(schema.intents)
        .where(activeOwnIntentsWhere(userId)),
      db.select({ count: count() })
        .from(schema.opportunities)
        .where(and(gte(schema.opportunities.createdAt, since), ownIntentOpportunity)),
      db.select({
        intentId: schema.intents.id,
        title: sql<string>`coalesce(nullif(btrim(${schema.intents.summary}), ''), ${schema.intents.payload})`,
        count: count(schema.opportunities.id),
      })
        .from(schema.intents)
        .innerJoin(schema.opportunities, and(
          gte(schema.opportunities.createdAt, since),
          sql`EXISTS (
            SELECT 1
            FROM jsonb_array_elements(${schema.opportunities.actors}) AS actor
            WHERE actor->>'userId' = ${userId}
              AND actor->>'intent' = ${schema.intents.id}
          )`,
        ))
        .where(eq(schema.intents.userId, userId))
        .groupBy(schema.intents.id, schema.intents.summary, schema.intents.payload)
        .orderBy(desc(count(schema.opportunities.id))),
      db.select({ count: count() })
        .from(schema.questions)
        .where(and(
          eq(schema.questions.status, 'pending'),
          ownQuestion,
          or(isNull(schema.questions.expiresAt), gt(schema.questions.expiresAt, new Date())),
        )),
      db.select({ count: count() })
        .from(schema.questions)
        .where(and(
          eq(schema.questions.status, 'answered'),
          ownQuestion,
          sql`${schema.questions.answer}->>'answeredAt' >= ${since.toISOString()}`,
        )),
      db.select({
        started: sql<number>`count(distinct ${tasks.metadata}->>'opportunityId') filter (where ${tasks.createdAt} >= ${since.toISOString()})`,
        completed: sql<number>`count(distinct ${tasks.metadata}->>'opportunityId') filter (where ${tasks.state} = 'completed' and ${tasks.updatedAt} >= ${since.toISOString()})`,
      })
        .from(tasks)
        .innerJoin(schema.opportunities, sql`${tasks.metadata}->>'opportunityId' = ${schema.opportunities.id}`)
        .where(and(
          sql`${tasks.metadata}->>'type' = 'negotiation'`,
          ownActor,
          or(
            gte(tasks.createdAt, since),
            and(eq(tasks.state, 'completed'), gte(tasks.updatedAt, since)),
          ),
        )),

    ]);

    return {
      sinceHours,
      liveSignalsWatched: Number(liveRows[0]?.count ?? 0),
      opportunitiesSurfaced: Number(surfacedRows[0]?.count ?? 0),
      opportunitiesBySignal: bySignalRows.map((row) => ({
        intentId: row.intentId,
        title: row.title,
        count: Number(row.count),
      })),
      pendingQuestionCount: Number(pendingRows[0]?.count ?? 0),
      questionsAnswered: Number(answeredRows[0]?.count ?? 0),
      negotiationsStarted: Number(negotiationRows[0]?.started ?? 0),
      negotiationsCompleted: Number(negotiationRows[0]?.completed ?? 0),
    };
  }

  async searchOwnIntents(
    userId: string,
    q: string,
    limit: number,
  ): Promise<Array<{ id: string; payload: string; summary: string | null; createdAt: Date }>> {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return db
      .select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        createdAt: schema.intents.createdAt,
      })
      .from(schema.intents)
      .where(
        and(
          eq(schema.intents.userId, userId),
          isNull(schema.intents.archivedAt),
          activeIntentLifecycleWhere(),
          or(ilike(schema.intents.payload, pattern), ilike(schema.intents.summary, pattern)),
        ),
      )
      .orderBy(desc(schema.intents.createdAt))
      .limit(limit);
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
      return result;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getIntentsInIndexForMember error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async getUser(userId: string) {
    const profileAdapter = new EnrichmentDatabaseAdapter();
    return profileAdapter.getUser(userId);
  }

  async updateUser(
    userId: string,
    data: { name?: string; intro?: string; location?: string; onboarding?: OnboardingState }
  ) {
    const profileAdapter = new EnrichmentDatabaseAdapter();
    return profileAdapter.updateUser(userId, data);
  }

  async getUserSocials(userId: string) {
    const profileAdapter = new EnrichmentDatabaseAdapter();
    return profileAdapter.getUserSocials(userId);
  }

  async findTelegramHandleOwners(handle: string) {
    const profileAdapter = new EnrichmentDatabaseAdapter();
    return profileAdapter.findTelegramHandleOwners(handle);
  }

  async setUserSocials(userId: string, socials: { label: string; value: string }[]) {
    const profileAdapter = new EnrichmentDatabaseAdapter();
    return profileAdapter.setUserSocials(userId, socials);
  }

  async saveProfile(userId: string, profile: UserIdentity): Promise<void> {
    await persistProfileIdentityToUser(userId, profile);
  }

  /**
   * Soft-delete a ghost user and all their contact memberships.
   * Delegates to EnrichmentDatabaseAdapter.
   * @param userId - The ghost user to soft-delete
   * @returns true if the user was soft-deleted
   */
  async softDeleteGhost(userId: string): Promise<boolean> {
    const profileAdapter = new EnrichmentDatabaseAdapter();
    return profileAdapter.softDeleteGhost(userId);
  }

  /**
   * Find an existing user that shares any of the given social handles with the specified ghost.
   * Delegates to EnrichmentDatabaseAdapter.
   * @param userId - The ghost user ID to exclude from results
   * @param socials - Social handles to match against
   * @returns The matching user's ID, or null if no match found
   */
  async findDuplicateUser(
    userId: string,
    socials: Array<{ id: string; userId: string; label: string; value: string }>,
  ): Promise<{ id: string } | null> {
    const profileAdapter = new EnrichmentDatabaseAdapter();
    return profileAdapter.findDuplicateUser(userId, socials);
  }

  /**
   * Merge a ghost user (source) into a target user.
   * Re-points all data from source to target, cleans up ghost-only records, and soft-deletes source.
   * Delegates to EnrichmentDatabaseAdapter.
   * @param sourceId - The ghost user to merge away (must be an active ghost)
   * @param targetId - The user to merge into
   */
  async mergeGhostUser(sourceId: string, targetId: string): Promise<void> {
    const profileAdapter = new EnrichmentDatabaseAdapter();
    return profileAdapter.mergeGhostUser(sourceId, targetId);
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
      logger.error('ChatDatabaseAdapter.createIntent error', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
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
      logger.error('ChatDatabaseAdapter.updateIntent error', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
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
      logger.error('ChatDatabaseAdapter.archiveIntent error', { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getNetworkMemberships(userId: string): Promise<NetworkMembershipRow[]> {
    try {
      const result = await db
        .select({
          networkId: schema.networkMembers.networkId,
          networkTitle: schema.networks.title,
          indexPrompt: schema.networks.prompt,
          permissions: schema.networkMembers.permissions,
          memberPrompt: schema.networkMembers.prompt,
          autoAssign: schema.networkMembers.autoAssign,
          isPersonal: schema.networks.isPersonal,
          joinedAt: schema.networkMembers.createdAt,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .leftJoin(schema.personalNetworks, eq(schema.networks.id, schema.personalNetworks.networkId))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            isNull(schema.networkMembers.deletedAt),
            isNull(schema.networks.deletedAt),
            or(
              eq(schema.networks.isPersonal, false),
              and(
                eq(schema.networks.isPersonal, true),
                eq(schema.personalNetworks.userId, userId),
              )
            ),
          )
        );
      return result;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getNetworkMemberships error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async getNetworkMembership(networkId: string, userId: string): Promise<NetworkMembershipRow | null> {
    try {
      const result = await db
        .select({
          networkId: schema.networkMembers.networkId,
          networkTitle: schema.networks.title,
          indexPrompt: schema.networks.prompt,
          permissions: schema.networkMembers.permissions,
          memberPrompt: schema.networkMembers.prompt,
          autoAssign: schema.networkMembers.autoAssign,
          isPersonal: schema.networks.isPersonal,
          joinedAt: schema.networkMembers.createdAt,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.networkId, networkId),
            eq(schema.networkMembers.userId, userId),
            isNull(schema.networkMembers.deletedAt),
            isNull(schema.networks.deletedAt)
          )
        )
        .limit(1);
      return result[0] ?? null;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getNetworkMembership error', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async getActiveNetworkMembershipPairs(
    pairs: Array<{ userId: string; networkId: string }>,
  ): Promise<Array<{ userId: string; networkId: string }>> {
    if (pairs.length === 0) return [];
    const uniquePairs = [...new Map(
      pairs.map((pair) => [`${pair.userId}\u0000${pair.networkId}`, pair] as const),
    ).values()];
    const pairPredicates = uniquePairs.map((pair) => and(
      eq(schema.networkMembers.userId, pair.userId),
      eq(schema.networkMembers.networkId, pair.networkId),
    ));
    const rows = await db
      .select({
        userId: schema.networkMembers.userId,
        networkId: schema.networkMembers.networkId,
      })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
      .where(and(
        or(...pairPredicates),
        isNull(schema.networkMembers.deletedAt),
        isNull(schema.networks.deletedAt),
      ));
    return rows.sort((a, b) =>
      a.userId.localeCompare(b.userId) || a.networkId.localeCompare(b.networkId));
  }

  async getNetwork(networkId: string): Promise<{
    id: string;
    title: string;
    prompt?: string | null;
    type?: string;
    metadata?: Record<string, unknown> | null;
    permissions?: Record<string, unknown> | null;
  } | null> {
    const rows = await db
      .select({
        id: schema.networks.id,
        title: schema.networks.title,
        prompt: schema.networks.prompt,
        type: schema.networks.type,
        metadata: schema.networks.metadata,
        permissions: schema.networks.permissions,
      })
      .from(schema.networks)
      .where(and(eq(schema.networks.id, networkId), isNull(schema.networks.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ...row, permissions: row.permissions as unknown as Record<string, unknown> | null };
  }

  /**
   * IDs of all non-personal (community) networks the user is an active member of.
   * Excludes soft-deleted memberships, soft-deleted networks, and personal networks.
   * @param userId - The user whose community memberships to resolve
   * @returns Array of network IDs (possibly empty)
   */
  async getNonPersonalNetworkIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
      .where(and(
        eq(schema.networkMembers.userId, userId),
        isNull(schema.networkMembers.deletedAt),
        isNull(schema.networks.deletedAt),
        eq(schema.networks.isPersonal, false),
      ));
    return rows.map((r) => r.networkId);
  }

  /**
   * Check whether an index is a personal network.
   * @param networkId - The index to check
   * @returns true if the index has isPersonal = true
   */
  async isPersonalNetwork(networkId: string): Promise<boolean> {
    const rows = await db
      .select({ isPersonal: schema.networks.isPersonal })
      .from(schema.networks)
      .where(and(eq(schema.networks.id, networkId), isNull(schema.networks.deletedAt)))
      .limit(1);
    return rows[0]?.isPersonal === true;
  }

  async getNetworkWithPermissions(networkId: string): Promise<{ id: string; title: string; permissions: { joinPolicy: 'anyone' | 'invite_only' } } | null> {
    const rows = await db
      .select({ id: networks.id, title: networks.title, permissions: networks.permissions })
      .from(networks)
      .where(and(eq(networks.id, networkId), isNull(networks.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const perms = (row.permissions as { joinPolicy?: string }) ?? {};
    return {
      id: row.id,
      title: row.title,
      permissions: { joinPolicy: (perms.joinPolicy === 'anyone' ? 'anyone' : 'invite_only') as 'anyone' | 'invite_only' },
    };
  }

  async getNetworksForUser(userId: string) {
    const memberIndexIds = await db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
      .where(
        and(
          eq(schema.networkMembers.userId, userId),
          isNull(schema.networks.deletedAt),
          sql`${schema.networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`
        )
      );

    const ids = [...new Set(memberIndexIds.map((r) => r.networkId))];
    if (ids.length === 0) {
      return {
        networks: [],
        pagination: { current: 1, total: 0, count: 0, totalCount: 0 },
      };
    }

    const ownerMembers = db
      .select({
        networkId: schema.networkMembers.networkId,
        userId: schema.networkMembers.userId,
      })
      .from(schema.networkMembers)
      .where(sql`'owner' = ANY(${schema.networkMembers.permissions})`)
      .as('owner_members');

    const rows = await db
      .select({
        id: schema.networks.id,
        title: schema.networks.title,
        key: schema.networks.key,
        prompt: schema.networks.prompt,
        imageUrl: schema.networks.imageUrl,
        permissions: schema.networks.permissions,
        isPersonal: schema.networks.isPersonal,
        isExperiment: schema.networks.isExperiment,
        ownerId: ownerMembers.userId,
        createdAt: schema.networks.createdAt,
        updatedAt: schema.networks.updatedAt,
        ownerName: schema.users.name,
        ownerAvatar: schema.users.avatar,
        type: schema.networks.type,
        metadata: schema.networks.metadata,
      })
      .from(schema.networks)
      .leftJoin(ownerMembers, eq(schema.networks.id, ownerMembers.networkId))
      .leftJoin(schema.users, eq(ownerMembers.userId, schema.users.id))
      .where(
        and(
          isNull(schema.networks.deletedAt),
          inArray(schema.networks.id, ids),
          // Only include personal networks owned by the requesting user;
          // contacts in someone else's personal network must not see it.
          or(
            eq(schema.networks.isPersonal, false),
            eq(ownerMembers.userId, userId)
          ),
        )
      )
      .orderBy(desc(schema.networks.isPersonal), desc(schema.networks.createdAt));

    // Deduplicate: ownerMembers join can produce multiple rows per network
    // when a network has multiple owners. Keep the first encounter only.
    const uniqueRows = [...new Map(rows.map(r => [r.id, r])).values()];

    const indexesWithCounts = await Promise.all(
      uniqueRows.map(async (row) => {
        const [memberCount] = await db
          .select({ count: count() })
          .from(schema.networkMembers)
          .where(and(eq(schema.networkMembers.networkId, row.id), isNull(schema.networkMembers.deletedAt)));
        return {
          id: row.id,
          title: row.title,
          key: row.key,
          prompt: row.prompt,
          imageUrl: row.imageUrl,
          type: row.type ?? 'community',
          metadata: (row.metadata ?? {}) as Record<string, unknown>,
          permissions: row.permissions,
          isPersonal: row.isPersonal,
          isExperiment: row.isExperiment,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          user: {
            id: row.ownerId ?? '',
            name: row.ownerName ?? 'System',
            avatar: row.ownerAvatar ?? null,
          },
          _count: {
            members: Number(memberCount?.count ?? 0),
          },
        };
      })
    );

    const totalCount = indexesWithCounts.length;
    return {
      networks: indexesWithCounts,
      pagination: {
        current: 1,
        total: totalCount > 0 ? 1 : 0,
        count: totalCount,
        totalCount,
      },
    };
  }

  /**
   * Get non-personal networks that both users share membership in.
   * Returns id, title, and member count for each shared network.
   */
  async getSharedNetworks(currentUserId: string, targetUserId: string): Promise<{ id: string; title: string; _count: { members: number } }[]> {
    const currentUserIndexIds = db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .where(eq(schema.networkMembers.userId, currentUserId));

    const targetUserIndexIds = db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .where(eq(schema.networkMembers.userId, targetUserId));

    const rows = await db
      .select({
        id: schema.networks.id,
        title: schema.networks.title,
        memberCount: count(schema.networkMembers.networkId),
      })
      .from(schema.networks)
      .innerJoin(schema.networkMembers, and(eq(schema.networks.id, schema.networkMembers.networkId), isNull(schema.networkMembers.deletedAt)))
      .where(
        and(
          isNull(schema.networks.deletedAt),
          eq(schema.networks.isPersonal, false),
          inArray(schema.networks.id, currentUserIndexIds),
          inArray(schema.networks.id, targetUserIndexIds),
        )
      )
      .groupBy(schema.networks.id, schema.networks.title);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      _count: { members: Number(row.memberCount) },
    }));
  }

  /**
   * Get public networks that the user has not joined (for discovery).
   */
  async getPublicIndexesNotJoined(userId: string) {
    const userIndexIds = await db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .where(eq(schema.networkMembers.userId, userId));

    const excludeIds = userIndexIds.map(r => r.networkId);

    const whereConditions = [
      isNull(schema.networks.deletedAt),
      eq(schema.networks.isPersonal, false),
      or(eq(schema.networks.isExperiment, false), isNull(schema.networks.isExperiment)),
    ];

    if (excludeIds.length > 0) {
      whereConditions.push(notInArray(schema.networks.id, excludeIds));
    }

    const publicIndexes = await db
      .select({
        id: schema.networks.id,
        title: schema.networks.title,
        prompt: schema.networks.prompt,
        imageUrl: schema.networks.imageUrl,
        createdAt: schema.networks.createdAt,
        permissions: schema.networks.permissions,
      })
      .from(schema.networks)
      .where(and(...whereConditions))
      .orderBy(desc(schema.networks.createdAt));

    const result = [];
    for (const row of publicIndexes) {
      const perms = (row.permissions as { joinPolicy?: string } | null);
      if (perms?.joinPolicy !== 'anyone') continue;

      const [ownerMember] = await db
        .select({
          userId: schema.networkMembers.userId,
          userName: schema.users.name,
          userAvatar: schema.users.avatar,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.users, eq(schema.networkMembers.userId, schema.users.id))
        .where(
          and(
            eq(schema.networkMembers.networkId, row.id),
            sql`'owner' = ANY(${schema.networkMembers.permissions})`
          )
        )
        .limit(1);

      const [countResult] = await db
        .select({ count: count() })
        .from(schema.networkMembers)
        .where(and(eq(schema.networkMembers.networkId, row.id), isNull(schema.networkMembers.deletedAt)));

      result.push({
        id: row.id,
        title: row.title,
        prompt: row.prompt,
        imageUrl: row.imageUrl,
        createdAt: row.createdAt,
        permissions: row.permissions,
        memberCount: Number(countResult?.count ?? 0),
        owner: ownerMember ? {
          id: ownerMember.userId,
          name: ownerMember.userName,
          avatar: ownerMember.userAvatar,
        } : null,
      });
    }

    return {
      networks: result,
      pagination: {
        current: 1,
        total: result.length > 0 ? 1 : 0,
        count: result.length,
        totalCount: result.length,
      },
    };
  }

  async getUserIndexIds(userId: string): Promise<string[]> {
    try {
      const result = await db
        .select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            eq(schema.networkMembers.autoAssign, true),
            isNull(schema.networks.deletedAt)
          )
        );
      return result.map((r) => r.networkId);
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getUserIndexIds error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Returns the user's own personal network ID(s). Sourced from `personal_networks`
   * (PK on userId) rather than joining `network_members` × `isPersonal=true`, so
   * contact memberships on other users' personal networks are excluded by
   * construction. Fail-soft (returns []) to match {@link getUserIndexIds} since
   * this runs in the HyDE worker path.
   */
  async getUserPersonalNetworkIds(userId: string): Promise<string[]> {
    try {
      const result = await db
        .select({ networkId: schema.personalNetworks.networkId })
        .from(schema.personalNetworks)
        .innerJoin(schema.networks, eq(schema.personalNetworks.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.personalNetworks.userId, userId),
            isNull(schema.networks.deletedAt)
          )
        );
      return result.map((r) => r.networkId);
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getUserPersonalNetworkIds error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async getIntent(intentId: string) {
    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        isIncognito: intents.isIncognito,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        userId: intents.userId,
        archivedAt: intents.archivedAt,
        embedding: intents.embedding,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId,
        status: intents.status,
      })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const emb = row.embedding;
    const embedding: number[] | null =
      emb == null
        ? null
        : Array.isArray(emb) && emb.length > 0 && Array.isArray(emb[0])
          ? (emb[0] as number[])
          : Array.isArray(emb)
            ? (emb as number[])
            : null;
    return {
      id: row.id,
      payload: row.payload,
      summary: row.summary,
      isIncognito: row.isIncognito,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      userId: row.userId,
      archivedAt: row.archivedAt,
      embedding: embedding ?? undefined,
      sourceType: row.sourceType ?? undefined,
      sourceId: row.sourceId ?? undefined,
      status: row.status,
    };
  }

  async getIntentForIndexing(intentId: string) {
    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId,
        status: intents.status,
        archivedAt: intents.archivedAt,
      })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Record that the intent's first background discovery run completed
   * successfully. Idempotent: only stamps when the column is still null, so
   * later re-discovery (pool answers, lifecycle resumes) never rewrites the
   * original completion time. Read-side "warming" derivation clears on this
   * stamp instead of waiting out the 24-hour freshness window (IND-482).
   */
  async markIntentFirstDiscoverySucceeded(intentId: string): Promise<void> {
    await db
      .update(intents)
      .set({ firstDiscoverySucceededAt: new Date() })
      .where(and(eq(intents.id, intentId), isNull(intents.firstDiscoverySucceededAt)));
  }

  async getNetworkMemberContext(networkId: string, userId: string) {
    const rows = await db
      .select({
        networkId: networks.id,
        indexPrompt: networks.prompt,
        memberPrompt: networkMembers.prompt,
      })
      .from(networks)
      .innerJoin(networkMembers, eq(networks.id, networkMembers.networkId))
      .where(
        and(
          eq(networks.id, networkId),
          eq(networkMembers.userId, userId),
          eq(networkMembers.autoAssign, true),
          isNull(networks.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async getAssignmentNetworkMembershipsForUser(userId: string): Promise<Array<{ networkId: string; isPersonal: boolean }>> {
    try {
      const result = await db
        .select({
          networkId: schema.networkMembers.networkId,
          isPersonal: schema.networks.isPersonal,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .leftJoin(schema.personalNetworks, eq(schema.networks.id, schema.personalNetworks.networkId))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            isNull(schema.networkMembers.deletedAt),
            isNull(schema.networks.deletedAt),
            or(
              eq(schema.networks.isPersonal, false),
              and(
                eq(schema.networks.isPersonal, true),
                eq(schema.personalNetworks.userId, userId),
              ),
            ),
          )
        );
      return result.map((r) => ({ networkId: r.networkId, isPersonal: r.isPersonal }));
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getAssignmentNetworkMembershipsForUser error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async getAssignmentNetworkIdsForUser(userId: string): Promise<string[]> {
    const memberships = await this.getAssignmentNetworkMembershipsForUser(userId);
    return memberships.map((membership) => membership.networkId);
  }

  async getNetworkAssignmentContext(networkId: string, userId: string) {
    const rows = await db
      .select({
        networkId: networks.id,
        indexPrompt: networks.prompt,
        memberPrompt: networkMembers.prompt,
      })
      .from(networks)
      .innerJoin(networkMembers, eq(networks.id, networkMembers.networkId))
      .where(
        and(
          eq(networks.id, networkId),
          eq(networkMembers.userId, userId),
          isNull(networkMembers.deletedAt),
          isNull(networks.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async isIntentAssignedToIndex(intentId: string, networkId: string): Promise<boolean> {
    const rows = await db
      .select({ networkId: intentNetworks.networkId })
      .from(intentNetworks)
      .where(
        and(
          eq(intentNetworks.intentId, intentId),
          eq(intentNetworks.networkId, networkId)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async assignIntentToNetwork(
    intentId: string,
    networkId: string,
    relevancyScore?: number,
    assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
  ): Promise<void> {
    return upsertIntentNetworkAssignment(intentId, networkId, relevancyScore, assignmentMetadata);
  }

  async assignIntentToNetworkIfMember(
    userId: string,
    intentId: string,
    networkId: string,
    relevancyScore?: number,
    assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
  ): Promise<import('@indexnetwork/protocol').IntentNetworkFinalAssignmentResult> {
    return this.intentAdapter.assignIntentToNetworkIfMember(
      userId,
      intentId,
      networkId,
      relevancyScore,
      assignmentMetadata,
    );
  }

  async getIntentIndexScores(intentId: string): Promise<Array<{
    networkId: string;
    relevancyScore: number | null;
    assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata | null;
  }>> {
    const rows = await db
      .select({
        networkId: intentNetworks.networkId,
        relevancyScore: intentNetworks.relevancyScore,
        assignmentMetadata: intentNetworks.assignmentMetadata,
      })
      .from(intentNetworks)
      .where(eq(intentNetworks.intentId, intentId));
    return rows.map(r => ({
      networkId: r.networkId,
      relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
      assignmentMetadata: r.assignmentMetadata ?? null,
    }));
  }

  async unassignIntentFromIndex(intentId: string, networkId: string): Promise<void> {
    await db
      .delete(intentNetworks)
      .where(
        and(
          eq(intentNetworks.intentId, intentId),
          eq(intentNetworks.networkId, networkId)
        )
      );
  }

  async getNetworkIdsForIntent(intentId: string): Promise<string[]> {
    const rows = await db
      .select({ networkId: intentNetworks.networkId })
      .from(intentNetworks)
      .where(eq(intentNetworks.intentId, intentId));
    return rows.map((r) => r.networkId);
  }

  // HyDE document operations (delegate to HydeDatabaseAdapter)
  async getHydeDocument(
    sourceType: 'intent' | 'query',
    sourceId: string,
    strategy: string
  ): Promise<HydeDocumentRow | null> {
    return this.hydeAdapter.getHydeDocument(sourceType, sourceId, strategy);
  }

  async getHydeDocumentsForSource(
    sourceType: 'intent' | 'query',
    sourceId: string
  ): Promise<HydeDocumentRow[]> {
    return this.hydeAdapter.getHydeDocumentsForSource(sourceType, sourceId);
  }

  async saveHydeDocument(data: SaveHydeDocumentInput): Promise<HydeDocumentRow> {
    return this.hydeAdapter.saveHydeDocument(data);
  }

  async deleteHydeDocumentsForSource(
    sourceType: 'intent' | 'query',
    sourceId: string
  ): Promise<number> {
    return this.hydeAdapter.deleteHydeDocumentsForSource(sourceType, sourceId);
  }

  async deleteExpiredHydeDocuments(): Promise<number> {
    return this.hydeAdapter.deleteExpiredHydeDocuments();
  }

  async getStaleHydeDocuments(threshold: Date): Promise<HydeDocumentRow[]> {
    return this.hydeAdapter.getStaleHydeDocuments(threshold);
  }

  async getOwnedIndexes(userId: string) {
    const ownerRows = await db
      .select({
        networkId: networkMembers.networkId,
        title: networks.title,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        isPersonal: networks.isPersonal,
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
      })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(
        and(
          eq(networkMembers.userId, userId),
          sql`'owner' = ANY(${networkMembers.permissions})`,
          isNull(networks.deletedAt)
        )
      );

    const result = await Promise.all(
      ownerRows.map(async (row) => {
        const [memberCountResult, intentCountResult] = await Promise.all([
          db.select({ count: count() }).from(networkMembers).where(and(eq(networkMembers.networkId, row.networkId), isNull(networkMembers.deletedAt))),
          db.select({ count: count() }).from(intentNetworks).where(eq(intentNetworks.networkId, row.networkId)),
        ]);
        const perms = row.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean } | null;
        const memberCount = Number(memberCountResult[0]?.count ?? 0);
        return {
          id: row.networkId,
          title: row.title,
          prompt: row.prompt,
          imageUrl: row.imageUrl,
          permissions: {
            joinPolicy: (perms?.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
            allowGuestVibeCheck: perms?.allowGuestVibeCheck ?? false,
            invitationLink: perms?.invitationLink ?? null,
          },
          isPersonal: row.isPersonal,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          memberCount,
          intentCount: Number(intentCountResult[0]?.count ?? 0),
          user: { id: row.ownerId, name: row.userName, avatar: row.userAvatar },
          _count: { members: memberCount },
        };
      })
    );
    return result;
  }

  async getNetworkMembersForMember(networkId: string, requestingUserId: string) {
    const isMember = await this.isNetworkMember(networkId, requestingUserId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this network');
    }

    const members = await db
      .select({
        userId: networkMembers.userId,
        name: users.name,
        avatar: users.avatar,
        permissions: networkMembers.permissions,
        memberPrompt: networkMembers.prompt,
        autoAssign: networkMembers.autoAssign,
        joinedAt: networkMembers.createdAt,
      })
      .from(networkMembers)
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(and(eq(networkMembers.networkId, networkId), isNull(networkMembers.deletedAt), isNull(users.deletedAt)));

    const [requestingUserEmailRow] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, requestingUserId))
      .limit(1);

    const result = await Promise.all(
      members.map(async (m) => {
        const [intentCountRow] = await db
          .select({ count: count() })
          .from(intentNetworks)
          .innerJoin(intents, eq(intentNetworks.intentId, intents.id))
          .where(and(
            eq(intentNetworks.networkId, networkId),
            eq(intents.userId, m.userId),
            isNull(intents.archivedAt),
            activeIntentLifecycleWhere(),
          ));
        const email = m.userId === requestingUserId ? (requestingUserEmailRow?.email ?? undefined) : undefined;
        return {
          userId: m.userId,
          name: m.name,
          avatar: m.avatar,
          email,
          permissions: m.permissions ?? [],
          memberPrompt: m.memberPrompt,
          autoAssign: m.autoAssign,
          joinedAt: m.joinedAt,
          intentCount: Number(intentCountRow?.count ?? 0),
        };
      })
    );
    return result;
  }

  async isIndexOwner(networkId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ userId: networkMembers.userId })
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, networkId),
          eq(networkMembers.userId, userId),
          sql`'owner' = ANY(${networkMembers.permissions})`
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async getNetworkMembersForOwner(networkId: string, requestingUserId: string) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this network');
    }

    const members = await db
      .select({
        userId: networkMembers.userId,
        name: users.name,
        avatar: users.avatar,
        intro: users.intro,
        email: users.email,
        isGhost: users.isGhost,
        permissions: networkMembers.permissions,
        memberPrompt: networkMembers.prompt,
        autoAssign: networkMembers.autoAssign,
        joinedAt: networkMembers.createdAt,
      })
      .from(networkMembers)
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(and(eq(networkMembers.networkId, networkId), isNull(networkMembers.deletedAt), isNull(users.deletedAt)));

    const memberUserIds = members.map((m) => m.userId);
    const intentCountRows = memberUserIds.length > 0
      ? await db
          .select({ userId: intents.userId, count: count() })
          .from(intentNetworks)
          .innerJoin(intents, eq(intentNetworks.intentId, intents.id))
          .where(and(
            eq(intentNetworks.networkId, networkId),
            inArray(intents.userId, memberUserIds),
            isNull(intents.archivedAt),
            activeIntentLifecycleWhere(),
          ))
          .groupBy(intents.userId)
      : [];
    const intentCountMap = new Map(intentCountRows.map((r) => [r.userId, Number(r.count)]));

    return members.map((m) => ({
      userId: m.userId,
      name: m.name,
      avatar: m.avatar,
      intro: m.intro ?? null,
      email: m.email,
      isGhost: m.isGhost ?? false,
      permissions: m.permissions ?? [],
      memberPrompt: m.memberPrompt,
      autoAssign: m.autoAssign,
      joinedAt: m.joinedAt,
      intentCount: intentCountMap.get(m.userId) ?? 0,
    }));
  }

  async getMembersFromUserIndexes(userId: Id<'users'>): Promise<{ userId: Id<'users'>; name: string; avatar: string | null }[]> {
    // Indexes the user is a member of (non-deleted)
    const myIndexRows = await db
      .select({ networkId: networkMembers.networkId })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(
        and(eq(networkMembers.userId, userId), isNull(networks.deletedAt))
      );
    const myIndexIds = myIndexRows.map((r) => r.networkId);
    if (myIndexIds.length === 0) return [];

    // All members from those indexes, joined with users; dedupe by userId
    const rows = await db
      .select({
        userId: networkMembers.userId,
        name: users.name,
        avatar: users.avatar,
      })
      .from(networkMembers)
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(
        and(
          inArray(networkMembers.networkId, myIndexIds),
          isNull(networks.deletedAt),
          isNull(users.deletedAt),
          isNull(networkMembers.deletedAt),
        )
      );

    const byId = new Map<Id<'users'>, { userId: Id<'users'>; name: string; avatar: string | null }>();
    for (const r of rows) {
      if (!byId.has(r.userId)) byId.set(r.userId, { userId: r.userId, name: r.name, avatar: r.avatar });
    }
    return Array.from(byId.values());
  }

  async getNetworkIntentsForOwner(
    networkId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this network');
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        userId: intents.userId,
        userName: users.name,
        createdAt: intents.createdAt,
      })
      .from(intentNetworks)
      .innerJoin(intents, eq(intentNetworks.intentId, intents.id))
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(
        eq(intentNetworks.networkId, networkId),
        isNull(intents.archivedAt),
        activeIntentLifecycleWhere(),
      ))
      .orderBy(desc(intents.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => ({
      id: r.id,
      payload: r.payload,
      summary: r.summary,
      userId: r.userId,
      userName: r.userName,
      createdAt: r.createdAt,
    }));
  }

  async isNetworkMember(networkId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ userId: networkMembers.userId })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(
        and(
          eq(networkMembers.networkId, networkId),
          eq(networkMembers.userId, userId),
          isNull(networkMembers.deletedAt),
          isNull(networks.deletedAt),
          sql`${networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async getMemberSettings(networkId: string, userId: string): Promise<{ permissions: string[]; isOwner: boolean } | null> {
    const rows = await db
      .select({ permissions: networkMembers.permissions })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(
        and(
          eq(networkMembers.networkId, networkId),
          eq(networkMembers.userId, userId),
          isNull(networkMembers.deletedAt),
          isNull(networks.deletedAt),
          sql`${networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`
        )
      )
      .limit(1);

    if (rows.length === 0) return null;

    const permissions = rows[0]?.permissions || [];
    const isOwner = permissions.includes('owner');

    return { permissions, isOwner };
  }

  async getNetworkIntentsForMember(
    networkId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const isMember = await this.isNetworkMember(networkId, requestingUserId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this network');
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        userId: intents.userId,
        userName: users.name,
        createdAt: intents.createdAt,
      })
      .from(intentNetworks)
      .innerJoin(intents, eq(intentNetworks.intentId, intents.id))
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(
        eq(intentNetworks.networkId, networkId),
        isNull(intents.archivedAt),
        activeIntentLifecycleWhere(),
      ))
      .orderBy(desc(intents.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => ({
      id: r.id,
      payload: r.payload,
      summary: r.summary,
      userId: r.userId,
      userName: r.userName,
      createdAt: r.createdAt,
    }));
  }

  /**
   * List the current member's ACTIVE premises assigned to a network, for the
   * /networks overview tab. Unlike getPremisesForUserInNetworks (tuned for
   * similarity search — embedding-gated, capped at 40), this is an honest
   * list+count: no embedding gate, no limit. Soft-deleted premises excluded.
   * Current-user scoped. See EDG-53.
   */
  async getNetworkPremisesForMember(networkId: string, userId: string): Promise<Array<{
    id: string;
    text: string;
    summary: string | null;
    createdAt: Date;
  }>> {
    const rows = await db
      .select({
        id: schema.premises.id,
        assertion: schema.premises.assertion,
        createdAt: schema.premises.createdAt,
      })
      .from(schema.premiseNetworks)
      .innerJoin(schema.premises, eq(schema.premiseNetworks.premiseId, schema.premises.id))
      .where(and(
        eq(schema.premiseNetworks.networkId, networkId),
        eq(schema.premises.userId, userId),
        eq(schema.premises.status, 'ACTIVE'),
        isNull(schema.premises.deletedAt),
      ))
      .orderBy(desc(schema.premises.createdAt));

    return rows.map((r) => {
      const assertion = r.assertion as { text?: string; summary?: string } | null;
      return {
        id: r.id,
        text: assertion?.text ?? '',
        summary: assertion?.summary ?? null,
        createdAt: r.createdAt,
      };
    });
  }

  /**
   * List the current member's ACTIVE (non-archived) intents assigned to a
   * network, for the /networks overview tab. Unlike getNetworkIntentsForMember
   * (network-wide, capped at 50, then filtered by the caller in JS, so a member
   * in a busy network can lose their own intents past the cap), this is an
   * honest user-scoped list+count: scoped to the caller in SQL via the canonical
   * {@link activeOwnIntentsWhere} predicate, no limit. Does not assert
   * membership; callers gate access. See EDG-53.
   */
  async getNetworkIntentsForMemberOwn(networkId: string, userId: string): Promise<Array<{
    id: string;
    payload: string;
    summary: string | null;
    userId: string;
    userName: string | null;
    createdAt: Date;
  }>> {
    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        userId: intents.userId,
        userName: users.name,
        createdAt: intents.createdAt,
      })
      .from(intentNetworks)
      .innerJoin(intents, eq(intentNetworks.intentId, intents.id))
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(
        eq(intentNetworks.networkId, networkId),
        activeOwnIntentsWhere(userId),
      ))
      .orderBy(desc(intents.createdAt));

    return rows.map((r) => ({
      id: r.id,
      payload: r.payload,
      summary: r.summary,
      userId: r.userId,
      userName: r.userName,
      createdAt: r.createdAt,
    }));
  }

  async getActiveIntentsAcrossIndexes(userId: string, indexIds: string[]) {
    try {
      if (indexIds.length === 0) return [];

      const rows = await db
        .selectDistinctOn([intents.id], {
          id: intents.id,
          payload: intents.payload,
          summary: intents.summary,
          createdAt: intents.createdAt,
        })
        .from(intents)
        .innerJoin(intentNetworks, eq(intentNetworks.intentId, intents.id))
        .where(
          and(
            activeOwnIntentsWhere(userId),
            inArray(intentNetworks.networkId, indexIds),
          ),
        )
        .orderBy(intents.id, desc(intents.createdAt));

      return rows;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getActiveIntentsAcrossIndexes error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async updateIndexSettings(
    networkId: string,
    requestingUserId: string,
    data: { title?: string; prompt?: string | null; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean; profileEnrichment?: schema.ProfileEnrichmentPolicy; type?: 'community' | 'event'; metadata?: Record<string, unknown>; contextInjection?: { discovery: boolean } }
  ) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this network');
    }

    const [existing] = await db.select().from(networks).where(eq(networks.id, networkId)).limit(1);
    if (!existing) {
      throw new Error('Index not found');
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) updateData.title = data.title;
    if (data.prompt !== undefined) updateData.prompt = data.prompt;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.joinPolicy !== undefined || data.allowGuestVibeCheck !== undefined) {
      const currentPerms = (existing.permissions as schema.NetworkPermissionsState | null) ?? {
        joinPolicy: 'invite_only',
        invitationLink: null,
        allowGuestVibeCheck: false,
      };
      updateData.permissions = {
        ...currentPerms,
        joinPolicy: data.joinPolicy ?? currentPerms.joinPolicy ?? 'invite_only',
        invitationLink: currentPerms.invitationLink ?? { code: crypto.randomUUID() },
        allowGuestVibeCheck: data.allowGuestVibeCheck ?? currentPerms.allowGuestVibeCheck ?? false,
      };
    }
    if (data.type !== undefined) updateData.type = data.type;
    if (data.metadata !== undefined) updateData.metadata = data.metadata;
    if (data.contextInjection !== undefined || data.profileEnrichment !== undefined) {
      const currentPerms = (existing.permissions as unknown as Record<string, unknown> | null) ?? {};
      updateData.permissions = {
        ...currentPerms,
        ...((updateData.permissions as Record<string, unknown>) ?? {}),
        ...(data.contextInjection !== undefined && { contextInjection: data.contextInjection }),
        ...(data.profileEnrichment !== undefined && { profileEnrichment: data.profileEnrichment }),
      };
    }

    await db.update(networks).set(updateData).where(eq(networks.id, networkId));

    return this.loadNetworkSettingsDTO(networkId);
  }

  /**
   * Re-select a network after a settings/permissions mutation and map it to the
   * canonical settings DTO (owner info, permissions, member/intent counts).
   * Shared by {@link updateIndexSettings} and {@link regenerateInvitationLink}.
   * @param networkId - The network to load
   * @returns The canonical network settings DTO
   * @throws Error if the network cannot be found after the update
   */
  private async loadNetworkSettingsDTO(networkId: string) {
    const [updatedRow] = await db
      .select({
        id: networks.id,
        title: networks.title,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        isPersonal: networks.isPersonal,
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
        type: networks.type,
        metadata: networks.metadata,
      })
      .from(networks)
      .innerJoin(
        networkMembers,
        and(
          eq(networks.id, networkMembers.networkId),
          sql`'owner' = ANY(${networkMembers.permissions})`
        )
      )
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(eq(networks.id, networkId))
      .limit(1);

    if (!updatedRow) {
      throw new Error('Index not found after update');
    }
    const [memberCountResult, intentCountResult] = await Promise.all([
      db.select({ count: count() }).from(networkMembers).where(and(eq(networkMembers.networkId, networkId), isNull(networkMembers.deletedAt))),
      db.select({ count: count() }).from(intentNetworks).where(eq(intentNetworks.networkId, networkId)),
    ]);
    const perms = (updatedRow.permissions as schema.NetworkPermissionsState | null) ?? {
      joinPolicy: 'invite_only',
      invitationLink: null,
      allowGuestVibeCheck: false,
    };
    const memberCount = Number(memberCountResult[0]?.count ?? 0);
    return {
      id: updatedRow.id,
      title: updatedRow.title,
      prompt: updatedRow.prompt,
      imageUrl: updatedRow.imageUrl,
      type: updatedRow.type ?? 'community',
      metadata: (updatedRow.metadata ?? {}) as Record<string, unknown>,
      permissions: {
        joinPolicy: (perms.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
        allowGuestVibeCheck: perms.allowGuestVibeCheck ?? false,
        invitationLink: perms.invitationLink ?? null,
        ...(perms.contextInjection !== undefined && { contextInjection: perms.contextInjection }),
        ...(perms.profileEnrichment !== undefined && { profileEnrichment: perms.profileEnrichment }),
      },
      isPersonal: updatedRow.isPersonal,
      createdAt: updatedRow.createdAt,
      updatedAt: updatedRow.updatedAt,
      memberCount,
      intentCount: Number(intentCountResult[0]?.count ?? 0),
      user: { id: updatedRow.ownerId, name: updatedRow.userName, avatar: updatedRow.userAvatar },
      _count: { members: memberCount },
    };
  }

  /**
   * Rotate a network's invitation link, issuing a fresh UUID code. Owner-only.
   * Works regardless of join policy and preserves all other permission fields.
   * Once rotated, any previously shared link stops resolving.
   * @param networkId - The network whose invitation code should be rotated
   * @param requestingUserId - The caller; must be an owner of the network
   * @returns The updated network settings DTO carrying the new invitation code
   * @throws Error if the caller is not an owner or the network does not exist
   */
  async regenerateInvitationLink(networkId: string, requestingUserId: string) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this network');
    }

    const [existing] = await db.select().from(networks).where(eq(networks.id, networkId)).limit(1);
    if (!existing) {
      throw new Error('Index not found');
    }

    const currentPerms = (existing.permissions as schema.NetworkPermissionsState | null) ?? {
      joinPolicy: 'invite_only',
      invitationLink: null,
      allowGuestVibeCheck: false,
    };
    const updatedPermissions: schema.NetworkPermissionsState = {
      ...currentPerms,
      invitationLink: { code: crypto.randomUUID() },
    };

    await db
      .update(networks)
      .set({ permissions: updatedPermissions, updatedAt: new Date() })
      .where(eq(networks.id, networkId));

    return this.loadNetworkSettingsDTO(networkId);
  }

  async softDeleteNetwork(networkId: string): Promise<void> {
    await db.delete(intentNetworks).where(eq(intentNetworks.networkId, networkId));
    await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
    await db.update(networks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(networks.id, networkId));
  }

  /**
   * Cascading soft delete for an experiment network.
   *
   * Soft-deletes users who were *invited into* this experiment (i.e. have a
   * network-scoped personal agent permissioned on this network) along with
   * their data (intents, agents, API keys, personal networks, network
   * memberships). Organic users who happen to be members but were not
   * provisioned through the invitation flow are NOT cascaded — they keep their
   * accounts.
   *
   * @param networkId - The experiment network to delete
   */
  async softDeleteExperimentNetwork(networkId: string): Promise<void> {
    const now = new Date();

    // Identify experimentally-onboarded users: those who own at least one
    // agent with a network-scoped permission on this network. These are the
    // users provisioned by networkInvitationService.invite() (headless/CSV).
    const experimentUsers = await db
      .selectDistinct({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.agents, eq(schema.agents.ownerId, schema.users.id))
      .innerJoin(
        schema.agentPermissions,
        eq(schema.agentPermissions.agentId, schema.agents.id),
      )
      .where(and(
        eq(schema.agentPermissions.scope, 'network'),
        eq(schema.agentPermissions.scopeId, networkId),
        isNull(schema.users.deletedAt),
        isNull(schema.agents.deletedAt),
      ));

    const userIds = experimentUsers.map(u => u.id);

    if (userIds.length > 0) {
      // Soft-delete users
      await db
        .update(schema.users)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(schema.users.id, userIds));

      // Archive their intents (intents use archivedAt, not deletedAt)
      await db
        .update(schema.intents)
        .set({ archivedAt: now, updatedAt: now })
        .where(inArray(schema.intents.userId, userIds));

      // Delete their intent_networks (hard delete, same as existing softDeleteNetwork)
      await db
        .delete(schema.intentNetworks)
        .where(inArray(schema.intentNetworks.intentId,
          db.select({ id: schema.intents.id }).from(schema.intents).where(inArray(schema.intents.userId, userIds))
        ));

      // Soft-delete their network memberships
      await db
        .update(schema.networkMembers)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(schema.networkMembers.userId, userIds));

      // Soft-delete their personal networks
      const personalNetworkIds = await db
        .select({ networkId: schema.personalNetworks.networkId })
        .from(schema.personalNetworks)
        .where(inArray(schema.personalNetworks.userId, userIds));

      if (personalNetworkIds.length > 0) {
        await db
          .update(schema.networks)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(schema.networks.id, personalNetworkIds.map(p => p.networkId)));
      }

      // Soft-delete their agents
      await db
        .update(schema.agents)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(schema.agents.ownerId, userIds));

      // Disable their API keys
      await db
        .update(schema.apikeys)
        .set({ enabled: false, updatedAt: now })
        .where(inArray(schema.apikeys.userId, userIds));
    }

    // Delete experiment network memberships (hard delete, same pattern as existing)
    await db.delete(schema.networkMembers).where(eq(schema.networkMembers.networkId, networkId));

    // Delete intent_networks for the experiment network
    await db.delete(schema.intentNetworks).where(eq(schema.intentNetworks.networkId, networkId));

    // Soft-delete the experiment network itself
    await db
      .update(schema.networks)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(schema.networks.id, networkId));
  }

  async getProfileByUserId(userId: string): Promise<(UserIdentity & { id: string }) | null> {
    return buildProfileWithIdFromUser(userId);
  }

  /**
   * Find an index by its key (human-readable identifier).
   * @param key - The index's key
   * @returns Index record or null
   */
  async getNetworkByKey(key: string) {
    const rows = await db.select()
      .from(networks)
      .where(and(eq(networks.key, key), isNull(networks.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Check if a network key already exists.
   * @param key - The key to check
   * @returns True if the key is taken
   */
  async networkKeyExists(key: string): Promise<boolean> {
    const result = await db.select({ id: networks.id })
      .from(networks)
      .where(eq(networks.key, key))
      .limit(1);
    return result.length > 0;
  }

  /**
   * Update a network's key. Owner-only check should be done at the service level.
   * @param indexId - The network ID
   * @param key - The new key value
   * @returns Updated network or null
   */
  async updateIndexKey(indexId: string, key: string) {
    const result = await db.update(networks)
      .set({ key, updatedAt: new Date() })
      .where(and(eq(networks.id, indexId), isNull(networks.deletedAt)))
      .returning();
    return result[0] ?? null;
  }

  async createNetwork(data: {
    title: string;
    prompt?: string | null;
    imageUrl?: string | null;
    joinPolicy?: 'anyone' | 'invite_only';
    allowGuestVibeCheck?: boolean;
    profileEnrichment?: schema.ProfileEnrichmentPolicy;
    type?: 'community' | 'event';
    metadata?: Record<string, unknown>;
  }): Promise<{
    id: string;
    title: string;
    prompt: string | null;
    imageUrl: string | null;
    permissions: schema.NetworkPermissionsState;
    type: 'community' | 'event';
    metadata: Record<string, unknown>;
  }> {
    const finalJoinPolicy = data.joinPolicy ?? 'invite_only';
    const permissions: schema.NetworkPermissionsState = {
      joinPolicy: finalJoinPolicy,
      invitationLink: { code: crypto.randomUUID() },
      allowGuestVibeCheck: data.allowGuestVibeCheck ?? false,
      ...(data.profileEnrichment !== undefined && { profileEnrichment: data.profileEnrichment }),
    };
    const [row] = await db
      .insert(networks)
      .values({
        title: data.title,
        prompt: data.prompt ?? null,
        imageUrl: data.imageUrl ?? null,
        permissions,
        type: data.type ?? 'community',
        metadata: data.metadata ?? {},
      })
      .returning({
        id: networks.id,
        title: networks.title,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        type: networks.type,
        metadata: networks.metadata,
      });
    if (!row) throw new Error('Failed to create network');
    const perms = (row.permissions as schema.NetworkPermissionsState | null) ?? {
      joinPolicy: 'invite_only',
      invitationLink: null,
      allowGuestVibeCheck: false,
    };
    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      imageUrl: row.imageUrl,
      permissions: {
        joinPolicy: (perms.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
        invitationLink: perms.invitationLink ?? null,
        allowGuestVibeCheck: perms.allowGuestVibeCheck ?? false,
        ...(perms.profileEnrichment !== undefined && { profileEnrichment: perms.profileEnrichment }),
      },
      type: row.type ?? 'community',
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    };
  }

  async getNetworkMemberCount(networkId: string): Promise<number> {
    const [r] = await db.select({ count: count() }).from(networkMembers).where(and(eq(networkMembers.networkId, networkId), isNull(networkMembers.deletedAt)));
    return Number(r?.count ?? 0);
  }

  async addMemberToNetwork(
    networkId: string,
    userId: string,
    role: 'owner' | 'member'
  ): Promise<{ success: boolean; alreadyMember?: boolean }> {
    let memberPrompt: string | null = null;
    const [indexRow] = await db.select({ prompt: networks.prompt }).from(networks).where(eq(networks.id, networkId)).limit(1);
    if (indexRow) memberPrompt = indexRow.prompt;

    const finalPermissions = role === 'owner' ? ['owner'] : ['member'];
    const result = await db.insert(networkMembers).values({
      networkId,
      userId,
      permissions: finalPermissions,
      prompt: memberPrompt,
      autoAssign: true,
    }).onConflictDoNothing({ target: [networkMembers.networkId, networkMembers.userId] }).returning();

    if (result.length > 0) {
      try {
        NetworkMembershipEvents.onMemberAdded(userId, networkId);
      } catch (err) {
        logger.warn('addMemberToNetwork event hook failed (non-fatal)', { networkId, userId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { success: true, alreadyMember: result.length === 0 };
  }

  async removeMemberFromIndex(
    networkId: string,
    userId: string
  ): Promise<{ success: boolean; wasOwner?: boolean; notMember?: boolean }> {
    // Check if user is the owner - owners cannot be removed
    const isOwner = await this.isIndexOwner(networkId, userId);
    if (isOwner) {
      return { success: false, wasOwner: true };
    }

    // Check if user is actually a member
    const existing = await db
      .select()
      .from(networkMembers)
      .where(and(eq(networkMembers.networkId, networkId), eq(networkMembers.userId, userId)))
      .limit(1);

    if (existing.length === 0) {
      return { success: false, notMember: true };
    }

    // Delete the membership
    await db
      .delete(networkMembers)
      .where(and(eq(networkMembers.networkId, networkId), eq(networkMembers.userId, userId)));

    return { success: true };
  }

  // user_profiles was dropped in WS8 (IND-365); there is no separate profile row to
  // delete. Identity lives on `users` and is removed via user soft-delete, not here.
  // Retained as a no-op so existing callers/interface stay stable.
  async deleteProfile(_userId: string): Promise<void> {
    return;
  }

  /**
   * Resolve an network identifier (UUID or key) to a UUID.
   * @param idOrKey - UUID or human-readable key
   * @returns The network UUID, or null if not found
   */
  async resolveIndexId(idOrKey: string): Promise<string | null> {
    const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey);
    if (isFullUuid) {
      return idOrKey;
    }
    // Try key lookup first
    const row = await this.getNetworkByKey(idOrKey);
    if (row) return row.id;
    // Fall back to hex prefix matching
    const isHexPrefix = /^[0-9a-f]+$/i.test(idOrKey);
    if (isHexPrefix) {
      const rows = await db.select({ id: networks.id })
        .from(networks)
        .where(and(sql`${networks.id} LIKE ${idOrKey + '%'}`, isNull(networks.deletedAt)))
        .limit(2);
      if (rows.length === 1) return rows[0].id;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Detail & Member Management (with access control)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a single network with owner info and member count.
   * Checks that the requesting user is a member; throws "Access denied" if not.
   */
  async getPublicIndexDetail(networkId: string) {
    const rows = await db
      .select({
        id: networks.id,
        title: networks.title,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
      })
      .from(networks)
      .innerJoin(
        networkMembers,
        and(
          eq(networks.id, networkMembers.networkId),
          sql`'owner' = ANY(${networkMembers.permissions})`
        )
      )
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(and(eq(networks.id, networkId), isNull(networks.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const perms = row.permissions as { joinPolicy?: string } | null;
    if (perms?.joinPolicy !== 'anyone') return null;

    const memberCount = await this.getNetworkMemberCount(networkId);

    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      imageUrl: row.imageUrl,
      permissions: row.permissions,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: { id: row.ownerId, name: row.userName, avatar: row.userAvatar },
      _count: { members: memberCount },
    };
  }

  /**
   * Get an index by its invitation link code (public access, no auth required).
   * @param code - The invitation link code from the URL
   * @returns The index with owner info, member count, and joinPolicy, or null if not found
   */
  async getNetworkByShareCode(code: string) {
    const rows = await db
      .select({
        id: networks.id,
        title: networks.title,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
      })
      .from(networks)
      .innerJoin(
        networkMembers,
        and(
          eq(networks.id, networkMembers.networkId),
          sql`'owner' = ANY(${networkMembers.permissions})`
        )
      )
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(
        and(
          sql`${networks.permissions}->'invitationLink'->>'code' = ${code}`,
          isNull(networks.deletedAt),
          eq(networks.isPersonal, false)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const memberCount = await this.getNetworkMemberCount(row.id);

    const perms = row.permissions as { joinPolicy?: string } | null;

    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      imageUrl: row.imageUrl,
      joinPolicy: (perms?.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: { id: row.ownerId, name: row.userName, avatar: row.userAvatar },
      _count: { members: memberCount },
    };
  }

  /**
   * Accept an invitation to join an index using the invitation code.
   * @param code - The invitation link code
   * @param userId - The authenticated user accepting the invitation
   * @returns The index, membership details, and alreadyMember flag
   * @throws Error if the code is invalid or the index is not found
   */
  async acceptIndexInvitation(code: string, userId: string) {
    const index = await this.getNetworkByShareCode(code);
    if (!index) {
      throw new Error('Invalid or expired invitation link');
    }

    const result = await this.addMemberToNetwork(index.id, userId, 'member');

    const [memberRow] = await db
      .select({
        userId: networkMembers.userId,
        name: users.name,
        email: users.email,
        avatar: users.avatar,
        permissions: networkMembers.permissions,
        createdAt: networkMembers.createdAt,
      })
      .from(networkMembers)
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(and(eq(networkMembers.networkId, index.id), eq(networkMembers.userId, userId)))
      .limit(1);

    return {
      index,
      membership: memberRow
        ? {
            id: memberRow.userId,
            name: memberRow.name,
            email: memberRow.email,
            avatar: memberRow.avatar,
            permissions: memberRow.permissions,
            createdAt: memberRow.createdAt,
          }
        : null,
      alreadyMember: result.alreadyMember,
    };
  }

  async getNetworkDetail(networkId: string, requestingUserId: string) {
    const rows = await db
      .select({
        id: networks.id,
        title: networks.title,
        key: networks.key,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        isPersonal: networks.isPersonal,
        isExperiment: networks.isExperiment,
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
        type: networks.type,
        metadata: networks.metadata,
      })
      .from(networks)
      .innerJoin(
        networkMembers,
        and(
          eq(networks.id, networkMembers.networkId),
          sql`'owner' = ANY(${networkMembers.permissions})`
        )
      )
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(and(eq(networks.id, networkId), isNull(networks.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const isMember = await this.isNetworkMember(networkId, requestingUserId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this network');
    }

    const memberCount = await this.getNetworkMemberCount(networkId);

    return {
      id: row.id,
      title: row.title,
      key: row.key,
      prompt: row.prompt,
      imageUrl: row.imageUrl,
      type: row.type ?? 'community',
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      permissions: row.permissions,
      isPersonal: row.isPersonal,
      isExperiment: row.isExperiment,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: { id: row.ownerId, name: row.userName, avatar: row.userAvatar },
      _count: { members: memberCount },
    };
  }

  /**
   * Search users within the caller's personal network members by name or email,
   * optionally excluding existing members of a target index.
   */
  async searchPersonalNetworkMembers(userId: string, query: string, excludeIndexId?: string) {
    if (!query || query.trim().length === 0) return [];

    // Find user's contacts from personal network (index_members with permissions=['contact'])
    const personalIndexId = await getPersonalIndexId(userId);
    if (!personalIndexId) return [];

    const contactUserIds = db
      .select({ userId: schema.networkMembers.userId })
      .from(schema.networkMembers)
      .where(
        and(
          eq(schema.networkMembers.networkId, personalIndexId),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
          isNull(schema.networkMembers.deletedAt)
        )
      );

    const pattern = `%${query.trim()}%`;
    const conditions = [
      isNull(users.deletedAt),
      inArray(users.id, contactUserIds),
      or(ilike(users.name, pattern), ilike(users.email, pattern)),
    ];

    if (excludeIndexId) {
      const existingMembers = db
        .select({ userId: networkMembers.userId })
        .from(networkMembers)
        .where(eq(networkMembers.networkId, excludeIndexId));
      conditions.push(notInArray(users.id, existingMembers));
    }

    return db
      .select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar })
      .from(users)
      .where(and(...conditions))
      .limit(20);
  }

  /**
   * Add a member to an index. Owner-only.
   * Throws "Access denied" if the requesting user is not an owner.
   */
  async addMemberForOwner(
    networkId: string,
    userId: string,
    requestingUserId: string,
    role: 'owner' | 'member' = 'member'
  ) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Only owners can add members');
    }

    const result = await this.addMemberToNetwork(networkId, userId, role);
    const user = await this.getUser(userId);

    return {
      member: user
        ? { id: user.id, name: user.name, email: user.email, avatar: user.avatar, permissions: role === 'owner' ? ['owner'] : ['member'] }
        : null,
      alreadyMember: result.alreadyMember,
    };
  }

  /**
   * Update an existing member's role. Owner-only.
   * Cannot demote the last owner. Cannot change contacts.
   * @param networkId - The network ID
   * @param targetUserId - The member whose role is being changed
   * @param requestingUserId - The user making the change (must be owner)
   * @param role - The new role ('owner' | 'member')
   * @returns The updated member with new permissions
   * @throws Error if not authorized, last owner, or member not found
   */
  async updateMemberRole(
    networkId: string,
    targetUserId: string,
    requestingUserId: string,
    role: 'owner' | 'member'
  ) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Only owners can change member roles');
    }

    // Cannot change your own role
    if (targetUserId === requestingUserId) {
      throw new Error('Cannot change your own role');
    }

    // Get existing membership (exclude soft-deleted)
    const [existing] = await db
      .select({ permissions: networkMembers.permissions })
      .from(networkMembers)
      .where(and(
        eq(networkMembers.networkId, networkId),
        eq(networkMembers.userId, targetUserId),
        isNull(networkMembers.deletedAt)
      ))
      .limit(1);

    if (!existing) {
      throw new Error('Member not found');
    }

    // Don't allow changing contacts
    if (existing.permissions?.includes('contact')) {
      throw new Error('Cannot change role of a contact');
    }

    const newPermissions = role === 'owner' ? ['owner'] : ['member'];

    // Demotion guard: prevent demoting the last owner.
    // Uses a transaction with SELECT ... FOR UPDATE to lock all owner rows,
    // preventing concurrent write-skew under READ COMMITTED.
    if (role === 'member' && existing.permissions?.includes('owner')) {
      await db.transaction(async (tx) => {
        const owners = await tx
          .select({ userId: networkMembers.userId })
          .from(networkMembers)
          .where(and(
            eq(networkMembers.networkId, networkId),
            sql`'owner' = ANY(${networkMembers.permissions})`,
            isNull(networkMembers.deletedAt)
          ))
          .for('update');

        if (owners.length <= 1) {
          throw new Error('Cannot demote the last owner');
        }

        await tx
          .update(networkMembers)
          .set({ permissions: newPermissions, updatedAt: new Date() })
          .where(and(
            eq(networkMembers.networkId, networkId),
            eq(networkMembers.userId, targetUserId),
            isNull(networkMembers.deletedAt)
          ));
      });
    } else {
      await db
        .update(networkMembers)
        .set({ permissions: newPermissions, updatedAt: new Date() })
        .where(and(
          eq(networkMembers.networkId, networkId),
          eq(networkMembers.userId, targetUserId),
          isNull(networkMembers.deletedAt)
        ));
    }

    const user = await this.getUser(targetUserId);
    return {
      member: user
        ? { id: user.id, name: user.name, email: user.email, avatar: user.avatar, permissions: newPermissions }
        : null,
    };
  }

  /**
   * Remove a member from an index. Owner-only.
   * Checks isIndexOwner internally; throws "Access denied" if not owner.
   * Prevents self-removal. Throws "Member not found" if member doesn't exist.
   */
  async removeMemberForOwner(networkId: string, memberUserId: string, requestingUserId: string) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this network');
    }

    if (memberUserId === requestingUserId) {
      throw new Error('Cannot remove yourself from the index');
    }

    const deleted = await db
      .delete(networkMembers)
      .where(and(eq(networkMembers.networkId, networkId), eq(networkMembers.userId, memberUserId)))
      .returning({ userId: networkMembers.userId });

    if (deleted.length === 0) {
      throw new Error('Member not found');
    }
  }

  /**
   * Join a public network (anyone can join if joinPolicy is 'anyone').
   */
  async joinPublicNetwork(networkId: string, userId: string) {
    const [index] = await db
      .select({ permissions: networks.permissions, deletedAt: networks.deletedAt })
      .from(networks)
      .where(eq(networks.id, networkId))
      .limit(1);

    if (!index || index.deletedAt) {
      throw new Error('Index not found');
    }

    const perms = (index.permissions as { joinPolicy?: string } | null);
    if (perms?.joinPolicy !== 'anyone') {
      throw new Error('This network is not public');
    }

    return await this.addMemberToNetwork(networkId, userId, 'member');
  }

  /**
   * Leave an index. Members (non-owners) can leave an index.
   * Owners cannot leave their own index.
   */
  async leaveNetwork(networkId: string, userId: string) {
    const isOwner = await this.isIndexOwner(networkId, userId);
    if (isOwner) {
      throw new Error('Cannot leave a network you own. Delete the network instead.');
    }

    const deleted = await db
      .delete(networkMembers)
      .where(and(eq(networkMembers.networkId, networkId), eq(networkMembers.userId, userId)))
      .returning({ userId: networkMembers.userId });

    if (deleted.length === 0) {
      throw new Error('You are not a member of this network');
    }
  }

  /**
   * Soft-delete a network. Owner-only.
   * Checks isIndexOwner internally; throws "Access denied" if not owner.
   */
  async deleteIndexForOwner(networkId: string, requestingUserId: string) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this network');
    }

    await this.softDeleteNetwork(networkId);
  }

  // Opportunity operations (delegate to OpportunityDatabaseAdapter)
  async createOpportunity(data: CreateOpportunityInput): Promise<OpportunityRow> {
    return this.opportunityAdapter.createOpportunity(data);
  }
  async createOpportunityIfNetworkEligible(
    data: CreateOpportunityInput,
    eligibility: Parameters<OpportunityDatabaseAdapter['createOpportunityIfNetworkEligible']>[1],
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.createOpportunityIfNetworkEligible(data, eligibility);
  }
  async persistIntentScopedOpportunityIfNetworkEligible(
    data: CreateOpportunityInput,
    expireIds: string[],
    eligibility: Parameters<OpportunityDatabaseAdapter['persistIntentScopedOpportunityIfNetworkEligible']>[2],
    dedupWindowMs: number,
  ): ReturnType<OpportunityDatabaseAdapter['persistIntentScopedOpportunityIfNetworkEligible']> {
    return this.opportunityAdapter.persistIntentScopedOpportunityIfNetworkEligible(
      data,
      expireIds,
      eligibility,
      dedupWindowMs,
    );
  }
  async createOpportunityAndExpireIds(
    data: CreateOpportunityInput,
    expireIds: string[]
  ): Promise<{ created: OpportunityRow; expired: OpportunityRow[] }> {
    return this.opportunityAdapter.createOpportunityAndExpireIds(data, expireIds);
  }
  async createOpportunityAndExpireIdsIfNetworkEligible(
    data: CreateOpportunityInput,
    expireIds: string[],
    eligibility: Parameters<OpportunityDatabaseAdapter['createOpportunityAndExpireIdsIfNetworkEligible']>[2],
  ): Promise<{ created: OpportunityRow; expired: OpportunityRow[] } | null> {
    return this.opportunityAdapter.createOpportunityAndExpireIdsIfNetworkEligible(data, expireIds, eligibility);
  }
  async getOpportunity(id: string): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.getOpportunity(id);
  }
  async findEnrichedReplacementOpportunities(opportunityId: string): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.findEnrichedReplacementOpportunities(opportunityId);
  }
  async getOpportunitiesByIds(ids: string[]): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getOpportunitiesByIds(ids);
  }
  /**
   * Resolve an opportunity ID from a full UUID or short prefix.
   * Delegates to OpportunityDatabaseAdapter.
   * @param idOrPrefix - Full UUID or prefix (e.g. first 8 chars)
   * @param userId - The user ID (for visibility scoping)
   * @returns Object with resolved id, or null/ambiguous status
   */
  async resolveOpportunityId(idOrPrefix: string, userId: string): Promise<{ id: string } | { ambiguous: true } | null> {
    return this.opportunityAdapter.resolveOpportunityId(idOrPrefix, userId);
  }
  async getOpportunitiesForUser(
    userId: string,
    options?: { status?: string; statuses?: string[]; networkId?: string; role?: string; limit?: number; offset?: number; conversationId?: string; scopeType?: 'intent'; scopeId?: string }
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getOpportunitiesForUser(userId, options);
  }
  async getLivePoolOpportunitiesForIntent(
    recipientUserId: string,
    intentId: string,
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getLivePoolOpportunitiesForIntent(recipientUserId, intentId);
  }
  /** Lens-C-only (IND-465): exact intent pool including terminal statuses. */
  async getEvidencePoolOpportunitiesForIntent(
    recipientUserId: string,
    intentId: string,
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getEvidencePoolOpportunitiesForIntent(recipientUserId, intentId);
  }
  /** Lens-C-only (IND-465 slice 2): answeredBy-verified owner answers for one opportunity. */
  async getAnsweredNegotiationQuestionsForOpportunity(
    recipientUserId: string,
    opportunityId: string,
    currentIntentFingerprint: string,
  ): Promise<AnsweredNegotiationOwnerAnswer[]> {
    return this.questionerAdapter.getAnsweredNegotiationQuestionsForOpportunity(recipientUserId, opportunityId, currentIntentFingerprint);
  }
  async getOpportunitiesForNetwork(
    networkId: string,
    options?: { status?: string; statuses?: string[]; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getOpportunitiesForNetwork(networkId, options);
  }
  async updateOpportunityStatus(
    id: string,
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
    outbox?: Parameters<OpportunityDatabaseAdapter['updateOpportunityStatus']>[3],
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.updateOpportunityStatus(id, status, acceptedBy, outbox);
  }

  /**
   * Delegates exact-version, active-task-aware compensation for a taskless
   * `negotiating` opportunity to OpportunityDatabaseAdapter.
   *
   * @param id - Opportunity ID
   * @param expectedUpdatedAt - Persistence boundary for the negotiation attempt
   * @param fallbackStatus - Status restored when the guarded update succeeds
   * @returns The compensated opportunity, or null on a status, version, or task race
   */
  async compensateTasklessNegotiatingOpportunity(
    id: string,
    expectedUpdatedAt: Date,
    fallbackStatus: 'latent' | 'draft',
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.compensateTasklessNegotiatingOpportunity(
      id,
      expectedUpdatedAt,
      fallbackStatus,
    );
  }

  /**
   * Delegates network-eligible status compare-and-set reactivation.
   *
   * @param id - Opportunity ID
   * @param status - Target lifecycle status
   * @param actors - Participant network anchors
   * @param eligibility - Authoritative owner/network/intent scope
   * @param expectedStatus - Optional compare-and-set source status
   * @returns The updated opportunity, or null after scope/status drift
   */
  async updateOpportunityStatusIfNetworkEligible(
    id: string,
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
    actors: Array<{ userId: string; networkId: string }>,
    eligibility: Parameters<OpportunityDatabaseAdapter['updateOpportunityStatusIfNetworkEligible']>[3],
    expectedStatus?: Parameters<OpportunityDatabaseAdapter['updateOpportunityStatusIfNetworkEligible']>[4],
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.updateOpportunityStatusIfNetworkEligible(
      id,
      status,
      actors,
      eligibility,
      expectedStatus,
    );
  }
  async updateOpportunityActorApproval(
    id: string,
    introducerUserId: string,
    approved: boolean,
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.updateOpportunityActorApproval(id, introducerUserId, approved);
  }
  async updateOpportunityMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await this.opportunityAdapter.updateOpportunityMetadata(id, metadata);
  }
  async applyOpportunityPoolAdjustments(
    recipientUserId: string,
    intentId: string,
    expectedIntentFingerprint: string,
    writes: Parameters<OpportunityDatabaseAdapter['applyOpportunityPoolAdjustments']>[3],
  ): Promise<string[] | null> {
    return this.opportunityAdapter.applyOpportunityPoolAdjustments(
      recipientUserId,
      intentId,
      expectedIntentFingerprint,
      writes,
    );
  }
  async stampOpportunityActorAction(
    id: string,
    actorUserId: string,
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
    outbox?: Parameters<OpportunityDatabaseAdapter['stampOpportunityActorAction']>[4],
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.stampOpportunityActorAction(id, actorUserId, status, acceptedBy, outbox);
  }
  async opportunityExistsBetweenActors(actorIds: string[], networkId: string): Promise<boolean> {
    return this.opportunityAdapter.opportunityExistsBetweenActors(actorIds, networkId);
  }
  async findOpportunitiesByActors(
    actorIds: string[],
    options?: Parameters<OpportunityDatabaseAdapter['findOpportunitiesByActors']>[1]
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.findOpportunitiesByActors(actorIds, options);
  }
  async getRecentlyRejectedOpportunityCounterparties(
    discovererId: string,
    candidateUserIds: string[],
    windowMs: number,
  ): Promise<string[]> {
    return this.opportunityAdapter.getRecentlyRejectedOpportunityCounterparties(discovererId, candidateUserIds, windowMs);
  }
  async expireOpportunitiesByIntent(intentId: string): Promise<number> {
    return this.opportunityAdapter.expireOpportunitiesByIntent(intentId);
  }
  async expireOpportunitiesForRemovedMember(networkId: string, userId: string): Promise<number> {
    return this.opportunityAdapter.expireOpportunitiesForRemovedMember(networkId, userId);
  }
  async expireStaleOpportunities(): Promise<number> {
    return this.opportunityAdapter.expireStaleOpportunities();
  }
  async acceptSiblingOpportunities(
    userId: string,
    counterpartUserId: string,
    excludeOpportunityId: string
  ): Promise<string[]> {
    return this.opportunityAdapter.acceptSiblingOpportunities(
      userId,
      counterpartUserId,
      excludeOpportunityId
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Contact / My Network Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a ghost user (unregistered contact) with empty profile.
   * Uses the same ON CONFLICT DO UPDATE pattern as the auth adapter:
   * - New email → inserts ghost row
   * - Existing ghost → updates name, returns existing ghost ID
   * - Existing real user → setWhere doesn't match, returns existing real user ID
   *
   * This ensures one consistent user-upsert mechanism across the codebase
   * (auth adapter for real-user signup/ghost-claim, this method for ghost creation).
   *
   * @param data - Name and email for the ghost user
   * @returns The created ghost user's ID (or existing user's ID if email taken)
   */
  async createGhostUser(data: { name: string; email: string }): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    const email = data.email.toLowerCase().trim();

    // Same onConflictDoUpdate + setWhere pattern as AuthDatabaseAdapter.createDrizzleAdapter().
    // If a ghost already exists with this email, update its name.
    // If a real user exists, setWhere won't match → RETURNING is empty.
    const result = await db
      .insert(schema.users)
      .values({
        id,
        name: data.name,
        email,
        isGhost: true,
      })
      .onConflictDoUpdate({
        target: [schema.users.email],
        set: {
          name: sql`EXCLUDED."name"`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${schema.users.isGhost} = true`,
      })
      .returning({ id: schema.users.id });

    if (result[0]) {
      // New ghost created or existing ghost updated. No profile row to seed since
      // user_profiles was dropped in WS8 (IND-365); identity lives on `users`.
      return { id: result[0].id };
    }

    // Real user already exists with this email — return their ID (exclude soft-deleted)
    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!existing) {
      throw new Error(`Cannot create ghost: email belongs to a deleted user (${email})`);
    }

    return { id: existing.id };
  }

  /**
   * Soft-delete a ghost user by unsubscribe token.
   * Looks up the user via userNotificationSettings.unsubscribeToken,
   * then soft-deletes if the user is a ghost and not already deleted.
   * @param token - The unsubscribe token from the email link
   * @returns true if user was soft-deleted, false if not found or not eligible
   */
  async softDeleteGhostByUnsubscribeToken(token: string): Promise<boolean> {
    const [settings] = await db.select({ userId: schema.userNotificationSettings.userId })
      .from(schema.userNotificationSettings)
      .where(eq(schema.userNotificationSettings.unsubscribeToken, token))
      .limit(1);
    if (!settings) return false;

    // Verify user is a ghost
    const [user] = await db.select({ id: schema.users.id, isGhost: schema.users.isGhost })
      .from(schema.users)
      .where(eq(schema.users.id, settings.userId))
      .limit(1);
    if (!user || !user.isGhost) return false;

    // Soft-delete all index_members rows where this ghost is a contact
    const result = await db.update(schema.networkMembers)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(schema.networkMembers.userId, settings.userId),
        sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        isNull(schema.networkMembers.deletedAt),
      ))
      .returning({ networkId: schema.networkMembers.networkId });

    return result.length > 0;
  }

  /**
   * Get or create notification settings for a user.
   * If no row exists, creates one with default preferences.
   * @param userId - The user's ID
   * @returns The notification settings row (includes unsubscribeToken)
   */
  async getOrCreateNotificationSettings(userId: string): Promise<{ id: string; userId: string; unsubscribeToken: string }> {
    const projection = {
      id: schema.userNotificationSettings.id,
      userId: schema.userNotificationSettings.userId,
      unsubscribeToken: schema.userNotificationSettings.unsubscribeToken,
    };

    // Atomic upsert: insert with onConflictDoNothing, then select
    await db.insert(schema.userNotificationSettings)
      .values({ userId })
      .onConflictDoNothing({ target: schema.userNotificationSettings.userId });

    const [row] = await db.select(projection)
      .from(schema.userNotificationSettings)
      .where(eq(schema.userNotificationSettings.userId, userId))
      .limit(1);
    if (!row) {
      throw new Error(`Failed to get or create notification settings for user ${userId}`);
    }
    return row;
  }

  /**
   * Get emails of soft-deleted ghost users from a list of emails.
   * Used to prevent re-importing opted-out ghost contacts.
   * @param emails - List of emails to check
   * @returns Emails belonging to soft-deleted ghost users
   */
  async getSoftDeletedGhostEmails(emails: string[]): Promise<string[]> {
    if (emails.length === 0) return [];
    const results = await db.select({ email: schema.users.email })
      .from(schema.users)
      .where(and(
        inArray(schema.users.email, emails),
        eq(schema.users.isGhost, true),
        isNotNull(schema.users.deletedAt),
      ));
    return results.map(r => r.email);
  }


  /**
   * Returns personal network IDs where the given user is a contact member.
   * @param userId - The user whose contact memberships to look up
   * @returns Array of personal network IDs
   */
  async getPersonalIndexesForContact(userId: string): Promise<{ networkId: string }[]> {
    return db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, eq(schema.networks.id, schema.networkMembers.networkId))
      .where(
        and(
          eq(schema.networkMembers.userId, userId),
          eq(schema.networks.isPersonal, true),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        )
      );
  }

  /**
   * Find a user by email (case-insensitive).
   * @param email - The email to search for
   * @returns User record or null
   */
  async getUserByEmail(email: string): Promise<{ id: string; name: string; email: string; isGhost: boolean } | null> {
    const normalized = email.toLowerCase().trim();
    const [row] = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        isGhost: schema.users.isGhost,
      })
      .from(schema.users)
      .where(and(
        sql`lower(${schema.users.email}) = ${normalized}`,
        isNull(schema.users.deletedAt),
      ))
      .limit(1);
    return row ?? null;
  }

  /**
   * Bulk lookup users by email.
   * @param emails - Array of emails to search for
   * @returns Array of user records (only those that exist)
   */
  async getUsersByEmails(emails: string[]): Promise<Array<{ id: string; name: string; email: string; isGhost: boolean }>> {
    if (emails.length === 0) return [];
    const rows = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        isGhost: schema.users.isGhost,
      })
      .from(schema.users)
      .where(and(inArray(schema.users.email, emails), isNull(schema.users.deletedAt)));
    return rows;
  }

  /**
   * Bulk create ghost users.
   * @param data - Array of {name, email} for ghost users
   * @returns Array of created ghost users with their IDs
   */
  async createGhostUsersBulk(data: Array<{ name: string; email: string }>): Promise<Array<{ id: string; name: string; email: string }>> {
    if (data.length === 0) return [];

    const results: Array<{ id: string; name: string; email: string }> = [];

    // Create users
    const usersToInsert = data.map(d => ({
      id: crypto.randomUUID(),
      name: d.name,
      email: d.email.toLowerCase().trim(),
      isGhost: true,
    }));

    await db.insert(schema.users).values(usersToInsert).onConflictDoNothing();

    // Re-query to find which live users actually exist (created now vs already existed)
    // Excludes soft-deleted users so they don't flow into membership upserts or enrichment
    const insertedEmails = new Set(usersToInsert.map(u => u.email));
    const existingAfterInsert = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(and(
        inArray(schema.users.email, [...insertedEmails]),
        isNull(schema.users.deletedAt),
      ));

    // Map back to our generated IDs vs actual IDs
    const emailToId = new Map(existingAfterInsert.map(u => [u.email, u.id]));

    // Return results with correct IDs (actual DB IDs, not our generated ones)
    for (const u of usersToInsert) {
      const actualId = emailToId.get(u.email);
      if (actualId) {
        results.push({ id: actualId, name: u.name, email: u.email });
      }
    }

    return results;
  }


  /**
   * Upsert a contact membership in the owner's personal network.
   * Inserts an index_members row with permissions=['contact'].
   * @param ownerId - The owner of the personal network
   * @param contactUserId - The user to add as a contact member
   * @param options - If restore=true, reactivates soft-deleted rows via onConflictDoUpdate(deletedAt=null).
   *                  If restore=false (default), skips soft-deleted rows and uses onConflictDoNothing for active ones.
   */
  async upsertContactMembership(
    ownerId: string,
    contactUserId: string,
    options: { restore?: boolean } = {}
  ): Promise<void> {
    const personalIndexId = await ensurePersonalNetwork(ownerId);

    if (options.restore) {
      await db
        .insert(schema.networkMembers)
        .values({
          networkId: personalIndexId,
          userId: contactUserId,
          permissions: ['contact'],
          autoAssign: false,
        })
        .onConflictDoUpdate({
          target: [schema.networkMembers.networkId, schema.networkMembers.userId],
          set: { deletedAt: null, updatedAt: new Date() },
        });
    } else {
      // Check for soft-deleted row first — skip if found (opt-out respected)
      const [existing] = await db
        .select({ deletedAt: schema.networkMembers.deletedAt })
        .from(schema.networkMembers)
        .where(
          and(
            eq(schema.networkMembers.networkId, personalIndexId),
            eq(schema.networkMembers.userId, contactUserId),
            sql`'contact' = ANY(${schema.networkMembers.permissions})`,
          )
        )
        .limit(1);

      if (existing?.deletedAt) return; // soft-deleted — do not restore

      await db
        .insert(schema.networkMembers)
        .values({
          networkId: personalIndexId,
          userId: contactUserId,
          permissions: ['contact'],
          autoAssign: false,
        })
        .onConflictDoNothing();
    }
  }

  /**
   * Bulk upsert contact memberships in the owner's personal network.
   * Respects opt-outs: skips contacts that have a soft-deleted membership row.
   * @param ownerId - The owner of the personal network
   * @param contactUserIds - User IDs to add as contacts
   * @returns Resolves when all non-opted-out memberships are upserted
   */
  async upsertContactMembershipBulk(ownerId: string, contactUserIds: string[]): Promise<void> {
    if (contactUserIds.length === 0) return;
    const personalIndexId = await ensurePersonalNetwork(ownerId);

    const softDeleted = new Set(
      (await db
        .select({ userId: schema.networkMembers.userId })
        .from(schema.networkMembers)
        .where(
          and(
            eq(schema.networkMembers.networkId, personalIndexId),
            inArray(schema.networkMembers.userId, contactUserIds),
            sql`'contact' = ANY(${schema.networkMembers.permissions})`,
            isNotNull(schema.networkMembers.deletedAt),
          )
        )
      ).map(r => r.userId)
    );

    const idsToInsert = contactUserIds.filter(id => !softDeleted.has(id));
    if (idsToInsert.length === 0) return;

    const values = idsToInsert.map(userId => ({
      networkId: personalIndexId,
      userId,
      permissions: ['contact'],
      autoAssign: false,
    }));
    await db.insert(schema.networkMembers).values(values).onConflictDoNothing();
  }

  /**
   * Bulk-add users as members to a specific index.
   * Skips users that are already members (onConflictDoNothing).
   * @param networkId - The target index
   * @param userIds - User IDs to add as members
   */
  async addMembersBulkToIndex(networkId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;

    let memberPrompt: string | null = null;
    const [indexRow] = await db.select({ prompt: schema.networks.prompt }).from(schema.networks).where(eq(schema.networks.id, networkId)).limit(1);
    if (indexRow) memberPrompt = indexRow.prompt;

    const values = userIds.map(userId => ({
      networkId,
      userId,
      permissions: ['member'],
      prompt: memberPrompt,
      autoAssign: false,
    }));
    await db.insert(schema.networkMembers).values(values).onConflictDoNothing();
  }

  // ─── Index Integrations ───────────────────────────────────────────────────────

  /**
   * Link a Composio connected account to an index.
   * @param networkId - Target index
   * @param toolkit - Toolkit slug (e.g. 'gmail', 'slack')
   * @param connectedAccountId - Composio connected account ID
   */
  async insertIndexIntegration(networkId: string, toolkit: string, connectedAccountId: string): Promise<void> {
    await db.insert(schema.networkIntegrations)
      .values({ networkId, toolkit, connectedAccountId })
      .onConflictDoNothing();
  }

  /**
   * Unlink a toolkit from an index.
   * @param networkId - Target index
   * @param toolkit - Toolkit slug
   */
  async deleteIndexIntegration(networkId: string, toolkit: string): Promise<void> {
    await db.delete(schema.networkIntegrations)
      .where(and(
        eq(schema.networkIntegrations.networkId, networkId),
        eq(schema.networkIntegrations.toolkit, toolkit),
      ));
  }

  /**
   * Remove all index links for a specific Composio connected account.
   * Called when a user fully disconnects their Composio connection.
   * @param connectedAccountId - Composio connected account ID
   */
  async deleteIndexIntegrationsByConnectedAccount(connectedAccountId: string): Promise<void> {
    await db.delete(schema.networkIntegrations)
      .where(eq(schema.networkIntegrations.connectedAccountId, connectedAccountId));
  }

  /**
   * List all linked integrations for an index.
   * @param networkId - The index to query
   * @returns Array of linked integration records
   */
  async getNetworkIntegrations(networkId: string): Promise<Array<{ toolkit: string; connectedAccountId: string; createdAt: Date }>> {
    return db.select({
      toolkit: schema.networkIntegrations.toolkit,
      connectedAccountId: schema.networkIntegrations.connectedAccountId,
      createdAt: schema.networkIntegrations.createdAt,
    })
      .from(schema.networkIntegrations)
      .where(eq(schema.networkIntegrations.networkId, networkId));
  }

  /**
   * Read the current syncConfig for a specific integration row.
   * @param networkId - Target index
   * @param toolkit - Toolkit slug
   * @returns The syncConfig object or null if no row exists
   */
  async getIntegrationSyncConfig(
    networkId: string,
    toolkit: string,
  ): Promise<Record<string, unknown> | null> {
    const [row] = await db
      .select({ syncConfig: schema.networkIntegrations.syncConfig })
      .from(schema.networkIntegrations)
      .where(
        and(
          eq(schema.networkIntegrations.networkId, networkId),
          eq(schema.networkIntegrations.toolkit, toolkit),
        ),
      )
      .limit(1);
    return row?.syncConfig ?? null;
  }

  /**
   * Read the metadata JSONB for a network.
   * @param networkId - Target network
   * @returns The metadata object or null if not found
   */
  async getNetworkMetadata(networkId: string): Promise<Record<string, unknown> | null> {
    const [row] = await db
      .select({ metadata: schema.networks.metadata })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId))
      .limit(1);
    return (row?.metadata as Record<string, unknown>) ?? null;
  }

  /**
   * Replace the metadata JSONB for a network.
   * @param networkId - Target network
   * @param metadata - New metadata object
   */
  async updateNetworkMetadata(networkId: string, metadata: Record<string, unknown>): Promise<void> {
    await db
      .update(schema.networks)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(schema.networks.id, networkId));
  }

  /**
   * Update the syncConfig JSONB column on a network_integrations row.
   * @param networkId - Target index
   * @param toolkit - Toolkit slug (e.g. 'google_calendar')
   * @param syncConfig - New sync configuration to store
   */
  async updateIntegrationSyncConfig(
    networkId: string,
    toolkit: string,
    syncConfig: Record<string, unknown>,
  ): Promise<void> {
    await db
      .update(schema.networkIntegrations)
      .set({ syncConfig })
      .where(
        and(
          eq(schema.networkIntegrations.networkId, networkId),
          eq(schema.networkIntegrations.toolkit, toolkit),
        ),
      );
  }

  /**
   * Return all network_integrations rows whose syncConfig.status is 'active',
   * joined with network_members to include the network owner's userId.
   * Used by the integration sync worker to find integrations due for a tick.
   */
  async getActiveIntegrationSyncs(): Promise<Array<{
    networkId: string;
    toolkit: string;
    connectedAccountId: string;
    syncConfig: Record<string, unknown>;
    ownerUserId: string;
  }>> {
    // Use a lateral subquery to pick exactly one owner per network,
    // avoiding duplicate rows when a network has multiple owners.
    const rows = await db.execute<{
      network_id: string;
      toolkit: string;
      connected_account_id: string;
      sync_config: Record<string, unknown>;
      owner_user_id: string;
    }>(sql`
      SELECT
        ni.network_id,
        ni.toolkit,
        ni.connected_account_id,
        ni.sync_config,
        owner.user_id AS owner_user_id
      FROM network_integrations ni
      JOIN networks n ON n.id = ni.network_id AND n.deleted_at IS NULL
      CROSS JOIN LATERAL (
        SELECT nm.user_id
        FROM network_members nm
        WHERE nm.network_id = ni.network_id
          AND 'owner' = ANY(nm.permissions)
          AND nm.deleted_at IS NULL
        ORDER BY nm.created_at ASC
        LIMIT 1
      ) owner
      WHERE ni.sync_config->>'status' = 'active'
    `);

    return rows.map((r) => ({
      networkId: r.network_id,
      toolkit: r.toolkit,
      connectedAccountId: r.connected_account_id,
      syncConfig: r.sync_config as Record<string, unknown>,
      ownerUserId: r.owner_user_id,
    }));
  }

  /**
   * Hard-delete a contact membership from the owner's personal network.
   * @param ownerId - The owner of the personal network
   * @param contactUserId - The contact user to remove
   */
  async hardDeleteContactMembership(ownerId: string, contactUserId: string): Promise<void> {
    const personalIndexId = await getPersonalIndexId(ownerId);
    if (!personalIndexId) return;

    await db.delete(schema.networkMembers)
      .where(
        and(
          eq(schema.networkMembers.networkId, personalIndexId),
          eq(schema.networkMembers.userId, contactUserId),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        )
      );
  }

  /**
   * Clear a soft-deleted contact membership that the other user has for this owner.
   * This removes the "reverse opt-out" so the other user's personal network no longer blocks the owner.
   * @param ownerId - The user being added as a contact
   * @param otherUserId - The other user whose personal network may have a soft-deleted row for ownerId
   */
  async clearReverseOptOut(ownerId: string, otherUserId: string): Promise<void> {
    const otherPersonalIndexId = await getPersonalIndexId(otherUserId);
    if (!otherPersonalIndexId) return;

    await db.delete(schema.networkMembers)
      .where(
        and(
          eq(schema.networkMembers.networkId, otherPersonalIndexId),
          eq(schema.networkMembers.userId, ownerId),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
          isNotNull(schema.networkMembers.deletedAt),
        )
      );
  }

  /**
   * Bulk clear soft-deleted contact memberships (reverse opt-outs) for multiple users.
   * Removes rows where `ownerId` appears as a soft-deleted contact in each user's personal network.
   * @param ownerId - The user being added as a contact
   * @param otherUserIds - The users whose personal networks may have soft-deleted rows for ownerId
   */
  async clearReverseOptOutBulk(ownerId: string, otherUserIds: string[]): Promise<void> {
    if (otherUserIds.length === 0) return;

    // Batch lookup personal networks for all other users
    const personalIndexRows = await db
      .select({ userId: schema.personalNetworks.userId, networkId: schema.personalNetworks.networkId })
      .from(schema.personalNetworks)
      .where(inArray(schema.personalNetworks.userId, otherUserIds));

    const personalIndexIds = personalIndexRows.map(r => r.networkId);
    if (personalIndexIds.length === 0) return;

    // Single DELETE across all matching personal networks
    await db.delete(schema.networkMembers)
      .where(
        and(
          inArray(schema.networkMembers.networkId, personalIndexIds),
          eq(schema.networkMembers.userId, ownerId),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
          isNotNull(schema.networkMembers.deletedAt),
        )
      );
  }

  /**
   * Get all contact members from the owner's personal network.
   * @param ownerId - The owner of the personal network
   * @returns Array of contact members with user details
   */
  async getContactMembers(ownerId: string): Promise<Array<{
    userId: string;
    user: { id: string; name: string; email: string; avatar: string | null; isGhost: boolean };
  }>> {
    const personalIndexId = await getPersonalIndexId(ownerId);
    if (!personalIndexId) return [];

    const rows = await db
      .select({
        userId: schema.networkMembers.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userAvatar: schema.users.avatar,
        userIsGhost: schema.users.isGhost,
      })
      .from(schema.networkMembers)
      .innerJoin(schema.users, eq(schema.networkMembers.userId, schema.users.id))
      .where(
        and(
          eq(schema.networkMembers.networkId, personalIndexId),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
          isNull(schema.networkMembers.deletedAt),
          isNull(schema.users.deletedAt),
        )
      );

    return rows.map((row) => ({
      userId: row.userId,
      user: {
        id: row.userId,
        name: row.userName,
        email: row.userEmail,
        avatar: row.userAvatar,
        isGhost: row.userIsGhost,
      },
    }));
  }

  /**
   * Get the user's personal network ID.
   * @param userId - The user whose personal network to find
   * @returns The personal network ID, or null if none exists
   */
  async getPersonalIndexId(userId: string): Promise<string | null> {
    return getPersonalIndexId(userId);
  }

  /**
   * Get contacts from a personal network with their latest intent timestamp and intent count.
   * Contacts are sorted by most recent intent (freshest first) for introducer discovery.
   *
   * @param personalIndexId - The personal network to query
   * @param ownerId - The network owner (excluded from results)
   * @param limit - Maximum contacts to return
   * @returns Contacts with intent freshness data
   */
  async getContactsWithIntentFreshness(
    personalIndexId: string,
    ownerId: string,
    limit: number,
  ): Promise<Array<{ userId: string; latestIntentAt: string | null; intentCount: number }>> {
    try {
      const rows = await db
        .select({
          userId: schema.networkMembers.userId,
          latestIntentAt: sql<string | null>`MAX(${schema.intents.updatedAt})`.as('latest_intent_at'),
          intentCount: sql<number>`COUNT(${schema.intents.id})::int`.as('intent_count'),
        })
        .from(schema.networkMembers)
        .innerJoin(
          schema.users,
          eq(schema.networkMembers.userId, schema.users.id),
        )
        .leftJoin(
          schema.intents,
          and(
            eq(schema.intents.userId, schema.networkMembers.userId),
            isNull(schema.intents.archivedAt),
            activeIntentLifecycleWhere(),
          ),
        )
        .where(
          and(
            eq(schema.networkMembers.networkId, personalIndexId),
            sql`'contact' = ANY(${schema.networkMembers.permissions})`,
            isNull(schema.networkMembers.deletedAt),
            isNull(schema.users.deletedAt),
            sql`${schema.networkMembers.userId} != ${ownerId}`,
          ),
        )
        .groupBy(schema.networkMembers.userId)
        .orderBy(sql`MAX(${schema.intents.updatedAt}) DESC NULLS LAST`)
        .limit(limit);

      return rows.map((row) => ({
        userId: row.userId,
        latestIntentAt: row.latestIntentAt ? new Date(row.latestIntentAt).toISOString() : null,
        intentCount: Number(row.intentCount) || 0,
      }));
    } catch (error) {
      logger.error('ChatDatabaseAdapter.getContactsWithIntentFreshness error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Finds an existing DM conversation between two users, or creates one.
   * Thin delegator to {@link ConversationDatabaseAdapter.getOrCreateDM} so
   * OpportunityService can satisfy the OpportunityControllerDatabase
   * interface without importing another service (per the services-must-not-
   * import-services rule). Used by the Start Chat endpoint (Plan B Task 8).
   *
   * @param userA - First participant user ID.
   * @param userB - Second participant user ID.
   * @returns The existing or newly-created DM conversation (only the id).
   * @throws Error when both IDs match (self-DMs are rejected) or when the
   *   insert fails and no pre-existing row can be found after a unique
   *   constraint collision (surfaced by the underlying ConversationDatabaseAdapter).
   */
  async getOrCreateDM(userA: string, userB: string, participantType?: 'user' | 'agent'): Promise<{ id: string }> {
    const conversationAdapter = new ConversationDatabaseAdapter();
    return conversationAdapter.getOrCreateDM(userA, userB, participantType);
  }

  /**
   * Clears hiddenAt for a user on a conversation, making it visible again.
   * Thin delegator to {@link ConversationDatabaseAdapter.unhideConversation}
   * so OpportunityService can call it after reusing an existing DM that the
   * user had previously hidden.
   */
  async unhideConversation(userId: string, conversationId: string): Promise<void> {
    const conversationAdapter = new ConversationDatabaseAdapter();
    return conversationAdapter.unhideConversation(userId, conversationId);
  }

  /** Append a deduplicated match provenance entry to a DM metadata sidecar. */
  async appendMatchProvenance(
    conversationId: string,
    provenance: Parameters<ConversationDatabaseAdapter['appendMatchProvenance']>[1],
  ): Promise<void> {
    const conversationAdapter = new ConversationDatabaseAdapter();
    return conversationAdapter.appendMatchProvenance(conversationId, provenance);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Premises Methods (premise CRUD and network assignment)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new premise record for a user.
   * @param input - The premise fields to persist
   * @returns The created premise record
   */
  async createPremise(input: {
    userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis?: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number };
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding?: number[];
  }): Promise<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[] | null;
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  }> {
    const [row] = await db
      .insert(schema.premises)
      .values({
        userId: input.userId,
        assertion: input.assertion,
        provenance: input.provenance,
        analysis: input.analysis ?? null,
        validity: input.validity,
        embedding: input.embedding ?? null,
        status: 'ACTIVE',
      })
      .returning();
    if (!row) throw new Error('createPremise: no row returned');
    // Premise lifecycle events fire HERE — at the persistence chokepoint — so every
    // surface (chat, MCP, ToolService, enrichment graphs, queues) triggers the
    // opportunity cascade + user_contexts regeneration without per-surface wiring.
    // The bus defaults to no-ops; main.ts subscribes the queue handlers.
    try { PremiseEvents.onCreated(row.id, row.userId); }
    catch (e) { logger.error('PremiseEvents.onCreated failed after premise create', { premiseId: row.id, error: e }); }
    return {
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
      retractedAt: row.retractedAt ?? null,
    };
  }

  async getPremise(premiseId: string): Promise<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[] | null;
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  } | null> {
    const [row] = await db
      .select()
      .from(schema.premises)
      .where(and(eq(schema.premises.id, premiseId), isNull(schema.premises.deletedAt)))
      .limit(1);
    if (!row) return null;
    return {
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
      retractedAt: row.retractedAt ?? null,
    };
  }

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
    return readPremisesForUser(userId, status);
  }

  /**
   * Retrieve a capped set of active source premises scoped to target networks.
   * Delegates to OpportunityDatabaseAdapter so OpportunityGraph can avoid
   * loading every premise for premise-rich users.
   */
  async getPremisesForUserInNetworks(userId: string, networkIds: string[], status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED', limit?: number) {
    return this.opportunityAdapter.getPremisesForUserInNetworks(userId, networkIds, status, limit);
  }

  /**
   * Cosine similarity search against premise embeddings, scoped to shared networks.
   * Delegates to OpportunityDatabaseAdapter (which hosts the raw SQL query).
   */
  async searchPremisesBySimilarity(params: {
    embedding: number[];
    networkIds: string[];
    excludeUserId: string;
    limit: number;
  }) {
    return this.opportunityAdapter.searchPremisesBySimilarity(params);
  }

  /**
   * Batched cosine similarity search against premise embeddings.
   * Delegates to OpportunityDatabaseAdapter to avoid one DB round-trip per
   * source premise during discovery.
   */
  async searchPremisesBySimilarityBatch(params: {
    sources: Array<{ premiseId: string; embedding: number[] }>;
    networkIds: string[];
    excludeUserId: string;
    limitPerSource: number;
  }) {
    return this.opportunityAdapter.searchPremisesBySimilarityBatch(params);
  }

  /**
   * Find the most-similar ACTIVE premise owned by the same user whose cosine
   * similarity to `embedding` meets or exceeds `threshold`. Powers near-duplicate
   * skipping on premise create. Returns null when nothing clears the threshold.
   *
   * @param params.userId - Owner whose premises are searched.
   * @param params.embedding - Query embedding for the candidate premise.
   * @param params.threshold - Minimum cosine similarity (0-1) to treat as a duplicate.
   * @returns The nearest qualifying premise, or null.
   */
  async findSimilarActivePremise(params: {
    userId: string;
    embedding: number[];
    threshold: number;
  }): Promise<{ premiseId: string; assertionText: string; similarity: number } | null> {
    const { userId, embedding, threshold } = params;
    if (!embedding.length) return null;
    const vectorStr = `[${embedding.join(',')}]`;
    const rows = await db.execute<{
      premiseId: string;
      assertionText: string;
      similarity: number;
    }>(sql`
      SELECT
        p.id AS "premiseId",
        p.assertion->>'text' AS "assertionText",
        1 - (p.embedding <=> ${vectorStr}::vector) AS similarity
      FROM ${schema.premises} p
      WHERE p.user_id = ${userId}
        AND p.status = 'ACTIVE'
        AND p.embedding IS NOT NULL
        AND p.deleted_at IS NULL
      ORDER BY p.embedding <=> ${vectorStr}::vector
      LIMIT 1
    `);
    const top = rows[0];
    if (!top) return null;
    const similarity = Number(top.similarity);
    if (!Number.isFinite(similarity) || similarity < threshold) return null;
    return { premiseId: top.premiseId, assertionText: top.assertionText, similarity };
  }

  async updatePremise(premiseId: string, updates: {
    assertion?: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    analysis?: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number };
    validity?: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding?: number[];
    status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    retractedAt?: Date;
  }): Promise<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[] | null;
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  }> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.assertion !== undefined) patch.assertion = updates.assertion;
    if (updates.analysis !== undefined) patch.analysis = updates.analysis;
    if (updates.validity !== undefined) patch.validity = updates.validity;
    if (updates.embedding !== undefined) patch.embedding = updates.embedding;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.retractedAt !== undefined) patch.retractedAt = updates.retractedAt;

    const [row] = await db
      .update(schema.premises)
      .set(patch)
      .where(and(eq(schema.premises.id, premiseId), isNull(schema.premises.deletedAt)))
      .returning();
    if (!row) throw new Error(`updatePremise: premise ${premiseId} not found or soft-deleted`);
    // Lifecycle events at the persistence chokepoint (see createPremise). Status
    // transitions map to their dedicated events; content/validity edits map to
    // onUpdated. Fired for every surface — no caller has to remember to wire them.
    try {
      if (updates.status === 'RETRACTED') PremiseEvents.onRetracted(row.id, row.userId);
      else if (updates.status === 'EXPIRED') PremiseEvents.onExpired(row.id, row.userId);
      else PremiseEvents.onUpdated(row.id, row.userId);
    } catch (e) {
      logger.error('PremiseEvents emit failed after premise update', { premiseId: row.id, error: e });
    }
    return {
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
      retractedAt: row.retractedAt ?? null,
    };
  }

  /** Atomically retract an owned premise if its proposal snapshot is still current. */
  async retractPremiseIfCurrent(
    premiseId: string,
    userId: string,
    expectedUpdatedAt: Date,
  ): Promise<'applied' | 'alreadyDone' | 'stale' | 'not_found'> {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select({
        id: schema.premises.id,
        userId: schema.premises.userId,
        status: schema.premises.status,
        updatedAt: schema.premises.updatedAt,
      }).from(schema.premises).where(eq(schema.premises.id, premiseId)).limit(1).for('update');
      if (!current || current.userId !== userId) return { kind: 'not_found' as const };
      if (current.status === 'RETRACTED') return { kind: 'alreadyDone' as const };
      if (current.status !== 'ACTIVE' || current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        return { kind: 'stale' as const };
      }
      const [updated] = await tx.update(schema.premises)
        .set({ status: 'RETRACTED', retractedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.premises.id, premiseId), eq(schema.premises.userId, userId)))
        .returning({ id: schema.premises.id, userId: schema.premises.userId });
      return updated ? { kind: 'applied' as const, id: updated.id, userId: updated.userId } : { kind: 'stale' as const };
    });
    if (result.kind === 'applied') {
      try {
        PremiseEvents.onRetracted(result.id, result.userId);
      } catch (error) {
        logger.error('PremiseEvents emit failed after guarded premise retraction', { premiseId, error });
      }
    }
    return result.kind;
  }

  /** Atomically update an owned intent only when its proposal snapshot is current. */
  async updateIntentIfCurrent(
    intentId: string,
    userId: string,
    payload: string,
    expectedUpdatedAt: Date,
  ): Promise<'applied' | 'stale' | 'not_found'> {
    const result = await db.transaction(async (tx) => {
      const [before] = await tx.select({
        id: schema.intents.id,
        userId: schema.intents.userId,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        status: schema.intents.status,
        archivedAt: schema.intents.archivedAt,
        updatedAt: schema.intents.updatedAt,
      }).from(schema.intents).where(eq(schema.intents.id, intentId)).limit(1).for('update');
      if (!before || before.userId !== userId) return { kind: 'not_found' as const };
      if (before.archivedAt || before.status === 'FULFILLED' || before.status === 'EXPIRED' || before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        return { kind: 'stale' as const };
      }
      const updatedAt = new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1));
      const [updated] = await tx.update(schema.intents)
        .set({ payload, updatedAt })
        .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, userId)))
        .returning({ id: schema.intents.id, userId: schema.intents.userId, payload: schema.intents.payload, summary: schema.intents.summary });
      if (!updated) return { kind: 'stale' as const };
      return {
        kind: 'applied' as const,
        id: updated.id,
        userId: updated.userId,
        oldFingerprint: computeIntentFingerprint(before.payload, before.summary),
        newFingerprint: computeIntentFingerprint(updated.payload, updated.summary),
      };
    });
    if (result.kind === 'applied' && result.oldFingerprint !== result.newFingerprint) {
      await IntentEvents.onMaterialUpdated({
        intentId: result.id,
        userId: result.userId,
        oldFingerprint: result.oldFingerprint,
        newFingerprint: result.newFingerprint,
      });
    }
    return result.kind;
  }

  async assignPremiseToNetwork(
    premiseId: string,
    networkId: string,
    relevancyScore: number,
    assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
  ): Promise<void> {
    await db
      .insert(schema.premiseNetworks)
      .values({
        premiseId,
        networkId,
        relevancyScore: String(relevancyScore),
        ...(assignmentMetadata !== undefined ? { assignmentMetadata } : {}),
      })
      .onConflictDoUpdate({
        target: [schema.premiseNetworks.premiseId, schema.premiseNetworks.networkId],
        set: {
          relevancyScore: String(relevancyScore),
          ...(assignmentMetadata !== undefined ? { assignmentMetadata } : {}),
        },
      });
  }

  async getPremiseNetworks(premiseId: string): Promise<Array<{
    networkId: string;
    relevancyScore: number | null;
    assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata | null;
  }>> {
    const rows = await db
      .select({
        networkId: schema.premiseNetworks.networkId,
        relevancyScore: schema.premiseNetworks.relevancyScore,
        assignmentMetadata: schema.premiseNetworks.assignmentMetadata,
      })
      .from(schema.premiseNetworks)
      .where(eq(schema.premiseNetworks.premiseId, premiseId));
    return rows.map((r) => ({
      networkId: r.networkId,
      relevancyScore: r.relevancyScore !== null ? Number(r.relevancyScore) : null,
      assignmentMetadata: r.assignmentMetadata ?? null,
    }));
  }

  /**
   * Find a user's own ACTIVE intents whose embeddings sit close to the given
   * embedding. Used by the premise retract/expire cascade as the "grounded on"
   * heuristic: no explicit premise→intent edge exists in the schema, so
   * cosine proximity in the shared embedding space (text-embedding-3-large,
   * 2000 dims — same space as premises) is the best available proxy for which
   * intents were grounded on a lapsed premise and need re-verification (IND-423).
   * @param params.userId - Owner of the intents (own intents only)
   * @param params.embedding - The premise embedding to compare against
   * @param params.minSimilarity - Cosine similarity floor (default 0.5)
   * @param params.limit - Max intents to return (default 5)
   */
  async getIntentsGroundedOnEmbedding(params: {
    userId: string;
    embedding: number[];
    minSimilarity?: number;
    limit?: number;
  }): Promise<Array<{ id: string; payload: string; similarity: number }>> {
    const { userId, embedding, minSimilarity = 0.5, limit = 5 } = params;
    const vectorStr = `[${embedding.join(',')}]`;
    const rows = await db.execute<{ id: string; payload: string; similarity: number }>(sql`
      SELECT
        i.id,
        i.payload,
        1 - (i.embedding <=> ${vectorStr}::vector) AS similarity
      FROM ${schema.intents} i
      WHERE i.user_id = ${userId}
        AND (i.status = 'ACTIVE' OR i.status IS NULL)
        AND i.archived_at IS NULL
        AND i.embedding IS NOT NULL
        AND 1 - (i.embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
      ORDER BY i.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);
    return rows as Array<{ id: string; payload: string; similarity: number }>;
  }

  /**
   * Find ACTIVE premises whose validity.validUntil has passed.
   * Uses a JSONB text extraction cast to timestamptz for the comparison.
   * @returns Minimal rows: id and userId for each expired premise
   */
  async getExpiredPremises(): Promise<Array<{ id: string; userId: string }>> {
    const rows = await db
      .select({ id: schema.premises.id, userId: schema.premises.userId })
      .from(schema.premises)
      .where(
        and(
          eq(schema.premises.status, 'ACTIVE'),
          isNull(schema.premises.deletedAt),
          sql`(${schema.premises.validity}->>'validUntil') IS NOT NULL`,
          sql`(${schema.premises.validity}->>'validUntil')::timestamptz < NOW()`,
        )
      );
    return rows.map((r) => ({ id: r.id, userId: r.userId }));
  }

  /**
   * Find premises for a user with a specific provenance source.
   * Used for bulk-retraction of premises derived from a given source type
   * (e.g. 'integration' when social URLs are updated).
   *
   * @param userId - Owner of the premises
   * @param source - Provenance source value to filter by (e.g. 'integration', 'explicit')
   * @returns Minimal rows: id for each matching ACTIVE (non-deleted, non-retracted) premise
   */
  async getPremisesBySource(userId: string, source: string): Promise<Array<{ id: string }>> {
    const rows = await db
      .select({ id: schema.premises.id })
      .from(schema.premises)
      .where(
        and(
          eq(schema.premises.userId, userId),
          eq(schema.premises.status, 'ACTIVE'),
          isNull(schema.premises.deletedAt),
          sql`(${schema.premises.provenance}->>'source') = ${source}`,
        )
      );
    return rows.map(r => ({ id: r.id }));
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // User Context Methods — CRUD for per-user-per-network context summaries
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Upsert a user context summary for a given user+network pair.
   * Creates a new row or updates an existing one based on the (userId, networkId) unique constraint.
   */
  async upsertUserContext(params: {
    userId: string;
    /** Concrete network id, or null for the user's global (profile-replacing) row. */
    networkId: string | null;
    text: string;
    embedding: number[];
    premiseHash: string;
  }): Promise<{ id: string }> {
    const vectorStr = `[${params.embedding.join(',')}]`;
    const setOnConflict = {
      text: params.text,
      embedding: sql`${vectorStr}::vector` as unknown as number[],
      premiseHash: params.premiseHash,
      generatedAt: new Date(),
    };
    // A null networkId conflicts on the partial `user_contexts_user_global_uniq`
    // index (target = userId WHERE network_id IS NULL); concrete networks conflict
    // on the composite `user_contexts_user_network_uniq` index. The two indexes are
    // mutually exclusive, so the conflict target must match the row being written.
    const insert = db.insert(userContexts)
      .values({
        userId: params.userId,
        networkId: params.networkId,
        text: params.text,
        embedding: sql`${vectorStr}::vector` as unknown as number[],
        premiseHash: params.premiseHash,
        generatedAt: new Date(),
      });
    const rows = await (params.networkId === null
      ? insert.onConflictDoUpdate({
          target: userContexts.userId,
          targetWhere: isNull(userContexts.networkId),
          set: setOnConflict,
        })
      : insert.onConflictDoUpdate({
          target: [userContexts.userId, userContexts.networkId],
          targetWhere: isNotNull(userContexts.networkId),
          set: setOnConflict,
        }))
      .returning({ id: userContexts.id });
    return { id: rows[0].id };
  }

  /**
   * Retrieve a single user context for a user+network pair. Pass `null` for the
   * user's global (profile-replacing) context row.
   */
  async getUserContext(userId: string, networkId: string | null) {
    return readUserContext(userId, networkId);
  }

  /**
   * Retrieve all user contexts for a given user.
   */
  async getUserContexts(userId: string) {
    const rows = await db.select()
      .from(userContexts)
      .where(eq(userContexts.userId, userId));
    return rows.map(r => ({
      id: r.id,
      networkId: r.networkId,
      text: r.text,
      embedding: r.embedding as unknown as number[],
      premiseHash: r.premiseHash ?? '',
      generatedAt: r.generatedAt,
    }));
  }

  /**
   * Cosine similarity search against intent embeddings using a user context embedding.
   * Restores the profile→intent cross-search deleted when Path B was removed.
   */
  async searchIntentsByContextEmbedding(params: {
    embedding: number[];
    networkIds: string[];
    excludeUserId: string;
    limit: number;
    minScore?: number;
  }) {
    return traceAppOperation(
      {
        name: 'vector search context intents',
        op: 'db.vector_search',
        attributes: {
          subsystem: 'database',
          'db.system': 'postgresql',
          'db.operation': 'vector_search',
          'search.strategy': 'context-to-intent',
          'search.index_scope_count': params.networkIds.length,
          'search.limit': params.limit,
        },
      },
      async () => {
    const { embedding, networkIds, excludeUserId, limit, minScore = 0.30 } = params;
    if (networkIds.length === 0) return [];
    const vectorStr = `[${embedding.join(',')}]`;

    const rows = await db.execute<{
      intentId: string;
      userId: string;
      networkId: string;
      payload: string;
      summary: string | null;
      similarity: number;
    }>(sql`
      SELECT
        i.id AS "intentId",
        i.user_id AS "userId",
        ine.network_id AS "networkId",
        i.payload,
        i.summary,
        1 - (i.embedding <=> ${vectorStr}::vector) AS similarity
      FROM ${schema.intents} i
      JOIN ${schema.intentNetworks} ine ON i.id = ine.intent_id
      JOIN ${schema.networkMembers} nm
        ON nm.user_id = i.user_id AND nm.network_id = ine.network_id
      JOIN ${schema.networks} n ON n.id = ine.network_id
      JOIN ${schema.users} u ON i.user_id = u.id
      WHERE ine.network_id = ANY(ARRAY[${sql.join(networkIds.map(id => sql`${id}`), sql`, `)}])
        AND i.user_id != ${excludeUserId}
        AND nm.deleted_at IS NULL
        AND n.deleted_at IS NULL
        AND (i.status = 'ACTIVE' OR i.status IS NULL)
        AND i.archived_at IS NULL
        AND i.embedding IS NOT NULL
        AND u.deleted_at IS NULL
        AND 1 - (i.embedding <=> ${vectorStr}::vector) >= ${minScore}
      ORDER BY i.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return rows as Array<{
      intentId: string;
      userId: string;
      networkId: string;
      payload: string;
      summary: string | null;
      similarity: number;
    }>;
      },
    );
  }

}

// ═══════════════════════════════════════════════════════════════════════════════
// Profile Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for Profile Graph.
 */
