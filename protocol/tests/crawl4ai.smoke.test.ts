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
  category?: 'social' | 'video' | 'doc' | 'sheet' | 'db' | 'generic';
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
const FEWSHOT_MODE = (process.env.CRAWL4AI_FEWSHOT_MODE || (ENABLE_FEWSHOT ? 'fallback' : 'never')).toLowerCase() as 'always' | 'fallback' | 'never';
const INCLUDE_DISABLED = String(process.env.CRAWL4AI_INCLUDE_DISABLED || 'false') === 'true';
const TIMEOUT_MS = Number(process.env.CRAWL4AI_TIMEOUT_MS || '120000');
const RETRY_NETWORK = Number(process.env.CRAWL4AI_RETRY_NETWORK || '1');
const FEWSHOT_ALL_PATTERNS = ['1','true','yes'].includes(String(process.env.CRAWL4AI_FEWSHOT_ALL_PATTERNS || 'false').toLowerCase());
const UNIVERSAL_CHECK = ['1','true','yes'].includes(String(process.env.CRAWL4AI_UNIVERSAL_CHECK || 'false').toLowerCase());
const EXTENDED_FALLBACK = ['1','true','yes'].includes(String(process.env.CRAWL4AI_EXTENDED_FALLBACK || 'true').toLowerCase());
const EXT_DELAY_S = Number(process.env.CRAWL4AI_EXT_DELAY_S || '8');

// Crawler tuning (generic, not site-specific)
const SCAN_FULL_PAGE = ['1','true','yes'].includes(String(process.env.CRAWL4AI_SCAN_FULL_PAGE || 'false').toLowerCase());
const DELAY_BEFORE_HTML = Number(process.env.CRAWL4AI_DELAY_S || '3');
const SIMULATE_USER = !['0','false','no'].includes(String(process.env.CRAWL4AI_SIMULATE_USER || 'true').toLowerCase());
const REMOVE_OVERLAY = !['0','false','no'].includes(String(process.env.CRAWL4AI_REMOVE_OVERLAY || 'true').toLowerCase());
const MAGIC = !['0','false','no'].includes(String(process.env.CRAWL4AI_MAGIC || 'true').toLowerCase());

// LLM configuration
const LLM_PROVIDER = process.env.CRAWL4AI_LLM_PROVIDER || 'openai/gpt-4o';

// Verbose/debug flags
const DEBUG = ['1', 'true', 'yes'].includes(String(process.env.CRAWL4AI_DEBUG || '').toLowerCase());
const LOG_PAYLOAD = ['1', 'true', 'yes'].includes(String(process.env.CRAWL4AI_LOG_PAYLOAD || '').toLowerCase());
const LOG_MARKDOWN_CHARS = Number(process.env.CRAWL4AI_LOG_MARKDOWN_CHARS || (DEBUG ? '600' : '0'));
const LOG_ANALYSIS = DEBUG || ['1', 'true', 'yes'].includes(String(process.env.CRAWL4AI_LOG_ANALYSIS || '').toLowerCase());
const SHOW_MARKDOWN = LOG_MARKDOWN_CHARS > 0 || ['1','true','yes'].includes(String(process.env.CRAWL4AI_SHOW_MARKDOWN || '').toLowerCase());

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

function loadFixtures(): Fixture[] {
  const raw = fs.readFileSync(FIXTURES_PATH, 'utf8');
  const arr = JSON.parse(raw) as Fixture[];
  return arr;
}

function fewShotInstruction(fx: Fixture): string {
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
  const parts = [...common];
  if (FEWSHOT_ALL_PATTERNS || !fx.category) {
    parts.push(...tweet, ...youtube, ...docs, ...genericArticle, ...tables);
  } else {
    if (fx.category === 'video') parts.push(...youtube);
    if (fx.category === 'social') parts.push(...tweet);
    if (fx.category === 'doc') parts.push(...docs);
    if (fx.category === 'generic') parts.push(...genericArticle);
    if (fx.category === 'sheet' || fx.category === 'db') parts.push(...tables);
  }
  return parts.join('\n');
}

function makePayload(url: string, useFewShot: boolean, fx?: Fixture, overrides?: Partial<{
  simulate_user: boolean;
  delay_before_return_html: number;
  scan_full_page: boolean;
  remove_overlay_elements: boolean;
  magic: boolean;
}>) {
  const baseInstruction = 'Extract only the content from this page. Remove all non-content elements such as buttons, links, menus, ads, metadata, or boilerplate. Do not paraphrase or summarize — return the exact original text only. Extract as a markdown with a whole.';

  const instruction = useFewShot
    ? `${baseInstruction}\n\n${fewShotInstruction(fx!)}
      \nBe concise but complete. Keep original wording.`
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
        simulate_user: overrides?.simulate_user ?? SIMULATE_USER,
        override_navigator: true,
        delay_before_return_html: overrides?.delay_before_return_html ?? DELAY_BEFORE_HTML,
        magic: overrides?.magic ?? MAGIC,
        verbose: true,
        remove_overlay_elements: overrides?.remove_overlay_elements ?? REMOVE_OVERLAY,
        scan_full_page: overrides?.scan_full_page ?? SCAN_FULL_PAGE,
        markdown_generator: {
          type: 'DefaultMarkdownGenerator',
          params: {
            content_filter: {
              type: 'LLMContentFilter',
              params: {
                llm_config: {
                  type: 'LLMConfig',
                  params: {
                    provider: LLM_PROVIDER,
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
  const baseExp: Expectation = (UNIVERSAL_CHECK || !fx.category) ? {
    minChars: 50,
    requireHeading: false,
    requireTable: false,
    forbid: ['Sign in', 'Accept all cookies', 'Join now'],
  } : {
    minChars: 20,
    requireHeading: fx.category === 'doc',
    requireTable: fx.category === 'sheet' || fx.category === 'db',
    forbid: ['Sign in', 'Accept all cookies', 'Join now'],
  };
  const exp: Expectation = { ...baseExp, ...(fx.expect || {}) };

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
  if ((UNIVERSAL_CHECK || !fx.category || fx.category === 'generic') && paragraphs < 1) {
    return { ok: false, reason: 'no substantial paragraphs' };
  }
  return { ok: true };
}

async function runOne(fx: Fixture, useFewShot: boolean, overrides?: Parameters<typeof makePayload>[3]) {
  const payload = makePayload(fx.url, useFewShot, fx, overrides);

  console.log(`→ Building payload${useFewShot ? ' (few-shot)' : ''} for ${fx.url}`);
  if (LOG_PAYLOAD || DEBUG) {
    console.log('Payload:', JSON.stringify(payload, null, 2));
  }

  const started = Date.now();
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
    const limit = LOG_MARKDOWN_CHARS > 0 ? LOG_MARKDOWN_CHARS : Math.min(600, md.length);
    const snippet = md.slice(0, limit);
    console.log('--- Markdown snippet ---');
    console.log(snippet);
    if (md.length > snippet.length) console.log(`… [truncated, showing ${snippet.length}/${md.length}]`);
    console.log('------------------------');
  }
  if (!md) throw new Error('Empty markdown');

  const analysis = analyzeMarkdown(md);
  if (LOG_ANALYSIS) {
    console.log('ℹ Analysis:', analysis);
    const exp = ((): any => {
      const base = (UNIVERSAL_CHECK || !fx.category) ? {
        minChars: 50,
        requireHeading: false,
        requireTable: false,
        forbid: ['Sign in', 'Accept all cookies', 'Join now'],
      } : {
        minChars: 20,
        requireHeading: fx.category === 'doc',
        requireTable: fx.category === 'sheet' || fx.category === 'db',
        forbid: ['Sign in', 'Accept all cookies', 'Join now'],
      };
      return { ...base, ...(fx.expect || {}) };
    })();
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
  console.log(`Fixtures: ${fixtures.length} | Few-shot: ${FEWSHOT_MODE.toUpperCase()}${FEWSHOT_ALL_PATTERNS ? ' (ALL-PATTERNS)' : ''} | Include disabled: ${INCLUDE_DISABLED ? 'ON' : 'OFF'} | Debug: ${DEBUG ? 'ON' : 'OFF'} | Timeout: ${TIMEOUT_MS}ms | Retry(net): ${RETRY_NETWORK}`);
  console.log(`Crawler params: simulate_user=${SIMULATE_USER} scan_full_page=${SCAN_FULL_PAGE} delay_s=${DELAY_BEFORE_HTML} remove_overlay=${REMOVE_OVERLAY} magic=${MAGIC}`);
  if (UNIVERSAL_CHECK) console.log('Validation mode: UNIVERSAL (category-free)');
  if (EXTENDED_FALLBACK) console.log(`Extended fallback: ON (delay_s=${EXT_DELAY_S}, scan_full_page=true)`);

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
          const firstAttemptFewShot = FEWSHOT_MODE === 'always';
          const r1 = await runOne(fx, firstAttemptFewShot);
          let note = '';
          if (!r1.ok && FEWSHOT_MODE === 'fallback') {
            // try again with few-shot
            console.log('↻ First attempt failed. Retrying with few-shot examples…');
            const r2 = await runOne(fx, true);
            if (r2.ok) {
              note = '✓ recovered with few-shot';
              return { fx, ok: true, reason: undefined, note };
            }
            if (EXTENDED_FALLBACK) {
              console.log('↻ Applying extended fallback (longer delay + full-page scan)…');
              const r3 = await runOne(fx, true, { delay_before_return_html: EXT_DELAY_S, scan_full_page: true });
              if (r3.ok) return { fx, ok: true, reason: undefined, note: '✓ recovered with extended fallback' };
              return { fx, ok: false, reason: r3.reason, note: `✗ still failing with few-shot (${r2.reason})` };
            }
            return { fx, ok: false, reason: r2.reason, note: `✗ still failing with few-shot (${r2.reason})` };
          }
          if (!r1.ok && EXTENDED_FALLBACK) {
            console.log('↻ Applying extended fallback (longer delay + full-page scan)…');
            const r3 = await runOne(fx, FEWSHOT_MODE === 'always', { delay_before_return_html: EXT_DELAY_S, scan_full_page: true });
            if (r3.ok) return { fx, ok: true, reason: undefined, note: '✓ recovered with extended fallback' };
            return { fx, ok: false, reason: r3.reason, note };
          }
          return { fx, ok: r1.ok, reason: r1.reason, note };
        } catch (e: any) {
          console.log('✗ Error during crawl:', e?.response?.status, e?.message || String(e));
          const msg = e?.message || '';
          const isTimeout = /timeout/i.test(msg) || e?.code === 'ECONNABORTED';
          if (isTimeout && RETRY_NETWORK > 0) {
            console.log(`↻ Network timeout. Retrying once (same config)…`);
            try {
              const r = await runOne(fx, FEWSHOT_MODE === 'always');
              return { fx, ok: r.ok, reason: r.reason, note: '✓ recovered after timeout retry' };
            } catch (e2: any) {
              console.log('✗ Retry failed:', e2?.message || String(e2));
              return { fx, ok: false, reason: e?.message || String(e), note: '' };
            }
          }
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
