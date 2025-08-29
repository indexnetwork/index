Plain-English Task

- Add “Index Links” so a user can attach one or more URLs to an Index.
- When the user clicks “Sync now”, crawl those URLs (treat each base URL like a folder: stay within host/path), fetch page content, and generate
intents from the crawled content.
- Make it incremental and deduped: don’t re-create intents for the same pages; only process changes/new pages.
- Show results in the UI and enable the “Sync now” button for this feature.

What “Crawl links, treat them as folders” Means

- Start from each URL the user adds.
- Stay within the same host and under the same base path (like a folder).
- Follow internal links (respect robots.txt), fetch content, and convert to text.
- Save each page as a “file-like” item; run the existing intent inferrer to generate intents from these files.

User Story

- As a user, I can add a list of URLs to an Index. When I press Sync Now:
    - The system fetches pages under those URLs (depth-limited), extracts text, dedupes by URL, and generates new intents from the content.
    - Next time I press Sync Now, it fetches only changes since the last run.

Acceptance Criteria

- Can add/remove URLs for an Index.
- Sync crawls within host and base path, respects a max depth and page limit.
- Each page becomes an input file; intents are generated.
- Sync is idempotent: same URL does not create duplicate intents (unless content changed and we choose to update).
- UI shows last sync timestamp, pages fetched, and intents created.
- “Sync now” button is enabled for Index Links.

Scope

- Manage “Index Links” per Index (CRUD).
- HTTP-triggered crawl + intent generation (background-safe).
- Deduping via URL mapping (no duplicate intents for the same page).
- Basic incremental crawl (store last-seen URL set; optionally ETag/Last-Modified).

Non-Goals (for initial cut)

- Authenticated websites behind login.
- JavaScript-heavy crawling (no headless browser by default).
- Full sitemap or cross-domain crawling.

Data Model (Minimal)

- index_links:
    - id, index_id, url, max_depth, max_pages, include_patterns[], exclude_patterns[], last_sync_at, last_status, last_error, created_at,
updated_at
- Reuse dedupe mapping:
    - integration_items (or web_crawl_items): provider='web', external_id=url, user_id, index_id, intent_id (nullable), content_hash, last_seen_at,
created_at
    - Unique: (provider, external_id, user_id, coalesce(index_id, '0000…'))

API Endpoints

- POST /api/indexes/:indexId/links: add link config
- GET /api/indexes/:indexId/links: list links
- DELETE /api/indexes/:indexId/links/:id: remove link
- POST /api/indexes/:indexId/links/sync: trigger crawl + intent generation (or enqueue a job)

Crawler Behavior

- Input: list of base URLs from index_links.
- BFS within host/path; obey max_depth, max_pages, include/exclude patterns.
- Respect robots.txt (skip disallowed paths).
- Fetch HTML, extract text:
    - Prefer Unstructured API if configured; else strip HTML to text.
- Map each page → IntegrationFile:
    - id: hash(url), name: sanitized title-or-path, lastModified: Last-Modified header or fetch time, type: text/markdown.

Deduping Logic

- Before creating intents, check mapping for provider='web' + external_id=url.
- If mapping exists for user/index, skip creating a new intent (or update existing if you want drift handling).
- If new: create intent, then create mapping row.

Incremental Sync Cursors (Web)

- Cursor is simply “what we’ve already seen”:
    - Store external_id=url with last_seen_at and content_hash.
    - On next sync, skip URLs already seen unless ETag/Last-Modified changed, or a content hash differs.

UI Changes

- Index page: New “Links” section
    - Manage list: add/remove URLs
    - “Sync now” button
    - Status: last sync time, pages fetched, intents created
- Optional: show the last N crawled URLs and their status.

Security & Performance

- Rate limit fetches; small concurrency (e.g., 3–5).
- User-provided URLs: validate host, disallow file:// and private IP ranges if needed.
- Robots.txt compliance on by default.

Observability

- Log per sync: urls_queued, urls_fetched, files_created, intents_created.
- Errors with first failing URL and message.

Deliverables

- Backend: new routes + crawler + integration mapping + sync handler.
- Frontend: links manager UI + sync button + status display.
- Docs: brief README section for Index Links.
- Test plan: crawl 2–3 pages, create intents, re-run sync shows dedupe, respect max depth.

Example Flow

- User adds https://docs.example.com/guides/.
- Clicks Sync now.
- Crawler fetches /guides/, /guides/setup, /guides/faq (depth 1), extracts text, generates 5–30 intents (configurable).
- Next sync only fetches changed pages (via ETag/Last-Modified or hash) and generates new intents if content changed.

Step-by-Step Plan

- Schema:
    - Add index_links and integration_items (provider='web').
- Backend:
    - Add routes to manage links.
    - Implement crawlIndexLinks(indexId) that returns IntegrationFile[].
    - Integrate into syncIntegration (or parallel flow): write temp files → analyzeFolder → insert intents → create mapping rows.
- Frontend:
    - Add Links UI on the private index page with Sync now.
- Config:
    - .env: WEB_CRAWL_MAX_DEPTH, WEB_CRAWL_MAX_PAGES, CRAWL_CONCURRENCY, RESPECT_ROBOTS=1.
- Future:
    - Enqueue background jobs with BullMQ; add cursors for more precise incrementality.

If you want, I can turn this into a small RFC file (task.md) or scaffold the backend tables/routes to kickstart implementation.
