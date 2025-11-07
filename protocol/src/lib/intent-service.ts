import db from './db';
import { intents, intentIndexes, intentStakes } from './schema';
import { summarizeIntent } from '../agents/core/intent_summarizer';
import { generateEmbedding } from './embeddings';
import { Events } from './events';
import { eq } from 'drizzle-orm';
import { INTENT_INFERRER_AGENT_ID } from './agent-ids';

export interface CreateIntentOptions {
  payload: string;
  userId: string;
  isIncognito?: boolean;
  indexIds?: string[];
  sourceId?: string;
  sourceType?: 'file' | 'integration' | 'link' | 'discovery_form';
  confidence: number; // 0-1, required
  inferenceType: 'explicit' | 'implicit'; // required
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreatedIntent {
  id: string;
  payload: string;
  summary: string | null;
  isIncognito: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}

export class IntentService {
  /**
   * Get existing intents for a user as a Set of payloads
   */
  static async getUserIntents(userId: string): Promise<Set<string>> {
    const existingIntents = await db.select({
      payload: intents.payload,
      summary: intents.summary
    }).from(intents)
      .where(eq(intents.userId, userId));
    
    return new Set(existingIntents.map(intent => intent.summary || intent.payload));
  }

  /**
   * Main intent creation method that handles all intent creation scenarios
   */
  static async createIntent(options: CreateIntentOptions): Promise<CreatedIntent> {
    try {
      console.log(`[IntentService.createIntent] Starting with:`, {
        payload: options.payload.substring(0, 50) + '...',
        userId: options.userId,
        indexIds: options.indexIds,
        confidence: options.confidence,
        inferenceType: options.inferenceType
      });

      const {
        payload,
        userId,
        isIncognito = false,
        indexIds = [],
        sourceId,
        sourceType,
        confidence,
        inferenceType,
        createdAt,
        updatedAt
      } = options;

      console.log(`[IntentService.createIntent] Parameters destructured`);

      // Ensure createdAt and updatedAt are Date objects if provided
      const createdAtDate = createdAt ? (createdAt instanceof Date ? createdAt : new Date(createdAt)) : undefined;
      const updatedAtDate = updatedAt ? (updatedAt instanceof Date ? updatedAt : new Date(updatedAt)) : undefined;

      if (createdAtDate) {
        console.log(`[IntentService.createIntent] Creating intent with datetime: ${createdAtDate.toISOString()}`);
      }

      // Generate summary
      console.log(`[IntentService.createIntent] About to generate summary...`);
      const summary = await summarizeIntent(payload);
      console.log(`[IntentService.createIntent] Summary generated:`, summary);
      
      // Generate embedding for semantic search
      console.log(`[IntentService.createIntent] Generating embedding...`);
      let embedding: number[] | null = null;
      try {
        embedding = await generateEmbedding(payload);
        console.log(`[IntentService.createIntent] Embedding generated: ${embedding ? `${embedding.length} dimensions` : 'null'}`);
      } catch (error) {
        console.error('[IntentService.createIntent] Failed to generate embedding:', error);
        // Continue without embedding - it's optional
      }

      console.log(`[IntentService.createIntent] Inserting intent into database...`);
      
      // Create the intent
      let newIntent;
      try {
        newIntent = await db.insert(intents).values({
          payload,
          summary,
          isIncognito,
          userId,
          sourceId: sourceId || undefined,
          sourceType: sourceType || undefined,
          embedding: embedding || undefined,
          ...(createdAtDate && { createdAt: createdAtDate }),
          ...(updatedAtDate && { updatedAt: updatedAtDate })
        }).returning({
          id: intents.id,
          payload: intents.payload,
          summary: intents.summary,
          isIncognito: intents.isIncognito,
          createdAt: intents.createdAt,
          updatedAt: intents.updatedAt,
          userId: intents.userId
        });
      } catch (error) {
        console.error('[IntentService.createIntent] Failed to insert intent into DB:', error);
        throw error;
      }

      console.log(`[IntentService.createIntent] ✅ Intent inserted:`, newIntent);

      if (!newIntent || newIntent.length === 0) {
        throw new Error('Failed to create intent - no intent returned from insert');
      }

      const createdIntent = newIntent[0];
      console.log(`[IntentService.createIntent] ✅ Created intent with ID: ${createdIntent.id}`);

      // Associate with indexes if provided
      if (indexIds.length > 0) {
        console.log(`[IntentService.createIntent] Associating intent ${createdIntent.id} with ${indexIds.length} indexes:`, indexIds);
        try {
          await db.insert(intentIndexes).values(
            indexIds.map((indexId: string) => ({
              intentId: createdIntent.id,
              indexId: indexId
            }))
          );
          console.log(`[IntentService.createIntent] ✅ Successfully associated with indexes`);
        } catch (error) {
          console.error(`[IntentService.createIntent] ❌ Failed to associate intent ${createdIntent.id} with indexes:`, error);
          throw error;
        }
      } else {
        console.log(`[IntentService.createIntent] ⚠️ No indexes provided - intent ${createdIntent.id} will not be associated with any index`);
      }

      // Create inference stake (always required)
      try {
        await db.insert(intentStakes).values({
          intents: [createdIntent.id],
          stake: BigInt(Math.floor(confidence * 100)),
          reasoning: `Inferred as ${inferenceType} intent`,
          agentId: INTENT_INFERRER_AGENT_ID
        });
        console.log(`[IntentService.createIntent] ✅ Created inference stake for intent ${createdIntent.id}: ${inferenceType} (${confidence})`);
      } catch (error) {
        console.error(`[IntentService.createIntent] Failed to create inference stake for intent ${createdIntent.id}:`, error);
        // Continue without inference stake - it's optional
      }

      // Trigger centralized intent created event
      Events.Intent.onCreated({
        intentId: createdIntent.id,
        userId: createdIntent.userId,
        payload: createdIntent.payload
      });

      console.log(`[IntentService.createIntent] ✅ Successfully completed for intent ${createdIntent.id}`);
      return createdIntent;
    } catch (error) {
      console.error(`[IntentService.createIntent] ❌ FATAL ERROR:`, error);
      console.error(`[IntentService.createIntent] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
      throw error;
    }
  }

}
