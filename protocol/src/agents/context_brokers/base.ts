import db from '../../lib/db';
import { intents, intentStakes, type IntentStake, agents } from '../../lib/schema';
import { eq, or, desc, like } from 'drizzle-orm';

export abstract class BaseContextBroker {
  protected db = db;

  constructor(public readonly agentId: string) {}

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
      .where(eq(intentStakes.pair, pair));
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
      );
  }

  /**
   * Get all related intents through stakes
   */
  protected async getRelatedIntents(intentId: string): Promise<{ id: string; payload: string }[]> {
    const stakes = await this.getStakesForIntent(intentId);
    const relatedIntentIds = stakes.map(stake => {
      const [id1, id2] = stake.pair.split('-');
      return id1 === intentId ? id2 : id1;
    });

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
      pair: string;
      stake: bigint;
      reasoning: string;
      agentId: string;
    }): Promise<void> {
      // Check if stake already exists
      const existingStake = await this.broker.db.select()
        .from(intentStakes)
        .where(eq(intentStakes.pair, params.pair))
        .then(rows => rows[0]);

      if (!existingStake) {
        // Create new stake
        await this.broker.db.insert(intentStakes)
          .values({
            pair: params.pair,
            stake: params.stake,
            reasoning: params.reasoning,
            agentId: params.agentId
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