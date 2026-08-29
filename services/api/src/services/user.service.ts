import { log } from '../lib/log';
import { userDatabaseAdapter, chatDatabaseAdapter } from '../adapters/database.adapter';
import type { User } from '../schemas/database.schema';
import { premiseCascade } from '../lib/premise/cascade';
import { background } from '../lib/background';

const logger = log.service.from("UserService");

/**
 * Injectable dependencies for `UserService.setSocials` cascade behavior.
 * All fields are optional; the class uses production singletons as defaults.
 * Inject mocks in tests.
 */
export interface UserServiceDeps {
  /** Query premise IDs by provenance source for a user. */
  getPremisesBySource?: (userId: string, source: string) => Promise<Array<{ id: string }>>;
  /** Retract a single premise (set status RETRACTED + retractedAt). Lifecycle events fire in the DB adapter. */
  retractPremise?: (premiseId: string) => Promise<void>;
}

/**
 * Order-insensitive identity of a stored social set.
 *
 * Only `label`/`value` carry meaning — row `id` is regenerated on every write
 * (the adapter deletes and re-inserts), so it must not take part in the
 * comparison. Field and entry separators are control characters that cannot
 * appear in a label or URL, so distinct sets cannot collide on the same key.
 */
function socialSetKey(socials: Array<{ label: string; value: string }>): string {
  return socials
    .map(s => `${s.label}\u0000${s.value}`)
    .sort()
    .join('\u0001');
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
        const result = await this.db.update(userId, data);
        if ('name' in data || 'intro' in data || 'location' in data) {
            this.enqueuePremisesFromProfile(userId);
        }
        return result;
    }

    private enqueuePremisesFromProfile(userId: string): void {
        background('premise', () => premiseCascade.decomposeProfile({ userId }));
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

    /** Retract an owned premise through the normal lifecycle update chokepoint. */
    async retractPremise(
        premiseId: string,
        userId: string,
        expectedUpdatedAt: Date,
    ): Promise<'applied' | 'alreadyDone' | 'stale' | 'not_found'> {
        return chatDatabaseAdapter.retractPremiseIfCurrent(premiseId, userId, expectedUpdatedAt);
    }

    async getSocials(userId: string) {
        return this.db.getSocials(userId);
    }

    /**
     * Persist the user's social links, rebuilding integration-derived premises
     * only when the stored set actually changed.
     *
     * The comparison reads stored rows either side of the write, so the
     * adapter's normalization (label detection, telegram handle rewriting,
     * dedup, trimming, dropping blanks) has already been applied to both sides.
     * That matters because the web and mac settings screens submit the full
     * socials array on every save: comparing the raw payload against stored
     * rows would read an untouched form as a change and retract the user's
     * whole integration premise base for nothing.
     */
    async setSocials(userId: string, socials: { label: string; value: string }[]): Promise<void> {
        logger.verbose('Setting socials', { userId, count: socials.length });

        const before = await this.db.getSocials(userId);
        await this.db.setSocials(userId, socials);
        const after = await this.db.getSocials(userId);

        if (socialSetKey(before) === socialSetKey(after)) {
            logger.verbose('Socials unchanged; keeping integration premises', { userId });
            return;
        }

        await this.rebuildIntegrationPremises(userId);
    }

    /**
     * Retract all `source='integration'` premises for a user whose social URLs
     * changed, then rebuild premises from the saved profile.
     *
     * Retraction and re-enrichment are a pair: retracting without re-enriching
     * leaves the user with no active premises at all, which silently strips
     * them out of discovery and cascades their live opportunities to `expired`.
     * Only call this when the social set genuinely changed.
     *
     * Retraction loop is synchronous — errors propagate to the caller.
     * Re-enrichment failure is logged and swallowed (best-effort).
     */
    private async rebuildIntegrationPremises(userId: string): Promise<void> {
        const getPremisesBySource =
            this.deps?.getPremisesBySource ??
            ((uid: string, src: string) => chatDatabaseAdapter.getPremisesBySource(uid, src));

        // Lifecycle events (cascade + context regen) fire inside the adapter's
        // updatePremise — no explicit emit needed here.
        const retractPremise =
            this.deps?.retractPremise ??
            (async (id: string) => { await chatDatabaseAdapter.updatePremise(id, { status: 'RETRACTED', retractedAt: new Date() }); });

        const toRetract = await getPremisesBySource(userId, 'integration');

        logger.verbose('Retracting integration premises before premise rebuild', {
            userId,
            count: toRetract.length,
        });

        for (const { id } of toRetract) {
            await retractPremise(id);
        }

        // Re-enrichment is fire-and-forget — failure is logged but does not propagate to caller.
        background('premise', () => premiseCascade.decomposeProfile({ userId }));
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
    async updateNotificationPreferences(userId: string, preferences: { connectionUpdates?: boolean }) {
        return this.db.updateNotificationPreferences(userId, preferences as import('../schemas/database.schema').NotificationPreferences);
    }

}

export const userService = new UserService();
