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
      
      // Check if stake already exists for this exact set of intents
      const existingStake = await this.broker.db.select()
        .from(intentStakes)
        .where(sql`${intentStakes.intents} = ARRAY[${params.intents.map(id => `'${id}'`).join(',')}]`)
        .then(rows => rows[0]);

      if (!existingStake) {
        // Create new stake
        await this.broker.db.insert(intentStakes)
          .values(params);
      }
    }

    // Convenience method for creating stakes between two intents (backward compatibility)
    async createPairStake(params: {
      intentId1: string;
      intentId2: string;
      stake: bigint;
      reasoning: string;
      agentId: string;
    }): Promise<void> {
      await this.createStake({
        intents: [params.intentId1, params.intentId2],
        stake: params.stake,
        reasoning: params.reasoning,
        agentId: params.agentId
      });
    }
  })(this);

  /**
   * Abstract methods that must be implemented by concrete brokers
   */
  abstract onIntentCreated(intentId: string): Promise<void>;
  abstract onIntentUpdated(intentId: string, previousStatus?: string): Promise<void>;
  abstract onIntentArchived(intentId: string): Promise<void>;
} 