import fs from 'fs';
import path from 'path';
import db from '../../db';
import { userIntegrations, intents, intentIndexes } from '../../schema';
import { eq, and, isNull } from 'drizzle-orm';
import { analyzeFolder } from '../../../agents/core/intent_inferrer';
import { Events } from '../../events';
import { handlers } from '../index';
import { log } from '../../log';

interface SyncResult {
  success: boolean;
  filesImported: number;
  intentsGenerated: number;
  error?: string;
}

function makeTempDir(userId: string): Promise<string> {
  const tempDir = path.join(process.cwd(), 'temp-uploads', `sync-${userId}-${Date.now()}`);
  return fs.promises
    .mkdir(tempDir, { recursive: true })
    .then(() => tempDir);
}

async function saveFilesToTemp(files: Array<{ id: string; content: string }>, userId: string): Promise<{ tempDir: string; fileIds: string[] }> {
  const tempDir = await makeTempDir(userId);
  const fileIds: string[] = [];
  await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(tempDir, `${file.id}.md`);
      await fs.promises.writeFile(filePath, file.content);
      fileIds.push(file.id);
    })
  );
  return { tempDir, fileIds };
}

// Get existing intents to avoid duplicates
async function getExistingIntents(userId: string, indexId?: string): Promise<string[]> {
  let existingIntents;

  if (indexId) {
    // Query intents for specific index
    existingIntents = await db.select({ payload: intents.payload })
      .from(intents)
      .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
      .where(and(
        eq(intents.userId, userId),
        eq(intentIndexes.indexId, indexId),
        isNull(intents.archivedAt)
      ));
  } else {
    // Query all user intents
    existingIntents = await db.select({ payload: intents.payload })
      .from(intents)
      .where(and(
        eq(intents.userId, userId),
        isNull(intents.archivedAt)
      ));
  }

  const payloads = existingIntents.map(intent => intent.payload);
  return payloads;
}

// Sync integration files and generate intents
export async function syncIntegration(
  userId: string,
  integrationType: string,
  indexId?: string
): Promise<SyncResult> {
  try {
    log.info('Integration sync start', { userId, integrationType });

    // Get integration record
    const integration = await db.select()
      .from(userIntegrations)
      .where(and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.integrationType, integrationType),
        eq(userIntegrations.status, 'connected'),
        isNull(userIntegrations.deletedAt)
      ))
      .limit(1);

    if (integration.length === 0) {
      return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Integration not connected' };
    }

    const { lastSyncAt } = integration[0];

    const handler = handlers[integrationType];
    if (!handler) {
      return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Unsupported integration type' };
    }
    const files = await handler.fetchFiles(userId, lastSyncAt || undefined);
    log.info('Provider files', { count: files.length });

    if (files.length === 0) {
      // Update sync timestamp even if no new files
      await db.update(userIntegrations)
        .set({ lastSyncAt: new Date() })
        .where(eq(userIntegrations.id, integration[0].id));

      log.info('Integration sync done (no new files)', { userId, integrationType });
      return { success: true, filesImported: 0, intentsGenerated: 0 };
    }

    // Save files to temp directory
    const { tempDir, fileIds } = await saveFilesToTemp(
      files.map((f) => ({ id: f.id, content: f.content })),
      userId
    );

    try {
      // Get existing intents for deduplication
      const existingIntents = await getExistingIntents(userId, indexId);
      // Analyze files with intent inferrer
      const result = await analyzeFolder(
        tempDir,
        fileIds,
        `Generate intents based on content from ${integrationType} integration`,
        existingIntents,
        [], // existingSuggestions
        3, // count (reduced for faster iteration)
        60000 // timeout
      );


      let intentsGenerated = 0;

      if (result.success && result.intents.length > 0) {
        // Create intents in database
        for (const intentData of result.intents) {
          const newIntent = await db.insert(intents).values({
            payload: intentData.payload,
            userId,
            isIncognito: false,
            sourceId: integration[0].id,
            sourceType: 'integration',
          }).returning();

          // Associate with index if provided
          if (indexId && newIntent.length > 0) {
            await db.insert(intentIndexes).values({
              intentId: newIntent[0].id,
              indexId
            });
          }

          // Trigger centralized intent created event
          await Events.Intent.onCreated({
            intentId: newIntent[0].id,
            userId,
            payload: intentData.payload
          });

          intentsGenerated++;
        }
      }

      // Update sync timestamp
      await db.update(userIntegrations)
        .set({ lastSyncAt: new Date() })
        .where(eq(userIntegrations.id, integration[0].id));

      log.info('Integration sync done', { userId, integrationType, intentsGenerated, files: files.length });

      return {
        success: true,
        filesImported: files.length,
        intentsGenerated,
      };

    } finally {
      // Cleanup temp files
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }

  } catch (error) {
    log.error('Integration sync error', { userId, integrationType, error: error instanceof Error ? error.message : String(error) });
    return {
      success: false,
      filesImported: 0,
      intentsGenerated: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
