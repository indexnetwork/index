import fs from 'fs';
import path from 'path';
import db from '../db';
import { intents, intentIndexes } from '../schema';
import { and, eq, isNull } from 'drizzle-orm';
import { analyzeFolder } from '../../agents/core/intent_inferrer';
import { summarizeIntent } from '../../agents/core/intent_summarizer';
import { generateEmbedding } from '../embeddings';
import { Events } from '../events';
import { getTempPath } from '../paths';

import type { IntegrationFile } from '../integrations';

// Centralized configuration for intent processing
const INTENT_PROCESSING_CONFIG = {
  DEFAULT_COUNT: 5,
  DEFAULT_TIMEOUT_MS: 60000,
} as const;

// Generate standardized text instruction based on source type and ID
function generateTextInstruction(sourceType?: 'file' | 'integration' | 'link', sourceId?: string): string {
  const baseInstruction = 'Generate intents based on content';
  
  switch (sourceType) {
    case 'integration':
      return sourceId 
        ? `${baseInstruction} from integration ${sourceId}`
        : `${baseInstruction} from integration data`;
    case 'link':
      return sourceId 
        ? `${baseInstruction} from link ${sourceId}`
        : `${baseInstruction} from crawled web content`;
    case 'file':
      return sourceId 
        ? `${baseInstruction} from file ${sourceId}`
        : `${baseInstruction} from uploaded files`;
    default:
      return baseInstruction;
  }
}

// Get appropriate count based on source type
function getCountForSourceType(sourceType?: 'file' | 'integration' | 'link'): number {
  switch (sourceType) {
    case 'integration':
      return 3; // Reduced for faster iteration
    case 'link':
      return 1; // Usually one intent per link
    case 'file':
      return 5; // Standard for uploaded files
    default:
      return INTENT_PROCESSING_CONFIG.DEFAULT_COUNT;
  }
}

export async function getExistingIntents(userId: string, indexId?: string): Promise<Set<string>> {
  if (indexId) {
    const rows = await db
      .select({ payload: intents.payload })
      .from(intents)
      .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
      .where(and(eq(intentIndexes.indexId, indexId), eq(intents.userId, userId), isNull(intents.archivedAt)));
    return new Set(rows.map((r) => r.payload));
  }
  const rows = await db
    .select({ payload: intents.payload })
    .from(intents)
    .where(and(eq(intents.userId, userId), isNull(intents.archivedAt)));
  return new Set(rows.map((r) => r.payload));
}

// Helper function to save a single intent to database
async function saveIntentToDatabase(options: {
  intentData: any;
  userId: string;
  indexId?: string;
  sourceId?: string;
  sourceType?: 'file' | 'integration' | 'link';
  existingIntents: Set<string>;
}): Promise<number> {
  const { intentData, userId, indexId, sourceId, sourceType, existingIntents } = options;
  
  if (existingIntents.has(intentData.payload)) return 0;
  
  const summary = await summarizeIntent(intentData.payload);
  
  // Generate embedding for semantic search
  let embedding: number[] | null = null;
  try {
    embedding = await generateEmbedding(intentData.payload);
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    // Continue without embedding - it's optional
  }
  
  const inserted = await db
    .insert(intents)
    .values({
      payload: intentData.payload,
      userId,
      isIncognito: false,
      summary: summary,
      embedding: embedding || undefined,
      sourceId,
      sourceType,
    })
    .returning({ id: intents.id });
  const intentId = inserted[0].id;
  
  if (indexId) {
    await db.insert(intentIndexes).values({ intentId, indexId });
  }
  
  // Trigger centralized intent created event
  Events.Intent.onCreated({
    intentId,
    userId,
    payload: intentData.payload
  });
  
  existingIntents.add(intentData.payload);
  return 1;
}

export async function processFilesToIntents(options: {
  userId: string;
  indexId?: string;
  files: IntegrationFile[];
  onProgress?: (completed: number, total: number, note?: string) => Promise<void> | void;
  sourceId?: string;
  sourceType?: 'file' | 'integration' | 'link';
  existingIntents?: Set<string>;
  // Optional overrides for defaults
  timeoutMs?: number; // Override default timeout
}): Promise<{ intentsGenerated: number; filesImported: number }>{
  const { 
    userId, 
    indexId, 
    files, 
    onProgress, 
    timeoutMs = INTENT_PROCESSING_CONFIG.DEFAULT_TIMEOUT_MS
  } = options;
  if (!files.length) return { intentsGenerated: 0, filesImported: 0 };

  const existingIntents = options.existingIntents || await getExistingIntents(userId, indexId);
  const textInstruction = generateTextInstruction(options.sourceType, options.sourceId);
  const count = getCountForSourceType(options.sourceType);
  let totalIntentsGenerated = 0;

  // Batch process all files together
  const baseTempDir = getTempPath('sync', `sync-${userId}-${Date.now()}`);
  await fs.promises.mkdir(baseTempDir, { recursive: true });
  
  try {
    const fileIds: string[] = [];
    let completed = 0;
    for (const f of files) {
      await fs.promises.writeFile(path.join(baseTempDir, `${f.id}.md`), f.content);
      fileIds.push(f.id);
      completed += 1;
      await onProgress?.(completed, files.length, `saved ${completed}/${files.length}`);
    }

    const result = await analyzeFolder(
      baseTempDir,
      fileIds,
      textInstruction,
      Array.from(existingIntents),
      [],
      Math.max(1, count),
      timeoutMs
    );

    if (result.success && result.intents.length > 0) {
      for (const intentData of result.intents) {
        const saved = await saveIntentToDatabase({
          intentData,
          userId,
          indexId,
          sourceId: options.sourceId,
          sourceType: options.sourceType,
          existingIntents,
        });
        totalIntentsGenerated += saved;
      }
    }
  } finally {
    await fs.promises.rm(baseTempDir, { recursive: true, force: true });
  }
  
  return { intentsGenerated: totalIntentsGenerated, filesImported: files.length };
}

