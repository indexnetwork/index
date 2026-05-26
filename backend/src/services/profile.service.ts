import { log } from '../lib/log';
import { ProfileGraphFactory } from '@indexnetwork/protocol';
import type { ProfileGraphDatabase, Scraper } from '@indexnetwork/protocol';
import { ProfileDatabaseAdapter } from '../adapters/database.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';

const logger = log.service.from("ProfileService");

/**
 * ProfileService
 * 
 * Manages profile generation and synchronization.
 * Uses ProfileDatabaseAdapter for database operations.
 * Uses ProfileGraphFactory for graph-based profile generation.
 * 
 * RESPONSIBILITIES:
 * - Generate/sync user profiles through Profile Graph
 * - Coordinate profile and scraper operations
 */
export class ProfileService {
  private db: ProfileGraphDatabase;
  private scraper: Scraper;
  private factory: ProfileGraphFactory;

  constructor() {
    this.db = new ProfileDatabaseAdapter();
    this.scraper = new ScraperAdapter();
    this.factory = new ProfileGraphFactory(this.db, this.scraper);
  }

  /**
   * Sync/generate a profile for a user.
   * Invokes the profile graph to create or update the user's profile.
   * 
   * @param userId - The user ID
   * @returns Graph execution result with profile data
   */
  async syncProfile(userId: string): Promise<Record<string, unknown>> {
    logger.verbose('[ProfileService] Syncing profile', { userId });

    const graph = this.factory.createGraph();
    const result = await graph.invoke({ userId });

    return result;
  }

  /**
   * Embed profiles (and generate HyDE) for a list of tester users.
   * Used by db-seed to run profile graph write mode for each persona.
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
          logger.warn('[ProfileService] Embed failed', { name, error: result.error });
        } else {
          embedded++;
        }
      } catch (err: unknown) {
        embedFailures++;
        logger.warn('[ProfileService] Embed error', {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { embedded, embedFailures };
  }
}

export const profileService = new ProfileService();
