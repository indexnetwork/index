import type { IntegrationHandler, IntegrationFile } from './index';
import { getClient } from './composio';
import { log } from '../log';
import { withRetry, concurrencyLimit, mapNotionToFile } from './util';

async function fetchFiles(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]> {
  try {
    log.info('Notion sync start', { userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();
    const connectedAccounts = await withRetry(() => composio.connectedAccounts.list({ userIds: [userId], toolkitSlugs: ['notion'] }));
    const account = connectedAccounts?.items?.[0];
    if (!account) return [];
    const connectedAccountId = account.id;

    // Search pages sorted by last_edited_time desc
    const search = await withRetry(() => composio.tools.execute('NOTION_SEARCH_NOTION_PAGE', {
      userId,
      connectedAccountId,
      arguments: {
        query: '',
        sort: { timestamp: 'last_edited_time', direction: 'descending' },
        page_size: 100,
      },
    }));
    
    // Parse search results directly from API response
    const items = (search as any)?.data?.response_data?.results ?? [];
    log.info('Notion pages', { count: items.length });

    const limit = concurrencyLimit(8);
    const files: IntegrationFile[] = [];
    const tasks = items.map((item: any) => limit(async () => {
      if (!item?.id) return; // Skip invalid items
      const lastModified = new Date(item.last_edited_time as any);
      if (lastSyncAt && lastModified <= lastSyncAt) return;

      const blocksResp = await withRetry(() => composio.tools.execute('NOTION_FETCH_BLOCK_CONTENTS', {
        userId,
        connectedAccountId,
        arguments: { block_id: item.id, page_size: 100 },
      }), { retries: 3 });
      
      // Parse blocks directly from API response
      const blocks = (blocksResp as any)?.data?.block_child_data?.results ?? [];
      const file = mapNotionToFile(item, blocks);
      files.push(file);
    }));

    await Promise.all(tasks);
    log.info('Notion sync done', { userId, files: files.length });
    return files;
  } catch (error) {
    log.error('Notion sync error', { userId, error: (error as Error).message });
    return [];
  }
}

export const notionHandler: IntegrationHandler = { fetchFiles };
