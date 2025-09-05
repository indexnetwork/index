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
    CRAWL4AI_CONCURRENCY=1
    CRAWL4AI_DELAY_MS=800
    CRAWL4AI_ENABLE_FEWSHOT=true
    CRAWL4AI_INCLUDE_DISABLED=true
*/

import fs from 'fs';
import path from 'path';
import axios from 'axios';

type Expectation = {
  minChars?: number;
  requireHeading?: boolean;
  requireTable?: boolean;
  forbid?: string[];
};

type Fixture = {
  name: string;
  url: string;
  category: 'social' | 'video' | 'doc' | 'sheet' | 'db' | 'generic';
  strict?: boolean; // failing this fails the suite; default true
  disabled?: boolean; // skip unless CRAWL4AI_INCLUDE_DISABLED=true
  expect?: Expectation;
};

type CrawlResult = {
  status: string;
  url: string;
  markdown?: { fit_markdown?: string };
  error?: string | null;
};

const BASE_URL = process.env.CRAWL4AI_BASE_URL || 'http://crawl4ai.env-dev:11235';
const FIXTURES_PATH = process.env.CRAWL4AI_FIXTURES || path.join(__dirname, 'fixtures', 'crawl-sites.json');
const CONCURRENCY = Number(process.env.CRAWL4AI_CONCURRENCY || '1');
const DELAY_MS = Number(process.env.CRAWL4AI_DELAY_MS || '800');
const ENABLE_FEWSHOT = String(process.env.CRAWL4AI_ENABLE_FEWSHOT || 'false') === 'true';
const INCLUDE_DISABLED = String(process.env.CRAWL4AI_INCLUDE_DISABLED || 'false') === 'true';

// Verbose/debug flags
const DEBUG = ['1', 'true', 'yes'].includes(String(process.env.CRAWL4AI_DEBUG || '').toLowerCase());
const LOG_PAYLOAD = ['1', 'true', 'yes'].includes(String(process.env.CRAWL4AI_LOG_PAYLOAD || '').toLowerCase());
const LOG_MARKDOWN_CHARS = Number(process.env.CRAWL4AI_LOG_MARKDOWN_CHARS || (DEBUG ? '600' : '0'));
const LOG_ANALYSIS = DEBUG || ['1', 'true', 'yes'].includes(String(process.env.CRAWL4AI_LOG_ANALYSIS || '').toLowerCase());

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

function loadFixtures(): Fixture[] {
  const raw = fs.readFileSync(FIXTURES_PATH, 'utf8');
  const arr = JSON.parse(raw) as Fixture[];
  return arr;
}

function fewShotInstruction(): string {
  return [
    'Extract only human-readable main content as Markdown. Do not paraphrase.',
    'Exclude navigation, menus, buttons, ads, cookie banners, and footers.',
    'Preserve headings, paragraphs, lists, code blocks, tables, and links.',
    '',
    'Examples:',
    '1) YouTube watch page ->',
    '# <Video Title>\n\n- Channel: <Channel Name>\n- Published: <Date>\n\n## Description\n<Original description text>\n\n## Transcript (if visible)\n<Transcript excerpts>\n',
    '2) Tweet page (single tweet) ->',
    '<@handle>: <verbatim tweet text>\n\n- Posted: <Date/Time>\n- Media: <alt text if present>\n',
    '3) Notion/Docs/Airtable tables -> keep as Markdown tables with headers.',
  ].join('\n');
}

function makePayload(url: string, useFewShot: boolean) {
  const baseInstruction = 'Extract only the content from this page. Remove all non-content elements such as buttons, links, menus, ads, metadata, or boilerplate. Do not paraphrase or summarize — return the exact original text only. Extract as a markdown with a whole.';

  const instruction = useFewShot
    ? `${baseInstruction}\n\n${fewShotInstruction()}`
    : baseInstruction;

  return {
    urls: [url],
    browser_config: {
      type: 'BrowserConfig',
      params: { headless: true },
    },
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

function validate(md: string, fx: Fixture): { ok: boolean; reason?: string } {
  const exp: Expectation = {
    minChars: 20,
    requireHeading: fx.category === 'doc',
    requireTable: fx.category === 'sheet' || fx.category === 'db',
    forbid: ['Sign in', 'Accept all cookies', 'Join now'],
    ...(fx.expect || {}),
  };

  const { length, headings, tableLines, paragraphs } = analyzeMarkdown(md);
  if (length < (exp.minChars || 0)) {
    return { ok: false, reason: `too short (${length} chars)` };
  }
  if (exp.requireHeading && headings < 1) {
    return { ok: false, reason: 'missing heading' };
  }
  if (exp.requireTable && tableLines < 2) {
    return { ok: false, reason: 'expected table-like content' };
  }
  if (exp.forbid && exp.forbid.some(f => md.includes(f))) {
    return { ok: false, reason: 'contains forbidden boilerplate' };
  }
  // Basic paragraph signal for generic pages
  if (fx.category === 'generic' && paragraphs < 1) {
    return { ok: false, reason: 'no substantial paragraphs' };
  }
  return { ok: true };
}

async function runOne(fx: Fixture, useFewShot: boolean) {
  const payload = makePayload(fx.url, useFewShot);

  console.log(`→ Building payload${useFewShot ? ' (few-shot)' : ''} for ${fx.url}`);
  if (LOG_PAYLOAD || DEBUG) {
    console.log('Payload:', JSON.stringify(payload, null, 2));
  }

  const started = Date.now();
  const resp = await axios.post(`${BASE_URL}/crawl`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120_000,
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
  if (LOG_MARKDOWN_CHARS > 0) {
    const snippet = md.slice(0, LOG_MARKDOWN_CHARS);
    console.log('--- Markdown snippet ---');
    console.log(snippet);
    if (md.length > snippet.length) console.log(`… [truncated, showing ${snippet.length}/${md.length}]`);
    console.log('------------------------');
  }
  if (!md) throw new Error('Empty markdown');

  const analysis = analyzeMarkdown(md);
  if (LOG_ANALYSIS) {
    console.log('ℹ Analysis:', analysis);
    const exp = {
      minChars: 20,
      requireHeading: fx.category === 'doc',
      requireTable: fx.category === 'sheet' || fx.category === 'db',
      forbid: ['Sign in', 'Accept all cookies', 'Join now'],
      ...(fx.expect || {}),
    };
    console.log('ℹ Expectations:', exp);
  }

  return validate(md, fx);
}

async function main() {
  const fixtures = loadFixtures().filter(fx => (INCLUDE_DISABLED ? true : !fx.disabled));
  if (!fixtures.length) {
    console.log('No fixtures to run. Provide CRAWL4AI_FIXTURES or enable disabled.');
    process.exit(0);
  }

  console.log(`\nCrawl4AI smoke tests -> ${BASE_URL}`);
  console.log(`Fixtures: ${fixtures.length} | Few-shot: ${ENABLE_FEWSHOT ? 'ON' : 'OFF'} | Include disabled: ${INCLUDE_DISABLED ? 'ON' : 'OFF'} | Debug: ${DEBUG ? 'ON' : 'OFF'}`);

  let strictFailures = 0;
  let warnings = 0;

  // naive concurrency control
  for (let i = 0; i < fixtures.length; i += CONCURRENCY) {
    const batch = fixtures.slice(i, i + CONCURRENCY);
    console.log(`\nBatch ${Math.floor(i / CONCURRENCY) + 1}: ${batch.length} item(s)`);
    const results = await Promise.allSettled(
      batch.map(async (fx) => {
        try {
          console.log(`\n[START] ${fx.name} -> ${fx.url}`);
          const r1 = await runOne(fx, false);
          let note = '';
          if (!r1.ok && ENABLE_FEWSHOT) {
            // try again with few-shot
            console.log('↻ First attempt failed. Retrying with few-shot examples…');
            const r2 = await runOne(fx, true);
            if (r2.ok) note = '✓ recovered with few-shot';
            else note = `✗ still failing with few-shot (${r2.reason})`;
            return { fx, ok: r2.ok, reason: r1.ok ? undefined : r2.reason, note };
          }
          return { fx, ok: r1.ok, reason: r1.reason, note };
        } catch (e: any) {
          console.log('✗ Error during crawl:', e?.response?.status, e?.message || String(e));
          return { fx, ok: false, reason: e?.message || String(e), note: '' };
        }
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { fx, ok, reason, note } = r.value;
        if (ok) {
          console.log(`PASS  - ${fx.name} (${fx.url}) ${note ? `=> ${note}` : ''}`);
        } else if (fx.strict !== false) {
          console.log(`FAIL  - ${fx.name} (${fx.url}) :: ${reason} ${note ? `=> ${note}` : ''}`);
          strictFailures += 1;
        } else {
          console.log(`WARN  - ${fx.name} (${fx.url}) :: ${reason} ${note ? `=> ${note}` : ''}`);
          warnings += 1;
        }
      } else {
        const fx = batch[0];
        console.log(`FAIL  - ${fx.name} (${fx.url}) :: ${r.reason}`);
        strictFailures += 1;
      }
    }

    if (i + CONCURRENCY < fixtures.length && DELAY_MS > 0) await sleep(DELAY_MS);
  }

  console.log(`\nSummary: ${fixtures.length - strictFailures} passed, ${strictFailures} failed, ${warnings} warn\n`);
  process.exit(strictFailures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
