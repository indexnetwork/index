/*
  Crawl4AI Smoke Tests
  - Opt-in integration checks for a list of public URLs
  - Calls your crawl4ai instance and validates basic content invariants
  - Skips fragile/auth-walled targets unless explicitly enabled

  Usage:
    CRAWL4AI_BASE_URL=http://crawl4ai.env-dev:11235 \
    OPENAI_API_KEY=... \
    yarn test:crawl4ai

  Optional env:
    CRAWL4AI_FIXTURES=./tests/fixtures/crawl-sites.json
    CRAWL4AI_TIMEOUT_MS=60000
    CRAWL4AI_SHOW_MARKDOWN=true|false
    CRAWL4AI_LOG_MARKDOWN_CHARS=0
    CRAWL4AI_UNIVERSAL_CHECK=true|false
*/

import fs from 'fs';
import path from 'path';
import axios from 'axios';

type Fixture = {
  name: string;
  url: string;
  disabled?: boolean; // skip unless CRAWL4AI_INCLUDE_DISABLED=true
};

type CrawlResult = {
  status: string;
  url: string;
  markdown?: { fit_markdown?: string };
  error?: string | null;
};

const BASE_URL = process.env.CRAWL4AI_BASE_URL || 'http://crawl4ai.env-dev:11235';
const FIXTURES_PATH = process.env.CRAWL4AI_FIXTURES || path.join(__dirname, 'fixtures', 'crawl-sites.json');
// Minimal configuration
const CONCURRENCY = 1;
const TIMEOUT_MS = Number(process.env.CRAWL4AI_TIMEOUT_MS || '60000');
const RETRY_NETWORK = 0;
const UNIVERSAL_CHECK = ['1', 'true', 'yes'].includes(String(process.env.CRAWL4AI_UNIVERSAL_CHECK || 'true').toLowerCase());
const SHOW_MARKDOWN = ['1', 'true', 'yes'].includes(String(process.env.CRAWL4AI_SHOW_MARKDOWN || 'true').toLowerCase());
const LOG_MARKDOWN_CHARS = Number(process.env.CRAWL4AI_LOG_MARKDOWN_CHARS || '0');
const LOG_ANALYSIS = true;

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

function loadFixtures(): Fixture[] {
  const raw = fs.readFileSync(FIXTURES_PATH, 'utf8');
  const arr = JSON.parse(raw) as Fixture[];
  return arr;
}

function fewShotInstruction(): string {
  const common = [
    'Extract only human-readable main content as Markdown. Do not paraphrase.',
    'Exclude navigation, menus, buttons, ads, cookie banners, and footers.',
    'Preserve headings, paragraphs, lists, code blocks, tables, and links.',
  ];
  const youtube = [
    'YouTube watch page example:',
    '# <Video Title>\n',
    '- Channel: <Channel Name>\n- Published: <Date>\n',
    '## Description\n<Original description>\n',
    '## Transcript (if visible)\n<Transcript excerpts>',
  ];
  const tweet = [
    'Tweet page example:',
    '<@handle>: <verbatim tweet text>\n',
    '- Posted: <Date/Time>\n- Media: <alt text if present>',
  ];
  const docs = [
    'Docs/Notion example:',
    '# <Document Title>\n',
    '## <Section>\n<Paragraphs with original wording>\n',
  ];
  const genericArticle = [
    'Generic article example:',
    '# <Article Title>\n',
    'By <Author> — <Date>\n',
    '\n<Intro paragraph as-is>\n',
    '## <Section Heading>\n<Paragraphs as-is>\n',
  ];
  const tables = [
    'Tables (Sheets/Airtable) example:',
    '| Column A | Column B |\n|---|---|\n| a1 | b1 |\n| a2 | b2 |',
  ];
  const parts = [...common, ...tweet, ...youtube, ...docs, ...genericArticle, ...tables];
  return parts.join('\n');
}

function makePayload(url: string, useFewShot: boolean, overrides?: Partial<{
  simulate_user: boolean;
  delay_before_return_html: number;
  scan_full_page: boolean;
  remove_overlay_elements: boolean;
  magic: boolean;
}>) {
  const baseInstruction = 'Extract only the content from this page. Remove all non-content elements such as buttons, links, menus, ads, metadata, or boilerplate. Do not paraphrase or summarize — return the exact original text only. Extract as a markdown with a whole.';

  const instruction = `${baseInstruction}\n\n${fewShotInstruction()}\nBe concise but complete. Keep original wording.`;

  return {
    urls: [url],
    browser_config: {
      type: 'BrowserConfig',
      params: { headless: true },
    },
    crawler_config: {
      type: 'CrawlerRunConfig',
      params: {
        simulate_user: overrides?.simulate_user ?? true,
        override_navigator: true,
        delay_before_return_html: overrides?.delay_before_return_html ?? 3,
        magic: overrides?.magic ?? true,
        verbose: true,
        remove_overlay_elements: overrides?.remove_overlay_elements ?? true,
        scan_full_page: overrides?.scan_full_page ?? false,
        markdown_generator: {
          type: 'DefaultMarkdownGenerator',
          params: {
            content_filter: {
              type: 'LLMContentFilter',
              params: {
                llm_config: {
                  type: 'LLMConfig',
                  params: {
                    provider: 'openai/gpt-4o',
                    api_token: 'env:OPENAI_API_KEY',
                  },
                },
                instruction,
              },
            },
          },
        },
      },
    },
  };
}

function analyzeMarkdown(md: string) {
  const length = md.trim().length;
  const lines = md.split(/\r?\n/);
  const headings = lines.filter(l => /^#{1,6} /.test(l)).length;
  const tableLines = lines.filter(l => /\|/.test(l)).length;
  const paragraphs = lines.filter(l => l.trim().length > 80).length;
  return { length, headings, tableLines, paragraphs };
}

function validate(md: string): { ok: boolean; reason?: string } {
  const { length, paragraphs, headings } = analyzeMarkdown(md);
  if (length === 0) return { ok: false, reason: 'empty markdown' };
  // Single behavior flag: UNIVERSAL_CHECK enforces basic substance check
  if (UNIVERSAL_CHECK && paragraphs < 1) return { ok: false, reason: `no substantial paragraphs (paras=${paragraphs}, len=${length})` };
  const forbid = ['Sign in', 'Accept all cookies', 'Join now'];
  const hit = forbid.find(f => md.includes(f));
  if (hit) return { ok: false, reason: `contains forbidden boilerplate (hit='${hit}')` };
  return { ok: true };
}

async function runOne(fx: Fixture, useFewShot: boolean, overrides?: Parameters<typeof makePayload>[2]) {
  const payload = makePayload(fx.url, useFewShot, overrides);

  console.log(`→ Building payload for ${fx.url}`);

  const started = Date.now();
  // Heartbeat while waiting
  let beat: any = null;
  try {
    beat = setInterval(() => {
      const elapsed = Date.now() - started;
      const s = Math.floor(elapsed / 1000);
      console.log(`… waiting for crawl response (${s}s)`);
    }, 5000);

    const resp = await axios.post(`${BASE_URL}/crawl`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS,
      validateStatus: () => true, // do not throw on 4xx/5xx; we handle below
    });
    const elapsed = Date.now() - started;
    const status = resp.status;
    const data = resp.data;
    const byteSize = Buffer.from(JSON.stringify(data || {})).length;
    console.log(`← Response: HTTP ${status} in ${elapsed}ms, ~${byteSize} bytes`);

    if (status >= 400) {
      throw new Error(`HTTP ${status} from crawl API`);
    }

    const res: CrawlResult | undefined = data?.results?.[0];
    if (!res) throw new Error('Malformed response: missing results[0]');
    if (res.error) throw new Error(`Crawler error: ${res.error}`);
    const md = res.markdown?.fit_markdown || '';
    const mdLen = md.trim().length;
    console.log(`ℹ Extracted markdown length: ${mdLen}`);
    if (SHOW_MARKDOWN) {
      const limit = LOG_MARKDOWN_CHARS > 0 ? LOG_MARKDOWN_CHARS : md.length;
      const snippet = md.slice(0, limit);
      console.log('--- Markdown ---');
      console.log(snippet);
      if (md.length > snippet.length) console.log(`… [truncated, showing ${snippet.length}/${md.length}]`);
      console.log('----------------');
    }
    if (!md) throw new Error('Empty markdown');

    const analysis = analyzeMarkdown(md);
    if (LOG_ANALYSIS) {
      console.log('ℹ Analysis:', analysis);
      console.log('ℹ Validation: ', UNIVERSAL_CHECK ? 'UNIVERSAL' : 'BASIC');
    }

    return { ...validate(md), analysis } as any;
  } finally {
    if (beat) clearInterval(beat);
  }
}

async function main() {
  const fixtures = loadFixtures().filter(fx => !fx.disabled);
  if (!fixtures.length) {
    console.log('No fixtures to run. Provide CRAWL4AI_FIXTURES or enable disabled.');
    process.exit(0);
  }

  console.log(`\nCrawl4AI smoke tests -> ${BASE_URL}`);
  console.log(`Fixtures: ${fixtures.length} | Timeout: ${TIMEOUT_MS}ms | Show markdown: ${SHOW_MARKDOWN ? 'ON' : 'OFF'}`);
  if (UNIVERSAL_CHECK) console.log('Validation mode: UNIVERSAL (category-free)');

  let strictFailures = 0;
  let warnings = 0;
  const passedList: Array<{ name: string; url: string }> = [];
  const failedList: Array<{ name: string; url: string; reason: string }> = [];

  // naive concurrency control
  for (let i = 0; i < fixtures.length; i += CONCURRENCY) {
    const batch = fixtures.slice(i, i + CONCURRENCY);
    console.log(`\nBatch ${Math.floor(i / CONCURRENCY) + 1}: ${batch.length} item(s)`);
    const results = await Promise.allSettled(
      batch.map(async (fx) => {
        try {
          console.log(`\n[START] ${fx.name} -> ${fx.url}`);
          const r1 = await runOne(fx, true);
          let lastAnalysis: any = (r1 as any).analysis;
          let note = '';
          // no fallback or retry branches to keep behavior simple
          return { fx, ok: r1.ok, reason: r1.reason, note, analysis: lastAnalysis };
        } catch (e: any) {
          console.log('✗ Error during crawl:', e?.response?.status, e?.message || String(e));
          const msg = e?.message || '';
          return { fx, ok: false, reason: e?.message || String(e), note: '' };
        }
      })
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        const { fx, ok, reason, note, analysis } = r.value as any;
        if (ok) {
          const m = analysis ? ` [len=${analysis.length}, paras=${analysis.paragraphs}, heads=${analysis.headings}]` : '';
          console.log(`PASS  - ${fx.name} (${fx.url})${m} ${note ? `=> ${note}` : ''}`);
          passedList.push({ name: fx.name, url: fx.url });
        } else {
          const m = analysis ? ` [len=${analysis.length}, paras=${analysis.paragraphs}, heads=${analysis.headings}]` : '';
          console.log(`FAIL  - ${fx.name} (${fx.url}) :: ${reason}${m} ${note ? `=> ${note}` : ''}`);
          strictFailures += 1;
          failedList.push({ name: fx.name, url: fx.url, reason: String(reason || '') });
        }
      } else {
        const fx = batch[j];
        console.log(`FAIL  - ${fx?.name || 'Unknown'} (${fx?.url || 'n/a'}) :: ${r.reason}`);
        strictFailures += 1;
        if (fx) failedList.push({ name: fx.name, url: fx.url, reason: String(r.reason || '') });
      }
    }

    // no delay between batches with concurrency=1
  }

  // Grouped results table
  console.log('\nResults:');
  if (passedList.length) {
    console.log('\nPassed:');
    console.log('| Name | URL |');
    console.log('| --- | --- |');
    for (const p of passedList) console.log(`| ${p.name} | ${p.url} |`);
  }
  if (failedList.length) {
    console.log('\nFailed:');
    console.log('| Name | Reason | URL |');
    console.log('| --- | --- | --- |');
    for (const f of failedList) console.log(`| ${f.name} | ${f.reason} | ${f.url} |`);
  }

  console.log(`\nSummary: ${fixtures.length - strictFailures} passed, ${strictFailures} failed, ${warnings} warn\n`);
  process.exit(strictFailures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});

