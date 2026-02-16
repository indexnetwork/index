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
- `src/agent/` - XMTP agent process (`xmtp.agent.ts`, `content-types.ts`, `xmtp.types.ts`)

### Server Entry Point

The protocol server is `protocol/src/main.ts`: Bun native server on port 3001, controller classes registered via `RouteRegistry` (`@Controller`, `@Get`, `@Post`, etc.) in `src/lib/router/router.decorators.ts`, guards, and adapter-injected controllers. The XMTP agent process runs alongside the HTTP server. Started with `bun run dev` / `bun run start`.

### Agent System (LangGraph-Based)

All agents extend `BaseLangChainAgent` which wraps LangChain's ChatOpenAI model (configured for OpenRouter). Agents use Zod schemas for structured output validation.

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

### XMTP Messaging Agent

The project uses XMTP (Extensible Message Transport Protocol) for all real-time messaging, replacing the previous Stream Chat integration. XMTP provides end-to-end encrypted, decentralized messaging.

**Server-Side Agent** (`protocol/src/agent/`):
- `xmtp.agent.ts` - Main agent process using `@xmtp/agent-sdk`. Runs alongside the HTTP server and listens to all XMTP conversations.
- `content-types.ts` - Custom XMTP content types for structured messages (opportunity cards, status updates).
- `xmtp.types.ts` - TypeScript type definitions for XMTP message payloads.

**Conversation Types**:
- `home_feed` - One per user. A group chat where the agent posts opportunity cards and system updates.
- `ai_chat` - 1:1 style AI conversations. The user sends messages and the agent responds via the chat LangGraph.
- `human_chat` - Direct messages between two users. The agent is a silent member (can facilitate introductions or moderate).

**Key Design Decisions**:
- The XMTP agent is a member of every conversation, enabling server-side message processing.
- AI response tokens are streamed to the frontend via an SSE sideband (`POST /chat/stream`) rather than through XMTP itself, for low-latency display. The final complete response is then sent as an XMTP message.
- User identity is linked via `xmtpInboxId` on the `users` table, registered through `POST /chat/register-inbox`.
- The agent's XMTP address is exposed via `GET /chat/agent-address` so the frontend can create conversations with the agent as a member.

### Database Layer (Drizzle ORM)

**Schema Location**: `protocol/src/schemas/database.schema.ts`. The Drizzle client is in `protocol/src/lib/drizzle/drizzle.ts`.

**Core Tables**:
- `users` - User accounts (Privy authentication, `xmtpInboxId` for XMTP identity)
- `user_profiles` - User identity with vector embeddings (2000-dim, text-embedding-3-large)
- `intents` - User intents with vector embeddings and confidence scores
- `indexes` - Communities/collections of related intents
- `index_members` - Membership with custom prompts and auto-assignment settings
- `intent_indexes` - Many-to-many junction (intents ↔ indexes)
- `intent_stakes` - Relationships between intents with confidence tracking
- `intent_stake_items` - Per-stake item details (linked to intent_stakes)
- `files` / `user_integrations` - Source tracking for intents
- `user_connection_events` - Connection requests/approvals
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

**Authentication Pattern**: Routes use guards (e.g. `auth.guard.ts`) which validate Privy JWT tokens and create/update users in DB.

**Key Controllers and Routes**:
- `AuthController` - Authentication (Privy integration)
- `IntentController` - Intent CRUD, generation, suggestions
- `IndexController` - Community management and index opportunities
- `FileController` - File uploads and processing
- `ChatController` - XMTP chat endpoints (agent-address, register-inbox, SSE stream sideband)
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

**Authentication**: Privy (Web3 authentication with email, social, wallet support)

**UI Libraries**: Tailwind CSS, Radix UI, Lucide React, Ant Design, react-markdown

## Important Patterns & Conventions

### Adapter Pattern

Protocol interfaces live in `src/lib/protocol/interfaces/` (e.g. `database.interface.ts`). Implementations live in `src/adapters/` (database, embedder, cache, queue, scraper). Controllers (e.g. opportunity, chat) receive database/queue abstractions via constructor injection so they can be tested with mocks.

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
PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-app-secret

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
- `XMTP_ENV` - XMTP network (`dev` or `production`)
- `XMTP_WALLET_KEY` - Agent wallet private key for XMTP identity
- `XMTP_DB_ENCRYPTION_KEY` - Agent local DB encryption key

### Frontend Environment Variables

See `frontend/.env.example` for frontend-specific configuration (Privy app ID, API URL, `NEXT_PUBLIC_XMTP_ENV`, etc.)

**Privy "Origin not allowed" (`invalid_origin`)**: If login fails with this error, the app’s current origin is not in Privy’s allowed list. In the [Privy Dashboard](https://dashboard.privy.io) go to **Configuration → App settings → Domains**, then under **Allowed origins** (Web & mobile web) add the exact origin(s) you use, e.g. `http://localhost:3000` (port required for localhost). Remove localhost from allowed domains when not developing.

## Testing

Tests use Vitest framework. Test files are located in:
- `protocol/tests/` - Integration and E2E tests
- `protocol/src/lib/*/tests/` - Unit tests alongside code

**Run tests**:
```bash
cd protocol
bun test                    # Run all tests
bun test --watch           # Watch mode
bun test path/to/test.ts   # Specific test file
```

**Test Categories**:
- Integration tests: Test agent interactions with services
- E2E tests: Test full API workflows
- Smoke tests: Test external integrations (crawl4ai, etc.)

## Database Workflow

### Making Schema Changes

1. **Edit schema**: Modify `protocol/src/schemas/database.schema.ts`
2. **Generate migration**: `bun run db:generate`
3. **Review migration**: Check `drizzle/` directory for generated SQL
4. **Apply migration**: `bun run db:migrate`
5. **Verify**: `bun run db:studio` to inspect changes

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
- All agents use Zod schemas for validation
- Prefer type inference from Drizzle schema over manual types
- Use `Id<'tableName'>` type from `_generated/dataModel` for document IDs
- For new files in the protocol, follow the `{domain}.{purpose}.{extension}` naming convention (see `.cursor/rules/file-naming-convention.mdc`)

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

### Controllers

- Controllers handle HTTP (request/response) and delegate business logic to services or protocol graphs
- They may accept adapters (database, queue) via constructor injection for testability

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

## Key Dependencies

**Protocol**:
- `langchain` / `@langchain/core` / `@langchain/openai` - Agent orchestration
- `drizzle-orm` / `postgres` - Database ORM and driver
- `bullmq` / `ioredis` - Job queues and Redis client
- `express` / `helmet` / `cors` - HTTP server
- `@privy-io/server-auth` - Authentication
- `zod` - Schema validation
- `openai` - OpenAI-compatible client (used with OpenRouter)
- `@composio/core` - Integration platform
- `langfuse-langchain` - LLM observability
- `@xmtp/agent-sdk` - XMTP messaging agent (server-side)
- `resend` - Email delivery
- `vitest` - Testing framework

**Frontend**:
- `next` - React framework
- `react` / `react-dom` - UI library
- `@privy-io/react-auth` - Authentication
- `tailwindcss` - CSS framework
- `@radix-ui/*` - Accessible UI primitives
- `@xmtp/browser-sdk` - XMTP messaging (E2E encrypted)
- `react-markdown` - Markdown rendering

## Convex Guidelines (from .cursor/rules)

**Note**: The project includes Convex guidelines in `.cursor/rules/convex_rules.mdc`. While this codebase doesn't currently use Convex, the file contains patterns for:
- Function syntax and registration
- Schema design with validators
- Query/mutation/action patterns
- TypeScript best practices

These guidelines are preserved for reference but don't apply to the current Drizzle-based architecture.
