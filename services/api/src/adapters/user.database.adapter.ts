import { BasicUserInfo, NewsletterUserData, NotificationPreferences, User, UserWithGraph, db, eq, inArray, sessions, userNotificationSettings, userSocials, users } from './database.shared';

import { EnrichmentDatabaseAdapter } from './enrichment.database.adapter';

export class UserDatabaseAdapter {
  /**
   * Find user by ID
   */
  async findById(userId: string): Promise<typeof users.$inferSelect | null> {
    const result = await db.select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Find multiple users by IDs. Returns public profile fields only (same shape as single-user API).
   */
  async findByIds(userIds: string[]): Promise<Array<{ id: string; name: string; intro: string | null; avatar: string | null; location: string | null; socials: Array<{ id: string; userId: string; label: string; value: string }>; createdAt: Date; updatedAt: Date }>> {
    if (userIds.length === 0) return [];
    const userRows = await db.select({
      id: users.id,
      name: users.name,
      intro: users.intro,
      avatar: users.avatar,
      location: users.location,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
      .from(users)
      .where(inArray(users.id, userIds));

    const socialRows = await db.select()
      .from(userSocials)
      .where(inArray(userSocials.userId, userIds));

    const socialsByUser = new Map<string, Array<{ id: string; userId: string; label: string; value: string }>>();
    for (const s of socialRows) {
      const arr = socialsByUser.get(s.userId) ?? [];
      arr.push({ id: s.id, userId: s.userId, label: s.label, value: s.value });
      socialsByUser.set(s.userId, arr);
    }

    return userRows.map(u => ({
      ...u,
      socials: socialsByUser.get(u.id) ?? [],
    }));
  }

  /**
   * Find user by email.
   */
  async findByEmail(email: string): Promise<typeof users.$inferSelect | null> {
    const result = await db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Create a domain user.
   */
  async create(data: {
    email: string;
    name?: string;
    intro?: string;
    location?: string;
  }): Promise<typeof users.$inferSelect> {
    const [row] = await db.insert(users)
      .values({
        email: data.email,
        name: data.name ?? data.email.split('@')[0],
        intro: data.intro ?? null,
        location: data.location ?? null,
      })
      .returning();
    if (!row) throw new Error('User insert did not return a row');
    return row;
  }

  /**
   * Delete user by ID (for test teardown). Does not delete related rows; call other adapters first if needed.
   */
  async deleteById(userId: string): Promise<void> {
    await db.delete(users).where(eq(users.id, userId));
  }

  /**
   * Delete user by email (for test teardown). Finds by email then deletes.
   */
  async deleteByEmail(email: string): Promise<void> {
    const u = await this.findByEmail(email);
    if (u) await this.deleteById(u.id);
  }

  /**
   * Find user by key (human-readable identifier).
   * @param key - The user's key
   * @returns User record or null
   */
  async findByKey(key: string): Promise<typeof users.$inferSelect | null> {
    const result = await db.select()
      .from(users)
      .where(eq(users.key, key))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Find user by ID or key. Detects UUID format to decide which column to query.
   * @param idOrKey - UUID or human-readable key
   * @returns User record or null
   */
  async findByIdOrKey(idOrKey: string): Promise<typeof users.$inferSelect | null> {
    const isUuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey);
    if (isUuidFormat) {
      return this.findById(idOrKey);
    }
    return this.findByKey(idOrKey);
  }

  /**
   * Find user with joined profile and notification settings
   */
  async findWithGraph(userId: string): Promise<UserWithGraph | null> {
    const userResult = await db.select({
      user: users,
      settings: userNotificationSettings,
    })
      .from(users)
      .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
      .where(eq(users.id, userId))
      .limit(1);

    if (userResult.length === 0) {
      return null;
    }

    const { user, settings } = userResult[0];

    const socialRows = await db.select()
      .from(userSocials)
      .where(eq(userSocials.userId, userId));

    const hasProfile = Boolean(user.intro?.trim() || user.name?.trim());

    return {
      ...user,
      socials: socialRows.map(s => ({ id: s.id, userId: s.userId, label: s.label, value: s.value })),
      hasProfile,
      notificationPreferences: settings?.preferences as {
        connectionUpdates: boolean;
      } || {
        connectionUpdates: true,
      }
    };
  }

  async getSocials(userId: string): Promise<Array<{ id: string; userId: string; label: string; value: string }>> {
    const rows = await db.select()
      .from(userSocials)
      .where(eq(userSocials.userId, userId));
    return rows.map(s => ({ id: s.id, userId: s.userId, label: s.label, value: s.value }));
  }

  async setSocials(userId: string, socials: { label: string; value: string }[]): Promise<void> {
    const profileAdapter = new EnrichmentDatabaseAdapter();
    return profileAdapter.setUserSocials(userId, socials);
  }

  /**
   * Update user
   */
  async update(userId: string, data: Partial<User>): Promise<typeof users.$inferSelect | null> {
    const { socials: _socials, ...rest } = data as Partial<User> & { socials?: unknown };
    const result = await db.update(users)
      .set({
        ...rest,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();

    return result[0] || null;
  }

  /**
   * Deletes all sessions for a user (used before soft-delete to invalidate auth).
   * @param userId - The user whose sessions should be removed
   */
  async deleteUserSessions(userId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  /**
   * Soft delete user
   */
  async softDelete(userId: string): Promise<void> {
    await db.update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /**
   * Get user details for newsletter
   */
  async getUserForNewsletter(userId: string): Promise<NewsletterUserData | null> {
    const userRes = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      intro: users.intro,
      timezone: users.timezone,
      lastSent: users.lastWeeklyEmailSentAt,
      prefs: userNotificationSettings.preferences,
      unsubscribeToken: userNotificationSettings.unsubscribeToken,
      onboarding: users.onboarding
    })
      .from(users)
      .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
      .where(eq(users.id, userId))
      .limit(1);

    return userRes[0] || null;
  }

  /**
   * Get basic info for multiple users
   */
  async getUsersBasicInfo(userIds: string[]): Promise<BasicUserInfo[]> {
    if (userIds.length === 0) return [];

    return db.select({
      id: users.id,
      name: users.name,
      intro: users.intro
    })
      .from(users)
      .where(inArray(users.id, userIds));
  }

  /**
   * Update last weekly email sent timestamp
   */
  async updateLastWeeklyEmailSent(userId: string): Promise<void> {
    await db.update(users)
      .set({ lastWeeklyEmailSentAt: new Date() })
      .where(eq(users.id, userId));
  }

  /**
   * Initialize default notification settings for a new user.
   * Idempotent - safe to call multiple times (does nothing if settings exist).
   */
  async setupDefaultNotificationSettings(userId: string): Promise<void> {
    await db.insert(userNotificationSettings)
      .values({
        userId,
        preferences: {
          connectionUpdates: true,
        }
      })
      .onConflictDoNothing();
  }

  /**
   * Ensure notification settings exist for a user
   */
  async ensureNotificationSettings(userId: string): Promise<{ unsubscribeToken: string | null }> {
    const [upsertedSettings] = await db.insert(userNotificationSettings)
      .values({
        userId,
        preferences: {
          connectionUpdates: true,
        }
      })
      .onConflictDoUpdate({
        target: userNotificationSettings.userId,
        set: {
          updatedAt: new Date()
        }
      })
      .returning({
        unsubscribeToken: userNotificationSettings.unsubscribeToken
      });

    return upsertedSettings;
  }

  /**
   * Upsert notification preferences for a user
   */
  async updateNotificationPreferences(userId: string, preferences: NotificationPreferences): Promise<void> {
    const existing = await db.select().from(userNotificationSettings).where(eq(userNotificationSettings.userId, userId)).limit(1);
    if (existing.length > 0) {
      await db.update(userNotificationSettings)
        .set({ preferences, updatedAt: new Date() })
        .where(eq(userNotificationSettings.userId, userId));
    } else {
      await db.insert(userNotificationSettings)
        .values({ userId, preferences });
    }
  }

}

// ═══════════════════════════════════════════════════════════════════════════════
// File Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

