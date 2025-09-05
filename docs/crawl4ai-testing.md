## Crawl4AI Testing

```zsh
CRAWL4AI_ENABLE_FEWSHOT=true CRAWL4AI_FEWSHOT_MODE=always CRAWL4AI_FEWSHOT_ALL_PATTERNS=true CRAWL4AI_UNIVERSAL_CHECK=true CRAWL4AI_SHOW_MARKDOWN=true CRAWL4AI_LOG_MARKDOWN_CHARS=400 CRAWL4AI_CONCURRENCY=4 yarn test:crawl4ai
```

Ready-to-copy CLI Examples
  
- Debug + fallback few-shots (safe default):

  ```zsh
  CRAWL4AI_ENABLE_FEWSHOT=true CRAWL4AI_FEWSHOT_MODE=fallback CRAWL4AI_CONCURRENCY=2 CRAWL4AI_DEBUG=true CRAWL4AI_LOG_MARKDOWN_CHARS=600 yarn test:crawl4ai 
  ```

- Force few-shots on every URL:
  - CRAWL4AI_ENABLE_FEWSHOT=true CRAWL4AI_FEWSHOT_MODE=always CRAWL4AI_CONCURRENCY=2 CRAWL4AI_DELAY_S=6 CRAWL4AI_SCAN_FULL_PAGE=true yarn test:crawl4ai
- Include disabled fixtures:
  - CRAWL4AI_INCLUDE_DISABLED=true CRAWL4AI_ENABLE_FEWSHOT=true CRAWL4AI_FEWSHOT_MODE=fallback yarn test:crawl4ai
- Heavier pages (increase render time + retries):
  - CRAWL4AI_TIMEOUT_MS=180000 CRAWL4AI_RETRY_NETWORK=1 CRAWL4AI_DELAY_S=8 CRAWL4AI_SCAN_FULL_PAGE=true yarn test:crawl4ai
- Minimal, CI-friendly (no logs, no payload):
  - CRAWL4AI_CONCURRENCY=4 CRAWL4AI_ENABLE_FEWSHOT=true CRAWL4AI_FEWSHOT_MODE=fallback yarn test:crawl4ai
- Switch LLM provider/model:
  - CRAWL4AI_LLM_PROVIDER=openai/gpt-4o-mini CRAWL4AI_ENABLE_FEWSHOT=true CRAWL4AI_FEWSHOT_MODE=always yarn test:crawl4ai

This repo includes an opt‑in smoke test harness to verify our crawl4ai deployment can extract usable Markdown from a representative set of public pages (social, video, docs, tables).

### What we test

- **Availability:** Service responds 200 with a valid `results[0]` payload.
- **Content presence:** Extracted Markdown has a minimum length and basic structure (headings/paragraphs/tables depending on site type).
- **Boilerplate filtering:** Common non‑content phrases (e.g., cookie banners, sign‑in prompts) are absent.
- **Few‑shot fallback (optional):** Re‑tries difficult pages with an augmented instruction that includes brief examples for YouTube/Tweets/Tables.

These are lightweight integration checks, not pixel‑perfect golden tests. They’re meant to fail loudly when extraction breaks across major sites, while staying resilient to small content changes.

### Run locally

```
cd protocol
CRAWL4AI_BASE_URL=http://crawl4ai.env-dev:11235 \
OPENAI_API_KEY=... \
yarn test:crawl4ai
```

Optional env vars:

- `CRAWL4AI_FIXTURES`: path to a fixtures JSON (default: `./tests/fixtures/crawl-sites.json`).
- `CRAWL4AI_CONCURRENCY`: parallelism (default: 1). Keep low to avoid rate‑limits.
- `CRAWL4AI_DELAY_MS`: delay between batches (default: 800ms).
- `CRAWL4AI_ENABLE_FEWSHOT`: `true` to enable the few‑shot retry path.
- `CRAWL4AI_FEWSHOT_MODE`: `never` | `fallback` | `always` (default: `fallback` when `CRAWL4AI_ENABLE_FEWSHOT=true`, otherwise `never`).
- `CRAWL4AI_FEWSHOT_ALL_PATTERNS`: `true` injects social+video+doc+table+article examples together.
- `CRAWL4AI_INCLUDE_DISABLED`: `true` to include disabled/auth‑walled fixtures.
- `CRAWL4AI_DEBUG`: `true` enables step‑by‑step logging.
- `CRAWL4AI_LOG_PAYLOAD`: `true` prints the crawl payload (safe; token is `env:OPENAI_API_KEY`).
- `CRAWL4AI_LOG_MARKDOWN_CHARS`: number of characters of Markdown to print (default 0; 600 when debug).
- `CRAWL4AI_LOG_ANALYSIS`: `true` prints content analysis metrics and effective expectations.
- `CRAWL4AI_SHOW_MARKDOWN`: `true` prints a snippet even if `CRAWL4AI_LOG_MARKDOWN_CHARS` is unset.
- `CRAWL4AI_TIMEOUT_MS`: request timeout in ms (default: 120000).
- `CRAWL4AI_RETRY_NETWORK`: number of retries on network timeout (default: 1).
- `CRAWL4AI_SCAN_FULL_PAGE`: `true` to scroll/scan more of the page (default: false).
- `CRAWL4AI_DELAY_S`: seconds to wait before capturing HTML to allow heavy pages to render (default: 3).
- `CRAWL4AI_EXTENDED_FALLBACK`: `true` re-attempts with longer delay + full-page scan if validation still fails (default: true).
- `CRAWL4AI_EXT_DELAY_S`: delay for the extended fallback attempt (default: 8).
- `CRAWL4AI_SIMULATE_USER`: `true` simulates basic interactions (default: true).
- `CRAWL4AI_REMOVE_OVERLAY`: `true` attempts to remove cookie/login overlays (default: true).
- `CRAWL4AI_MAGIC`: `true` enables crawl4ai’s internal heuristics (default: true).
- `CRAWL4AI_LLM_PROVIDER`: override the LLM provider/model string (default: `openai/gpt-4o`).

### Fixtures

Edit `protocol/tests/fixtures/crawl-sites.json`. Examples included:

- `x.com` tweet (strict)
- YouTube watch page (non‑strict)
- Generic article (non‑strict)
- Placeholders for Google Docs/Sheets/Notion/Airtable (disabled by default). Replace with your team’s public links.

Each fixture can set expectations:

```json
{
  "name": "Google Sheets (published view)",
  "url": "https://docs.google.com/spreadsheets/d/<ID>/htmlembed",
  "category": "sheet",
  "strict": false,
  "expect": { "minChars": 50, "requireTable": true }
}
```

### Few‑shot prompting

The test harness can optionally retry a failing page with an **augmented instruction** that includes short, concrete examples (YouTube/Tweet/Tables). This is what “few‑shots” refers to: giving the LLM extractor a couple of target‑format examples to bias it toward better Markdown for certain site types without hard‑coding per‑site logic.

Enable it by setting `CRAWL4AI_ENABLE_FEWSHOT=true`. Control behavior with `CRAWL4AI_FEWSHOT_MODE`:

- `fallback`: run normally first, then retry with short examples if validation fails (recommended).
- `always`: include the examples in the initial attempt for every URL.
- `never`: never include examples.

The harness reports when a case “recovers with few‑shot”. Examples can be tailored by category or you can inject all patterns via `CRAWL4AI_FEWSHOT_ALL_PATTERNS=true` to avoid needing categories.

This respects “no per‑site logic”: examples are generic patterns (tweet, video, article, table), not URL rules.

### Why some fixtures didn’t run

Fixtures marked with `"disabled": true` are skipped by default to avoid hitting auth‑walled or placeholder links. To include them:

```
CRAWL4AI_INCLUDE_DISABLED=true yarn test:crawl4ai
```

Or edit the fixture and set `"disabled": false` after replacing placeholders with public, accessible URLs.

### Tips for Sheets/Docs/Notion/LinkedIn

- Google Sheets: use a published HTML view (e.g., `/pubhtml` or `/htmlembed`) instead of `/edit`, which often requires auth and can time out.
- Google Docs: use `/preview` or publish to the web to avoid auth walls.
- Notion: ensure “Share to web” is enabled and the page is public.
- LinkedIn: most pages require auth; keep as `strict: false` or disabled unless you have an authenticated crawler.

### Category-free mode (for URL-only inputs)

- Set `CRAWL4AI_FEWSHOT_ALL_PATTERNS=true` and `CRAWL4AI_FEWSHOT_MODE=always` to include generic social/video/doc/table/article examples for all URLs.
- Optionally set `CRAWL4AI_UNIVERSAL_CHECK=true` to use a minimal validation: `minChars>=50` and at least one substantial paragraph (no table/heading requirement). This avoids relying on category.
- Keep `CRAWL4AI_EXTENDED_FALLBACK=true` so pages that initially return little/no text get one more attempt with a longer render delay and full-page scan.

### Adding more sites

- Prefer public, non‑auth, stable pages.
- Mark brittle/auth‑walled targets as `{ "strict": false }` or `"disabled": true`.
- For table‑like sources (Sheets/Airtable/Notion databases), set `requireTable: true`.
- Keep concurrency low to avoid bans/blocks.

### What success looks like

- Major public pages pass with non‑empty, sensible Markdown.
- Docs/tables include headings or table rows.
- Fragile sites either pass with few‑shot or show WARN, not FAIL (if marked non‑strict).

### Troubleshooting

- If everything fails, verify `CRAWL4AI_BASE_URL` reachability from your machine/VPN.
- Ensure `OPENAI_API_KEY` is set (LLMContentFilter requires it).
- Turn on `CRAWL4AI_ENABLE_FEWSHOT=true` for stubborn pages.
