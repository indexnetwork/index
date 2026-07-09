/**
 * Introducer Discovery: proactive discovery of connector-flow opportunities
 * between a user's contacts.
 *
 * Selects top-N contacts from the user's personal network and runs scoped
 * HyDE discovery for each, creating latent introducer opportunities that
 * the user (as introducer) must approve before parties see them.
 */

import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('IntroducerDiscovery');

/** Maximum contacts to evaluate per maintenance cycle. */
export const MAX_CONTACTS_PER_CYCLE = 5;

/** Maximum candidate opportunities per contact. */
export const MAX_CANDIDATES_PER_CONTACT = 3;

/** Detection source value for introducer-discovered opportunities. */
export const INTRODUCER_DISCOVERY_SOURCE = 'introducer_discovery' as const;

/** A contact with their active intents, used for introducer discovery selection. */
export interface ContactWithIntents {
  userId: string;
  /** Most recent intent updatedAt timestamp (ISO string or null). */
  latestIntentAt: string | null;
  /** Number of active intents this contact has. */
  intentCount: number;
}

/** Database methods needed for introducer discovery contact selection. */
export interface IntroducerDiscoveryDatabase {
  /** Get the user's personal network ID. */
  getPersonalIndexId(userId: string): Promise<string | null>;
  /** Get contacts from a personal network with their intent freshness data. */
  getContactsWithIntentFreshness(
    personalIndexId: string,
    ownerId: string,
    limit: number,
  ): Promise<ContactWithIntents[]>;
}

/** Queue interface for enqueuing introducer discovery jobs. */
export interface IntroducerDiscoveryQueue {
  addJob(
    data: { intentId: string; userId: string; indexIds?: string[]; contactUserId?: string },
    options?: { priority?: number; jobId?: string },
  ): Promise<unknown>;
}

/** Result of a single introducer discovery cycle. */
export interface IntroducerDiscoveryResult {
  contactsEvaluated: number;
  jobsEnqueued: number;
  skippedReason?: string;
}

/**
 * Select top-N contacts for introducer discovery, sorted by intent freshness.
 * Contacts with no active intents are excluded.
 *
 * @param database - Database adapter with contact/intent queries
 * @param userId - The introducer user
 * @param limit - Max contacts to return (default MAX_CONTACTS_PER_CYCLE)
 * @returns Sorted contacts with intent data
 */
export async function selectContactsForDiscovery(
  database: IntroducerDiscoveryDatabase,
  userId: string,
  limit: number = MAX_CONTACTS_PER_CYCLE,
): Promise<ContactWithIntents[]> {
  const personalIndexId = await database.getPersonalIndexId(userId);
  if (!personalIndexId) {
    logger.verbose('No personal network found', { userId });
    return [];
  }

  const contacts = await database.getContactsWithIntentFreshness(
    personalIndexId,
    userId,
    limit,
  );

  logger.verbose('Selected contacts for discovery', { userId, totalContacts: contacts.length, limit });

  return contacts;
}

/**
 * Determine whether introducer discovery should run based on the current
 * connector-flow composition. Triggers when connector-flow count is below
 * the soft target.
 *
 * @param connectorFlowCount - Current number of connector-flow opportunities
 * @param connectorFlowTarget - Soft target (default 2)
 * @returns Whether introducer discovery should run
 */
export function shouldRunIntroducerDiscovery(
  connectorFlowCount: number,
  connectorFlowTarget: number = 2,
): boolean {
  return connectorFlowCount < connectorFlowTarget;
}

/**
 * Run introducer discovery for a user: select contacts, enqueue discovery jobs.
 * Each job uses onBehalfOfUserId so the opportunity graph treats the user as introducer.
 *
 * @param database - Database adapter for contact queries
 * @param queue - Queue for enqueuing discovery jobs
 * @param userId - The introducer user
 * @returns Summary of the discovery cycle
 */
export async function runIntroducerDiscovery(
  database: IntroducerDiscoveryDatabase,
  queue: IntroducerDiscoveryQueue,
  userId: string,
): Promise<IntroducerDiscoveryResult> {
  const personalIndexId = await database.getPersonalIndexId(userId);
  if (!personalIndexId) {
    return { contactsEvaluated: 0, jobsEnqueued: 0, skippedReason: 'no_personal_index' };
  }

  const contacts = await selectContactsForDiscovery(database, userId);
  if (contacts.length === 0) {
    return { contactsEvaluated: 0, jobsEnqueued: 0, skippedReason: 'no_contacts' };
  }

  const bucket = Math.floor(Date.now() / (12 * 60 * 60 * 1000)); // 12h dedup bucket

  const results = await Promise.allSettled(
    contacts.map(async (contact) => {
      // For each contact, we enqueue a discovery job using one of their intents
      // The opportunity graph will use onBehalfOfUserId to discover on behalf of the contact
      // while the userId (introducer) gets the introducer role
      const jobId = `introducer-discovery-${userId}-${contact.userId}-${bucket}`;
      try {
        await queue.addJob(
          {
            intentId: `introducer:${contact.userId}`,
            userId,
            indexIds: [personalIndexId],
            contactUserId: contact.userId,
          },
          { priority: 15, jobId }, // Lower priority than regular rediscovery (10)
        );
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/duplicate|already exists|job.*id/i.test(message)) {
          logger.verbose('Job skipped (duplicate)', { userId, contactUserId: contact.userId, error: message });
          return false;
        }
        throw err;
      }
    }),
  );

  for (const r of results) {
    if (r.status === 'rejected') {
      const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      logger.error('Job enqueue failed', { error: errMsg });
    }
  }
  const jobsEnqueued = results.filter((r) => r.status === 'fulfilled' && r.value).length;

  logger.info('Discovery cycle complete', { userId, contactsEvaluated: contacts.length, jobsEnqueued });

  return { contactsEvaluated: contacts.length, jobsEnqueued };
}
