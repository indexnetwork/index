import crypto from 'crypto';
import { URL } from 'url';
import { log } from '../../lib/log';
import type { IntegrationFile } from '../../lib/integrations';
import { concurrencyLimit } from '../../lib/integrations/core/util';
import { config } from '../config';

// Per-link overrides removed; crawler now uses global defaults

type CrawlResult = {
  files: IntegrationFile[];
  urlMap: Record<string, { url: string; contentHash: string; lastModified: Date }>;
  pagesVisited: number;
};

function sha1(s: string | Buffer) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function stripHtml(html: string): string {
  try {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>(?=\s*<)/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<li>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return html;
  }
}

function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return '';
  const t = m[1] || '';
  return stripHtml(t).replace(/\s+/g, ' ').trim();
}

function sanitizeName(s: string): string {
  return s.replace(/[\/:*?"<>|\n\r\t]/g, '-').slice(0, 120);
}

async function fetchText(u: string): Promise<{ ok: boolean; status: number; headers: Record<string, string>; body: string }>
{
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), config.webCrawl.requestTimeoutMs);
  try {
    const f: any = (globalThis as any).fetch;
    if (!f) throw new Error('fetch not available in runtime');
    const resp = await f(u, { redirect: 'follow', signal: controller.signal });
    const headers: Record<string, string> = {};
    (resp.headers as any).forEach((v: string, k: string) => headers[k.toLowerCase()] = v);
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, headers, body: text };
  } finally {
    clearTimeout(id);
  }
}

async function fetchRobotsTxt(origin: string): Promise<string | null> {
  try {
    const url = origin.endsWith('/') ? origin + 'robots.txt' : origin + '/robots.txt';
    const r = await fetchText(url);
    if (r.ok && r.status === 200) return r.body;
    return null;
  } catch {
    return null;
  }
}

function parseRobots(robots: string | null) {
  // Minimal parser: collect Disallow paths for User-agent: *
  const rules: { disallow: string[] } = { disallow: [] };
  if (!robots) return rules;
  const lines = robots.split(/\r?\n/);
  let inGlobal = false;
  for (const ln of lines) {
    const line = ln.trim();
    if (!line || line.startsWith('#')) continue;
    const [kRaw, vRaw] = line.split(':', 2);
    const k = (kRaw || '').trim().toLowerCase();
    const v = (vRaw || '').trim();
    if (k === 'user-agent') {
      inGlobal = v === '*';
    } else if (inGlobal && k === 'disallow') {
      if (v) rules.disallow.push(v);
    }
  }
  return rules;
}

function pathAllowed(pathname: string, rules: { disallow: string[] }): boolean {
  for (const d of rules.disallow) {
    if (d === '/') return false;
    if (d && pathname.startsWith(d)) return false;
  }
  return true;
}

function withinScope(target: URL, base: URL): boolean {
  if (target.protocol !== base.protocol || target.hostname !== base.hostname) return false;
  const basePath = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/';
  const tPath = target.pathname.endsWith('/') ? target.pathname : target.pathname + '/';
  return tPath.startsWith(basePath);
}

function extractLinks(html: string, baseUrl: URL): URL[] {
  const urls: URL[] = [];
  const re = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    try {
      const u = new URL(href, baseUrl);
      urls.push(u);
    } catch {
      // ignore
    }
  }
  return urls;
}

export async function crawlLinksForIndex(urls: string[]): Promise<CrawlResult> {
  const files: IntegrationFile[] = [];
  const urlMap: Record<string, { url: string; contentHash: string; lastModified: Date }> = {};
  let pagesVisited = 0;

  const limit = concurrencyLimit(config.webCrawl.concurrency);

  for (const linkUrl of urls) {
    try {
      const base = new URL(linkUrl);
      const robots = config.webCrawl.respectRobots ? parseRobots(await fetchRobotsTxt(base.origin)) : { disallow: [] };
      const seen = new Set<string>();

      type QueueItem = { url: URL; depth: number };
      const queue: QueueItem[] = [{ url: base, depth: 0 }];

      const runTask = async (item: QueueItem) => {
        if (pagesVisited >= config.webCrawl.maxPages) return;
        const key = item.url.toString();
        if (seen.has(key)) return;
        seen.add(key);

        if (!withinScope(item.url, base)) return;
        if (!pathAllowed(item.url.pathname, robots)) return;

        // include/exclude filters removed; crawl remains scoped by host/path and robots

        const res = await fetchText(item.url.toString());
        if (!res.ok) return;
        pagesVisited += 1;

        const lastMod = res.headers['last-modified'] ? new Date(res.headers['last-modified']) : new Date();
        const etag = res.headers['etag'];
        const contentHash = etag ? etag : sha1(res.body);
        const title = extractTitle(res.body) || item.url.pathname || item.url.toString();
        const plain = stripHtml(res.body);
        const md = `# ${title}\n\n${plain}`.trim();
        const id = sha1(item.url.toString());
        const baseName = sanitizeName(`${base.hostname}${item.url.pathname || ''}`).replace(/^-+/, '');
        const name = baseName || id;

        const file: IntegrationFile = {
          id,
          name: `${name || id}.md`,
          content: md,
          lastModified: lastMod,
          type: 'text/markdown',
          size: md.length,
        };
        files.push(file);
        urlMap[id] = { url: item.url.toString(), contentHash, lastModified: lastMod };

        // enqueue child links if depth allows
        if (item.depth < config.webCrawl.maxDepth) {
          const links = extractLinks(res.body, item.url);
          for (const n of links) {
            if (withinScope(n, base)) queue.push({ url: n, depth: item.depth + 1 });
          }
        }
      };

      while (queue.length && pagesVisited < config.webCrawl.maxPages) {
        const batch: Promise<void>[] = [];
        // process a small batch concurrently
        for (let i = 0; i < config.webCrawl.concurrency && queue.length; i++) {
          const item = queue.shift()!;
          batch.push(limit(() => runTask(item)) as unknown as Promise<void>);
        }
        await Promise.allSettled(batch);
      }

    } catch (err) {
      log.warn('crawl link failed', { url: linkUrl, error: (err as Error).message });
    }
  }

  return { files, urlMap, pagesVisited };
}
