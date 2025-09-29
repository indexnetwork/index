import type { IntegrationHandler } from '../index';

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
import { analyzeObjects } from '../../../agents/core/intent_inferrer';
import { saveUser } from '../../user-utils';
import { IntentService } from '../../../services/intent-service';

// Return raw Notion pages as objects
async function fetchObjects(userId: string, lastSyncAt?: Date): Promise<NotionPage[]> {
  try {
    log.info('Notion objects sync start', { userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();
    const connectedAccounts = await composio.connectedAccounts.list({ userIds: [userId], toolkitSlugs: ['notion'] });
    const account = connectedAccounts?.items?.[0];
    if (!account) return [];
    const connectedAccountId = account.id;

    // Search pages sorted by last_edited_time desc
    const search = await composio.tools.execute('NOTION_SEARCH_NOTION_PAGE', {
      userId,
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
          userId,
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

    log.info('Notion objects sync done', { userId, objects: allPages.length });
    return allPages;
  } catch (error) {
    log.error('Notion objects sync error', { userId, error: (error as Error).message });
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
  sourceId: string
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
    const extractedUser = {
      email: `${firstPage.created_by.name || notionUserId}@notion.local`,
      name: firstPage.created_by.name || notionUserId,
      provider: 'notion' as const,
      providerId: notionUserId
    };

    try {
      // Save user individually
      const createdUser = await saveUser(extractedUser);
      if (createdUser.isNewUser) {
        newUsersCreated++;
      }
      usersProcessed++;

      // Generate intents for this user
      const existingIntents = await IntentService.getUserIntents(createdUser.id);
      
      const result = await analyzeObjects(
        userPages,
        `Generate intents for Notion user "${createdUser.name}" based on their pages`,
        Array.from(existingIntents),
        3,
        60000
      );

      if (result.success) {
        for (const intentData of result.intents) {
          if (!existingIntents.has(intentData.payload)) {
            await IntentService.createIntent({
              payload: intentData.payload,
              userId: createdUser.id,
              sourceId,
              sourceType: 'integration'
            });
            totalIntentsGenerated++;
            existingIntents.add(intentData.payload);
          }
        }
      }
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

export const notionHandler: IntegrationHandler<NotionPage> = { fetchObjects };
