import fs from 'fs';
import path from 'path';
import { analyzeFolder } from '../../../agents/core/intent_inferrer';
import { getTempPath } from '../../paths';
import type { IntegrationFile } from '../index';
import { IntentService } from '../../../services/intent-service';

export async function processFiles(
  userId: string,
  files: IntegrationFile[],
  sourceId: string,
  sourceType: 'file' | 'integration' | 'link' = 'file',
  onProgress?: (completed: number, total: number, note?: string) => Promise<void> | void
): Promise<{ intentsGenerated: number; filesImported: number }> {
  if (!files.length) {
    return { intentsGenerated: 0, filesImported: 0 };
  }

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
            sourceType
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
