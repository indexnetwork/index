import { BaseContextBroker } from '../base';
import { intents, intentStakes } from '../../../lib/schema';
import { eq, sql } from 'drizzle-orm';
import { traceableStructuredLlm } from "../../../lib/agents";
import { z } from "zod";

export class SemanticRelevancyBroker extends BaseContextBroker {
  constructor(agentId: string) {
    super(agentId);
  }

  async onIntentCreated(intentId: string): Promise<void> {
    await this.onIntentUpdated(intentId);
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

    // Create stakes for related intents - PARALLEL PROCESSING
    const stakePromises = relatedIntents.map(async (relatedIntentData) => {
      try {
        // Handle different return formats from vector search vs LLM fallback
        const relatedIntent = relatedIntentData.intent || relatedIntentData;
        const relatedIntentId = relatedIntent.id;
        
        if (!relatedIntentId) {
          console.error('Related intent missing ID:', relatedIntentData);
          return;
        }
        
        console.log('Created intent array:', [intentId, relatedIntentId]);
        
        // Define Zod schema for structured mutual intent check
        const MutualIntentSchema = z.object({
          isMutual: z.boolean().describe("Whether the two intents have mutual intent (both relate to or depend on each other)"),
          reasoning: z.string().describe("If mutual, explain why they are mutually related in one sentence. If not mutual, provide empty string.")
        });

        // Create new stake with reasoning from LLM - but only if they're mutually related
        const reasoningPrompt = `Analyze these two intents and determine if they have mutual intent (both intents relate to or depend on each other).

        Intent 1: ${JSON.stringify(currentIntent.payload)}
        Intent 2: ${JSON.stringify(relatedIntent.payload)}

        Provide a structured response indicating whether they are mutually related and if so, explain why in one sentence.`;

        const reasoningCall = traceableStructuredLlm(
          "broker-semantic-relevancy-reasoning-generator",
          ["context-broker", "broker-semantic-relevancy", "structured-output"],
          {
            agent_type: "semantic_relevancy_broker",
            operation: "reasoning_generation",
            current_intent_id: intentId,
            related_intent_id: relatedIntentId
          }
        );
        const response = await reasoningCall(reasoningPrompt, MutualIntentSchema);
        
        // Only create stake if the intents are mutually related
        if (response.isMutual && response.reasoning.trim()) {
          await this.stakeManager.createStake({
            intents: [intentId, relatedIntentId],
            stake: BigInt(100),
            reasoning: response.reasoning,
            agentId: this.agentId
          });
        } else {
          console.log(`Skipping stake creation - intents ${intentId} and ${relatedIntentId} are not mutually related`);
        }
      } catch (error) {
        console.error(`Error creating stake for intent ${relatedIntentData?.intent?.id || relatedIntentData?.id || 'unknown'}:`, error);
      }
    });

    // Wait for all stake creation to complete
    await Promise.allSettled(stakePromises);
  }

  async onIntentArchived(intentId: string): Promise<void> {
    // Remove all stakes that include this intent
    await this.db.delete(intentStakes)
      .where(sql`${intentStakes.intents} @> ARRAY[${intentId}]`);
  }
} 