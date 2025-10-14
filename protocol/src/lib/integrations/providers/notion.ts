import type { IntegrationHandler } from '../index';
import { resolveNotionUser } from '../../user-utils';
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

    // Search pages sorted by last_edited_time desc
    const search = await composio.tools.execute('NOTION_SEARCH_NOTION_PAGE', {
      connectedAccountId,
      arguments: {
        query: '',
        sort: { timestamp: 'last_edited_time', direction: 'descending' },
        page_size: 100,
      },
    });
    
    // Parse search results directly from API response
    const items = (search as any)?.data?.response_data?.results ?? [];
    log.info('Notion pages', { count: items.length });

    const allPages: NotionPage[] = [];
    
    for (const item of items) {
      if (!item?.id) continue; // Skip invalid items
      const lastModified = new Date(item.last_edited_time as any);
      if (lastSyncAt && lastModified <= lastSyncAt) continue;

      try {
        const blocksResp = await composio.tools.execute('NOTION_FETCH_BLOCK_CONTENTS', {
          connectedAccountId,
          arguments: { block_id: item.id, page_size: 100 },
        });
        
        // Parse blocks directly from API response
        const blocks = (blocksResp as any)?.data?.block_child_data?.results ?? [];
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

// Process Notion pages to generate intents per user
export async function processNotionPages(
  pages: NotionPage[],
  integration: { id: string; indexId: string }
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  if (!pages.length) {
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }

  log.info('Processing Notion pages', { count: pages.length });

  // Group pages by Notion user ID first
  const pagesByUser = new Map<string, NotionPage[]>();
  for (const page of pages) {
    const userId = page.created_by.id;
    if (!pagesByUser.has(userId)) {
      pagesByUser.set(userId, []);
    }
    pagesByUser.get(userId)!.push(page);
  }

  let totalIntentsGenerated = 0;
  let usersProcessed = 0;
  let newUsersCreated = 0;

  // Process each user individually
  for (const [notionUserId, userPages] of pagesByUser) {
    if (!userPages.length) continue;

    // Extract user info from the first page
    const firstPage = userPages[0];

    try {
      // Save user individually using the Notion resolver
      const createdUser = await resolveNotionUser(
        `${firstPage.created_by.name || notionUserId}@notion.local`,
        notionUserId,
        firstPage.created_by.name || notionUserId
      );
      
      if (!createdUser) {
        console.error(`Failed to resolve Notion user: ${notionUserId}`);
        continue;
      }
      
      if (createdUser.isNewUser) {
        newUsersCreated++;
      }
      usersProcessed++;

      // Add user as index member if not already a member
      await ensureIndexMembership(createdUser.id, integration.indexId);

      // Queue intent generation for this user
      await addGenerateIntentsJob({
        userId: createdUser.id,
        sourceId: integration.id,
        sourceType: 'integration',
        objects: userPages,
        instruction: `Generate intents for Notion user "${createdUser.name}" based on their pages`,
        indexId: integration.indexId,
        intentCount: 3
      }, 6);
      
      totalIntentsGenerated++; // Count queued jobs
    } catch (error) {
      log.error('Failed to process Notion user', {
        notionUserId,
        name: firstPage.created_by.name,
        error: error instanceof Error ? error.message : String(error)
      });
      // Continue processing other users even if one fails
    }
  }

  log.info('Notion processing complete', { 
    intentsGenerated: totalIntentsGenerated,
    usersProcessed,
    newUsersCreated
  });

  return { 
    intentsGenerated: totalIntentsGenerated, 
    usersProcessed,
    newUsersCreated
  };
}

// Extract Notion users from pages
export function extractNotionUsers(pages: any[]) {
  const userMap = new Map();
  
  for (const page of pages) {
    const createdBy = page.created_by?.id;
    if (!createdBy || userMap.has(createdBy)) continue;
    
    const name = page.created_by?.name || `notion-user-${createdBy}`;
    const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}+notion-${createdBy}@notion.index.app`;
    
    userMap.set(createdBy, {
      email,
      name,
      provider: 'notion',
      providerId: createdBy
    });
  }
  
  return Array.from(userMap.values());
}

export const notionHandler: IntegrationHandler<NotionPage> = { 
  fetchObjects,
  processObjects: processNotionPages
};
