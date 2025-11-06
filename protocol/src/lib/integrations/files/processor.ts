import fs from 'fs';
import path from 'path';
import { analyzeFolder } from '../../../agents/core/intent_inferrer';
import { getTempPath } from '../../paths';
import type { IntegrationFile } from '../index';
import { IntentService } from '../../../services/intent-service';

export async function processFiles(
  userId: string,
  files: IntegrationFile[],
  source: { id: string; indexId?: string } | string,
  sourceType: 'file' | 'integration' | 'link' | 'discovery_form' = 'file',
  onProgress?: (completed: number, total: number, note?: string) => Promise<void> | void
): Promise<{ intentsGenerated: number; filesImported: number }> {
  if (!files.length) {
    return { intentsGenerated: 0, filesImported: 0 };
  }

  // Handle both integration object and string sourceId
  const sourceId = typeof source === 'string' ? source : source.id;
  const indexId = typeof source === 'object' ? source.indexId : undefined;

  const existingIntents = await IntentService.getUserIntents(userId);
  const count = sourceType === 'link' ? 1 : 5; // 1 for links, 5 for files
  
  const tempDir = getTempPath('sync', `${userId}-${Date.now()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  
  try {
    // Save files to temp directory
    const fileIds: string[] = [];
    for (const file of files) {
      await fs.promises.writeFile(path.join(tempDir, `${file.id}.md`), file.content);
      fileIds.push(file.id);
    }

    await onProgress?.(files.length, files.length, 'analyzing content');

    // Generate intents
    const result = await analyzeFolder(
      tempDir,
      fileIds,
      'Generate intents based on content',
      Array.from(existingIntents),
      count,
      60000
    );

    let intentsGenerated = 0;
    if (result.success) {
      for (const intentData of result.intents) {
        if (!existingIntents.has(intentData.payload)) {
          await IntentService.createIntent({
            payload: intentData.payload,
            userId,
            sourceId,
            sourceType,
            indexIds: indexId ? [indexId] : [],
            confidence: intentData.confidence || 0.8,
            inferenceType: intentData.type || 'implicit',
          });
          intentsGenerated++;
          existingIntents.add(intentData.payload);
        }
      }
    }

    return { intentsGenerated, filesImported: files.length };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}
