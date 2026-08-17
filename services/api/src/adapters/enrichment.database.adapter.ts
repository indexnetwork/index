import type { DrizzleDB } from '../lib/drizzle/drizzle';

import { readUserContext, readPremisesForUser, schema, OnboardingState, UserIdentity, and, asc, buildProfileFromUser, buildProfileWithIdFromUser, db, detectSocialLabel, eq, isNull, normalizeTelegramSocialValue, not, persistProfileIdentityToUser, sql } from './database.shared';
import { HydeDatabaseAdapter } from './hyde.database.adapter';

export interface EnrichmentAdmissionContext {
  userExists: boolean;
  networkExists: boolean;
  membershipExists: boolean;
  hasActivePremise: boolean;
}

export class EnrichmentDatabaseAdapter {
  constructor(private readonly database: DrizzleDB = db) {}

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
    const result = await this.database.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const user = result[0];
    if (!user) return null;
    const socials = await this.getUserSocials(userId);
    return { ...user, socials };
  }

  /**
   * Reads needed to admit enrichment at worker execution time. Every job
   * requires a live user; network-scoped jobs additionally require a live
   * network and active membership. "Has been enriched?" keys on ACTIVE
   * premises — the source of truth — not a user_profiles row (WS10/IND-367).
   * @param userId - The user being enriched
   * @param networkId - Optional network scoping the enrichment job
   * @returns current user, scope, membership, and enrichment-state signals
   */
  async getEnrichmentAdmissionContext(
    userId: string,
    networkId?: string,
  ): Promise<EnrichmentAdmissionContext> {
    const userQuery = this.database
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    const premiseQuery = this.database
      .select({ id: schema.premises.id })
      .from(schema.premises)
      .where(and(eq(schema.premises.userId, userId), eq(schema.premises.status, 'ACTIVE')))
      .limit(1);
    const networkQuery = networkId
      ? this.database
        .select({ id: schema.networks.id })
        .from(schema.networks)
        .where(and(eq(schema.networks.id, networkId), isNull(schema.networks.deletedAt)))
        .limit(1)
      : Promise.resolve([]);
    const membershipQuery = networkId
      ? this.database
        .select({ userId: schema.networkMembers.userId })
        .from(schema.networkMembers)
        .where(and(
          eq(schema.networkMembers.userId, userId),
          eq(schema.networkMembers.networkId, networkId),
          isNull(schema.networkMembers.deletedAt),
        ))
        .limit(1)
      : Promise.resolve([]);

    const [[user], [network], [membership], [premise]] = await Promise.all([
      userQuery,
      networkQuery,
      membershipQuery,
      premiseQuery,
    ]);
    return {
      userExists: !!user,
      networkExists: networkId ? !!network : true,
      membershipExists: networkId ? !!membership : true,
      hasActivePremise: !!premise,
    };
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

    const result = await this.database.update(schema.users)
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
    const rows = await this.database.select()
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
    const rows = await this.database.select({
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
    await this.database.transaction(async (tx) => {
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
