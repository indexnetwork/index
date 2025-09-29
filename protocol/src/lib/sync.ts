import crypto from 'crypto';
import db from './db';
import { userIntegrations, indexLinks } from './schema';
import { eq, and, isNull } from 'drizzle-orm';
import { log } from './log';
import { handlers } from './integrations';
import { processDiscordMessages } from './integrations/providers/discord';
import { processSlackMessages } from './integrations/providers/slack';
import { processFiles } from './integrations/files/processor';
import { crawlLinksForIndex } from './crawl/web_crawler';

interface SyncResult {
  success: boolean;
  filesImported: number;
  intentsGenerated: number;
  usersProcessed?: number;
  newUsersCreated?: number;
  error?: string;
}

// Main sync function - handles all integration types
export async function syncIntegration(
  userId: string,
  integrationType: string
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

    let intentsGenerated = 0;
    let usersProcessed = 0;
    let newUsersCreated = 0;
    
    if (integrationType === 'discord') {
      if (handler.fetchObjects) {
        const messages = await handler.fetchObjects(userId, lastSyncAt || undefined);
        const result = await processDiscordMessages(messages as any, integration[0].id);
        intentsGenerated = result.intentsGenerated;
        usersProcessed = result.usersProcessed;
        newUsersCreated = result.newUsersCreated;
      }
    } else if (integrationType === 'slack') {
      if (handler.fetchObjects) {
        const messages = await handler.fetchObjects(userId, lastSyncAt || undefined);
        const result = await processSlackMessages(messages as any, integration[0].id);
        intentsGenerated = result.intentsGenerated;
        usersProcessed = result.usersProcessed;
        newUsersCreated = result.newUsersCreated;
      }
    } else {
      // Traditional file processing for Gmail, Calendar, Notion
      if (handler.fetchFiles) {
        const files = await handler.fetchFiles(userId, lastSyncAt || undefined);
        log.info('Provider files', { count: files.length });

        if (files.length === 0) {
          await db.update(userIntegrations)
            .set({ lastSyncAt: new Date() })
            .where(eq(userIntegrations.id, integration[0].id));
          return { success: true, filesImported: 0, intentsGenerated: 0 };
        }

        const result = await processFiles(userId, files, integration[0].id, 'integration');
        intentsGenerated = result.intentsGenerated;
      }
    }

    // Update sync timestamp
    await db.update(userIntegrations)
      .set({ lastSyncAt: new Date() })
      .where(eq(userIntegrations.id, integration[0].id));

    log.info('Integration sync done', { 
      userId, 
      integrationType, 
      intentsGenerated, 
      usersProcessed, 
      newUsersCreated
    });

    return {
      success: true,
      filesImported: 0,
      intentsGenerated,
      usersProcessed,
      newUsersCreated,
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

// Queue-based sync functions (from sync/providers.ts and sync/runner.ts)
export type SyncProviderName = 'links' | 'gmail' | 'notion' | 'slack' | 'discord' | 'calendar';

export interface SyncProvider<Params extends Record<string, any> = any> {
  name: SyncProviderName;
  start(run: any, params: Params, update: (patch: any) => Promise<void>): Promise<void>;
}

// Links sync provider
export const linksProvider: SyncProvider<{ linkId: string }> = {
  name: 'links',
  async start(run, params, update) {
    const singleLink = await db.select().from(indexLinks)
      .where(and(eq(indexLinks.userId, run.userId), eq(indexLinks.id, params.linkId)))
      .limit(1);
    
    if (singleLink.length === 0) {
      await update({ stats: { filesImported: 0, intentsGenerated: 0, note: 'link-not-found' } });
      return;
    }

    const link = singleLink[0];
    const crawlResult = await crawlLinksForIndex([link.url]);
    
    if (crawlResult.files.length > 0) {
      const result = await processFiles(
        run.userId,
        crawlResult.files,
        params.linkId,
        'link'
      );
      await update({ stats: { filesImported: result.filesImported, intentsGenerated: result.intentsGenerated } });
    } else {
      await update({ stats: { filesImported: 0, intentsGenerated: 0 } });
    }
  }
};

// Integration sync provider
export function createIntegrationProvider(type: string): SyncProvider {
  return {
    name: type as SyncProviderName,
    async start(run, params, update) {
      const result = await syncIntegration(run.userId, type);
      await update({ 
        stats: { 
          filesImported: result.filesImported, 
          intentsGenerated: result.intentsGenerated,
          usersProcessed: result.usersProcessed,
          newUsersCreated: result.newUsersCreated
        } 
      });
    },
  };
}

// Sync runner
const providers: Record<SyncProviderName, SyncProvider> = {
  links: linksProvider,
  notion: createIntegrationProvider('notion'),
  gmail: createIntegrationProvider('gmail'),
  slack: createIntegrationProvider('slack'),
  discord: createIntegrationProvider('discord'),
  calendar: createIntegrationProvider('calendar'),
};

export async function runSync(provider: SyncProviderName, userId: string, params: Record<string, any> = {}) {
  const p = providers[provider];
  if (!p) throw new Error('Unknown provider');
  
  const run = {
    id: crypto.randomBytes(16).toString('hex'),
    provider,
    userId,
    createdAt: Date.now(),
  };
  
  let stats: Record<string, any> = {};
  const update = async (patch: any) => {
    if (patch.stats) stats = { ...stats, ...patch.stats };
  };
  
  await p.start(run, params, update);
  return { stats };
}

export function getProvider(name: SyncProviderName) {
  return providers[name];
}
