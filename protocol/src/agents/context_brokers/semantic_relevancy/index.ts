import { BaseContextBroker } from '../base';
import { intents, intentStakes, agents } from '../../../lib/schema';
import { eq, sql, isNotNull } from 'drizzle-orm';
import { traceableLlm } from "../../../lib/agents";
import { generateEmbedding } from "../../../lib/embeddings";

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

      console.log(`Found ${similarIntents.length} similar intents using vector search`);

      // Filter by similarity threshold (equivalent to 0.7 LLM score)
      const relatedIntents = similarIntents
        .filter(intent => intent.similarity > 0.75) // Adjust threshold as needed
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
      return this.findSemanticallyRelatedIntentsLLM(currentIntent);
    }
  }

  // Keep the original LLM-based method as fallback
  private async findSemanticallyRelatedIntentsLLM(currentIntent: any): Promise<any[]> {
    // Use shared utility to get intents in same indexes
    const allIntents = await this.getIntentsInSameIndexes(currentIntent.id, true);
    console.log('Found other intents in same indexes:', allIntents.length);

    // Use LLM to determine semantic relevance - PARALLEL PROCESSING
    const scorePromises = allIntents.map(async (otherIntent) => {
      try {
        const prompt = `Compare these two intents and determine if there's mutual intent.
        Return only a number between 0 and 1, where 1 means highly related and 0 means not related at all.
        
        Intent 1: ${JSON.stringify(currentIntent.payload)}
        Intent 2: ${JSON.stringify(otherIntent.payload)}`;

        const llmCall = traceableLlm(
          "broker-semantic-relevancy-mutuality-score",
          ["context-broker", "broker-semantic-relevancy"],
          {
            current_intent_id: currentIntent.id,
            other_intent_id: otherIntent.id
          }
        );
        const response = await llmCall(prompt);
        const score = parseFloat(response.content.toString());
        //console.log('LLM response for intent comparison:', { score, otherIntentId: otherIntent.id });

        return {
          intent: otherIntent,
          score
        };
      } catch (error) {
        console.error(`Error processing intent ${otherIntent.id}:`, error);
        return {
          intent: otherIntent,
          score: 0
        };
      }
    });

    // Wait for all LLM calls to complete
    const scoredIntents = await Promise.allSettled(scorePromises);
    
    // Filter and extract successful results
    const relatedIntents = scoredIntents
      .filter(result => result.status === 'fulfilled' && result.value.score > 0.7)
      .map(result => result.status === 'fulfilled' ? result.value : null)
      .filter(item => item !== null);

    console.log('Related intents (LLM fallback):', relatedIntents);

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

    // Create stakes for related intents - PARALLEL PROCESSING
    const stakePromises = relatedIntents.map(async (relatedIntent) => {
      try {
        console.log('Created intent array:', [intentId, relatedIntent.id]);
        
        // Create new stake with reasoning from LLM
        const reasoningPrompt = `Explain why these two intents are related in one sentence:
        Intent 1: ${JSON.stringify(currentIntent.payload)}
        Intent 2: ${JSON.stringify(relatedIntent.payload)}`;

        const reasoningCall = traceableLlm(
          "broker-semantic-relevancy-reasoning-generator",
          ["context-broker", "broker-semantic-relevancy"],
          {
            agent_type: "semantic_relevancy_broker",
            operation: "reasoning_generation",
            current_intent_id: intentId,
            related_intent_id: relatedIntent.id
          }
        );
        const response = await reasoningCall(reasoningPrompt);
        const reasoning = response.content.toString();
        
        await this.stakeManager.createStake({
          intents: [intentId, relatedIntent.id],
          stake: BigInt(100),
          reasoning,
          agentId: this.agentId
        });
      } catch (error) {
        console.error(`Error creating stake for intent ${relatedIntent.id}:`, error);
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