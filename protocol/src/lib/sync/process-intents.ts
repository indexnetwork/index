import fs from 'fs';
import path from 'path';
import db from '../db';
import { intents, intentIndexes } from '../schema';
import { and, eq, isNull } from 'drizzle-orm';
import { analyzeFolder } from '../../agents/core/intent_inferrer';
import { summarizeIntent } from '../../agents/core/intent_summarizer';
import { intentIndexer } from '../../agents/core/intent_indexer';

import type { IntegrationFile } from '../integrations';

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

export async function processFilesToIntents(options: {
  userId: string;
  indexId?: string;
  files: IntegrationFile[];
  textInstruction: string;
  count: number;
  timeoutMs?: number;
  summarize?: boolean;
  onProgress?: (completed: number, total: number, note?: string) => Promise<void> | void;
  // Polymorphic source (nullable)
  sourceId?: string;
  sourceType?: 'file' | 'integration' | 'link';
}): Promise<{ intentsGenerated: number; filesImported: number }>{
  const { userId, indexId, files, textInstruction, count, summarize = false, timeoutMs = 60000, onProgress } = options;
  if (!files.length) return { intentsGenerated: 0, filesImported: 0 };

  const baseTempDir = path.join(process.cwd(), 'temp-uploads', `sync-${userId}-${Date.now()}`);
  await fs.promises.mkdir(baseTempDir, { recursive: true });
  try {
    // Write all files into a single temp folder and call analyze once
    const fileIds: string[] = [];
    let completed = 0;
    for (const f of files) {
      await fs.promises.writeFile(path.join(baseTempDir, `${f.id}.md`), f.content);
      fileIds.push(f.id);
      completed += 1;
      await onProgress?.(completed, files.length, `saved ${completed}/${files.length}`);
    }

    const existingIntents = await getExistingIntents(userId, indexId);
    const result = await analyzeFolder(
      baseTempDir,
      fileIds,
      textInstruction,
      Array.from(existingIntents),
      [],
      Math.max(1, count),
      timeoutMs
    );

    let intentsGenerated = 0;
    if (result.success && result.intents.length > 0) {
      for (const intentData of result.intents) {
        if (existingIntents.has(intentData.payload)) continue;
        const summary = summarize ? await summarizeIntent(intentData.payload) : undefined;
        const inserted = await db
          .insert(intents)
          .values({
            payload: intentData.payload,
            userId,
            isIncognito: false,
            summary: summary,
            sourceId: options.sourceId,
            sourceType: options.sourceType,
          })
          .returning({ id: intents.id });
        const intentId = inserted[0].id;
        if (indexId) {
          await db.insert(intentIndexes).values({ intentId, indexId });
        }
        
        // Run intent indexer for auto-assignment
        await intentIndexer.processIntent(intentId);
        
        existingIntents.add(intentData.payload);
        intentsGenerated += 1;
      }
    }
    return { intentsGenerated, filesImported: files.length };
  } finally {
    await fs.promises.rm(baseTempDir, { recursive: true, force: true });
  }
}
