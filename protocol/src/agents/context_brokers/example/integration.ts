import { BaseContextBroker } from '../base';
import { intents, users, intentStakes, indexes, intentIndexes, agents } from '../../../lib/schema';
import { eq, and, or, desc, like, sql, ne } from 'drizzle-orm';
import { llm } from "../../../lib/agents";
export class ExampleContextBroker extends BaseContextBroker {
  constructor() {
    super('example');
  }

  async onIntentCreated(intentId: string): Promise<void> {
    // Example: Get intent with user details
    const intent = await this.db.select({
      id: intents.id,
      payload: intents.payload,
      userId: intents.userId,
      user: {
        id: users.id,
        name: users.name,
        email: users.email
      }
    })
    .from(intents)
    .leftJoin(users, eq(intents.userId, users.id))
    .where(eq(intents.id, intentId))
    .then(rows => rows[0]);

    if (!intent) {
      console.error(`Intent ${intentId} not found`);
      return;
    }

    // Example: Get all indexes this intent belongs to
    const intentIndexRelations = await this.db.select({
      indexId: intentIndexes.indexId,
      index: {
        id: indexes.id,
        title: indexes.title
      }
    })
    .from(intentIndexes)
    .leftJoin(indexes, eq(intentIndexes.indexId, indexes.id))
    .where(eq(intentIndexes.intentId, intentId));

    // Example: Find similar intents in the same indexes
    const similarIntents = await this.db.select({
      id: intents.id,
      payload: intents.payload
    })
    .from(intents)
    .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
    .where(
      and(
        eq(intentIndexes.indexId, intentIndexRelations[0]?.indexId),
        ne(intents.id, intentId)
      )
    );

    // Example: Create stakes for similar intents
    if (similarIntents.length > 0) {
      // Get or create our agent
      const agent = await this.db.select()
        .from(agents)
        .where(eq(agents.name, this.name))
        .then(rows => rows[0]) || await this.db.insert(agents)
        .values({
          name: this.name,
          description: 'Example context broker for demonstrating stake operations',
          avatar: '🤖'
        })
        .returning()
        .then(rows => rows[0]);

      // Create stakes for each similar intent
      for (const similarIntent of similarIntents) {
        const pair = this.createOrderedPair(intentId, similarIntent.id);
        
        // Check if stake already exists
        const existingStake = await this.db.select()
          .from(intentStakes)
          .where(eq(intentStakes.pair, pair))
          .then(rows => rows[0]);

        if (!existingStake) {
          // Create new stake
          await this.db.insert(intentStakes)
            .values({
              pair,
              stake: BigInt(100), // Example stake amount
              reasoning: `Automatically created stake between intents ${intentId} and ${similarIntent.id}`,
              agentId: agent.id
            });
          
          console.log(`Created new stake between intents ${intentId} and ${similarIntent.id}`);
        }
      }
    }

    console.log(`Processing new intent: ${intentId}`);
    console.log(`Intent belongs to ${intentIndexRelations.length} indexes`);
    console.log(`Found ${similarIntents.length} similar intents`);
  }

  async onIntentUpdated(intentId: string, previousStatus?: string): Promise<void> {
    // Example: Get all related intents through stakes
    const relatedIntents = await this.getRelatedIntents(intentId);
    console.log(`Intent ${intentId} has ${relatedIntents.length} related intents through stakes`);

    // Example: Get stakes for each related intent
    for (const relatedIntent of relatedIntents) {
      const stakes = await this.getStakesForPair(intentId, relatedIntent.id);
      console.log(`Found ${stakes.length} stakes between intent ${intentId} and ${relatedIntent.id}`);
    }

    console.log(`Processing updated intent: ${intentId}, previous status: ${previousStatus}`);
  }

  async onIntentArchived(intentId: string): Promise<void> {
    // Example: Get all stakes and related intents before archiving
    const stakes = await this.getStakesForIntent(intentId);
    const relatedIntents = await this.getRelatedIntents(intentId);
    
    // Example: Update all related stakes to mark them as inactive
    if (stakes.length > 0) {
      await this.db.update(intentStakes)
        .set({ 
          // Add any fields you want to update when an intent is archived
          // For example, you might want to add an 'isActive' field to the schema
        })
        .where(
          or(...stakes.map(stake => eq(intentStakes.id, stake.id)))
        );
    }

    console.log(`Processing archived intent: ${intentId}`);
    console.log(`Updated ${stakes.length} related stakes`);
    console.log(`Affected ${relatedIntents.length} related intents`);
  }
} 