import crypto from 'crypto';
import db from './db';
import { userIntegrations, indexLinks } from './schema';
import { eq, and, isNull } from 'drizzle-orm';
import { log } from './log';
import { handlers, processObjects } from './integrations';
import { processFiles } from './integrations/files/processor';
import { crawlLinksForIndex } from './crawl/web_crawler';
import { INTEGRATIONS } from './integrations/config';
import { syncDirectoryMembers, type DirectorySyncProvider } from './integrations/directory-sync';
import { airtableDirectoryProvider } from './integrations/providers/airtable-directory';
import { notionDirectoryProvider } from './integrations/providers/notion-directory';
import { googledocsDirectoryProvider } from './integrations/providers/googledocs-directory';
import { getIntegrationById } from './integrations/integration-utils';

interface SyncResult {
  success: boolean;
  filesImported: number;
  intentsGenerated: number;
  usersProcessed?: number;
  newUsersCreated?: number;
  error?: string;
}

// Get directory sync provider for integration type
function getDirectoryProvider(integrationType: string): DirectorySyncProvider | null {
  switch (integrationType) {
    case 'airtable':
      return airtableDirectoryProvider;
    case 'notion':
      return notionDirectoryProvider;
    case 'googledocs':
      return googledocsDirectoryProvider;
    default:
      return null;
  }
}

// Main sync function - handles all integration types
export async function syncIntegration(
  integrationId: string
): Promise<SyncResult> {
  try {
    log.info('Integration sync start', { integrationId });

    // Get integration details (including config)
    const integrationDetails = await getIntegrationById(integrationId);
    if (!integrationDetails) {
      return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Integration not connected' };
    }

    // Get integration record for lastSyncAt
    const integration = await db.select()
      .from(userIntegrations)
      .where(and(
        eq(userIntegrations.id, integrationId),
        eq(userIntegrations.status, 'connected'),
        isNull(userIntegrations.deletedAt)
      ))
      .limit(1);

    if (integration.length === 0) {
      return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Integration not connected' };
    }

    const { lastSyncAt, integrationType } = integration[0];
    const integrationConfig = INTEGRATIONS[integrationType as keyof typeof INTEGRATIONS];

    // Check if this is an index integration with directory sync enabled
    if (integrationDetails.indexId && 
        integrationConfig?.capabilities.indexSyncModes && 
        'directorySync' in integrationConfig.capabilities.indexSyncModes &&
        integrationConfig.capabilities.indexSyncModes.directorySync &&
        integrationDetails.config?.directorySync?.enabled) {
      const provider = getDirectoryProvider(integrationType);
      if (!provider) {
        return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Directory sync provider not found' };
      }

      log.info('Running directory sync', { integrationId, integrationType });
      const result = await syncDirectoryMembers(integrationId, provider);

      // Update sync timestamp
      await db.update(userIntegrations)
        .set({ lastSyncAt: new Date() })
        .where(eq(userIntegrations.id, integration[0].id));

      return {
        success: result.success,
        filesImported: 0,
        intentsGenerated: 0,
        usersProcessed: result.membersAdded,
        error: result.error
      };
    }

    // Otherwise, use existing sync flow (intent generation or attribution)
    const handler = handlers[integrationType];
    if (!handler) {
      return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Unsupported integration type' };
    }

    let intentsGenerated = 0;
    let usersProcessed = 0;
    let newUsersCreated = 0;
    let filesImported = 0;
    
    // Generic sync logic - works with any provider
    if (handler.fetchObjects) {
      // Object-based providers (Discord, Slack, Notion, Airtable, Google Docs)
      const objects = await handler.fetchObjects(integrationId, lastSyncAt || undefined);
      const result = await processObjects(objects, {
        id: integration[0].id,
        indexId: integration[0].indexId,
        userId: integration[0].userId,
        enableUserAttribution: integration[0].enableUserAttribution ?? undefined
      }, handler);
      
      intentsGenerated = result.intentsGenerated;
      usersProcessed = result.usersProcessed;
      newUsersCreated = result.newUsersCreated;
      
    } else if (handler.fetchFiles) {
      // File-based providers (Gmail, Google Calendar)
      const files = await handler.fetchFiles(integrationId, lastSyncAt || undefined);
      log.info('Provider files', { count: files.length });

      if (files.length === 0) {
        await db.update(userIntegrations)
          .set({ lastSyncAt: new Date() })
          .where(eq(userIntegrations.id, integration[0].id));
        return { success: true, filesImported: 0, intentsGenerated: 0 };
      }

      const result = await processFiles(integration[0].userId, files, {
        id: integration[0].id,
        indexId: integration[0].indexId ?? undefined
      }, 'integration');
      intentsGenerated = result.intentsGenerated;
      filesImported = result.filesImported;
    } else {
      throw new Error(`Provider ${integrationType} has no valid sync methods`);
    }

    // Update sync timestamp
    await db.update(userIntegrations)
      .set({ lastSyncAt: new Date() })
      .where(eq(userIntegrations.id, integration[0].id));

    log.info('Integration sync done', { 
      integrationId,
      userId: integration[0].userId, 
      integrationType: integration[0].integrationType, 
      intentsGenerated, 
      usersProcessed, 
      newUsersCreated
    });

    return {
      success: true,
      filesImported,
      intentsGenerated,
      usersProcessed,
      newUsersCreated,
    };

  } catch (error) {
    log.error('Integration sync error', { integrationId, error: error instanceof Error ? error.message : String(error) });
    return {
      success: false,
      filesImported: 0,
      intentsGenerated: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Queue-based sync functions (from sync/providers.ts and sync/runner.ts)
import { SyncProviderName, getIntegrationNames } from './integrations/config';

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
    let crawlResult;
    try {
      crawlResult = await crawlLinksForIndex([link.url]);
    } catch (error) {
      await update({ stats: { filesImported: 0, intentsGenerated: 0, error: error instanceof Error ? error.message : String(error) } });
      return;
    }
    
    if (crawlResult.files.length > 0) {
      try {
        const result = await processFiles(
          run.userId,
          crawlResult.files,
          params.linkId,
          'link'
        );
        await update({ stats: { filesImported: result.filesImported, intentsGenerated: result.intentsGenerated } });
      } catch (error) {
        await update({ stats: { filesImported: 0, intentsGenerated: 0, error: error instanceof Error ? error.message : String(error) } });
        return;
      }
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
      // Use the integrationId directly from params
      if (!params.integrationId) {
        throw new Error(`integrationId is required for ${type} sync`);
      }

      const result = await syncIntegration(params.integrationId);
      await update({ 
        stats: { 
          filesImported: result.filesImported, 
          intentsGenerated: result.intentsGenerated,
          usersProcessed: result.usersProcessed,
          newUsersCreated: result.newUsersCreated,
          error: result.error
        } 
      });
    },
  };
}

// Sync runner
const providers: Record<SyncProviderName, SyncProvider> = {
  links: linksProvider,
  ...Object.fromEntries(
    getIntegrationNames().map(name => [name, createIntegrationProvider(name)])
  ) as Record<Exclude<SyncProviderName, 'links'>, SyncProvider>,
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
