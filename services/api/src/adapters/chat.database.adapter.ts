import { upsertIntentNetworkAssignment, schema, ActiveIntentRow, ArchiveResultShape, CreateIntentInput, CreateOpportunityInput, CreatedIntentRow, HydeDocumentRow, Id, NetworkMembershipRow, OnboardingState, OpportunityRow, SaveHydeDocumentInput, UpdateIntentInput, UserIdentity, activeIntentLifecycleWhere, activeOwnIntentsWhere, and, buildProfileFromUser, buildProfileWithIdFromUser, count, db, desc, eq, ilike, inArray, intentNetworks, intents, isNull, logger, networkMembers, networks, notInArray, or, persistProfileIdentityToUser, sql, traceAppOperation, users } from './database.shared';

import { EnrichmentDatabaseAdapter } from './enrichment.database.adapter';
import { IntentDatabaseAdapter } from './intent.database.adapter';
import { negotiationDatabaseAdapter, type NegotiationDatabaseAdapter } from './negotiation.database.adapter';
import { IntentEvents } from '../events/intent.event';
import { canApplyExpectedIntentUpdate, computeIntentFingerprint } from '../lib/intent/intent.fingerprint';
import { toPublicNetworkPermissions } from '../lib/network-permissions';
import { OpportunityDatabaseAdapter } from './opportunity.database.adapter';
import { HydeDatabaseAdapter } from './hyde.database.adapter';
import { ConversationDatabaseAdapter } from './conversation.database.adapter';
import { _convDb } from './conversation.database.adapter';

export interface NetworkShareResponseRow {
  id: string;
  title: string;
  prompt: string | null;
  imageUrl: string | null;
  permissions: unknown;
  createdAt: Date;
  updatedAt: Date;
  ownerId: string;
  userName: string;
  userAvatar: string | null;
}

/** Map a share-code lookup row to its public invitation response contract. */
export function buildNetworkShareResponse(row: NetworkShareResponseRow, memberCount: number) {
  const permissions = toPublicNetworkPermissions(row.permissions);
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    imageUrl: row.imageUrl,
    joinPolicy: permissions.joinPolicy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: { id: row.ownerId, name: row.userName, avatar: row.userAvatar },
    _count: { members: memberCount },
  };
}

export class ChatDatabaseAdapter {
  private readonly hydeAdapter = new HydeDatabaseAdapter();
  private readonly intentAdapter = new IntentDatabaseAdapter();
  private _opportunityAdapter: OpportunityDatabaseAdapter | null = null;
  private get opportunityAdapter(): OpportunityDatabaseAdapter {
    if (!this._opportunityAdapter) this._opportunityAdapter = new OpportunityDatabaseAdapter();
    return this._opportunityAdapter;
  }

  /** The turn log behind an opportunity — the protocol's NegotiationContextDatabase. */
  async readNegotiationContext(opportunityId: string, viewerUserId: string) {
    return negotiationDatabaseAdapter.readNegotiationContext(opportunityId, viewerUserId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Chat Graph Methods (Profiles, Intents, Networks)
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

  async getIntentsInNetworkForMember(userId: string, networkNameOrId: string): Promise<ActiveIntentRow[]> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let networkId: string | null;

    if (uuidRegex.test(networkNameOrId.trim())) {
      const membership = await db
        .select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            eq(schema.networkMembers.networkId, networkNameOrId.trim()),
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
      const needle = networkNameOrId.trim().toLowerCase();
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
      logger.error('ChatDatabaseAdapter.getIntentsInNetworkForMember error', { error: error instanceof Error ? error.message : String(error) });
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

  async setUserSocials(userId: string, socials: { label: string; value: string }[]) {
    const profileAdapter = new EnrichmentDatabaseAdapter();
    return profileAdapter.setUserSocials(userId, socials);
  }

  async saveProfile(userId: string, profile: UserIdentity): Promise<void> {
    await persistProfileIdentityToUser(userId, profile);
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
          networkPrompt: schema.networks.prompt,
          permissions: schema.networkMembers.permissions,
          memberPrompt: schema.networkMembers.prompt,
          autoAssign: schema.networkMembers.autoAssign,
          joinedAt: schema.networkMembers.createdAt,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            isNull(schema.networkMembers.deletedAt),
            isNull(schema.networks.deletedAt),
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
          networkPrompt: schema.networks.prompt,
          permissions: schema.networkMembers.permissions,
          memberPrompt: schema.networkMembers.prompt,
          autoAssign: schema.networkMembers.autoAssign,
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
    metadata?: Record<string, unknown> | null;
    permissions?: Record<string, unknown> | null;
  } | null> {
    const rows = await db
      .select({
        id: schema.networks.id,
        title: schema.networks.title,
        prompt: schema.networks.prompt,
        metadata: schema.networks.metadata,
        permissions: schema.networks.permissions,
      })
      .from(schema.networks)
      .where(and(eq(schema.networks.id, networkId), isNull(schema.networks.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ...row, permissions: { ...toPublicNetworkPermissions(row.permissions) } };
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
    // Caller's memberships — keep permissions so each network can carry the
    // viewer's role (owner vs member). Inferring ownership from `user.id`
    // (a single owner row) mislabels co-owned / multi-owner networks.
    const memberships = await db
      .select({
        networkId: schema.networkMembers.networkId,
        permissions: schema.networkMembers.permissions,
      })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
      .where(
        and(
          eq(schema.networkMembers.userId, userId),
          isNull(schema.networks.deletedAt),
          sql`${schema.networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`
        )
      );

    const membershipByNetworkId = new Map<string, string[]>();
    for (const row of memberships) {
      if (!membershipByNetworkId.has(row.networkId)) {
        membershipByNetworkId.set(row.networkId, row.permissions ?? []);
      }
    }
    const ids = [...membershipByNetworkId.keys()];
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
        ownerId: ownerMembers.userId,
        createdAt: schema.networks.createdAt,
        updatedAt: schema.networks.updatedAt,
        ownerName: schema.users.name,
        ownerAvatar: schema.users.avatar,
        metadata: schema.networks.metadata,
      })
      .from(schema.networks)
      .leftJoin(ownerMembers, eq(schema.networks.id, ownerMembers.networkId))
      .leftJoin(schema.users, eq(ownerMembers.userId, schema.users.id))
      .where(
        and(
          isNull(schema.networks.deletedAt),
          inArray(schema.networks.id, ids),
        )
      )
      .orderBy(desc(schema.networks.createdAt));

    // Deduplicate: ownerMembers join can produce multiple rows per network
    // when a network has multiple owners. Keep the first encounter only.
    const uniqueRows = [...new Map(rows.map(r => [r.id, r])).values()];

    const networksWithCounts = await Promise.all(
      uniqueRows.map(async (row) => {
        const [memberCount] = await db
          .select({ count: count() })
          .from(schema.networkMembers)
          .where(and(eq(schema.networkMembers.networkId, row.id), isNull(schema.networkMembers.deletedAt)));
        const viewerPermissions = membershipByNetworkId.get(row.id) ?? [];
        const role: 'owner' | 'member' =
          viewerPermissions.includes('owner') || viewerPermissions.includes('admin')
            ? 'owner'
            : 'member';
        return {
          id: row.id,
          title: row.title,
          key: row.key,
          prompt: row.prompt,
          imageUrl: row.imageUrl,
          metadata: (row.metadata ?? {}) as Record<string, unknown>,
          permissions: toPublicNetworkPermissions(row.permissions),
          role,
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

    const totalCount = networksWithCounts.length;
    return {
      networks: networksWithCounts,
      pagination: {
        current: 1,
        total: totalCount > 0 ? 1 : 0,
        count: totalCount,
        totalCount,
      },
    };
  }

  /** Get networks that both users share membership in. */
  async getSharedNetworks(currentUserId: string, targetUserId: string): Promise<{ id: string; title: string; _count: { members: number } }[]> {
    const currentUserNetworkIds = db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .where(eq(schema.networkMembers.userId, currentUserId));

    const targetUserNetworkIds = db
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
          inArray(schema.networks.id, currentUserNetworkIds),
          inArray(schema.networks.id, targetUserNetworkIds),
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
  async getPublicNetworksNotJoined(userId: string) {
    const userNetworkIds = await db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .where(eq(schema.networkMembers.userId, userId));

    const excludeIds = userNetworkIds.map(r => r.networkId);

    const whereConditions = [
      isNull(schema.networks.deletedAt),
      // Unapproved network requests are inert rows, never discoverable.
      isNull(schema.networks.requestStatus),
    ];

    if (excludeIds.length > 0) {
      whereConditions.push(notInArray(schema.networks.id, excludeIds));
    }

    const publicNetworks = await db
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
    for (const row of publicNetworks) {
      const permissions = toPublicNetworkPermissions(row.permissions);
      if (permissions.joinPolicy !== 'anyone') continue;

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
        permissions,
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

  async getUserNetworkIds(userId: string): Promise<string[]> {
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
      logger.error('ChatDatabaseAdapter.getUserNetworkIds error', { error: error instanceof Error ? error.message : String(error) });
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
        networkPrompt: networks.prompt,
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

  async getAssignmentNetworkMembershipsForUser(userId: string): Promise<Array<{ networkId: string }>> {
    try {
      const result = await db
        .select({
          networkId: schema.networkMembers.networkId,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            isNull(schema.networkMembers.deletedAt),
            isNull(schema.networks.deletedAt),
          )
        );
      return result.map((r) => ({ networkId: r.networkId }));
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
        networkPrompt: networks.prompt,
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

  async isIntentAssignedToNetwork(intentId: string, networkId: string): Promise<boolean> {
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

  // The Intent Graph's archive/transition/confirm actions reach these through
  // this composite adapter when compiled for chat/MCP tools; delegate straight
  // to IntentDatabaseAdapter, the single implementation of each.
  deleteIntentNetworkAssociations(intentId: string): ReturnType<IntentDatabaseAdapter['deleteIntentNetworkAssociations']> {
    return this.intentAdapter.deleteIntentNetworkAssociations(intentId);
  }

  expireOpportunitiesByIntentActor(intentId: string): ReturnType<IntentDatabaseAdapter['expireOpportunitiesByIntentActor']> {
    return this.intentAdapter.expireOpportunitiesByIntentActor(intentId);
  }

  transitionIntentLifecycle(
    input: Parameters<IntentDatabaseAdapter['transitionIntentLifecycle']>[0],
  ): ReturnType<IntentDatabaseAdapter['transitionIntentLifecycle']> {
    return this.intentAdapter.transitionIntentLifecycle(input);
  }

  compensateFailedResume(
    input: Parameters<IntentDatabaseAdapter['compensateFailedResume']>[0],
  ): ReturnType<IntentDatabaseAdapter['compensateFailedResume']> {
    return this.intentAdapter.compensateFailedResume(input);
  }

  async getIntentNetworkScores(intentId: string): Promise<Array<{
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

  async unassignIntentFromNetwork(intentId: string, networkId: string): Promise<void> {
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

  async getOwnedNetworks(userId: string) {
    const ownerRows = await db
      .select({
        networkId: networkMembers.networkId,
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
        const perms = toPublicNetworkPermissions(row.permissions);
        const memberCount = Number(memberCountResult[0]?.count ?? 0);
        return {
          id: row.networkId,
          title: row.title,
          prompt: row.prompt,
          imageUrl: row.imageUrl,
          permissions: perms,
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

  async isNetworkOwner(networkId: string, userId: string): Promise<boolean> {
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
    const isOwner = await this.isNetworkOwner(networkId, requestingUserId);
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
      permissions: m.permissions ?? [],
      memberPrompt: m.memberPrompt,
      autoAssign: m.autoAssign,
      joinedAt: m.joinedAt,
      intentCount: intentCountMap.get(m.userId) ?? 0,
    }));
  }

  async getMembersFromUserNetworks(userId: Id<'users'>): Promise<{ userId: Id<'users'>; name: string; avatar: string | null }[]> {
    // Networks the user is a member of (non-deleted)
    const myNetworkRows = await db
      .select({ networkId: networkMembers.networkId })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(
        and(eq(networkMembers.userId, userId), isNull(networks.deletedAt))
      );
    const myNetworkIds = myNetworkRows.map((r) => r.networkId);
    if (myNetworkIds.length === 0) return [];

    // All members from those networks, joined with users; dedupe by userId
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
          inArray(networkMembers.networkId, myNetworkIds),
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
    const isOwner = await this.isNetworkOwner(networkId, requestingUserId);
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

  async getActiveIntentsAcrossNetworks(userId: string, networkIds: string[]) {
    try {
      if (networkIds.length === 0) return [];

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
            inArray(intentNetworks.networkId, networkIds),
          ),
        )
        .orderBy(intents.id, desc(intents.createdAt));

      return rows;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getActiveIntentsAcrossNetworks error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async updateNetworkSettings(
    networkId: string,
    requestingUserId: string,
    data: { title?: string; prompt?: string | null; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; metadata?: Record<string, unknown>; contextInjection?: { discovery: boolean } }
  ) {
    const isOwner = await this.isNetworkOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this network');
    }

    const [existing] = await db.select().from(networks).where(eq(networks.id, networkId)).limit(1);
    if (!existing) {
      throw new Error('Network not found');
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) updateData.title = data.title;
    if (data.prompt !== undefined) updateData.prompt = data.prompt;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.joinPolicy !== undefined) {
      const currentPerms = (existing.permissions as schema.NetworkPermissionsState | null) ?? {
        joinPolicy: 'invite_only',
        invitationLink: null,
      };
      updateData.permissions = {
        ...currentPerms,
        joinPolicy: data.joinPolicy ?? currentPerms.joinPolicy ?? 'invite_only',
        invitationLink: currentPerms.invitationLink ?? { code: crypto.randomUUID() },
      };
    }
    if (data.metadata !== undefined) updateData.metadata = data.metadata;
    if (data.contextInjection !== undefined) {
      const currentPerms = (existing.permissions as unknown as Record<string, unknown> | null) ?? {};
      updateData.permissions = {
        ...currentPerms,
        ...((updateData.permissions as Record<string, unknown>) ?? {}),
        contextInjection: data.contextInjection,
      };
    }

    await db.update(networks).set(updateData).where(eq(networks.id, networkId));

    return this.loadNetworkSettingsDTO(networkId);
  }

  /**
   * Re-select a network after a settings/permissions mutation and map it to the
   * canonical settings DTO (owner info, permissions, member/intent counts).
   * Shared by {@link updateNetworkSettings} and {@link regenerateInvitationLink}.
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
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
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
      throw new Error('Network not found after update');
    }
    const [memberCountResult, intentCountResult] = await Promise.all([
      db.select({ count: count() }).from(networkMembers).where(and(eq(networkMembers.networkId, networkId), isNull(networkMembers.deletedAt))),
      db.select({ count: count() }).from(intentNetworks).where(eq(intentNetworks.networkId, networkId)),
    ]);
    const permissions = toPublicNetworkPermissions(updatedRow.permissions);
    const memberCount = Number(memberCountResult[0]?.count ?? 0);
    return {
      id: updatedRow.id,
      title: updatedRow.title,
      prompt: updatedRow.prompt,
      imageUrl: updatedRow.imageUrl,
      metadata: (updatedRow.metadata ?? {}) as Record<string, unknown>,
      permissions,
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
    const isOwner = await this.isNetworkOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this network');
    }

    const [existing] = await db.select().from(networks).where(eq(networks.id, networkId)).limit(1);
    if (!existing) {
      throw new Error('Network not found');
    }

    const currentPerms = (existing.permissions as schema.NetworkPermissionsState | null) ?? {
      joinPolicy: 'invite_only',
      invitationLink: null,
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

  async getProfileByUserId(userId: string): Promise<(UserIdentity & { id: string }) | null> {
    return buildProfileWithIdFromUser(userId);
  }

  /**
   * Find a network by its key (human-readable identifier).
   * @param key - The network's key
   * @returns Network record or null
   */
  async getNetworkByKey(key: string) {
    const rows = await db.select()
      .from(networks)
      .where(and(eq(networks.key, key), isNull(networks.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createNetwork(data: {
    title: string;
    prompt?: string | null;
    imageUrl?: string | null;
    joinPolicy?: 'anyone' | 'invite_only';
    metadata?: Record<string, unknown>;
  }): Promise<{
    id: string;
    title: string;
    prompt: string | null;
    imageUrl: string | null;
    permissions: schema.NetworkPermissionsState;
    metadata: Record<string, unknown>;
  }> {
    const finalJoinPolicy = data.joinPolicy ?? 'invite_only';
    const permissions: schema.NetworkPermissionsState = {
      joinPolicy: finalJoinPolicy,
      invitationLink: { code: crypto.randomUUID() },
    };
    const [row] = await db
      .insert(networks)
      .values({
        title: data.title,
        prompt: data.prompt ?? null,
        imageUrl: data.imageUrl ?? null,
        permissions,
        metadata: data.metadata ?? {},
      })
      .returning({
        id: networks.id,
        title: networks.title,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        metadata: networks.metadata,
      });
    if (!row) throw new Error('Failed to create network');
    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      imageUrl: row.imageUrl,
      permissions: toPublicNetworkPermissions(row.permissions),
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
    const [networkRow] = await db.select({ prompt: networks.prompt }).from(networks).where(eq(networks.id, networkId)).limit(1);
    if (networkRow) memberPrompt = networkRow.prompt;

    const finalPermissions = role === 'owner' ? ['owner'] : ['member'];
    const result = await db.insert(networkMembers).values({
      networkId,
      userId,
      permissions: finalPermissions,
      prompt: memberPrompt,
      autoAssign: true,
    }).onConflictDoNothing({ target: [networkMembers.networkId, networkMembers.userId] }).returning();

    return { success: true, alreadyMember: result.length === 0 };
  }

  async removeMemberFromNetwork(
    networkId: string,
    userId: string
  ): Promise<{ success: boolean; wasOwner?: boolean; notMember?: boolean }> {
    // Check if user is the owner - owners cannot be removed
    const isOwner = await this.isNetworkOwner(networkId, userId);
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
  async resolveNetworkId(idOrKey: string): Promise<string | null> {
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
  // Network Detail & Member Management (with access control)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a single network with owner info and member count.
   * Checks that the requesting user is a member; throws "Access denied" if not.
   */
  async getPublicNetworkDetail(networkId: string) {
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
      permissions: toPublicNetworkPermissions(row.permissions),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: { id: row.ownerId, name: row.userName, avatar: row.userAvatar },
      _count: { members: memberCount },
    };
  }

  /**
   * Get a network by its invitation link code (public access, no auth required).
   * @param code - The invitation link code from the URL
   * @returns The network with owner info, member count, and joinPolicy, or null if not found
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
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const memberCount = await this.getNetworkMemberCount(row.id);
    return buildNetworkShareResponse(row, memberCount);
  }

  /**
   * Accept an invitation to join a network using the invitation code.
   * @param code - The invitation link code
   * @param userId - The authenticated user accepting the invitation
   * @returns The network, membership details, and alreadyMember flag
   * @throws Error if the code is invalid or the network is not found
   */
  async acceptNetworkInvitation(code: string, userId: string) {
    const network = await this.getNetworkByShareCode(code);
    if (!network) {
      throw new Error('Invalid or expired invitation link');
    }

    const result = await this.addMemberToNetwork(network.id, userId, 'member');

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
      .where(and(eq(networkMembers.networkId, network.id), eq(networkMembers.userId, userId)))
      .limit(1);

    return {
      network,
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
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
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
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      permissions: toPublicNetworkPermissions(row.permissions),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: { id: row.ownerId, name: row.userName, avatar: row.userAvatar },
      _count: { members: memberCount },
    };
  }

  /**
   * Add a member to a network. Owner-only.
   * Throws "Access denied" if the requesting user is not an owner.
   */
  async addMemberForOwner(
    networkId: string,
    userId: string,
    requestingUserId: string,
    role: 'owner' | 'member' = 'member'
  ) {
    const isOwner = await this.isNetworkOwner(networkId, requestingUserId);
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
   * Cannot demote the last owner.
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
    const isOwner = await this.isNetworkOwner(networkId, requestingUserId);
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
   * Remove a member from a network. Owner-only.
   * Checks isNetworkOwner internally; throws "Access denied" if not owner.
   * Prevents self-removal. Throws "Member not found" if member doesn't exist.
   */
  async removeMemberForOwner(networkId: string, memberUserId: string, requestingUserId: string) {
    const isOwner = await this.isNetworkOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this network');
    }

    if (memberUserId === requestingUserId) {
      throw new Error('Cannot remove yourself from the network');
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
    const [network] = await db
      .select({ permissions: networks.permissions, deletedAt: networks.deletedAt })
      .from(networks)
      .where(eq(networks.id, networkId))
      .limit(1);

    if (!network || network.deletedAt) {
      throw new Error('Network not found');
    }

    const perms = (network.permissions as { joinPolicy?: string } | null);
    if (perms?.joinPolicy !== 'anyone') {
      throw new Error('This network is not public');
    }

    return await this.addMemberToNetwork(networkId, userId, 'member');
  }

  /**
   * Leave a network. Members (non-owners) can leave.
   * Owners cannot leave their own network.
   */
  async leaveNetwork(networkId: string, userId: string) {
    const isOwner = await this.isNetworkOwner(networkId, userId);
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
   * Checks isNetworkOwner internally; throws "Access denied" if not owner.
   */
  async deleteNetworkForOwner(networkId: string, requestingUserId: string) {
    const isOwner = await this.isNetworkOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this network');
    }

    await this.softDeleteNetwork(networkId);
  }

  // Discovery counterparties (delegate to NegotiationDatabaseAdapter)
  async openCounterparties(
    pairs: Parameters<NegotiationDatabaseAdapter['openCounterparties']>[0],
  ) {
    return negotiationDatabaseAdapter.openCounterparties(pairs);
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
  ): ReturnType<OpportunityDatabaseAdapter['persistIntentScopedOpportunityIfNetworkEligible']> {
    return this.opportunityAdapter.persistIntentScopedOpportunityIfNetworkEligible(
      data,
      expireIds,
      eligibility,
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
  async getOpportunityStatusesForIntentActor(userId: string, intentId: string): Promise<OpportunityRow['status'][]> {
    return this.opportunityAdapter.getOpportunityStatusesForIntentActor(userId, intentId);
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
  async getOpportunitiesForNetwork(
    networkId: string,
    options?: { status?: string; statuses?: string[]; actorUserId?: string; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getOpportunitiesForNetwork(networkId, options);
  }
  async updateOpportunityStatus(
    id: string,
    status: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
    outbox?: Parameters<OpportunityDatabaseAdapter['updateOpportunityStatus']>[3],
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.updateOpportunityStatus(id, status, acceptedBy, outbox);
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
    status: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired',
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
  async updateOpportunityMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await this.opportunityAdapter.updateOpportunityMetadata(id, metadata);
  }
  async stampOpportunityActorAction(
    id: string,
    actorUserId: string,
    status: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired',
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
   * Find a user by email (case-insensitive).
   * @param email - The email to search for
   * @returns User record or null
   */
  async getUserByEmail(email: string): Promise<{ id: string; name: string; email: string } | null> {
    const normalized = email.toLowerCase().trim();
    const [row] = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
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
  async getUsersByEmails(emails: string[]): Promise<Array<{ id: string; name: string; email: string }>> {
    if (emails.length === 0) return [];
    const rows = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(and(inArray(schema.users.email, emails), isNull(schema.users.deletedAt)));
    return rows;
  }



  /**
   * Bulk-add users as members to a specific network.
   * Skips users that are already members (onConflictDoNothing).
   * @param networkId - The target network
   * @param userIds - User IDs to add as members
   */
  async addMembersBulkToNetwork(networkId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;

    let memberPrompt: string | null = null;
    const [networkRow] = await db.select({ prompt: schema.networks.prompt }).from(schema.networks).where(eq(schema.networks.id, networkId)).limit(1);
    if (networkRow) memberPrompt = networkRow.prompt;

    const values = userIds.map(userId => ({
      networkId,
      userId,
      permissions: ['member'],
      prompt: memberPrompt,
      autoAssign: false,
    }));
    await db.insert(schema.networkMembers).values(values).onConflictDoNothing();
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

  /** Atomically update an owned intent only when the caller's snapshot is current. */
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



  async getUserContext(userId: string, _networkId: string | null) {
    const profile = await buildProfileFromUser(userId);
    if (!profile) return null;
    const text = [profile.identity.bio, profile.identity.name, profile.identity.location]
      .map((s) => s?.trim()).filter(Boolean).join(' ');
    if (!text) return null;
    return { id: userId, text, embedding: [] as number[], generatedAt: new Date() };
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
          'search.strategy': 'context-embedding',
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
