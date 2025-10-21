import type { IntegrationHandler, UserIdentifier } from '../index';
import { getIntegrationById } from '../integration-utils';

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
import { ensureIndexMembership } from '../membership-utils';
import { addGenerateIntentsJob } from '../../queue/llm-queue';


// Return raw Notion pages as objects
async function fetchObjects(integrationId: string, lastSyncAt?: Date): Promise<NotionPage[]> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      log.error('Integration not found', { integrationId });
      return [];
    }

    if (!integration.connectedAccountId) {
      log.error('No connected account ID found for integration', { integrationId });
      return [];
    }

    log.info('Notion objects sync start', { integrationId, userId: integration.userId, lastSyncAt: lastSyncAt?.toISOString() });
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
    
    const items = (search as any)?.data?.results ?? [];
    log.info('Notion pages', { count: items.length });

    const allPages: NotionPage[] = [];
    
    for (const item of items) {
      if (!item?.id) continue;
      
      if (lastSyncAt) {
        const lastModified = new Date(item.last_edited_time as any);
        if (lastModified <= lastSyncAt) {
          continue;
        }
      }

      try {
        const blocksResp = await composio.tools.execute('NOTION_FETCH_BLOCK_CONTENTS', {
          userId: integration.userId,
          connectedAccountId,
          arguments: { block_id: item.id, page_size: 100 },
        });
        
        const blocks = (blocksResp as any)?.data?.results ?? [];
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
        log.error('Error fetching Notion page blocks', { pageId: item.id, error: (error as Error).message });
      }
    }

    log.info('Notion objects sync done', { integrationId, objects: allPages.length });
    
    return allPages;
  } catch (error) {
    log.error('Notion objects sync error', { integrationId, error: (error as Error).message });
    return [];
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

// Extract Notion users from pages
function extractUsers(pages: NotionPage[]): UserIdentifier[] {
  const userMap = new Map<string, UserIdentifier>();
  
  for (const page of pages) {
    const createdBy = page.created_by?.id;
    if (!createdBy || userMap.has(createdBy)) continue;
    
    const name = page.created_by?.name || `notion-user-${createdBy}`;
    const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}+notion-${createdBy}@notion.local`;
    
    userMap.set(createdBy, {
      id: createdBy,
      email,
      name,
      provider: 'notion',
      providerId: createdBy
    });
  }
  
  return Array.from(userMap.values());
}

export const notionHandler: IntegrationHandler<NotionPage> = {
  enableUserAttribution: true,
  fetchObjects,
  extractUsers
};
