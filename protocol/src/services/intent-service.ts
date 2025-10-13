import db from '../lib/db';
import { intents, intentIndexes } from '../lib/schema';
import { summarizeIntent } from '../agents/core/intent_summarizer';
import { generateEmbedding } from '../lib/embeddings';
import { Events } from '../lib/events';
import { eq } from 'drizzle-orm';

export interface CreateIntentOptions {
  payload: string;
  userId: string;
  isIncognito?: boolean;
  indexIds?: string[];
  sourceId?: string;
  sourceType?: 'file' | 'integration' | 'link' | 'discovery_form';
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
      payload: intents.payload
    }).from(intents)
      .where(eq(intents.userId, userId));
    
    return new Set(existingIntents.map(intent => intent.payload));
  }

  /**
   * Main intent creation method that handles all intent creation scenarios
   */
  static async createIntent(options: CreateIntentOptions): Promise<CreatedIntent> {
    const {
      payload,
      userId,
      isIncognito = false,
      indexIds = [],
      sourceId,
      sourceType
    } = options;

    // Generate summary
    const summary = await summarizeIntent(payload);
    
    // Generate embedding for semantic search
    let embedding: number[] | null = null;
    try {
      embedding = await generateEmbedding(payload);
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      // Continue without embedding - it's optional
    }
    
    // Create the intent
    const newIntent = await db.insert(intents).values({
      payload,
      summary,
      isIncognito,
      userId,
      sourceId: sourceId || undefined,
      sourceType: sourceType || undefined,
      embedding: embedding || undefined,
    }).returning({
      id: intents.id,
      payload: intents.payload,
      summary: intents.summary,
      isIncognito: intents.isIncognito,
      createdAt: intents.createdAt,
      updatedAt: intents.updatedAt,
      userId: intents.userId
    });

    if (newIntent.length === 0) {
      throw new Error('Failed to create intent - no intent returned from insert');
    }

    const createdIntent = newIntent[0];

    // Associate with indexes if provided
    if (indexIds.length > 0) {
      await db.insert(intentIndexes).values(
        indexIds.map((indexId: string) => ({
          intentId: createdIntent.id,
          indexId: indexId
        }))
      );
    }

    // Trigger centralized intent created event
    Events.Intent.onCreated({
      intentId: createdIntent.id,
      userId: createdIntent.userId,
      payload: createdIntent.payload
    });

    return createdIntent;
  }

}
