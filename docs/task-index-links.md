# Task: Index Links – Crawl, Treat as Folders, Generate Intents (Sync Now)

## Goal
Enable users to attach one or more URLs to an Index and, on "Sync now", crawl those URLs (scoped like folders), ingest page content as files, and generate intents from the content. Make it incremental, deduped, observable, and easy to operate.

## User Stories
- As a user, I can add a set of URLs to an Index.
- When I click Sync now, the system crawls those URLs (within host and base path), extracts text, and generates new intents for that Index.
- Repeated syncs do not duplicate intents for the same pages; only new/changed pages produce new intents.
- I can see last sync time, pages processed, and intents created.

## Acceptance Criteria
- CRUD for Index Links (per Index): add/list/delete URLs.
- Crawl scope: stay in the same host and under the base path (like a folder). Respect robots.txt by default.
- Limits: configurable `maxDepth`, `maxPages`, `concurrency` per sync.
- Each crawled page becomes a file-like object (content + lastModified) and feeds the existing intent inferrer.
- Deduping: no duplicate intents for the same page unless content changed (see mapping below).
- Sync UI shows result: files imported, intents generated, last sync timestamp.
- Works with existing auth and index permission logic.

## Architecture Overview
1) Links Management
- New table `index_links` holds URLs and crawl options for each Index.
- Endpoints: `POST/GET/DELETE /api/indexes/:indexId/links`.

2) Crawl + Ingest
- Crawler starts from each base URL; BFS traversal within host + base path.
- Extract HTML → text (Unstructured API if available; fallback: HTML strip).
- Map each page to an `IntegrationFile` { id, name, content, lastModified, type }.

3) Dedup + Intents
- New mapping table `integration_items` (provider='web') records seen pages by URL and the intent(s) created.
- On sync, skip pages already mapped unless content hash changed.
- For new pages: create intents, then insert mapping rows.

4) Orchestration
- Reuse existing integration flow: write temp files → `analyzeFolder()` → insert intents (+ optional index association) → trigger brokers.
- Trigger path: HTTP "Sync now" and (later) scheduled background via a queue.

## Data Model
### index_links
- id uuid pk
- index_id uuid (fk indexes.id)
- url text (base URL)
- max_depth int default 1
- max_pages int default 50
- include_patterns text[] default []
- exclude_patterns text[] default []
- last_sync_at timestamp
- last_status text (e.g., "ok", "error")
- last_error text
- created_at, updated_at timestamp

### integration_items (reused for dedupe)
- id uuid pk
- provider varchar(32) NOT NULL (use 'web')
- external_id text NOT NULL (the absolute page URL)
- user_id uuid NOT NULL
- index_id uuid NULL
- intent_id uuid NULL -- optional if creating 1:1; can also be many-to-one via separate rows
- content_hash text NULL -- for incremental change detect (etag/body hash)
- last_seen_at timestamp NOT NULL default now()
- created_at timestamp NOT NULL default now()
- Unique(provider, external_id, user_id, coalesce(index_id,'00000000-0000-0000-0000-000000000000'))

## API Design
### Manage Links
- POST `/api/indexes/:indexId/links`
  - body: `{ url: string, maxDepth?: number, maxPages?: number, include?: string[], exclude?: string[] }`
  - 201 with the created link record

- GET `/api/indexes/:indexId/links`
  - 200 `{ links: Link[] }`

- DELETE `/api/indexes/:indexId/links/:linkId`
  - 200 `{ success: true }`

### Trigger Sync
- POST `/api/indexes/:indexId/links/sync`
  - 200 `{ success: true, filesImported, intentsGenerated, pagesVisited, startedAt, finishedAt }`
  - Optionally enqueue a background job and return `{ jobId }`; expose job status endpoint if needed.

## Crawler Behavior
- Start from each base URL in `index_links` for the Index.
- Scope: same hostname and URL path prefix as the base URL.
- BFS traversal with `maxDepth` and `maxPages`; de-duplicate by absolute URL.
- Respect robots.txt; skip disallowed paths.
- Fetch with ETag/Last-Modified support; if unchanged and we have a stored `content_hash`, skip.
- Extract text:
  - If `UNSTRUCTURED_API_URL` set → send HTML bytes and use parsed text.
  - Else → strip HTML tags (basic sanitizer) and collapse whitespace.
- Produce `IntegrationFile` with:
  - `id`: stable hash of URL (e.g., sha1(url))
  - `name`: sanitized URL path or `<host>-<path>.md`
  - `content`: `# <title>\n\n<plain text>`
  - `lastModified`: HTTP Last-Modified if present, else fetch time
  - `type`: `text/markdown`

## Deduping & Incremental
- Look up mapping by `(provider='web', external_id=url, user_id, index_id)`.
  - Exists and `content_hash` unchanged → skip creating intent.
  - Not exists or changed → create intent(s), then upsert mapping with `intent_id` and `content_hash`.
- Optional updates: if content changes materially, update the existing intent payload instead of creating a new one.

## Intent Generation
- Feed all new/changed `IntegrationFile`s into the existing `analyzeFolder()` with `existingIntents` to reduce duplication.
- Use configurable count (see Config): `INTEGRATION_INTENT_COUNT`.
- After each intent insert, call `triggerBrokersOnIntentCreated(intentId)`.

## UI Changes
- Index page → Links section:
  - List of URLs (add/remove)
  - Sync now button
  - Status line: last sync time, pages visited, intents created
  - Optional: last 5 URLs crawled with outcome

## Config
- `.env` keys (centralize in `lib/config.ts`):
  - `WEB_CRAWL_MAX_DEPTH=1`
  - `WEB_CRAWL_MAX_PAGES=50`
  - `WEB_CRAWL_CONCURRENCY=4`
  - `RESPECT_ROBOTS=true`
  - `INTEGRATION_INTENT_COUNT=30`

## Observability
- Log per sync: `{ indexId, urlsQueued, pagesVisited, filesImported, intentsGenerated, durationMs }`.
- Errors include URL and reason.
- Add simple counters/timers (Prometheus or at least log summaries).

## Security & Safety
- Validate user-provided URLs; disallow `file://` and private networks (e.g., 10.*, 192.168.*, 127.*, ::1) unless explicitly allowed.
- Rate limit fetches; bounded concurrency and timeouts.
- Respect robots.txt; configurable override for development.

## Implementation Plan
1) Schema
- Add `index_links` and `integration_items` Drizzle models + migrations.

2) Backend
- Routes:
  - `indexes/:indexId/links` (POST/GET/DELETE)
  - `indexes/:indexId/links/sync` (POST)
- Crawler module:
  - Input: (indexId) → read links → crawl and yield `{ url, content, lastModified, hash }`.
  - Output: `IntegrationFile[]` and `urlMap` (fileId → url/hash).
- Sync orchestration:
  - For each new/changed page create file in temp dir → run `analyzeFolder()` → insert intents → insert/update `integration_items` → trigger brokers.

3) Frontend
- Add Links UI to private index page: manage list, sync button, status.

4) Config & Docs
- Add `lib/config.ts` and document env keys in README.

## Pseudocode (Backend Sync)
```
// POST /api/indexes/:indexId/links/sync
const links = db.index_links.find(indexId)
const { files, urlMap } = await crawlLinks(links, cfg)
const existingIntents = await getExistingIntents(userId, indexId)
writeTemp(files)
const result = await analyzeFolder(tempDir, files.map(f => f.id), guidance, existingIntents, [], count, timeout)
let created = 0
for intent in result.intents:
  // Find the originating url(s) from urlMap if 1:1; otherwise attach first
  const url = pickUrlForIntent(intent)
  if (mappingExists('web', url, userId, indexId) && !changed(url)) continue
  const newIntent = await insertIntent(intent.payload, userId)
  await maybeLinkIntentToIndex(newIntent.id, indexId)
  await upsertIntegrationItem('web', url, userId, indexId, newIntent.id, contentHash(url))
  await triggerBrokersOnIntentCreated(newIntent.id)
  created++
cleanup(tempDir)
return { filesImported: files.length, intentsGenerated: created }
```

## Open Questions
- N:1 mapping between a page and multiple intents? (initially allow 1:1; expand later to store multiple rows for the same URL).
- Content update policy: update existing intent vs create a new one on meaningful changes.
- Background jobs: move sync into a queue (BullMQ) vs synchronous HTTP for MVP.

## Milestones
M1: Schema, CRUD links, stub crawler returning placeholder content → end-to-end Sync generates intents.
M2: Real crawler (robots, depth, ETag), mapping dedupe, broker triggers, UI status.
M3: Background queue, metrics, and advanced config.

