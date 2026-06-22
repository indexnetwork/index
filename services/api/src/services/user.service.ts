import { log } from '../lib/log';
import { userDatabaseAdapter, chatDatabaseAdapter } from '../adapters/database.adapter';
import type { User } from '../schemas/database.schema';
import { validateKey } from '../lib/keys';
import { PremiseEvents } from '../events/premise.event';
import { enrichmentQueue } from '../queues/enrichment.queue';

const logger = log.service.from("UserService");

/**
 * Injectable dependencies for `UserService.setSocials` cascade behavior.
 * All fields are optional; the class uses production singletons as defaults.
 * Inject mocks in tests.
 */
export interface UserServiceDeps {
  /** Query premise IDs by provenance source for a user. */
  getPremisesBySource?: (userId: string, source: string) => Promise<Array<{ id: string }>>;
  /** Retract a single premise (set status RETRACTED + retractedAt). */
  retractPremise?: (premiseId: string) => Promise<void>;
  /** Emit the onRetracted lifecycle event for a premise. */
  emitPremiseRetracted?: (premiseId: string, userId: string) => void;
  /** Enqueue an enrichment job to rebuild premises from updated socials. */
  enqueueEnrichment?: (userId: string) => Promise<void>;
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
  constructor(
    private db = userDatabaseAdapter,
    private readonly deps?: UserServiceDeps,
  ) {}
    async findById(userId: string) {
        logger.verbose('[UserService] Finding user by ID', { userId });
        return this.db.findById(userId);
    }

    /**
     * Find multiple users by IDs (public profile fields only, for batch API).
     */
    async findByIds(userIds: string[]) {
        if (userIds.length === 0) return [];
        return this.db.findByIds(userIds);
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
        logger.verbose('[UserService] Updating user', { userId, fields: Object.keys(data) });
        return this.db.update(userId, data);
    }

    async getSocials(userId: string) {
        return this.db.getSocials(userId);
    }

    async setSocials(userId: string, socials: { label: string; value: string }[]): Promise<void> {
        logger.verbose('[UserService] Setting socials', { userId, count: socials.length });
        await this.db.setSocials(userId, socials);
        await this.retractIntegrationPremises(userId);
    }

    /**
     * Retract all `source='integration'` premises for a user after their social URLs
     * change, then fire-and-forget a re-enrichment job to rebuild from the new social set.
     *
     * Retraction loop is synchronous — errors propagate to the caller.
     * Re-enrichment failure is logged and swallowed (best-effort).
     */
    private async retractIntegrationPremises(userId: string): Promise<void> {
        const getPremisesBySource =
            this.deps?.getPremisesBySource ??
            ((uid: string, src: string) => chatDatabaseAdapter.getPremisesBySource(uid, src));

        const retractPremise =
            this.deps?.retractPremise ??
            (async (id: string) => { await chatDatabaseAdapter.updatePremise(id, { status: 'RETRACTED', retractedAt: new Date() }); });

        const emitPremiseRetracted =
            this.deps?.emitPremiseRetracted ??
            ((id: string, uid: string) => PremiseEvents.onRetracted(id, uid));

        const enqueueEnrichment =
            this.deps?.enqueueEnrichment ??
            (async (uid: string) => { await enrichmentQueue.addEnrichUserJob({ userId: uid, reason: 'socials_updated' }); });

        const toRetract = await getPremisesBySource(userId, 'integration');

        logger.verbose('[UserService] Retracting integration premises before re-enrich', {
            userId,
            count: toRetract.length,
        });

        for (const { id } of toRetract) {
            await retractPremise(id);
            emitPremiseRetracted(id, userId);
        }

        // Re-enrichment is fire-and-forget — failure is logged but does not propagate to caller.
        enqueueEnrichment(userId).catch(err =>
            logger.error('[UserService] Failed to enqueue re-enrichment after social update', {
                userId,
                error: err,
            }),
        );
    }

    async softDelete(userId: string) {
        logger.verbose('[UserService] Soft deleting user', { userId });
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
        logger.verbose('[UserService] Finding user by ID or key', { idOrKey });
        return this.db.findByIdOrKey(idOrKey);
    }

    /**
     * Update the authenticated user's key.
     * @param userId - The user ID
     * @param key - The new key value
     * @returns Updated user or error object
     */
    async updateKey(userId: string, key: string): Promise<{ user: User } | { error: string; status: number }> {
        const validation = validateKey(key);
        if (!validation.valid) {
            return { error: validation.error!, status: 400 };
        }

        const existing = await this.db.keyExists(key);
        if (existing) {
            return { error: 'Key is already taken', status: 409 };
        }

        const updated = await this.db.updateKey(userId, key);
        if (!updated) {
            return { error: 'User not found', status: 404 };
        }

        return { user: updated };
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
    async updateNotificationPreferences(userId: string, preferences: { connectionUpdates?: boolean; weeklyNewsletter?: boolean }) {
        return this.db.updateNotificationPreferences(userId, preferences as import('../schemas/database.schema').NotificationPreferences);
    }

}

export const userService = new UserService();
