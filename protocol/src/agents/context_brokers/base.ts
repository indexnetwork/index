import db from '../../lib/db';
import { intents, intentStakes, type IntentStake, agents } from '../../lib/schema';
import { eq, or, desc, like, sql, and } from 'drizzle-orm';

export abstract class BaseContextBroker {
  protected db = db;

  constructor(public readonly agentId: string) {}

  /**
   * Get all other intent IDs from an array of stakes
   */
  protected getOtherIntentIdsFromStakes(stakes: IntentStake[], currentIntentId: string): string[] {
    const otherIds = new Set<string>();
    stakes.forEach(stake => {
      stake.intents.forEach(id => {
        if (id !== currentIntentId) {
          otherIds.add(id);
        }
      });
    });
    return Array.from(otherIds);
  }

  /**
   * Get stakes that include the specified intent IDs
   */
  protected async getStakesForIntents(intentIds: string[]): Promise<IntentStake[]> {
    if (intentIds.length === 0) return [];
    
    // For PostgreSQL array operations, we need to check if the array contains all the intent IDs
    const conditions = intentIds.map(id => sql`${intentStakes.intents} @> ARRAY[${id}]`);
    
    return this.db.select()
      .from(intentStakes)
      .where(and(...conditions));
  }

  /**
   * Get all stakes for a specific intent
   */
  protected async getStakesForIntent(intentId: string): Promise<IntentStake[]> {
    return this.db.select()
      .from(intentStakes)
      .where(sql`${intentStakes.intents} @> ARRAY[${intentId}]`);
  }

  /**
   * Get all related intents through stakes
   */
  protected async getRelatedIntents(intentId: string): Promise<{ id: string; payload: string }[]> {
    const stakes = await this.getStakesForIntent(intentId);
    const relatedIntentIds = this.getOtherIntentIdsFromStakes(stakes, intentId);

    if (relatedIntentIds.length === 0) {
      return [];
    }

    return this.db.select({
      id: intents.id,
      payload: intents.payload
    })
    .from(intents)
    .where(
      or(...relatedIntentIds.map(id => eq(intents.id, id)))
    );
  }

  protected readonly stakeManager = new (class {
    constructor(private broker: BaseContextBroker) {}

    async createStake(params: {
      intents: string[];
      stake: bigint;
      reasoning: string;
      agentId: string;
    }): Promise<void> {
      
      // Sort intents to ensure consistent ordering
      const sortedIntents = [...params.intents].sort();
      
      // Validate that intents have different owners (at least 2 different users)
      const intentOwners = await this.broker.db.select({
        id: intents.id,
        userId: intents.userId
      })
      .from(intents)
      .where(
        or(...sortedIntents.map(id => eq(intents.id, id)))
      );

      // Check if all intents exist
      if (intentOwners.length !== sortedIntents.length) {
        throw new Error('Some intents do not exist');
      }

      // Get unique user IDs
      const uniqueUserIds = new Set(intentOwners.map(intent => intent.userId));
      
      // Validate that there are at least 2 different users
      if (uniqueUserIds.size < 2) {
        throw new Error('Stakes must involve intents from at least 2 different users');
      }
      
      // Check if stake already exists for this exact set of intents
      const existingStake = await this.broker.db.select()
        .from(intentStakes)
        .where(sql`${intentStakes.intents} = ARRAY[${sortedIntents.map(id => `'${id}'`).join(',')}]`)
        .then(rows => rows[0]);

      if (!existingStake) {
        // Create new stake
        await this.broker.db.insert(intentStakes)
          .values({
            ...params,
            intents: sortedIntents
          });
      }
    }

  })(this);

  /**
   * Abstract methods that must be implemented by concrete brokers
   */
  abstract onIntentCreated(intentId: string): Promise<void>;
  abstract onIntentUpdated(intentId: string, previousStatus?: string): Promise<void>;
  abstract onIntentArchived(intentId: string): Promise<void>;
} 