import crypto from 'crypto';
import { log } from '../../lib/log';
import type { IntegrationFile } from '../../lib/integrations';
import { extractUrlContent } from '../parallels';

type CrawlResult = {
  files: IntegrationFile[];
  urlMap: Record<string, { url: string; contentHash: string; lastModified: Date }>;
  pagesVisited: number;
};

function sha1(s: string | Buffer) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function sanitizeName(s: string): string {
  return s.replace(/[\/:*?"<>|\n\r\t]/g, '-').slice(0, 120);
}

export async function crawlLinksForIndex(urls: string[]): Promise<CrawlResult> {
  const now = new Date();
  const files: IntegrationFile[] = [];
  const urlMap: Record<string, { url: string; contentHash: string; lastModified: Date }> = {};

  // Process URLs in parallel using Parallels API
  const contentPromises = urls.map(async (url) => {
    try {
      const content = await extractUrlContent(url);
      return { url, content };
    } catch (error) {
      log.warn('Failed to extract URL content', { url, error: (error as Error).message });
      return { url, content: null };
    }
  });

  const results = await Promise.all(contentPromises);

  for (const { url, content } of results) {
    if (!url || !content || content.length < 10) {
      log.warn(`Skipping result for ${url}: URL or content missing (content len: ${content?.length || 0})`);
      continue;
    }

    try {
      const id = sha1(url);
      const name = sanitizeName(new URL(url).hostname + new URL(url).pathname) || id;
      files.push({
        id,
        name: `${name}.md`,
        content,
        lastModified: now,
        type: 'text/markdown',
        size: content.length,
      });
      urlMap[id] = { url, contentHash: sha1(content), lastModified: now };
    } catch (e) {
      log.warn('Parallels result skipped', { url, error: (e as Error).message });
    }
  }

  return { files, urlMap, pagesVisited: files.length };
}
