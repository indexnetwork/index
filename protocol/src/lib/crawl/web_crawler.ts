import crypto from 'crypto';
import { log } from '../../lib/log';
import type { IntegrationFile } from '../../lib/integrations';

type CrawlResult = {
  files: IntegrationFile[];
  urlMap: Record<string, { url: string; contentHash: string; lastModified: Date }>;
  pagesVisited: number;
};

type Crawl4AIResult = {
  results?: Array<{
    url?: string;
    requested_url?: string;
    markdown?: { fit_markdown?: string };
    error?: string | null;
  }>;
};

function sha1(s: string | Buffer) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function sanitizeName(s: string): string {
  return s.replace(/[\/:*?"<>|\n\r\t]/g, '-').slice(0, 120);
}

// (simplified) no env boolean parser — fixed sensible defaults

const CRAWL4AI_BASE_URL = process.env.CRAWL4AI_BASE_URL || 'http://crawl4ai.env-dev:11235';
const LLM_PROVIDER = 'openai/gpt-4o';

function allPatternsFewShot(): string {
  const blocks = [
    'Extract only human-readable main content as Markdown. Do not paraphrase.',
    'Exclude navigation, menus, buttons, ads, cookie banners, and footers.',
    'Preserve headings, paragraphs, lists, code blocks, tables, and links.',
    '',
    'Tweet example:',
    '<@handle>: <verbatim tweet text>\n- Posted: <Date/Time>',
    '',
    'YouTube example:',
    '# <Video Title>\n- Channel: <Channel>\n## Description\n<Original description>\n## Transcript (if visible)\n<Excerpts>',
    '',
    'Docs/Notion example:',
    '# <Document Title>\n## <Section>\n<Paragraphs with original wording>',
    '',
    'Generic article example:',
    '# <Article Title>\nBy <Author> — <Date>\n\n<Intro paragraph>\n## <Section Heading>\n<Paragraphs as-is>',
    '',
    'Tables (Sheets/Airtable) example:',
    '| Column A | Column B |\n|---|---|\n| a1 | b1 |\n| a2 | b2 |',
  ];
  return blocks.join('\n');
}

function buildInstruction(): string {
  const base = 'Extract only the content from this page. Remove all non-content elements such as buttons, links, menus, ads, metadata, or boilerplate. Do not paraphrase or summarize — return the exact original text only. Extract as a markdown with a whole.';
  return `${base}\n\n${allPatternsFewShot()}\nBe concise but complete. Keep original wording.`;
}

async function postCrawl(urls: string[], instruction: string): Promise<Crawl4AIResult> {
  const body = {
    urls,
    browser_config: { type: 'BrowserConfig', params: { headless: true } },
    crawler_config: {
      type: 'CrawlerRunConfig',
      params: {
        simulate_user: true,
        override_navigator: true,
        delay_before_return_html: 3,
        magic: true,
        verbose: true,
        remove_overlay_elements: true,
        scan_full_page: false,
        proxy_config: {
          server: process.env.PROXY_SERVER,
          username: process.env.PROXY_USERNAME,
          password: process.env.PROXY_PASSWORD
        },
        markdown_generator: {
          type: 'DefaultMarkdownGenerator',
          params: {
            content_filter: {
              type: 'LLMContentFilter',
              params: {
                llm_config: { type: 'LLMConfig', params: { provider: LLM_PROVIDER, api_token: 'env:OPENAI_API_KEY' } },
                instruction,
              },
            },
          },
        },
      },
    },
  } as const;

  const controller = new AbortController();
  const timeoutMs = Number(process.env.CRAWL4AI_TIMEOUT_MS || '60000');
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${CRAWL4AI_BASE_URL}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    } as any);
    if (!resp.ok) throw new Error(`crawl4ai HTTP ${resp.status}`);
    const json = await resp.json();
    return json as Crawl4AIResult;
  } finally {
    clearTimeout(id);
  }
}

export async function crawlLinksForIndex(urls: string[]): Promise<CrawlResult> {
  // One request with all URLs; rely on crawl4ai to fan out
  const instruction = buildInstruction();
  const data: Crawl4AIResult = await postCrawl(urls, instruction);

  const now = new Date();
  const files: IntegrationFile[] = [];
  const urlMap: Record<string, { url: string; contentHash: string; lastModified: Date }> = {};

  const results = Array.isArray(data?.results) ? data.results : [];
  for (const r of results) {
    try {
      const url: string = r?.url || r?.requested_url || '';
      const md: string = r?.markdown?.fit_markdown || '';
      if (!url || !md) continue;
      const id = sha1(url);
      const name = sanitizeName(new URL(url).hostname + new URL(url).pathname) || id;
      files.push({
        id,
        name: `${name}.md`,
        content: md,
        lastModified: now,
        type: 'text/markdown',
        size: md.length,
      });
      urlMap[id] = { url, contentHash: sha1(md), lastModified: now };
    } catch (e) {
      log.warn('crawl4ai result skipped', { error: (e as Error).message });
    }
  }

  return { files, urlMap, pagesVisited: files.length };
}
