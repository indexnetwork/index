import db from '../../lib/db';
import { intents, users, intentStakes, type IntentStake } from '../../lib/schema';
import { eq, and, or, desc, like, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export interface Intent {
  id: string;
  payload: string;
  userId: string;
  user?: {
    id: string;
    name: string;
    email: string | null;
  };
}

export abstract class BaseContextBroker {
  public name: string;
  protected db: typeof db;

  constructor(name: string) {
    this.name = name;
    this.db = db;
  }

  /**
   * Create a properly ordered pair string for staking
   * Ensures consistent ordering of intent pairs
   */
  protected createOrderedPair(intentId1: string, intentId2: string): string {
    return [intentId1, intentId2].sort().join('-');
  }

  /**
   * Get the other intent ID from a stake pair
   */
  protected getOtherIntentFromPair(pair: string, currentIntentId: string): string {
    const [id1, id2] = pair.split('-');
    return id1 === currentIntentId ? id2 : id1;
  }

  /**
   * Get all other intent IDs from an array of stakes
   */
  protected getOtherIntentIdsFromStakes(stakes: IntentStake[], currentIntentId: string): string[] {
    return stakes.map(stake => this.getOtherIntentFromPair(stake.pair, currentIntentId));
  }

  /**
   * Get stakes for a specific intent pair
   */
  protected async getStakesForPair(intentId1: string, intentId2: string): Promise<IntentStake[]> {
    const pair = this.createOrderedPair(intentId1, intentId2);
    return this.db.select()
      .from(intentStakes)
      .where(eq(intentStakes.pair, pair))
      .orderBy(desc(intentStakes.createdAt));
  }

  /**
   * Get all stakes for a specific intent
   */
  protected async getStakesForIntent(intentId: string): Promise<IntentStake[]> {
    return this.db.select()
      .from(intentStakes)
      .where(
        or(
          like(intentStakes.pair, `${intentId}-%`),
          like(intentStakes.pair, `%-${intentId}`)
        )
      )
      .orderBy(desc(intentStakes.createdAt));
  }

  /**
   * Get all related intents through stakes
   */
  protected async getRelatedIntents(intentId: string): Promise<{ id: string; payload: string }[]> {
    const stakes = await this.getStakesForIntent(intentId);
    const relatedIntentIds = this.getOtherIntentIdsFromStakes(stakes, intentId);

    if (relatedIntentIds.length === 0) return [];

    return this.db.select({
      id: intents.id,
      payload: intents.payload
    })
    .from(intents)
    .where(
      or(...relatedIntentIds.map(id => eq(intents.id, id)))
    );
  }

  /**
   * Abstract methods that must be implemented by concrete brokers
   */
  abstract onIntentCreated(intentId: string): Promise<void>;
  abstract onIntentUpdated(intentId: string, previousStatus?: string): Promise<void>;
  abstract onIntentArchived(intentId: string): Promise<void>;
} 