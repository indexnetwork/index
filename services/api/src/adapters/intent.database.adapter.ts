import { readUserContext, schema, ActiveIntentRow, ArchiveResultShape, CreateIntentInput, CreatedIntentRow, IntentListRow, UpdateIntentInput, UserIdentity, activeOwnIntentsWhere, and, buildProfileFromUser, count, db, desc, eq, inArray, isNull, logger, ne, ownIntentsListWhere, sql } from './database.shared';


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

      const [updated] = await db.update(schema.intents)
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
      return updated ?? null;
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.updateIntent error', { error: error instanceof Error ? error.message : String(error) });
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
            isNull(schema.intents.archivedAt)
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
  }): Promise<{ rows: IntentListRow[]; total: number }> {
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
      })
        .from(schema.intents)
        .where(where)
        .orderBy(desc(schema.intents.createdAt))
        .offset(offset)
        .limit(options.limit),
      db.select({ count: count() }).from(schema.intents).where(where),
    ]);

    const withExtras = await this.attachIntentExtras(rows, userId);
    return { rows: withExtras, total: Number(totalResult[0]?.count ?? 0) };
  }

  /**
   * Enrich a page of intent list rows with their registered networks plus the
   * per-intent counts the UI surfaces (pending questions, waiting
   * opportunities). Runs three grouped queries in parallel and joins in memory,
   * so it stays O(1) round-trips regardless of page size.
   *
   * @param rows - The paginated base intent rows to enrich.
   * @param userId - Owner, used to scope the waiting-opportunity actor match.
   * @returns The same rows, each with `networks`, `pendingQuestionCount`, and
   *   `waitingOpportunityCount` populated (empty/zero when none).
   */
  private async attachIntentExtras(
    rows: Omit<IntentListRow, 'networks' | 'pendingQuestionCount' | 'waitingOpportunityCount'>[],
    userId: string,
  ): Promise<IntentListRow[]> {
    if (rows.length === 0) return [];
    const intentIds = rows.map(r => r.id);
    const [networks, counts] = await Promise.all([
      this.networksByIntent(intentIds),
      this.countsByIntent(intentIds, userId),
    ]);
    return rows.map(r => ({
      ...r,
      networks: networks.get(r.id) ?? [],
      pendingQuestionCount: counts.get(r.id)?.questions ?? 0,
      waitingOpportunityCount: counts.get(r.id)?.opportunities ?? 0,
    }));
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
   * Per-intent counts of pending intent-scoped questions and `pending`
   * opportunities awaiting the user. Two grouped jsonb queries; every requested
   * intent id is present in the returned map (zero when it has none).
   */
  private async countsByIntent(
    intentIds: string[],
    userId: string,
  ): Promise<Map<string, { questions: number; opportunities: number }>> {
    const map = new Map<string, { questions: number; opportunities: number }>();
    if (intentIds.length === 0) return map;
    for (const id of intentIds) map.set(id, { questions: 0, opportunities: 0 });
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
        SELECT actor->>'intent' AS intent_id, COUNT(DISTINCT ${schema.opportunities.id})::int AS cnt
        FROM ${schema.opportunities}, jsonb_array_elements(${schema.opportunities.actors}) AS actor
        WHERE actor->>'userId' = ${userId}
          AND actor->>'intent' IN (${idList})
          AND ${schema.opportunities.status} = 'pending'
        GROUP BY actor->>'intent'
      `) as unknown as Array<{ intent_id: string; cnt: number }>,
    ]);

    for (const r of questionRows) {
      const entry = map.get(r.intent_id);
      if (entry) entry.questions = Number(r.cnt);
    }
    for (const r of oppRows) {
      const entry = map.get(r.intent_id);
      if (entry) entry.opportunities = Number(r.cnt);
    }
    return map;
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
    })
      .from(schema.intents)
      .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, userId)))
      .limit(1);

    if (!row[0]) return null;
    const [withExtras] = await this.attachIntentExtras(row, userId);
    return withExtras;
  }

  /**
   * Resolve an intent ID from a full UUID or short prefix.
   * @param idOrPrefix - Full UUID or prefix (e.g. first 8 chars)
   * @param userId - The owning user's ID (for ownership scoping)
   * @returns Object with resolved id, or null/ambiguous status
   */
  async resolveIntentId(idOrPrefix: string, userId: string): Promise<{ id: string } | { ambiguous: true } | null> {
    const normalized = idOrPrefix.trim().toLowerCase();
    const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized);
    if (isFullUuid) {
      return { id: normalized };
    }
    const rows = await db.select({ id: schema.intents.id })
      .from(schema.intents)
      .where(and(
        sql`${schema.intents.id} LIKE ${normalized + '%'}`,
        eq(schema.intents.userId, userId),
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

  // --- Profile check (required by IntentGraphDatabase for prepNode gate) ---

  async getProfile(userId: string): Promise<UserIdentity | null> {
    return buildProfileFromUser(userId);
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
      isGhost: user.isGhost ?? false,
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
          isNull(schema.intents.archivedAt)
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
