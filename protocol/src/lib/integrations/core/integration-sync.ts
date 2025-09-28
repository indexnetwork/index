import db from '../../db';
import { userIntegrations } from '../../schema';
import { eq, and, isNull } from 'drizzle-orm';
import { processFilesToIntents } from '../../sync/process-intents';
import { handlers } from '../index';
import { log } from '../../log';

interface SyncResult {
  success: boolean;
  filesImported: number;
  intentsGenerated: number;
  error?: string;
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

    // Process files to intents using centralized function
    const { intentsGenerated } = await processFilesToIntents({
      userId,
      files,
      sourceId: integration[0].id,
      sourceType: 'integration',
    });

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
