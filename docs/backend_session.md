**Purpose**
- Private, intent‑driven discovery network. Users express intents; autonomous agents analyze, suggest, and broker connections while preserving privacy via contextual boundaries (indexes) and minimal exposure of raw data.

**High‑Level Architecture**
- **Apps:** `protocol/` (TypeScript Express API + agents) and `frontend/` (Next.js UI).
- **Agents:** LangGraph/LLM workflows for intent inference, synthesis, and context brokers that relate intents and create “stakes”.
- **Storage:** PostgreSQL via Drizzle ORM; migrations in `protocol/drizzle/` and schema in `protocol/src/lib/schema.ts`.
- **Integrations:** External sources (Slack, Discord, Notion, Gmail, Google Calendar) via Composio; content ingested into temp files → intents inferred.
- **Docs:** `README.md` (vision + quickstart), `HOWITWORKS.md` (architecture), `AGENTS.md` (repo conventions).

**Core Concepts**
- **Intent:** A text payload describing what the user is looking for (e.g., “Seeking privacy‑focused AI engineer”). Can be incognito; can belong to multiple indexes.
- **Index:** A privacy‑scoped context (workspace) containing files and intents; access is permissioned via `index_members`.
- **Files:** Supporting documents in an index; used as input for intent inference (upload or integration‑fetched).
- **Stakes:** Created by broker agents to connect related intents with a confidence (economic primitive placeholder).
- **Integrations:** Connect third‑party data sources through Composio; fetch content → generate intents.

**Data Model (Drizzle tables)**
- **`users`**: people using the protocol.
- **`intents`**: text `payload`, `isIncognito`, `userId`, timestamps.
- **`indexes`**: titled contexts; owned by `userId`.
- **`intent_indexes`**: many‑to‑many link between intents and indexes.
- **`index_members`**: membership + permissions (contextual access model).
- **`files`**: files uploaded to an index (metadata only here).
- **`agents` / `intent_stakes`**: broker agents and their “stakes” (array of intent IDs + reasoning + stake amount).
- **`user_connection_events`**: timeline of REQUEST/ACCEPT/DECLINE/etc. for social connections.
- **`user_integrations`**: connected integrations with `status`, `lastSyncAt`.

**Backend Entry Points**
- **Server:** `protocol/src/index.ts` sets up Express, middleware, static `/uploads`, then mounts routes:
  - `auth`, `users`, `intents`, `stakes`, `connections`, `indexes`, `files`, `upload` (file ingestion), `suggested_intents`, `integrations`, `vibecheck`, `synthesis`.
- **Schema:** `protocol/src/lib/schema.ts` centralizes DB schema/relations.
- **DB:** `protocol/src/lib/db.ts` (not shown above) configures Drizzle.
- **Logging:** `protocol/src/lib/log.ts` lightweight JSON logging with env‑based levels.

**Key Flows**
- **Upload → Suggested Intents**
  - User uploads files to an index (`/api/indexes/:indexId/files` and `/api/upload`).
  - Route `suggestions.ts` calls `analyzeFolder` (agent) with the new files and existing intents to avoid duplication.
  - Returns suggested intent objects (payload + confidence) for user review.

- **Integrations → Intents**
  - Connect via `/api/integrations/connect/:integrationType` (Composio OAuth; status polled via `/status/:requestId`).
  - Sync via `/api/integrations/sync/:integrationType` → `syncIntegration()`:
    - Fetch provider files: `handlers[integrationType].fetchFiles(userId, lastSyncAt?)`.
    - Write contents into a temp dir as `id.md`.
    - Read existing user intents for dedupe; call `analyzeFolder()` to infer intents.
    - Insert `intents` (and `intent_indexes` if `indexId` specified); update `lastSyncAt`.
  - Providers live in `protocol/src/lib/integrations/providers/`:
    - Slack/Discord/Notion: parse messages/pages to markdown.
    - Gmail: list threads/messages, fetch full message if needed, decode multipart bodies, output markdown.
    - Google Calendar: list events, map to markdown.

- **Context Brokers → Stakes**
  - Brokers initialize at boot (`initializeBrokers()` in `protocol/src/index.ts`).
  - On intent create/update/archive, brokers analyze relations and create entries in `intent_stakes` with reasoning and stake.

- **Connection Lifecycle**
  - `/api/connections`: POST `/actions` creates REQUEST/SKIP/CANCEL/ACCEPT/DECLINE entries in `user_connection_events` with validation on transitions.
  - Auto email handlers are invoked (non‑blocking) for connection state changes.

- **Synthesis Layer**
  - `/api/vibecheck` and `/api/synthesis` produce contextual narratives or intros derived from agent signals (never raw private data from others).

**Agents and Inference**
- **Intent Inferrer:** `protocol/src/agents/core/intent_inferrer/index.ts`.
  - Reads temp files; uses Unstructured API when available for rich parsing; falls back to plaintext.
  - Builds a constrained prompt with Zod schema to return exactly N intent objects (payload + confidence).
  - Exposed helper `analyzeFolder(folderPath, fileIds, instruction?, existingIntents, existingSuggestions, count, timeoutMs)`.
- **Brokers:** `protocol/src/agents/context_brokers/*`.
  - Example: `semantic_relevancy` computes similarities and creates stakes linking intents.

**Integrations (Composio)**
- **Client:** `protocol/src/lib/integrations/core/composio.ts` lazy‑loads `@composio/core` and exposes `connectedAccounts.list` + `tools.execute`.
- **Patterns:**
  - Always handle variant response shapes (`.data`, `.details`, direct) — providers normalize them.
  - For Gmail, accept both `id` and `messageId`; pass both snake_case and camelCase arg keys when calling tools.
  - Use `withRetry` and `concurrencyLimit` for stability and throughput.

**Authentication & Privacy**
- **Auth:** `authenticatePrivy` middleware protects routes (Privy token); user extracted to `req.user`.
- **Privacy:** Intents can be incognito; visibility flows through index membership and permissions (see `HOWITWORKS.md`).
- **No raw cross‑user leakage:** Brokers and synthesis share reasoning/links, not private file contents.

**Local Development**
- **Start servers:**
  - Protocol: `cd protocol && yarn dev` (nodemon).
  - Frontend: `cd frontend && yarn dev`.
  - Combined helper: `./dev.local.sh`.
- **Build & run:** `yarn build && yarn start` (both apps).
- **Database:** `cd protocol && yarn db:generate && yarn db:migrate && yarn db:studio`.
- **Lint:** `yarn lint` in each app.
- **.env:** Copy `protocol/env.example` → `protocol/.env` and fill:
  - `DATABASE_URL` (Postgres), `COMPOSIO_API_KEY`, `UNSTRUCTURED_API_URL` (optional but improves parsing), auth/email keys (Privy, Resend) if used.

**Where To Look (Guide for Agents/Contributors)**
- **Understand the DB:** `protocol/src/lib/schema.ts` (table definitions + relations).
- **API surface:** `protocol/src/index.ts` then each `protocol/src/routes/*.ts` for endpoints and business logic.
- **Intent generation:** `agents/core/intent_inferrer/index.ts` and routes using `analyzeFolder` (suggestions, integrations).
- **Context brokers:** `agents/context_brokers/*` for semantics and stake creation flow.
- **Integrations:** `lib/integrations/core/integration-sync.ts` and `providers/*` to add new sources.
- **Utilities:** `lib/integrations/core/util.ts` (retry, pagination, concurrency, mapping helpers).
- **Frontend usage:** `frontend/src/services/*` and pages under `frontend/src/app/` (e.g., integrations UI in `indexes/private/page.tsx`).

**Extending the System**
- **Add an Integration:**
  - Implement `IntegrationHandler.fetchFiles(userId, lastSyncAt?) → IntegrationFile[]` under `providers/`.
  - Normalize response shapes; return markdown‑like `content`, `lastModified`.
  - Register in `lib/integrations/index.ts`; add mapping in `routes/integrations.ts` if needed.
- **New Broker:**
  - Create a broker under `agents/context_brokers/` implementing lifecycle hooks (onIntentCreated/Updated/Archived).
  - Insert stakes with reasoning into `intent_stakes`.
- **New Intent Flow:**
  - Use `analyzeFolder` with selected files and existing intents to avoid duplicates.

**Operational Notes**
- **Logging:** `log.ts` honors `LOG_LEVEL` or `DEBUG` envs; JSON‑friendly lines. Add context keys to ease tracing.
- **Gmail query window:** Using `after:YYYY/MM/DD` can skip earlier same‑day messages; widen the window or unset `lastSyncAt` for initial syncs if desired.
- **Unstructured API:** Rich parsing for PDFs/HTML; without it, inference falls back to plaintext and may reduce quality.

**Project Goals**
- Shift discovery from identity‑based to intent‑driven, improving relevance and agency.
- Preserve privacy with contextual boundaries and minimal data movement.
- Enable a competitive marketplace of broker agents aligned by incentives (stakes now; on‑chain later).
- Provide a pragmatic, developer‑friendly API today with a migration path to decentralized/confidential compute.

**Quick Start (Backend)**
- `cp protocol/env.example protocol/.env` (set DB + keys)
- `cd protocol && yarn && yarn db:generate && yarn db:migrate && yarn dev`
- Hit `GET /health` then explore routes (auth required for most).

**Reference Paths**
- API bootstrap: `protocol/src/index.ts`
- DB schema: `protocol/src/lib/schema.ts`
- Intent inference: `protocol/src/agents/core/intent_inferrer/index.ts`
- Integration sync: `protocol/src/lib/integrations/core/integration-sync.ts`
- Integration providers: `protocol/src/lib/integrations/providers/*`
- Suggestions API: `protocol/src/routes/suggestions.ts`
- Integrations API: `protocol/src/routes/integrations.ts`
- Intents API: `protocol/src/routes/intents.ts`
- Brokers: `protocol/src/agents/context_brokers/*`

