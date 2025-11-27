import { getIntegrationById } from '../integration-utils';
import { ensureIndexMembership } from '../membership-utils';
import { addGenerateIntentsJob } from '../../queue/llm-queue';

const MAX_INTENTS_PER_USER = 3;

export interface NotionPage {
  id: string;
  title: string;
  content: string;
  created_time: string;
  last_edited_time: string;
  created_by: {
    id: string;
    name?: string;
  };
}
import { getClient } from '../composio';
import { log } from '../../log';


/**
 * Initialize Notion integration sync.
 * Fetches pages and queues intent generation for the integration owner.
 * For index integrations: skips (directory sync handles this).
 */
export async function initNotion(
  integrationId: string,
  lastSyncAt?: Date
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      log.error('Integration not found', { integrationId });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    // Index integration: skip intent generation (directory sync handles this)
    if (integration.indexId) {
      log.info('Skipping intent generation for index integration', { integrationId });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    if (!integration.connectedAccountId) {
      log.error('No connected account ID found for integration', { integrationId });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    log.info('🚀 Notion sync starting', { integrationId, userId: integration.userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();
    const connectedAccountId = integration.connectedAccountId;

    const searchArgs: any = {
      query: '',
      page_size: 100,
    };

    if (lastSyncAt) {
      log.info('🔄 Incremental sync - filtering client-side', { after: lastSyncAt.toISOString() });
    } else {
      log.info('🆕 First sync - fetching all pages');
    }

    const search = await composio.tools.execute('NOTION_SEARCH_NOTION_PAGE', {
      userId: integration.userId,
      connectedAccountId,
      arguments: searchArgs,
    });
    
    const items =
      (search as any)?.data?.response_data?.results ??
      (search as any)?.data?.results ??
      [];
    log.info('Notion pages', { count: items.length });

    const allPages: NotionPage[] = [];
    
    for (const item of items) {
      if (!item?.id) continue;
      
      if (lastSyncAt) {
        const lastModified = new Date(item.last_edited_time as any);
        if (isNaN(lastModified.getTime())) {
          log.warn('Invalid last_edited_time for Notion page', { pageId: item.id, last_edited_time: item.last_edited_time });
          continue;
        }
        if (lastModified < lastSyncAt) {
          continue;
        }
      }

      try {
        const blocksResp = await composio.tools.execute('NOTION_FETCH_BLOCK_CONTENTS', {
          userId: integration.userId,
          connectedAccountId,
          arguments: { block_id: item.id, page_size: 100 },
        });
        
        const blocks =
          (blocksResp as any)?.data?.block_child_data?.results ??
          (blocksResp as any)?.data?.response_data?.results ??
          (blocksResp as any)?.data?.results ??
          [];
        const content = extractContentFromBlocks(blocks);
        const title = extractTitle(item);
        
        allPages.push({
          id: item.id,
          title,
          content,
          created_time: item.created_time,
          last_edited_time: item.last_edited_time,
          created_by: {
            id: item.created_by?.id || 'unknown',
            name: item.created_by?.name
          }
        });
      } catch (error) {
        log.error('❌ Error fetching Notion page blocks', { pageId: item.id, error: (error as Error).message });
      }
    }

    log.info('Notion pages fetched', { integrationId, count: allPages.length });
    
    if (allPages.length === 0) {
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }
    
    // Process for integration owner
    if (integration.indexId) {
      await ensureIndexMembership(integration.userId, integration.indexId);
    }
    
    await addGenerateIntentsJob({
      userId: integration.userId,
      sourceId: integrationId,
      sourceType: 'integration',
      objects: allPages,
      instruction: `Generate intents based on Notion pages`,
      indexId: integration.indexId || undefined,
      intentCount: MAX_INTENTS_PER_USER
    }, 6);
    
    return {
      intentsGenerated: 1,
      usersProcessed: 1,
      newUsersCreated: 0
    };
  } catch (error) {
    log.error('💥 Notion sync failed', { integrationId, error: (error as Error).message });
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }
}

// Helper function to extract content from Notion blocks
function extractContentFromBlocks(blocks: any[]): string {
  const contentParts: string[] = [];
  
  for (const block of blocks) {
    if (!block) continue;
    
    // Extract text from different block types
    const blockType = block.type;
    const blockData = block[blockType];
    
    if (blockData?.rich_text) {
      const text = blockData.rich_text
        .map((rt: any) => rt.plain_text || '')
        .join('');
      if (text.trim()) {
        contentParts.push(text.trim());
      }
    }
  }
  
  return contentParts.join('\n\n');
}

// Helper function to extract title from Notion page
function extractTitle(item: any): string {
  if (item.properties?.title?.title?.[0]?.plain_text) {
    return item.properties.title.title[0].plain_text;
  }
  if (item.properties?.Name?.title?.[0]?.plain_text) {
    return item.properties.Name.title[0].plain_text;
  }
  return item.id || 'Untitled';
}

