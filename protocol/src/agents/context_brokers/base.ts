import db from '../../lib/db';
import { intents, intentStakes, type IntentStake, agents, intentIndexes } from '../../lib/schema';
import { eq, or, desc, like, sql, and, ne, isNull, inArray } from 'drizzle-orm';
import { getAccessibleIntents } from '../../lib/intent-access';
import { generateEmbedding } from '../../lib/embeddings';

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
   * Get all intents in the same indexes as the given intent (excluding the intent itself)
   * Can also accept specific indexIds to filter by
   */
  protected async getIntentsInSameIndexes(intentId: string, excludeCurrentUser: boolean = true, targetIndexIds?: string[]): Promise<any[]> {
    // Get the current intent to access userId if needed
    const currentIntent = await this.db.select()
      .from(intents)
      .where(eq(intents.id, intentId))
      .then(rows => rows[0]);

    if (!currentIntent) {
      return [];
    }

    // Use generic function to get accessible intents
    const result = await getAccessibleIntents(currentIntent.userId, {
      indexIds: targetIndexIds,
      includeOwnIntents: !excludeCurrentUser
    });

    // Filter out the current intent itself
    return result.intents.filter(intent => intent.id !== intentId);
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

  /**
   * Find semantically related intents using vector similarity search
   */
  protected async findSemanticallyRelatedIntents(currentIntent: any): Promise<any[]> {
    console.log('Finding semantically related intents for:', currentIntent.id);
    
    try {
      // Generate embedding for current intent if it doesn't have one
      let queryEmbedding: number[];
      if (currentIntent.embedding) {
        queryEmbedding = currentIntent.embedding;
      } else {
        console.log('Generating embedding for current intent');
        queryEmbedding = await generateEmbedding(currentIntent.payload);
      }

      // Use pgvector for semantic similarity search with IVFFlat index
      // Get top 10 most similar intents using cosine distance
      // Exclude intents from the same user to avoid stake validation errors
      const similarIntents = await this.db
        .select({
          id: intents.id,
          payload: intents.payload,
          summary: intents.summary,
          userId: intents.userId,
          createdAt: intents.createdAt,
          // Calculate cosine similarity (1 - cosine distance)
          similarity: sql<number>`1 - (${intents.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`
        })
        .from(intents)
        .where(
          sql`${intents.id} != ${currentIntent.id} 
              AND ${intents.userId} != ${currentIntent.userId}
              AND ${intents.embedding} IS NOT NULL
              AND ${intents.archivedAt} IS NULL`
        )
        .orderBy(sql`${intents.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
        .limit(10);

      console.log(`Found ${similarIntents.length} similar intents using vector search`);

      // Filter by similarity threshold (equivalent to 0.7 LLM score)
      const relatedIntents = similarIntents
        //.filter(intent => intent.similarity > 0.75) // Adjust threshold as needed
        .map(intent => ({
          intent: {
            id: intent.id,
            payload: intent.payload,
            summary: intent.summary,
            userId: intent.userId,
            createdAt: intent.createdAt
          },
          score: intent.similarity
        }));

      console.log('Related intents (vector similarity):', relatedIntents.length);
      return relatedIntents;

    } catch (error) {
      console.error('Error in vector similarity search:', error);
      
      // Fallback to original LLM-based approach if vector search fails
      console.log('Falling back to LLM-based semantic search');
      return []; // Return empty array as fallback
    }
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