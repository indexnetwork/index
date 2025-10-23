import { BaseContextBroker } from '../base';
import { intents, intentStakes } from '../../../lib/schema';
import { eq, sql } from 'drizzle-orm';
import { traceableStructuredLlm } from "../../../lib/agents";
import { z } from "zod";
import { addBrokerJob } from '../../../lib/queue/llm-queue';

export class SemanticRelevancyBroker extends BaseContextBroker {
  constructor(agentId: string) {
    super(agentId);
  }

  async onIntentCreated(intentId: string): Promise<void> {
    console.log(`🤖 SemanticRelevancyBroker: Processing intent ${intentId}`);
    
    // Directly discover related intents and queue pair processing jobs
    await this.discoverAndQueueRelatedIntents(intentId);
  }

  /**
   * Discover related intents and queue individual pair processing jobs
   */
  async discoverAndQueueRelatedIntents(currentIntentId: string): Promise<void> {
    // Get the current intent
    const currentIntent = await this.db.select()
      .from(intents)
      .where(eq(intents.id, currentIntentId))
      .then(rows => rows[0]);

    if (!currentIntent) {
      console.error(`Intent ${currentIntentId} not found`);
      return;
    }

    console.log('🔍 Discovering related intents for:', currentIntentId);

    // Find semantically related intents
    const relatedIntents = await this.findSemanticallyRelatedIntents(currentIntent);
    console.log('Found related intents:', relatedIntents.length);

    // Queue individual pair processing jobs
    const queuePromises = relatedIntents.map(async (relatedIntentData) => {
      try {
        // Handle different return formats from vector search vs LLM fallback
        const relatedIntent = relatedIntentData.intent || relatedIntentData;
        const relatedIntentId = relatedIntent.id;
        
        if (!relatedIntentId) {
          console.error('Related intent missing ID:', relatedIntentData);
          return;
        }
        
        // Queue individual pair processing job
        await addBrokerJob({
          intentId: currentIntentId,
          relatedIntentId,
          userId: currentIntent.userId,
          brokerType: 'semantic_relevancy'
        }, 3); // Lower priority than discovery job
        
      } catch (error) {
        console.error(`Error queueing pair job for intent ${relatedIntentData?.intent?.id || relatedIntentData?.id || 'unknown'}:`, error);
      }
    });

    // Wait for all queue operations to complete
    await Promise.allSettled(queuePromises);
    console.log(`✅ Queued ${relatedIntents.length} intent pair processing jobs for ${currentIntentId}`);
  }

  /**
   * Process a specific intent pair for mutual relevancy
   */
  async processIntentPair(currentIntentId: string, relatedIntentId: string): Promise<void> {
    console.log('🤝 Processing intent pair:', currentIntentId, 'vs', relatedIntentId);
    
    // Get both intents
    const [currentIntent, relatedIntent] = await Promise.all([
      this.db.select().from(intents).where(eq(intents.id, currentIntentId)).then(rows => rows[0]),
      this.db.select().from(intents).where(eq(intents.id, relatedIntentId)).then(rows => rows[0])
    ]);

    if (!currentIntent || !relatedIntent) {
      console.error('One or both intents not found:', currentIntentId, relatedIntentId);
      return;
    }

    // Define Zod schema for structured mutual intent check
    const MutualIntentSchema = z.object({
      isMutual: z.boolean().describe("Whether the two intents have mutual intent (both relate to or depend on each other)"),
      reasoning: z.string().describe("If mutual, explain why they are mutually related in one sentence. If not mutual, provide empty string.")
    });

    // System message: Define role and evaluation criteria
    const systemMessage = {
      role: "system",
      content: `You are a semantic relationship analyst. Determine if two intents have MUTUAL relevance (both relate to or complement each other).

Mutual criteria:
- Both intents seek things that complement each other (e.g., investor + startup, designer + developer)
- Both intents could lead to a valuable connection or collaboration
- There's bidirectional value (not just one-way interest)

Examples:
✅ MUTUAL: "Seeking AI investors" + "Looking for AI startups to fund" → Both want to connect
✅ MUTUAL: "Need React developers" + "Looking for projects to build with React" → Complementary
❌ NOT MUTUAL: "Seeking investors" + "Seeking investors" → Same need, no complement
❌ NOT MUTUAL: "Looking for designers" + "Looking for investors" → Unrelated needs`
    };

    // User message: Provide the two intents to compare
    const userMessage = {
      role: "user",
      content: `Analyze these intents for mutual relevance:

Intent 1: ${currentIntent.payload}
Intent 2: ${relatedIntent.payload}

Are these mutually relevant? If yes, explain why in one sentence.`
    };

    const reasoningCall = traceableStructuredLlm(
      "semantic-relevancy",
      {
        agent_type: "semantic_relevancy_broker",
        operation: "reasoning_generation",
        current_intent_id: currentIntentId,
        related_intent_id: relatedIntentId
      }
    );
    
    const response = await reasoningCall([systemMessage, userMessage], MutualIntentSchema);
    
    // Only create stake if the intents are mutually related
    if (response.isMutual && response.reasoning.trim()) {
      await this.stakeManager.createStake({
        intents: [currentIntentId, relatedIntentId],
        stake: BigInt(100),
        reasoning: response.reasoning,
        agentId: this.agentId
      });
      console.log(`✅ Created stake for mutually related intents: ${currentIntentId} ↔ ${relatedIntentId}`);
    } else {
      console.log(`⏭️  Skipped stake - intents ${currentIntentId} and ${relatedIntentId} are not mutually related`);
    }
  }


  async onIntentUpdated(intentId: string): Promise<void> {
    console.log(`🤖 SemanticRelevancyBroker: Processing updated intent ${intentId}`);
    
    // Directly discover related intents and queue pair processing jobs
    await this.discoverAndQueueRelatedIntents(intentId);
  }

  async onIntentArchived(intentId: string): Promise<void> {
    // Remove all stakes that include this intent
    await this.db.delete(intentStakes)
      .where(sql`${intentStakes.intents} @> ARRAY[${intentId}]`);
  }
} 