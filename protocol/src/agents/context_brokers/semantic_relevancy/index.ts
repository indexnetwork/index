import { BaseContextBroker } from '../base';
import { intents, intentStakes, agents } from '../../../lib/schema';
import { eq, sql, isNotNull } from 'drizzle-orm';
import { traceableLlm, traceableStructuredLlm } from "../../../lib/agents";
import { generateEmbedding } from "../../../lib/embeddings";
import { z } from "zod";

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
              AND ${intents.embedding} IS NOT NULL
              AND ${intents.archivedAt} IS NULL`
        )
        .orderBy(sql`${intents.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
        .limit(10);

      console.log(`Found ${similarIntents.length} similar intents using vector search`, similarIntents);

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