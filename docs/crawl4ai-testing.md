## Crawl4AI Testing

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
- `CRAWL4AI_INCLUDE_DISABLED`: `true` to include disabled/auth‑walled fixtures.
- `CRAWL4AI_DEBUG`: `true` enables step‑by‑step logging.
- `CRAWL4AI_LOG_PAYLOAD`: `true` prints the crawl payload (safe; token is `env:OPENAI_API_KEY`).
- `CRAWL4AI_LOG_MARKDOWN_CHARS`: number of characters of Markdown to print (default 0; 600 when debug).
- `CRAWL4AI_LOG_ANALYSIS`: `true` prints content analysis metrics and effective expectations.

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

Enable it by setting `CRAWL4AI_ENABLE_FEWSHOT=true`. The harness reports when a case “recovers with few‑shot”.

### Why some fixtures didn’t run

Fixtures marked with `"disabled": true` are skipped by default to avoid hitting auth‑walled or placeholder links. To include them:

```
CRAWL4AI_INCLUDE_DISABLED=true yarn test:crawl4ai
```

Or edit the fixture and set `"disabled": false` after replacing placeholders with public, accessible URLs.

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
