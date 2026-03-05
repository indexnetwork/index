---
description: 
alwaysApply: true
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Index Network is a private, intent-driven discovery protocol built on autonomous agents. Users define "intents" and competing Broker Agents work to fulfill them through relevant connections. The system leverages LangChain/LangGraph for agent orchestration, PostgreSQL with pgvector for semantic search, and a monorepo structure with protocol (backend) and frontend (Next.js) workspaces.

## Development Commands

### Protocol (Backend)

```bash
cd protocol

# Development
bun run dev                                 # Start dev server with hot reload (Bun.serve, port 3001)
bun run dev:prod                            # Start dev server in production mode
bun run start                               # Start production server

# Database (Drizzle ORM)
bun run db:generate                         # Generate migrations after schema changes
bun run db:migrate                          # Apply pending migrations
bun run db:studio                           # Open Drizzle Studio (interactive DB GUI)

# Database utilities
bun run db:seed                             # Seed database with sample data
bun run db:flush                            # Flush all data from database

# Testing
bun test                                    # Run tests with bun test
bun test tests/e2e.test.ts                  # Run specific test file
bun test --watch                            # Run tests in watch mode

# Code quality
bun run lint                                # Run ESLint

# Queue monitoring

# Maintenance/CLI tools
bun run maintenance:trigger-integration     # Manually trigger integration sync
bun run maintenance:export-slack            # Export Slack data
bun run maintenance:import-slack-export     # Import Slack export files
bun run maintenance:reset-brokers           # Reset context brokers
bun run maintenance:update:embeddings       # Regenerate embeddings

# Background workers
bun run integration-worker                  # Start integration sync worker
bun run social-worker                       # Start social media sync worker
bun run audit-freshness                     # Audit intent freshness
```

### Frontend

```bash
cd frontend

# Development
bun run dev                                 # Start Next.js dev server (Turbopack)
bun run build                               # Build for production
bun run start                               # Start production server
bun run lint                                # Run ESLint
```

### Root

```bash
# Install dependencies for all workspaces
bun install

# Development (from repo root)
bun run dev                                # Interactive list: select active branch (root) or a worktree to run dev (root runs build then dev; worktree runs worktree:dev)

# Git worktrees
bun run worktree:list                       # List worktrees and their setup status
bun run worktree:setup <name>               # Install node_modules & symlink .env files into a worktree
bun run worktree:dev <name>                 # Run all dev servers from a worktree (auto-setups if needed)
bun run worktree:build [name]               # Build at root, or in worktree <name> if given
```

## Architecture Overview

### Monorepo Structure

```
index/
├── protocol/          # Backend API & Agent Engine (Bun, Express, TypeScript)
└── frontend/          # Next.js 15 App with React 19
```

### Protocol Architecture

**Tech Stack**: Bun runtime, Express.js, Drizzle ORM, PostgreSQL with pgvector, BullMQ (Redis-backed queues), LangChain/LangGraph

**Key Directories**:
- `src/agents/` - LangGraph-based AI agents for intent processing
- `src/controllers/` - API controllers (chat, intent, opportunity, profile, upload); used with decorator-based routing in `main.ts`
- `src/adapters/` - Implementations of protocol interfaces (database, embedder, cache, queue, scraper); implement interfaces from `src/lib/protocol/interfaces/`
- `src/services/` - Business logic layer
- `src/schemas/` - Drizzle table definitions; primary schema is `schemas/database.schema.ts`
- `src/guards/` - Auth/validation guards for the decorator router (e.g. `auth.guard.ts`)
- `src/types/` - Shared TypeScript types
- `src/cli/` - CLI and maintenance scripts (db-seed, db-flush, integration-worker, social-worker, trigger-integration, audit-intent-freshness, etc.)
- `src/lib/` - Utilities, infrastructure; includes `lib/protocol/` (graphs, agents, interfaces, docs), `lib/drizzle/`, `lib/router/`
- `src/lib/protocol/` - Protocol layer: `graphs/` (LangGraph state machines: chat, hyde, index, intent, opportunity, profile), `agents/` (intent indexer, inferrer, reconciler, verifier, opportunity evaluator, profile/hyde generators), `interfaces/` (database, embedder, cache, queue, scraper), `docs/`
- `src/middleware/` - Express middleware (auth, validation)
- `src/queues/` - BullMQ job queue definitions
- `src/jobs/` - Scheduled cron jobs
- `src/events/` - Event emitters for agent system

### Server Entry Point

The protocol server is `protocol/src/main.ts`: Bun native server on port 3001, controller classes registered via `RouteRegistry` (`@Controller`, `@Get`, `@Post`, etc.) in `src/lib/router/router.decorators.ts`, guards, and adapter-injected controllers (e.g. `ChatDatabaseAdapter` for opportunity controller). Started with `bun run dev` / `bun run start`.

### Agent System (LangGraph-Based)

All agents extend `BaseLangChainAgent` which wraps LangChain's ChatOpenAI model (configured for OpenRouter). Agents use Zod schemas for structured output validation.

**LangGraph Patterns**:

- **When to use graphs**: Complex, multi-step workflows with conditional logic; read/write separation with fast paths; state accumulation across agents; complex decision trees; parallel map-reduce. **Do not** use graphs for: simple CRUD (use services), linear agent calls, single LLM call, single-agent workflows.
- **File organization**: Every graph has two files: `{domain}.graph.ts` (factory and nodes) and `{domain}.graph.state.ts` (state annotation and types). Example: `chat.graph.ts`, `chat.graph.state.ts`.
- **Factory pattern**: Graph built by a factory class that accepts dependencies in the constructor (database, embedder, agents), exposes `createGraph()` or `compile()`, and does not instantiate adapters inside the graph. No hardcoded dependencies.
- **State**: Use LangGraph `Annotation.Root` with reducers. Separate input fields, intermediate (merge) fields, control fields (operation mode), and output fields.
- **Conditional routing**: Every graph must have at least one conditional edge (routing decision). Use for read/write separation (fast path vs full pipeline), skip expensive ops by operation mode, or state-based branching. Map all branch results to valid node names or END.
- **Nodes**: Async functions that accept state and return partial state. Log entry with context and exit with results. Catch errors and return error state (do not throw). Return only the state fields being updated. Use `{action}Node` naming (e.g. `inferenceNode`).
- **Assembly**: Use `START` and `END` from `@langchain/langgraph`. Start with `addEdge(START, "first_node")`, end with `addEdge("last_node", END)`. Every conditional branch must map to a valid node.
- **Anti-patterns**: Avoid linear graphs with no conditionals (use service calls instead); avoid throwing in nodes (return error state); avoid hardcoded dependencies (inject via factory).
- **Checklist**: At least one conditional edge; state in separate `.graph.state.ts`; factory with DI; node logging and error handling; fast paths if applicable; tests cover routing logic.

**Agent Categories**:

1. **Intent Agents** (`agents/intent/`):
   - `ExplicitIntentInferrer` - Extracts intents from uploaded content (files, links)
   - `ImplicitInferrer` - Infers intents from implicit signals
   - `IntentManager` - Orchestrates intent lifecycle (create/update/expire actions)
   - `IntentRefiner` - Refines intent descriptions
   - `SyntacticEvaluator` / `SemanticEvaluator` - Validates intent quality using felicity conditions (Searle's Speech Acts)

2. **Core Agents** (`agents/core/`):
   - `IntentIndexer` - Assigns intents to relevant indexes (communities)
   - `IntentSummarizer` - Generates concise summaries
   - `IntentTagSuggester` - Recommends categorization tags
   - `IntentFreshnessAuditor` - Monitors intent staleness

3. **Profile Agents** (`agents/profile/`):
   - `ProfileGenerator` - Generates user profiles from identity signals
   - `HydeGenerator` - Creates Hypothetical Document Embeddings for semantic search

4. **Context Brokers** (`agents/context_brokers/`):
   - Event-driven agents that react to intent lifecycle (onIntentCreated, onIntentUpdated, onIntentArchived)
   - Example: `SemanticRelevancyBroker` finds semantically related intents and creates stakes linking them

A parallel protocol-oriented layer lives under `src/lib/protocol/`: **Graphs** (`lib/protocol/graphs/`) — chat, hyde, index, intent, opportunity, profile (LangGraph state machines); **Agents** (`lib/protocol/agents/`) — intent (inferrer, reconciler, verifier), index (intent indexer), opportunity (evaluator, notification agent), profile/hyde generators. See `PROFILE-GRAPH-IMPLEMENTATION-SUMMARY.md` and docs under `lib/protocol/docs/` for design details.

**Agent Execution Pattern**:
```typescript
// Agents are called from services
const result = await agent.run(input);

// Services handle persistence and event emission
await db.insert(intents).values(result);
IntentEvents.onCreated({ intentId, userId, payload?, previousStatus? });

// Brokers react to events asynchronously (they implement onIntentCreated(intentId), etc.)
```

### Database Layer (Drizzle ORM)

**Schema Location**: `protocol/src/schemas/database.schema.ts`. The Drizzle client is in `protocol/src/lib/drizzle/drizzle.ts`.

**Core Tables**:
- `users` - User accounts (Better Auth)
- `user_profiles` - User identity with vector embeddings (2000-dim, text-embedding-3-large)
- `intents` - User intents with vector embeddings and confidence scores
- `indexes` - Communities/collections of related intents
- `index_members` - Membership with custom prompts and auto-assignment settings
- `intent_indexes` - Many-to-many junction (intents ↔ indexes)
- `intent_stakes` - Relationships between intents with confidence tracking
- `intent_stake_items` - Per-stake item details (linked to intent_stakes)
- `files` / `user_integrations` - Source tracking for intents
- `user_connection_events` - Connection requests/approvals
- `chat_sessions` / `chat_messages` - Chat session and message storage (chat graph, chat-session.service)
- `user_notification_settings` - User notification preferences
- `agents` - Context broker agent registry (context_brokers/connector)
- `opportunities` - Opportunity records (detection, actors, interpretation, context, status); see migration 0018
- `hyde_documents` - Stored HyDE documents for retrieval

**Key Features**:
- pgvector extension for 2000-dimensional embeddings
- HNSW indexes for fast similarity search
- Polymorphic source tracking (sourceType: file|integration|link|discovery_form|enrichment)
- Soft deletes with deletedAt timestamp

**Type Safety**: Full TypeScript types auto-generated from schema via Drizzle

### Queue System (BullMQ)

**Location**: `protocol/src/queues/` and `protocol/src/jobs/`

**Queue Types**:
- `intent.queue.ts` - Intent indexing and generation jobs
- `newsletter.queue.ts` - Weekly digest generation
- `opportunity.queue.ts` - Matching intents with opportunities
- `profile.queue.ts` - User profile generation
- `notification.queue.ts` - Notification delivery (see `notification.job.ts`; registered in index.ts)

**Job Pattern**:
- Default: 3 retries with exponential backoff (1s delay)
- Cleanup: Completed jobs removed after 24h, failed after 7d
- Default concurrency: 1 (sequential processing)

**Monitoring**: Bull Board UI is served at http://localhost:3001/dev/queues/ when the protocol server is running

### API Routes Organization

**Location**: API routes are defined by controller classes using decorators in `protocol/src/controllers/`. See Server Entry Point and Adapter/Controller patterns.

**Authentication Pattern**: Routes use guards (e.g. `auth.guard.ts`) which validate Better Auth session and create/update users in DB.

**Key Controllers and Routes**:
- `AuthController` - Authentication (Better Auth integration)
- `IntentController` - Intent CRUD, generation, suggestions
- `IndexController` - Community management and index opportunities
- `FileController` - File uploads and processing
- `ChatController` - Chat interface
- `ProfileController` - User profiles
- `OpportunityController` - Opportunity management
- `UploadController` - Upload handling
- `UserController` - User management
- `LinkController` - Link management

### Frontend Architecture

**Framework**: Next.js 15 (App Router), React 19, Tailwind CSS

**Directory Structure**:
- `src/app/` - Next.js App Router pages (file-based routing)
  - `/index/[indexId]` - Index detail pages
  - `/u/[id]` - User profile pages
  - `/u/[id]/chat` - User chat
  - `/d/[id]` - Discovery/detail (e.g. by id)
  - `/l/[code]` - Link redirect (e.g. by code)
  - `/library` - Library
  - `/networks` - Networks
  - `/blog` - Blog listing; `/blog/[slug]` - Markdown-based blog posts
  - `/pages/privacy-policy`, `/pages/terms-of-use` - Legal pages
  - `/api/blog`, `/api/subscribe` - API routes for blog and subscription
  - Intents may be viewed in discover/chat or other contexts (no dedicated `/i/[id]` route)
- `src/components/` - Reusable React components
- `src/contexts/` - React Context providers (Auth, API, Notifications, XMTP)
- `src/services/` - Frontend API clients (typed fetch wrappers)
- `src/lib/` - Utilities and shared logic

**Authentication**: Better Auth (session-based; email, social, etc.)

**UI Libraries**: Tailwind CSS, Radix UI, Lucide React, Ant Design, react-markdown

## Important Patterns & Conventions

### Protocol Layering Rules

Strict layering: **Controllers -> Services -> Adapters**. Violations cause tight coupling and testing pain.

1. **Only `services` may import `adapters`.** Controllers and other layers must not depend on adapters directly.
2. **`lib` implementations** that need infrastructure must receive **adapters via constructor injection**, following the contract defined in `src/lib/protocol/interfaces/*.interface.ts`. They do not import adapters; they are injected.
3. **`controllers`** import and call **`services`** (or protocol graph factories) to perform operations. Controllers handle HTTP and delegate business logic.
4. **`services` must not import other `services`.** Cross-service orchestration should use events, queues, or the shared lib/graph layer.

### Template Files

Each layer has a `*.template.md` with coding guidelines. Consult before adding or changing code:

- `protocol/src/controllers/controller.template.md`
- `protocol/src/services/service.template.md`
- `protocol/src/queues/queue.template.md`
- `protocol/src/lib/protocol/agents/agent.template.md`

### Adapter Pattern

Protocol interfaces live in `src/lib/protocol/interfaces/` (e.g. `database.interface.ts`). Implementations live in `src/adapters/` (database, embedder, cache, queue, scraper). Controllers (e.g. opportunity, chat) receive database/queue abstractions via constructor injection so they can be tested with mocks.

**Adapter file naming**: Use **conceptual** names (role/capability), not implementation technology. Pattern: `{concept}.adapter.ts`. Examples: `database.adapter.ts` (not `drizzle.adapter.ts`), `cache.adapter.ts` and `queue.adapter.ts` (not `redis.adapter.ts`), `storage.adapter.ts` (not `s3.adapter.ts`). Tests: `{concept}.adapter.spec.ts`.

### Controller and Decorator Routing

The API uses class-based controllers with `@Controller(prefix)`, `@Get(path)`, `@Post(path)`, and optional guards. Routes are registered in `RouteRegistry` and dispatched in `main.ts`. See `protocol/src/controllers/controller.template.md` and `protocol/src/lib/router/router.decorators.ts`.

### Polymorphic Source Tracking

Intents track their origin via:
```typescript
sourceType: 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment'
sourceId: uuid // foreign key to source table
```

This enables filtering intents by source and bulk re-processing.

### Confidence & Inference Tracking

```typescript
// Intents have confidence scores
confidence: number // 0-1
inferenceType: 'explicit' | 'implicit'

// Intent stakes track relationships with reasoning
intentStakes: { confidence, reasoning, ... }
```

### Index Prompts & Auto-Assignment

```typescript
// Indexes define their purpose (used by LLM for evaluation)
indexes.prompt: "Looking for AI/ML co-founders"

// Members can customize with specific criteria
indexMembers.prompt: "Specifically seeking PyTorch experts"
indexMembers.autoAssign: boolean // Auto-tag new intents?
```

LLM agents evaluate whether intents belong in indexes based on these prompts rather than hardcoded rules.

### Queue-Based Processing

Intent creation is synchronous (fast user feedback), but complex processing is asynchronous:

```typescript
// 1. Create intent immediately
const intent = await db.insert(intents).values(...);

// 2. Enqueue background jobs
await intentQueue.add('index_intent', { intentId, indexId });
await intentQueue.add('generate_intents', { sourceId });

// 3. Workers process jobs independently
// 4. Brokers react to events asynchronously
```

### Event-Driven Broker System

Intent events live in `protocol/src/events/intent.event.ts` (the service imports from there; `src/lib/events.ts` contains a parallel/legacy implementation). API: `IntentEvents.onCreated(event)`, `IntentEvents.onUpdated(event)`, `IntentEvents.onArchived(event)` where `event` has `intentId`, `userId`, and optional `payload`, `previousStatus`. Brokers implement `onIntentCreated(intentId)` (and similar); the connector calls these from the event handlers.

Decoupled event handling for extensibility:

```typescript
// Service emits events after DB transaction
IntentEvents.onCreated({ intentId, userId, payload?, previousStatus? });

// Brokers listen and react independently
SemanticRelevancyBroker.onIntentCreated(intentId);
// - Finds related intents via vector search
// - Creates intentStakes linking them
// - Enables discovery
```

Add new brokers without modifying intent logic.

### OpenRouter Configuration

The protocol uses OpenRouter as the LLM provider with **presets** for different agent types. Each preset is configured at https://openrouter.ai/settings/presets with specific model, temperature, and max_tokens settings.

**Required Presets** (configure in OpenRouter dashboard):
- `intent-inferrer` - Complex structured output generation from content
- `intent-summarizer` - Text summarization with length constraints
- `intent-tag-suggester` - Tag/cluster generation from intent analysis
- `intent-indexer` - Intent appropriateness evaluation scoring
- `vibe-checker` - Collaboration synthesis generation
- `intro-maker` - Email introduction generation
- `semantic-relevancy` - Semantic intent relationship analysis
- `intent-freshness-auditor` - Intent expiration detection based on temporal markers

**Environment Variables**:
```bash
OPENROUTER_API_KEY=your-openrouter-api-key
```

Agents reference presets by name in their configuration. This allows centralized control of model selection and parameters for each agent type.

## Environment Setup

### Protocol Environment Variables

**Required**:
```bash
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/protocol_db

# LLM (OpenRouter)
OPENROUTER_API_KEY=your-openrouter-api-key
# Note: Create presets at https://openrouter.ai/settings/presets
# See "OpenRouter Configuration" section above for required preset names

# Authentication

# Server
PORT=3001
NODE_ENV=development
```

**Optional** (see `protocol/env.example` for full list):
- `REDIS_URL` - Redis connection (defaults to localhost:6379)
- `RESEND_API_KEY` - Email delivery via Resend
- `UNSTRUCTURED_API_URL` - Document parsing API
- `COMPOSIO_API_KEY` - 3rd-party integrations (Slack, Notion, Gmail)
- `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` - LLM observability
- `SENTRY_DSN` - Error tracking
- `PARALLELS_API_KEY` - Web crawling and profile extraction

### Frontend Environment Variables

See `frontend/.env.example` for frontend-specific configuration (Better Auth, API URL, etc.)

**Auth origin (`invalid_origin`)**: If login fails with this error, the app’s current origin is not in the allowed list. Ensure the app origin is allowed in your Better Auth configuration (e.g. `trustedOrigins` or CORS) when developing locally.

## Testing

### Never commit without testing

Before committing any change:

1. **Automated testing**: Run the relevant test suite (e.g. `bun test path/to/affected.spec.ts` in protocol). Do not commit if tests fail or are skipped without good reason.
2. **Smoke test**: Manually verify the change works as intended (e.g. run the app, hit the changed flow, or run a quick manual check). Do not commit on "assumption" only.

If you cannot run tests yourself (e.g. agent cannot execute `bun test`), provide the exact commands for the user to run and ask them to confirm results before committing.

### Do not run bun test yourself

When tests need to be run (e.g. after changes, to verify fixes, or when the user asks to run tests):

1. **Do not** execute `bun test` (or `bun test <path>`) in the terminal yourself.
2. **Provide** the exact command for the user to run (e.g. `bun test` or `bun test protocol/tests/e2e.test.ts`).
3. **Ask** the user to run it and share the output so you can interpret the result and continue from there.

Example response:

> Run the tests locally and paste the output:
>
> ```bash
> cd protocol && bun test
> ```
>
> Share the result and I'll help with any failures.

### Test layout and commands

Tests use `bun test` framework. Test files are located in:
- `protocol/tests/` - Integration and E2E tests
- `protocol/src/lib/*/tests/` - Unit tests alongside code

**Run tests**:
```bash
cd protocol
bun test path/to/test.ts   # Run specific test file (PREFERRED)
bun test --watch           # Watch mode
bun test                    # Run ALL tests (slow — avoid unless necessary)
```

**Important**: Always target specific test files affected by your changes rather than running the full suite. `bun test` in protocol is slow. Use `bun test path/to/specific.spec.ts` instead.

**Test Categories**:
- Integration tests: Test agent interactions with services
- E2E tests: Test full API workflows
- Smoke tests: Test external integrations (crawl4ai, etc.)

**Bun Test Standards**:

- **Environment**: Load env at the top of test files before other imports (`import { config } from "dotenv"; config({ path: '.env.development', override: true });`). Import test utilities from `bun:test` destructured (`describe`, `expect`, `it`, `beforeAll`, `afterAll`, `mock`, etc.), not default import.
- **Structure**: Group related tests with descriptive `describe` blocks. Write clear, specific test descriptions that explain behavior and expected outcome (not vague names like "should work").
- **Lifecycle**: Use `beforeAll`/`afterAll` (and `beforeEach`/`afterEach` when needed). Always clean up DB records and resources in `afterAll` for integration tests.
- **Timeouts**: Set explicit timeouts for async operations: fast operations use default (5s); agent inference 30000ms; graph operations 60000ms; LLM operations 120000ms.
- **Assertions**: Use specific matchers (e.g. `expect(result.target).toBe("intent_query")`); avoid loose assertions like `.toBeTruthy()` or `.toBeDefined()` only. Test multiple aspects of the result where relevant.
- **Mocking**: Mock external dependencies (DB, APIs) for isolation. Use `mock()` from `bun:test` for function mocking. Use realistic, representative test data (not minimal stubs).
- **Coverage**: Test both success and error paths. Add comments to explain complex scenarios. Use modifiers when appropriate: `it.skip()`, `it.todo()`, `it.only()`, `it.failing()`.

Checklist: env at top; imports from `bun:test`; `describe` grouping; clear test names; timeouts set; lifecycle cleanup in `afterAll`; specific assertions; mocks for externals; success and error paths; realistic data.

## Database Workflow

### Migration Naming Convention

Drizzle generates random names like `0002_flashy_millenium_guard.sql`. **Always rename** generated migrations to descriptive names before committing.

**Format**: `{NNNN}_{action}_{target}[_{detail}].sql`

| Component | Description | Examples |
|-----------|-------------|---------|
| `NNNN` | Zero-padded sequence number | `0000`, `0001`, `0012` |
| `action` | What the migration does | `initial`, `add`, `drop`, `create`, `alter`, `rename` |
| `target` | Table or feature affected | `users`, `chat_session`, `index_members` |
| `detail` | Optional specifics | `share_token`, `wallet_columns`, `pk` |

**Examples**:
```
0000_initial_schema.sql
0001_add_chat_session_share_token.sql
0002_add_user_wallet_xmtp_columns.sql
0003_drop_agent_wallet_columns.sql
0004_create_hidden_conversations.sql
0006_add_index_members_pk.sql
```

**After renaming**: Update the `tag` field in `drizzle/meta/_journal.json` to match (tag = filename without `.sql`). **Do not rename snapshot files** — keep them as `{NNNN}_snapshot.json`.

**Checklist when generating a new migration**: (1) `bun run db:generate`. (2) Rename the generated `.sql` file (e.g. `mv drizzle/0007_random_name.sql drizzle/0007_descriptive_name.sql`). (3) Edit `drizzle/meta/_journal.json`: set the `tag` for that entry to the new filename without `.sql`. (4) `bun run db:migrate`. (5) Verify: `bun run db:generate` should report "No schema changes".

### Making Schema Changes

1. **Edit schema**: Modify `protocol/src/schemas/database.schema.ts`
2. **Generate migration**: `bun run db:generate`
3. **Rename migration**: Rename the generated `.sql` file and update the journal `tag`
4. **Review migration**: Check `drizzle/` directory for generated SQL
5. **Apply migration**: `bun run db:migrate`
6. **Verify**: `bun run db:studio` to inspect changes

### Why migrations get out of sync

Drizzle stays in sync when (1) **`drizzle/meta/_journal.json`** lists every migration in order and (2) the **`__drizzle_migrations`** table in the DB matches what’s been applied. Things break when:

- **Journal and files diverge** — A new `.sql` file is added (e.g. `0001_foo.sql`) but `_journal.json` is not updated. Then `drizzle-kit migrate` only knows about migrations in the journal, so the new file is never applied. **Rule:** Every file in `drizzle/*.sql` must have a matching entry in `drizzle/meta/_journal.json` (same order; `tag` = filename without `.sql`).
- **Applying SQL outside Drizzle** — Running SQL by hand or via `db:apply-schema` applies changes but does not insert into `__drizzle_migrations`. Next run of `drizzle-kit migrate` can skip or re-apply migrations. **Rule:** Prefer `bun run db:migrate` so Drizzle tracks applied migrations; if you must run SQL manually, insert the corresponding row(s) into `__drizzle_migrations` (see Drizzle docs).
- **pgvector** — Drizzle does not emit `CREATE EXTENSION vector`. The first migration must include it (e.g. add it manually to the first `.sql` or use a custom migration). The `maintenance:fix-migrations` script injects it when regenerating from scratch.

Using Drizzle is correct; the pain usually comes from the journal or migration history getting out of sync with the actual files/DB.

### Making db:migrate the single source of truth

- **Same DB as the app:** `drizzle.config.ts` loads `.env.development`; run `bun run db:migrate` from `protocol/` so it uses the same `DATABASE_URL` as the app.
- **Fresh DB:** Run `bun run db:migrate` once; it will apply 0000 then 0001 (and any newer migrations).
- **Existing DB that was set up with db:apply-schema or manual SQL:** Run `bun run db:migrate`; it will apply any migrations not yet in `__drizzle_migrations`. If the DB is missing a column (e.g. `share_token`), ensure the migration journal and files are in sync, then run `db:migrate` again, or apply the missing migration SQL by hand and insert the corresponding row into `__drizzle_migrations`.

### Fixing ruined migrations

If local migrations are corrupted or out of sync:

```bash
cd protocol
bun run maintenance:fix-migrations   # Reset DB, regenerate one migration with pgvector, then restore drizzle/
```

For a **remote** DB (e.g. Neon) you can reset and re-run all migrations:

```bash
bun run maintenance:reset-remote-db -- --confirm
bun run db:migrate
```

### Common Operations

```bash
# View current database state
bun run db:studio

# Reset database (development only)
bun run db:flush
bun run db:migrate
bun run db:seed
```

## Debugging & Monitoring

### Queue Monitoring

```bash
# Bull Board at http://localhost:3001/dev/queues/ (when server is running)
# View job status, retry failed jobs, clear queues
```

### LLM Observability

If Langfuse is configured (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`):
- All agent calls are traced automatically
- View traces at https://us.cloud.langfuse.com

### Error Tracking

If Sentry is configured (`SENTRY_DSN`):
- Errors and performance metrics are sent to Sentry
- Check Sentry dashboard for issues

## Code Style & Practices

### TypeScript

- Strict mode enabled
- **Do not use `any`** — use proper types or `unknown` and narrow as needed. ESLint enforces `@typescript-eslint/no-explicit-any`.
- All agents use Zod schemas for validation
- Prefer type inference from Drizzle schema over manual types
- Use `Id<'tableName'>` type from `_generated/dataModel` for document IDs

### File Naming Convention

All files in the protocol directory should follow the pattern: `{domain}.{purpose}.{extension}`

- **domain**: The scope or area (e.g., `chat`, `intent`, `profile`, `opportunity`)
- **purpose**: The type or role (e.g., `graph`, `agent`, `generator`, `verifier`, `state`, `spec`)

**Common Purpose Types**:
| Purpose | Description | Example |
|---------|-------------|---------|
| `.graph` | LangGraph state machines | `chat.graph.ts` |
| `.state` | State definitions | `chat.state.ts` |
| `.agent` | AI agents | `router.agent.ts` |
| `.generator` | Content generators | `response.generator.ts` |
| `.evaluator` | Evaluation/scoring logic | `opportunity.evaluator.ts` |
| `.verifier` | Verification/validation | `semantic.verifier.ts` |
| `.inferrer` | Inference logic | `explicit.inferrer.ts` |
| `.reconciler` | Reconciliation logic | `intent.reconciler.ts` |
| `.controller` | API controllers | `chat.controller.ts` |
| `.service` | Business logic services | `intent.service.ts` |
| `.queue` | Job queue definitions | `intent.queue.ts` |
| `.spec` | Test files | `router.agent.spec.ts` |

**Adapters** (`protocol/src/adapters/`): Name by **concept**, not by tech. Use `{concept}.adapter.ts` (e.g. `database.adapter.ts`, `cache.adapter.ts`, `queue.adapter.ts`). Do not name after the implementation (e.g. no `drizzle.adapter.ts`, `redis.adapter.ts`, `bullmq.adapter.ts`). See Adapter Pattern above.

**Exceptions** (exempt from convention):
- `index.ts` - Barrel export files
- `schema.ts` - Database schema files
- `main.ts` - Application entry points
- Single-purpose utility files at root level (e.g., `constants.ts`, `types.ts`)

**Good examples**: `chat.graph.ts`, `chat.graph.state.ts`, `router.agent.ts`, `response.generator.ts`, `explicit.inferrer.ts`, `intent.reconciler.ts`, `opportunity.evaluator.ts`. **Bad**: `chatGraph.ts` → use `chat.graph.ts`; `intentAgent.ts` → use `intent.agent.ts`; `generator.ts` → use `{domain}.generator.ts`.

**Naming new files**: (1) Identify domain/scope (e.g. chat, intent, profile). (2) Identify purpose/type (e.g. agent, graph, generator). (3) Name: `{domain}.{purpose}.ts` (e.g. message validator → `message.validator.ts`).

### Import Ordering

Order imports from most general (external) to most local (nearby), separated by blank lines:

1. **External packages** (npm modules)
2. **Deep relative imports** (multiple levels up: `../../`, `../../../`, etc.)
3. **Nearby relative imports** (siblings/children: `./` or `../`)

```typescript
// ❌ BAD - Wrong order, no grouping
import { something } from "./nearby";
import { util } from "../../../lib/utils";
import express from "express";

// ✅ GOOD
import express from "express";
import { z } from "zod";

import { util } from "../../../lib/utils";
import { helper } from "../../helpers/helper";

import { something } from "../something";
import { local } from "./nearby";
```

### TSDoc

- Add **TSDoc comments** for all **classes** (summary and, when useful, `@remarks` or `@example`)
- Add **TSDoc comments** for all **public methods** (summary, `@param`, `@returns`, `@throws` where relevant)

```typescript
/**
 * Handles intent lifecycle and persistence.
 * @remarks Delegates to adapters for DB and queue; does not call other services.
 */
export class IntentService {
  /**
   * Creates an intent and enqueues indexing jobs.
   * @param input - Validated intent payload
   * @returns The created intent with id
   */
  async create(input: CreateIntentInput): Promise<Intent> { ... }
}
```

### Agents

- Extend `BaseLangChainAgent` for consistency
- Define input/output as Zod schemas
- Set appropriate temperature per agent type
- Use Langfuse middleware for tracing
- Keep agents pure (no direct DB access) - let services handle persistence

### Services

- Services encapsulate business logic
- Handle database transactions
- Emit events after successful operations
- Return typed results
- Use Drizzle for type-safe queries
- **Must not import other services** — use events, queues, or shared lib for cross-service orchestration

### Controllers

- Controllers handle HTTP (request/response) and delegate business logic to services or protocol graphs
- They may accept adapters (database, queue) via constructor injection for testability
- **Must not import adapters directly** — only services may import adapters

### API Routes

- Controllers use guard functions for authentication (e.g. `AuthGuard`)
- Validate input with Zod schemas where needed
- Handle errors with try/catch and proper HTTP status codes
- Return consistent JSON responses or Response objects

### Database

- Canonical schema and table definitions live in `src/schemas/database.schema.ts`; import from there (not from `lib/schema`)
- Use Drizzle's query builder for type safety
- Define relations in schema for automatic joins
- Create indexes for frequently queried columns
- Use vector similarity for semantic search
- Prefer soft deletes (deletedAt) over hard deletes

## Git Workflow

Follow these conventions for version control operations.

### Always use worktrees for fixes and new features

**Use a worktree** for any new feature or bugfix work. Do not do feature or fix work on the main working tree (e.g. on `dev` at repo root). Create a worktree, do the work there, then open PRs from that branch. This keeps `dev` stable and isolates changes.

- **New feature** → create worktree folder `feat-my-feature` (branch: `feat/my-feature`), implement and test there.
- **Bug fix** → create worktree folder `fix-issue-name` (branch: `fix/issue-name`), fix and test there.

Only use the main working tree for small docs/config edits, dependency bumps, or when explicitly told otherwise.

### Worktrees

Worktrees live in `.worktrees/` (gitignored). They share the same git history but have an isolated working tree. **Worktree folder names must use dashes, not slashes** (e.g. `feat-my-feature`, not `feat/my-feature`) — slashes create subdirectories which Zed does not support. The branch inside the worktree can still follow the conventional `feat/my-feature` format. Since `.gitignore`d files (`node_modules/`, `.env*`) are not copied into worktrees, you must run `bun run worktree:setup <name>` after creating one. This symlinks `.env*` files from the main repo into the worktree for all workspaces (`protocol`, `frontend`, `evaluator`). It also runs `bun install` in each workspace (`node_modules` can't be symlinked because Turbopack rejects symlinks pointing outside the worktree root).

```bash
# After creating a worktree (e.g., via `git worktree add .worktrees/feat-foo dev`)
bun run worktree:setup feat-foo

# Run all dev servers (protocol + frontend + evaluator) from a worktree
bun run worktree:dev feat-foo
```

Root `bun run dev` shows an interactive list to select either the active branch (root) or one of the worktrees; choosing root runs a full build then starts dev servers, choosing a worktree runs `worktree:dev` for that worktree. `worktree:dev` auto-runs setup if the worktree hasn't been set up yet. Use `bun run worktree:list` to see available worktrees and whether they've been set up. Use `bun run worktree:build` (at root) or `bun run worktree:build <name>` to build a specific worktree.

### Conventional Commits

Commit messages should follow the Conventional Commits format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer]
```

**Commit Types**:
- `feat` - New feature (MINOR in SemVer)
- `fix` - Bug fix (PATCH in SemVer)
- `docs` - Documentation changes
- `style` - Formatting, whitespace (no code change)
- `refactor` - Code change that neither fixes nor adds
- `perf` - Performance improvement
- `test` - Adding/correcting tests
- `chore` - Maintenance tasks

**Breaking Changes**: Add `BREAKING CHANGE:` in body/footer, or append `!` after type (e.g., `feat!:`)

### Conventional Branches

Branch names follow `<type>/<short-description>`:

```bash
feat/user-authentication
fix/login-redirect-loop
refactor/intent-service
test/chat-controller
```

### Pull Requests

1. Use `gh` CLI to create PRs into `upstream/dev`
2. Write PR description as a changelog with categories:
   - **New Features**
   - **Bug Fixes**
   - **Refactors**
   - **Documentation**
   - **Tests**

## Key Dependencies

**Protocol**:
- `langchain` / `@langchain/core` / `@langchain/openai` - Agent orchestration
- `drizzle-orm` / `postgres` - Database ORM and driver
- `bullmq` / `ioredis` - Job queues and Redis client
- `express` / `helmet` / `cors` - HTTP server
- `zod` - Schema validation
- `openai` - OpenAI-compatible client (used with OpenRouter)
- `@composio/core` - Integration platform
- `langfuse-langchain` - LLM observability
- `resend` - Email delivery

**Frontend**:
- `next` - React framework
- `react` / `react-dom` - UI library
- `tailwindcss` - CSS framework
- `@radix-ui/*` - Accessible UI primitives
- `react-markdown` - Markdown rendering

