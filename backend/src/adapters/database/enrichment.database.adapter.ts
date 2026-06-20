import { readUserContext, readPremisesForUser, schema, OnboardingState, UserIdentity, and, asc, buildProfileFromUser, buildProfileWithIdFromUser, db, detectSocialLabel, eq, isNull, normalizeTelegramSocialValue, not, persistProfileIdentityToUser, sql } from './_shared';

import { HydeDatabaseAdapter } from './hyde.database.adapter';

export class EnrichmentDatabaseAdapter {
  /**
   * Retrieve a single user_context row (global when networkId is null), or null.
   * Mirrors {@link ChatDatabaseAdapter.getUserContext} for the profile graph.
   */
  async getUserContext(userId: string, networkId: string | null) {
    return readUserContext(userId, networkId);
  }

  async getProfile(userId: string): Promise<UserIdentity | null> {
    return buildProfileFromUser(userId);
  }

  async saveProfile(userId: string, profile: UserIdentity): Promise<void> {
    await persistProfileIdentityToUser(userId, profile);
  }

  async getUser(userId: string) {
    const result = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const user = result[0];
    if (!user) return null;
    const socials = await this.getUserSocials(userId);
    return { ...user, socials };
  }

  /**
   * Update user account fields (name, intro, location).
   */
  async updateUser(
    userId: string,
    data: { name?: string; intro?: string; location?: string; onboarding?: OnboardingState }
  ): Promise<{ id: string; name: string; email: string; intro?: string | null; avatar?: string | null; location?: string | null; socials: Array<{ id: string; userId: string; label: string; value: string }>; onboarding?: OnboardingState | null } | null> {
    const current = await this.getUser(userId);
    if (!current) return null;

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };

    if (data.name !== undefined) updateFields.name = data.name;
    if (data.intro !== undefined) updateFields.intro = data.intro;
    if (data.location !== undefined) updateFields.location = data.location;

    if (data.onboarding !== undefined) {
      const existingOnboarding = current.onboarding ?? {};
      updateFields.onboarding = { ...existingOnboarding, ...data.onboarding };
    }

    const result = await db.update(schema.users)
      .set(updateFields)
      .where(eq(schema.users.id, userId))
      .returning();

    const updated = result[0];
    if (!updated) return null;
    const socials = await this.getUserSocials(userId);
    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      intro: updated.intro,
      avatar: updated.avatar,
      location: updated.location,
      socials,
      onboarding: (updated as { onboarding?: unknown }).onboarding as OnboardingState | null,
    };
  }

  async getUserSocials(userId: string): Promise<Array<{ id: string; userId: string; label: string; value: string }>> {
    const rows = await db.select()
      .from(schema.userSocials)
      .where(eq(schema.userSocials.userId, userId))
      .orderBy(asc(schema.userSocials.createdAt), asc(schema.userSocials.id));
    return rows.map(r => ({ id: r.id, userId: r.userId, label: r.label, value: r.value }));
  }

  /**
   * Finds telegram socials owned by any user whose stored value resolves to the
   * given bare handle. Used by MCP identity verification to detect whether a
   * telegram handle is already owned by another user. Each stored value is
   * normalized in SQL to its bare handle before comparison — a leading `@` or
   * `t.me`/`telegram.me` URL prefix is stripped and everything from the first
   * `/`, `?`, or `#` is dropped — so handles stored as `@h`, `https://t.me/h`,
   * `https://t.me/h/`, or `https://t.me/h?start=x` all match, which a fixed
   * candidate list would miss.
   * @param handle - Bare telegram handle (no `@`, no URL), already extracted by the caller.
   * @returns Matching telegram social rows with their owning userId.
   */
  async findTelegramHandleOwners(handle: string): Promise<Array<{ userId: string; label: string; value: string }>> {
    const normalized = handle.trim().toLowerCase();
    if (!normalized) return [];
    const rows = await db.select({
      userId: schema.userSocials.userId,
      label: schema.userSocials.label,
      value: schema.userSocials.value,
    })
      .from(schema.userSocials)
      .where(and(
        eq(schema.userSocials.label, 'telegram'),
        eq(
          sql<string>`lower((regexp_split_to_array(regexp_replace(${schema.userSocials.value}, '^(@|(https?://)?(t\\.me|telegram\\.me)/)', '', 'i'), '[/?#]'))[1])`,
          normalized,
        ),
      ));
    return rows.map(r => ({ userId: r.userId, label: r.label, value: r.value }));
  }

  async setUserSocials(userId: string, socials: { label: string; value: string }[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(schema.userSocials).where(eq(schema.userSocials.userId, userId));
      if (socials.length > 0) {
        const classified = socials
          .filter(s => s.value.trim() !== '')
          .map(s => {
            const value = s.value.trim();
            const detected = detectSocialLabel(value);
            const label = detected === 'custom' ? s.label : detected;
            if (label.trim().toLowerCase() === 'telegram') {
              const telegramHandle = normalizeTelegramSocialValue(value);
              return telegramHandle ? { userId, label: 'telegram', value: telegramHandle } : null;
            }
            return { userId, label, value };
          })
          .filter((s): s is { userId: string; label: string; value: string } => s !== null);

        // Dedup: for non-custom labels the unique index allows only one row per label.
        // Keep the first occurrence (explicit field) and drop later duplicates.
        const seen = new Set<string>();
        const deduped = classified.filter(s => {
          if (s.label === 'custom') return true;
          if (seen.has(s.label)) return false;
          seen.add(s.label);
          return true;
        });

        if (deduped.length > 0) {
          await tx.insert(schema.userSocials).values(deduped);
        }
      }
    });
  }

  /**
   * No-op since WS8 (IND-365) dropped user_profiles. Retained for interface/test stability.
   */
  async deleteProfile(_userId: string): Promise<void> {
    return;
  }

  /**
   * Get full profile row by userId (for test assertions).
   */
  async getProfileRow(userId: string): Promise<{
    identity: { name: string; bio: string; location: string };
    context: string;
  } | null> {
    const profile = await buildProfileFromUser(userId);
    if (!profile) return null;
    return { identity: profile.identity, context: profile.context };
  }

  async getProfileByUserId(userId: string): Promise<(UserIdentity & { id: string }) | null> {
    return buildProfileWithIdFromUser(userId);
  }

  private hydeAdapter = new HydeDatabaseAdapter();

  async getHydeDocument(
    sourceType: 'intent' | 'query',
    sourceId: string,
    strategy: string
  ) {
    return this.hydeAdapter.getHydeDocument(sourceType, sourceId, strategy);
  }

  async saveHydeDocument(data: {
    sourceType: 'intent' | 'query';
    sourceId?: string | null;
    sourceText?: string | null;
    strategy: string;
    targetCorpus: string;
    hydeText: string;
    hydeEmbedding: number[];
    context?: Record<string, unknown> | null;
    expiresAt?: Date | null;
  }) {
    return this.hydeAdapter.saveHydeDocument(data);
  }

  /**
   * Soft-delete a ghost user and all their contact memberships.
   * Used when enrichment detects the entity is not human.
   * @param userId - The ghost user to soft-delete
   * @returns true if the user was soft-deleted
   */
  async softDeleteGhost(userId: string): Promise<boolean> {
    const [user] = await db.select({ id: schema.users.id, isGhost: schema.users.isGhost })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!user || !user.isGhost) return false;

    await db.update(schema.networkMembers)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(schema.networkMembers.userId, userId),
        sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        isNull(schema.networkMembers.deletedAt),
      ));

    await db.update(schema.users)
      .set({ deletedAt: new Date() })
      .where(eq(schema.users.id, userId));

    return true;
  }

  /**
   * Find an existing user that shares any of the given social handles with the specified ghost.
   * Case-insensitive exact match on linkedin, github, and x handles.
   * Excludes the ghost itself and soft-deleted users.
   * Prefers real users over ghosts; among ghosts, picks the oldest by created_at.
   * @param userId - The ghost user ID to exclude from results
   * @param socials - Social handles to match against
   * @returns The matching user's ID, or null if no match found
   */
  async findDuplicateUser(
    userId: string,
    socials: Array<{ id: string; userId: string; label: string; value: string }>,
  ): Promise<{ id: string } | null> {
    const handles = socials
      .filter(s => ['linkedin', 'github', 'twitter', 'telegram'].includes(s.label))
      .map(s => ({ label: s.label, value: s.value.toLowerCase() }));

    if (handles.length === 0) return null;

    const conditions = handles.map(
      (h) => sql`(LOWER(${schema.userSocials.value}) = ${h.value} AND ${schema.userSocials.label} = ${h.label})`,
    );

    const results = await db
      .selectDistinct({ id: schema.userSocials.userId, isGhost: schema.users.isGhost, createdAt: schema.users.createdAt })
      .from(schema.userSocials)
      .innerJoin(schema.users, eq(schema.userSocials.userId, schema.users.id))
      .where(
        and(
          sql`(${sql.join(conditions, sql` OR `)})`,
          not(eq(schema.userSocials.userId, userId)),
          isNull(schema.users.deletedAt),
        ),
      )
      .orderBy(asc(schema.users.isGhost), asc(schema.users.createdAt))
      .limit(1);

    return results[0] ? { id: results[0].id } : null;
  }

  /**
   * Merge a ghost user (source) into a target user.
   * Re-points all FK references, deletes ghost-only records, and soft-deletes the source.
   * Runs entirely within a single database transaction.
   * @param sourceId - The ghost user to merge away
   * @param targetId - The target user to absorb the ghost's data
   */
  async mergeGhostUser(sourceId: string, targetId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Guard: only active ghost users may be merged away
      const [source] = await tx
        .select({ isGhost: schema.users.isGhost })
        .from(schema.users)
        .where(and(eq(schema.users.id, sourceId), isNull(schema.users.deletedAt)))
        .limit(1);
      if (!source?.isGhost) {
        throw new Error(`mergeGhostUser: sourceId ${sourceId} is not an active ghost user`);
      }

      // ── 1. Delete ghost-only records (unique constraints prevent re-pointing) ──

      await tx.delete(schema.userNotificationSettings).where(eq(schema.userNotificationSettings.userId, sourceId));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, sourceId));
      await tx.delete(schema.accounts).where(eq(schema.accounts.userId, sourceId));
      await tx.delete(schema.apikeys).where(eq(schema.apikeys.userId, sourceId));
      await tx.delete(schema.agentPermissions).where(eq(schema.agentPermissions.userId, sourceId));
      await tx.delete(schema.agents).where(eq(schema.agents.ownerId, sourceId));

      // ── 2. Re-point simple FK references ──

      await tx.update(schema.intents)
        .set({ userId: targetId })
        .where(eq(schema.intents.userId, sourceId));

      await tx.update(schema.files)
        .set({ userId: targetId })
        .where(eq(schema.files.userId, sourceId));

      await tx.update(schema.links)
        .set({ userId: targetId })
        .where(eq(schema.links.userId, sourceId));

      // ── 3. Re-point network_members (composite PK: skip if target already member) ──

      const ghostMemberships = await tx.select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .where(and(eq(schema.networkMembers.userId, sourceId), isNull(schema.networkMembers.deletedAt)));

      const targetMemberships = await tx.select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .where(and(eq(schema.networkMembers.userId, targetId), isNull(schema.networkMembers.deletedAt)));
      const targetNetworkIds = new Set(targetMemberships.map(m => m.networkId));

      for (const gm of ghostMemberships) {
        if (targetNetworkIds.has(gm.networkId)) {
          // Target already in this network — soft-delete ghost's membership
          await tx.update(schema.networkMembers)
            .set({ deletedAt: new Date() })
            .where(and(
              eq(schema.networkMembers.networkId, gm.networkId),
              eq(schema.networkMembers.userId, sourceId),
            ));
        } else {
          // Re-point ghost's membership to target
          await tx.update(schema.networkMembers)
            .set({ userId: targetId })
            .where(and(
              eq(schema.networkMembers.networkId, gm.networkId),
              eq(schema.networkMembers.userId, sourceId),
            ));
        }
      }

      // ── 4. Re-point opportunity_deliveries (conditional unique: skip conflicts) ──

      const ghostDeliveries = await tx.select({
        id: schema.opportunityDeliveries.id,
        opportunityId: schema.opportunityDeliveries.opportunityId,
        channel: schema.opportunityDeliveries.channel,
        deliveredAtStatus: schema.opportunityDeliveries.deliveredAtStatus,
        deliveredAt: schema.opportunityDeliveries.deliveredAt,
      })
        .from(schema.opportunityDeliveries)
        .where(eq(schema.opportunityDeliveries.userId, sourceId));

      const targetDeliveries = await tx.select({
        opportunityId: schema.opportunityDeliveries.opportunityId,
        channel: schema.opportunityDeliveries.channel,
        deliveredAtStatus: schema.opportunityDeliveries.deliveredAtStatus,
      })
        .from(schema.opportunityDeliveries)
        .where(and(
          eq(schema.opportunityDeliveries.userId, targetId),
          sql`${schema.opportunityDeliveries.deliveredAt} IS NOT NULL`,
        ));

      const targetDeliveryKeys = new Set(
        targetDeliveries.map(d => `${d.opportunityId}:${d.channel}:${d.deliveredAtStatus}`),
      );

      for (const gd of ghostDeliveries) {
        const wouldConflict = gd.deliveredAt !== null &&
          targetDeliveryKeys.has(`${gd.opportunityId}:${gd.channel}:${gd.deliveredAtStatus}`);
        if (wouldConflict) {
          await tx.delete(schema.opportunityDeliveries).where(eq(schema.opportunityDeliveries.id, gd.id));
        } else {
          await tx.update(schema.opportunityDeliveries)
            .set({ userId: targetId })
            .where(eq(schema.opportunityDeliveries.id, gd.id));
        }
      }

      // ── 5. Re-point conversation_participants (composite PK: skip if target already in conversation) ──

      await tx.execute(sql`
        UPDATE conversation_participants
        SET participant_id = ${targetId}
        WHERE participant_id = ${sourceId}
          AND participant_type = 'user'
          AND conversation_id NOT IN (
            SELECT conversation_id FROM conversation_participants WHERE participant_id = ${targetId}
          )
      `);
      // Delete remaining ghost participants (where target already in conversation)
      await tx.execute(sql`
        DELETE FROM conversation_participants
        WHERE participant_id = ${sourceId} AND participant_type = 'user'
      `);

      // ── 6. Re-point messages ──

      await tx.execute(sql`
        UPDATE messages SET sender_id = ${targetId}
        WHERE sender_id = ${sourceId} AND role = 'user'
      `);

      // ── 7. Re-point opportunity actors JSONB ──

      const affectedOpps = await tx.execute(sql`
        SELECT id, actors, detection FROM opportunities
        WHERE actors::text LIKE ${'%' + sourceId + '%'}
           OR detection::text LIKE ${'%' + sourceId + '%'}
      `) as unknown as { id: string; actors: unknown; detection: unknown }[];

      for (const row of affectedOpps) {
        const actors = (Array.isArray(row.actors) ? row.actors : []) as { userId: string; [k: string]: unknown }[];
        const updatedActors = actors.map(a =>
          a.userId === sourceId ? { ...a, userId: targetId } : a,
        );

        const detection = (row.detection ?? {}) as { createdBy?: string; [k: string]: unknown };
        const updatedDetection = detection.createdBy === sourceId
          ? { ...detection, createdBy: targetId }
          : detection;

        await tx.execute(sql`
          UPDATE opportunities
          SET actors = ${JSON.stringify(updatedActors)}::jsonb,
              detection = ${JSON.stringify(updatedDetection)}::jsonb
          WHERE id = ${row.id}
        `);
      }

      // ── 8. Soft-delete the ghost user ──

      await tx.update(schema.users)
        .set({ deletedAt: new Date() })
        .where(eq(schema.users.id, sourceId));
    });
  }

  /**
   * Retrieve premises for a user, optionally filtered by status.
   * Used by the profile graph in `aggregate` mode to synthesize profile from active premises.
   * @param userId - The user whose premises to retrieve
   * @param status - Optional status filter (`ACTIVE`, `RETRACTED`, or `EXPIRED`)
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
    return readPremisesForUser(userId, status);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Opportunity Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/** Opportunity row shape (matches protocol Opportunity; confidence as string from numeric). */
