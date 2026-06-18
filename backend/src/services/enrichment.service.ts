import { log } from '../lib/log';
import { EnrichmentGraphFactory } from '@indexnetwork/protocol';
import type { EnrichmentGraphDatabase, Scraper } from '@indexnetwork/protocol';
import { EnrichmentDatabaseAdapter } from '../adapters/database.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';

const logger = log.service.from("EnrichmentService");

/**
 * EnrichmentService
 * 
 * Manages profile generation and synchronization.
 * Uses EnrichmentDatabaseAdapter for database operations.
 * Uses EnrichmentGraphFactory for graph-based profile generation.
 * 
 * RESPONSIBILITIES:
 * - Generate/sync user profiles through Enrichment Graph
 * - Coordinate profile and scraper operations
 */
export class EnrichmentService {
  private db: EnrichmentGraphDatabase;
  private scraper: Scraper;
  private factory: EnrichmentGraphFactory;

  constructor() {
    this.db = new EnrichmentDatabaseAdapter();
    this.scraper = new ScraperAdapter();
    this.factory = new EnrichmentGraphFactory(this.db, this.scraper);
  }

  /**
   * Sync/generate a profile for a user.
   * Invokes the enrichment graph to create or update the user's profile.
   * 
   * @param userId - The user ID
   * @returns Graph execution result with profile data, plus a flat `intro` field
   *   sourced from `users.intro` (the canonical identity bio home).
   */
  async syncProfile(userId: string): Promise<Record<string, unknown>> {
    logger.verbose('[EnrichmentService] Syncing profile', { userId });

    const graph = this.factory.createGraph();
    const result = await graph.invoke({ userId });

    // The enrichment graph persists the identity bio to `users.intro`. Surface it as a
    // flat field so callers (e.g. the frontend intro display) read the canonical
    // users-table value instead of the soon-to-be-removed `profile.identity.bio`.
    const user = await this.db.getUser(userId);
    return { ...result, intro: user?.intro ?? null };
  }

  /**
   * Embed profiles (and generate HyDE) for a list of tester users.
   * Used by db-seed to run enrichment graph write mode for each persona.
   *
   * @param personaUsers - List of user ids (same order as personas)
   * @param personas - List of persona names for logging (same length as personaUsers)
   * @returns Counts of successful embeddings and failures
   */
  async embedTesterProfiles(
    personaUsers: { id: string }[],
    personas: Array<{ name: string }>
  ): Promise<{ embedded: number; embedFailures: number }> {
    let embedded = 0;
    let embedFailures = 0;
    const graph = this.factory.createGraph();

    for (let i = 0; i < personaUsers.length && i < personas.length; i++) {
      const userId = personaUsers[i].id;
      const name = personas[i].name;
      try {
        const result = await graph.invoke({ userId, operationMode: 'write' });
        if (result.error) {
          embedFailures++;
          logger.warn('[EnrichmentService] Embed failed', { name, error: result.error });
        } else {
          embedded++;
        }
      } catch (err: unknown) {
        embedFailures++;
        logger.warn('[EnrichmentService] Embed error', {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { embedded, embedFailures };
  }
}

export const enrichmentService = new EnrichmentService();
