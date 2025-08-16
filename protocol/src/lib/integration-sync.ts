import fs from 'fs';
import path from 'path';
import db from './db';
import { userIntegrations, intents, intentIndexes } from './schema';
import { eq, and, isNull } from 'drizzle-orm';
import { analyzeFolder } from '../agents/core/intent_inferrer';
import { handlers, IntegrationFile } from './integrations';

interface SyncResult {
  success: boolean;
  filesImported: number;
  intentsGenerated: number;
  error?: string;
}

// Save files to temp directory
async function saveFilesToTemp(files: IntegrationFile[], userId: string): Promise<{ tempDir: string; fileIds: string[] }> {
  const tempDir = path.join(process.cwd(), 'temp-uploads', `sync-${userId}-${Date.now()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  console.log(`[Integration Sync] Saving ${files.length} files to temp directory ${tempDir}`);

  const fileIds: string[] = [];

  for (const file of files) {
    const fileName = `${file.id}.md`;
    const filePath = path.join(tempDir, fileName);

    await fs.promises.writeFile(filePath, file.content);
    console.log(`[Integration Sync] Wrote file ${filePath} (${file.content.length} chars)`);
    fileIds.push(file.id);
  }

  console.log(`[Integration Sync] Saved files with ids: ${fileIds.join(', ')}`);
  return { tempDir, fileIds };
}

// Get existing intents to avoid duplicates
async function getExistingIntents(userId: string, indexId?: string): Promise<string[]> {
  console.log(`[Integration Sync] Fetching existing intents for user ${userId}${indexId ? ` and index ${indexId}` : ''}`);
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
  console.log(`[Integration Sync] Found ${payloads.length} existing intents`);
  return payloads;
}

// Sync integration files and generate intents
export async function syncIntegration(
  userId: string,
  integrationType: string,
  indexId?: string
): Promise<SyncResult> {
  try {
    console.log(`[Integration Sync] Starting sync for user ${userId}, integration ${integrationType}${indexId ? `, index ${indexId}` : ''}`);

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
      console.warn(`[Integration Sync] No active ${integrationType} integration found for user ${userId}`);
      return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Integration not connected' };
    }

    const { lastSyncAt } = integration[0];
    console.log(`[Integration Sync] Last sync timestamp: ${lastSyncAt?.toISOString() ?? 'never'}`);

    const handler = handlers[integrationType];
    if (!handler) {
      return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Unsupported integration type' };
    }
    const files = await handler.fetchFiles(userId, lastSyncAt || undefined);

    console.log(`[Integration Sync] Retrieved ${files.length} file(s) from ${integrationType}`);

    if (files.length === 0) {
      // Update sync timestamp even if no new files
      await db.update(userIntegrations)
        .set({ lastSyncAt: new Date() })
        .where(eq(userIntegrations.id, integration[0].id));

      console.log(`Sync completed for ${integrationType}: No new files found`);
      return { success: true, filesImported: 0, intentsGenerated: 0 };
    }

    // Save files to temp directory
    const { tempDir, fileIds } = await saveFilesToTemp(files, userId);
    console.log(`[Integration Sync] Files saved to temp directory ${tempDir}. IDs: ${fileIds.join(', ')}`);

    try {
      // Get existing intents for deduplication
      const existingIntents = await getExistingIntents(userId, indexId);
      console.log(`[Integration Sync] Existing intents count: ${existingIntents.length}`);
      // Analyze files with intent inferrer
      const result = await analyzeFolder(
        tempDir,
        fileIds,
        `Generate intents based on content from ${integrationType} integration`,
        existingIntents,
        [], // existingSuggestions
        30, // count
        60000 // timeout
      );

      console.log(`[Integration Sync] analyzeFolder result: success=${result.success}, intents=${result.intents?.length || 0}`);

      let intentsGenerated = 0;

      if (result.success && result.intents.length > 0) {
        // Create intents in database
        for (const intentData of result.intents) {
          console.log('[Integration Sync] Creating intent with payload:', intentData.payload);
          const newIntent = await db.insert(intents).values({
            payload: intentData.payload,
            userId,
            isIncognito: false
          }).returning();

          // Associate with index if provided
          if (indexId && newIntent.length > 0) {
            await db.insert(intentIndexes).values({
              intentId: newIntent[0].id,
              indexId
            });
          }

          intentsGenerated++;
        }
      }

      // Update sync timestamp
      await db.update(userIntegrations)
        .set({ lastSyncAt: new Date() })
        .where(eq(userIntegrations.id, integration[0].id));

      console.log(`[Integration Sync] Sync successful. Generated ${intentsGenerated} intents from ${files.length} files`);

      return {
        success: true,
        filesImported: files.length,
        intentsGenerated,
      };

    } finally {
      // Cleanup temp files
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      console.log(`[Integration Sync] Cleaned up temp directory ${tempDir}`);
    }

  } catch (error) {
    console.error('Sync integration error:', error);
    return {
      success: false,
      filesImported: 0,
      intentsGenerated: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
