import { BaseContextBroker } from '../base';
import { intents, intentStakes, agents } from '../../../lib/schema';
import { eq, and, ne } from 'drizzle-orm';
import { llm } from "../../../lib/agents";

export class SemanticRelevancyBroker extends BaseContextBroker {
  constructor(agentId: string) {
    super(agentId);
  }

  async onIntentCreated(intentId: string): Promise<void> {
    console.log("manyaaa", intentId, this.agentId)
    await this.onIntentUpdated(intentId);
  }

  private async findSemanticallyRelatedIntents(currentIntent: any): Promise<any[]> {
    console.log('Finding semantically related intents for:', currentIntent);
    // Get all other intents
    const allIntents = await this.db.select()
      .from(intents)
      .where(and(
        ne(intents.id, currentIntent.id),
        //ne(intents.userId, currentIntent.userId)
      ));
    console.log('Found other intents:', allIntents.length);

    const relatedIntents = [];
    
    // Use LLM to determine semantic relevance
    for (const otherIntent of allIntents) {
      const prompt = `Compare these two intents and determine if there's mutual intent.
      Return only a number between 0 and 1, where 1 means highly related and 0 means not related at all.
      
      Intent 1: ${JSON.stringify(currentIntent.payload)}
      Intent 2: ${JSON.stringify(otherIntent.payload)}`;

      const response = await llm.invoke(prompt);
      const score = parseFloat(response.content.toString());
      console.log('LLM response for intent comparison:', { score, otherIntentId: otherIntent.id });

      if (score > 0.7) { // Only consider intents with high relevance
        relatedIntents.push({
          intent: otherIntent,
          score
        });
      }
    }

    // Sort by relevance score and take top 5
    return relatedIntents
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.intent);
  }

  async onIntentUpdated(intentId: string): Promise<void> {
    // Get the current intent
    const currentIntent = await this.db.select()
      .from(intents)
      .where(eq(intents.id, intentId))
      .then(rows => rows[0]);

    console.log('Current intent:', currentIntent);

    if (!currentIntent) {
      console.error(`Intent ${intentId} not found`);
      return;
    }

    // Find semantically related intents
    const relatedIntents = await this.findSemanticallyRelatedIntents(currentIntent);
    console.log('Found related intents:', relatedIntents.length);

    // Create stakes for related intents
    for (const relatedIntent of relatedIntents) {
      const pair = this.createOrderedPair(intentId, relatedIntent.id);
      console.log('Created pair:', pair);
      
      // Create new stake with reasoning from LLM
      const reasoningPrompt = `Explain why these two intents are related in one sentence:
      Intent 1: ${JSON.stringify(currentIntent.payload)}
      Intent 2: ${JSON.stringify(relatedIntent.payload)}`;

      const response = await llm.invoke(reasoningPrompt);
      const reasoning = response.content.toString();
      
      await this.stakeManager.createStake({
        pair,
        stake: BigInt(100),
        reasoning,
        agentId: this.agentId
      });
    }
  }

  async onIntentArchived(intentId: string): Promise<void> {
    // Remove all stakes for this intent
    await this.db.delete(intentStakes)
      .where(
        and(
          eq(intentStakes.pair, intentId)
        )
      );
  }
} 