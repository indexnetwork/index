import { log } from '../lib/log';
import { detectSocialLabel } from '../adapters/database.shared';
import { userDatabaseAdapter, chatDatabaseAdapter } from '../adapters/database.adapter';
import type { User } from '../schemas/database.schema';

const logger = log.service.from("UserService");

function sameSurface(requested: string, label: string): boolean {
    const norm = (name: string) => (name === 'x' ? 'twitter' : name);
    return norm(requested) === norm(label);
}

/**
 * UserService
 *
 * Manages basic CRUD operations for User entities.
 * Uses UserDatabaseAdapter for all database operations.
 *
 * ROLE:
 * - Data access layer for the `users` table.
 * - Graph resolution: `findWithGraph` joins User + Profile + Settings.
 */
export class UserService {
  constructor(private db = userDatabaseAdapter) {}
    async findById(userId: string) {
        logger.verbose('Finding user by ID', { userId });
        return this.db.findById(userId);
    }

    /**
     * Find multiple users by IDs (public profile fields only, for batch API).
     */
    async findByIds(userIds: string[]) {
        if (userIds.length === 0) return [];
        return this.db.findByIds(userIds);
    }

    /** Of these users, the ones who have never signed in. */
    async findGhostIds(userIds: string[]) {
        return this.db.findGhostIds(userIds);
    }

    /**
     * Resolves a full User Graph.
     *
     * Identity (name/bio/location) is sourced from the `users` row itself; the
     * dropped `user_profiles` table is no longer joined.
     *
     * JOINS:
     * - `userNotificationSettings`
     *
     * @param userId - ID to find.
     * @returns User object merged with Settings, or null.
     */
    async findWithGraph(userId: string) {
        return this.db.findWithGraph(userId);
    }

    async update(userId: string, data: Partial<User>) {
        logger.verbose('Updating user', { userId, fields: Object.keys(data) });
        return this.db.update(userId, data);
    }

    /** Update an owned intent through the normal material-update chokepoint. */
    async updateIntentDescription(
        intentId: string,
        userId: string,
        description: string,
        expectedUpdatedAt: Date,
    ): Promise<'applied' | 'stale' | 'not_found'> {
        return chatDatabaseAdapter.updateIntentIfCurrent(intentId, userId, description, expectedUpdatedAt);
    }

    async getSocials(userId: string) {
        return this.db.getSocials(userId);
    }

    /** Stored social values on one surface (`x` and `twitter` are the same). */
    async socialValuesOnSurface(userId: string, surface: string): Promise<string[]> {
        const values = new Set<string>();
        for (const social of await this.db.getSocials(userId)) {
            const label = social.label.trim().toLowerCase();
            const value = social.value?.trim();
            if (!value) continue;
            if (sameSurface(surface, label) || sameSurface(surface, detectSocialLabel(value))) values.add(value);
        }
        return [...values];
    }

    async setSocials(userId: string, socials: { label: string; value: string }[]): Promise<void> {
        logger.verbose('Setting socials', { userId, count: socials.length });
        await this.db.setSocials(userId, socials);
    }

    async softDelete(userId: string) {
        logger.verbose('Soft deleting user', { userId });
        await this.db.deleteUserSessions(userId);
        await this.db.softDelete(userId);
        return true;
    }

    /**
     * Get user details for newsletter (including settings and onboarding)
     */
    async getUserForNewsletter(userId: string) {
        return this.db.getUserForNewsletter(userId);
    }

    /**
     * Get basic user info for multiple users (for partner lookup)
     */
    async getUsersBasicInfo(userIds: string[]) {
        return this.db.getUsersBasicInfo(userIds);
    }

    /**
     * Update the last time a weekly email was sent
     */
    async updateLastWeeklyEmailSent(userId: string) {
        await this.db.updateLastWeeklyEmailSent(userId);
    }

    /**
     * Find a user by UUID or key.
     * @param idOrKey - UUID or human-readable key
     * @returns User record or null
     */
    async findByIdOrKey(idOrKey: string) {
        logger.verbose('Finding user by ID or key', { idOrKey });
        return this.db.findByIdOrKey(idOrKey);
    }

    /**
     * Ensure notification settings exist for a user
     */
    async ensureNotificationSettings(userId: string) {
        return this.db.ensureNotificationSettings(userId);
    }

    /**
     * Update notification preferences for a user (upsert)
     */
    async updateNotificationPreferences(userId: string, preferences: Partial<import('../schemas/database.schema').NotificationPreferences>) {
        return this.db.updateNotificationPreferences(userId, preferences);
    }

    /**
     * Lists the devices a user is signed in on, as session metadata.
     * @param userId - The signed-in user
     * @returns One entry per live session, newest first
     */
    async listDevices(userId: string) {
        return this.db.listUserDevices(userId);
    }

    /**
     * Signs one device out by deleting its session.
     * @param userId - Owner of the session, scoping the delete
     * @param sessionId - The session to revoke
     * @returns Whether a session was revoked
     */
    async revokeDevice(userId: string, sessionId: string) {
        logger.verbose('Revoking device session', { userId, sessionId });
        return this.db.deleteUserSession(userId, sessionId);
    }

}

export const userService = new UserService();
