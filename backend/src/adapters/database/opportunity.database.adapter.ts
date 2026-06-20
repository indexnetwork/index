import { schema, CreateOpportunityInput, OpportunityRow, UserIdentity, and, buildProfileFromUser, db, desc, eq, inArray, isNotNull, isNull, lte, ne, normalizeEmbedding, notInArray, opportunities, sql, toOpportunityRow, traceAppOperation } from './_shared';

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
        expiresAt: data.expiresAt ?? null,
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
      })
      .returning();
    if (!row) throw new Error('OpportunityDatabaseAdapter.createOpportunity: no row returned');
    return toOpportunityRow(row);
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
    options?: { status?: string; statuses?: string[]; networkId?: string; role?: string; limit?: number; offset?: number; conversationId?: string }
  ): Promise<OpportunityRow[]> {
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
    const [row] = await db
      .update(opportunities)
      .set(updates)
      .where(eq(opportunities.id, id))
      .returning();
    return row ? toOpportunityRow(row) : null;
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

  async stampOpportunityActorAction(
    id: string,
    actorUserId: string,
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
  ): Promise<OpportunityRow | null> {
    if (status === 'accepted' && !acceptedBy) {
      throw new Error('acceptedBy is required when status is accepted');
    }
    return db.transaction(async (tx) => {
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
    });
  }

  async createOpportunityAndExpireIds(
    data: CreateOpportunityInput,
    expireIds: string[]
  ): Promise<{ created: OpportunityRow; expired: OpportunityRow[] }> {
    return traceAppOperation(
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
    const { embedding, networkIds, excludeUserId, limit } = params;
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
      WHERE pn.network_id = ANY(ARRAY[${sql.join(networkIds.map(id => sql`${id}`), sql`, `)}]::text[])
        AND p.user_id != ${excludeUserId}
        AND p.status = 'ACTIVE'
        AND p.embedding IS NOT NULL
        AND p.deleted_at IS NULL
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
            WHERE pn.network_id = ANY(ARRAY[${sql.join(params.networkIds.map(id => sql`${id}`), sql`, `)}]::text[])
              AND p.user_id != ${params.excludeUserId}
              AND p.status = 'ACTIVE'
              AND p.embedding IS NOT NULL
              AND p.deleted_at IS NULL
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
// Index Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for Index Graph (intent/index context and assignment).
 */
