import type { IntegrationHandler, IntegrationFile } from './index';
import { getClient } from './composio';
import { log } from '../log';
import { withRetry, concurrencyLimit, NotionBlocksResponse, NotionSearchResponse, NotionSearchItem, mapNotionToFile } from './util';

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
    const parsedSearch = NotionSearchResponse.safeParse(search);
    const items = parsedSearch.success ? (parsedSearch.data.data?.response_data as any)?.results ?? [] : [];
    log.info('Notion pages', { count: items.length });

    const limit = concurrencyLimit(8);
    const files: IntegrationFile[] = [];
    const tasks = items.map((item: any) => limit(async () => {
      const itemParsed = NotionSearchItem.safeParse(item);
      if (!itemParsed.success) return;
      const lastModified = new Date(itemParsed.data.last_edited_time as any);
      if (lastSyncAt && lastModified <= lastSyncAt) return;

      const blocksResp = await withRetry(() => composio.tools.execute('NOTION_FETCH_BLOCK_CONTENTS', {
        userId,
        connectedAccountId,
        arguments: { block_id: itemParsed.data.id, page_size: 100 },
      }), { retries: 3 });
      const parsedBlocks = NotionBlocksResponse.safeParse(blocksResp);
      const blocks = parsedBlocks.success ? (parsedBlocks.data.data?.block_child_data as any)?.results ?? [] : [];
      const file = mapNotionToFile(itemParsed.data, blocks);
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
