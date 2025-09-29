import db from './db';
import { intents } from './schema';
import { eq } from 'drizzle-orm';
import { summarizeIntent } from '../agents/core/intent_summarizer';
import { generateEmbedding } from './embeddings';

/**
 * Get existing intents for a user as a Set of payloads
 */
export async function getExistingIntents(userId: string): Promise<Set<string>> {
  const existingIntents = await db.select({
    payload: intents.payload
  }).from(intents)
    .where(eq(intents.userId, userId));
  
  return new Set(existingIntents.map(intent => intent.payload));
}

/**
 * Save a new intent for a user with a source
 */
export async function saveIntent(payload: string, userId: string, sourceId: string): Promise<void> {
  const summary = await summarizeIntent(payload);
  
  // Generate embedding for semantic search
  let embedding: number[] | null = null;
  try {
    embedding = await generateEmbedding(payload);
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    // Continue without embedding - it's optional
  }
  
  await db.insert(intents).values({
    payload,
    summary,
    isIncognito: false,
    userId,
    sourceId,
    sourceType: 'integration',
    embedding: embedding || undefined,
  });
}
