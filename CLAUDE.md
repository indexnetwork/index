---
description:
alwaysApply: true
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Index Network is a private, intent-driven discovery protocol built on autonomous agents. Users define "intents" and competing Broker Agents work to fulfill them through relevant connections. The system leverages LangChain/LangGraph for agent orchestration, PostgreSQL with pgvector for semantic search, and a monorepo structure with protocol (backend) and frontend (Vite + React Router) workspaces.

## Development Commands

### Protocol (Backend)

```bash
cd backend

# Development
bun run dev                                 # Start dev server with hot reload (Bun.serve, port 3001)
bun run dev:prod                            # Start dev server in production mode
bun run start                               # Start production server

# Database (Drizzle ORM)
bun run db:generate                         # Generate migrations after schema changes
bun run db:migrate                          # Apply pending migrations
bun run db:studio                           # Open Drizzle Studio (interactive DB GUI)
bun run db:seed                             # Seed database with sample data
bun run db:flush                            # Flush all data from database

# Testing
bun test                                    # Run tests with bun test
bun test tests/e2e.spec.ts                  # Run specific test file
bun test --watch                            # Run tests in watch mode

# Code quality
bun run lint                                # Run ESLint

# Maintenance/CLI tools
bun run maintenance:trigger-integration     # Manually trigger integration sync
bun run maintenance:export-slack            # Export Slack data
bun run maintenance:import-slack-export     # Import Slack export files
bun run maintenance:reset-brokers           # Reset context brokers
bun run maintenance:update:embeddings       # Regenerate embeddings
bun run maintenance:decompose-profiles      # Backfill: decompose profiles into premises
bun run maintenance:backfill-premises       # Backfill: enqueue enrichment for users in a network
bun run maintenance:backfill-context-hyde   # Backfill: generate HyDE docs for user contexts
bun run maintenance:backfill-profile-questions # Backfill: enqueue profile-gap question generation for existing users
bun run maintenance:backfill-intent-questions # Backfill: enqueue intent-refinement question generation (most recent active intent per user)
bun run maintenance:compare-discovery       # Compare profile-HyDE vs context discovery strategies

# Background workers
bun run integration-worker                  # Start integration sync worker
bun run social-worker                       # Start social media sync worker
bun run audit-freshness                     # Audit intent freshness
```

### Frontend

```bash
cd frontend
bun run dev                                 # Start Vite dev server (with API proxy to protocol)
bun run build                               # Build blog assets then run Vite production build
bun run start                               # Start Vite preview server
bun run lint                                # Run ESLint
```

### CLI

```bash
cd packages/cli
bun src/main.ts conversation                # Run CLI directly with Bun (no build)
bun run build                               # Build native binaries for all platforms
bun test                                    # Run CLI tests
```

> **Subtree:** `packages/cli/` mirrors `indexnetwork/cli`. Edit via this monorepo; see `### Subtrees` for sync commands.

### @indexnetwork/protocol Package

```bash
cd packages/protocol

bun run build                               # Compile TypeScript to dist/
bun run dev                                 # Watch mode
npm publish --access public                 # Publish (requires NPM login + OTP, or use CI)

# Publishing via CI (preferred):
# push dev to publish an rc prerelease
git push <indexnetwork-remote> dev

# push main to publish the stable release if the version is new
git push <indexnetwork-remote> main
```

> **Subtree:** `packages/protocol/` mirrors `indexnetwork/protocol`. Edit via this monorepo; see `### Subtrees` for sync commands.

### Subtrees

The following packages are git subtrees tracked to external repos. **Syncing is automatic for Index-owned subtrees** — the `.github/workflows/sync-subtrees.yml` workflow runs on every push to `dev` or `main` of the canonical `indexnetwork/index` repo (including PR merges), splitting each prefix and force-pushing to the corresponding subtree repo with the `SUBTREE_SYNC_PAT` secret. Subtree branches stay aligned with the monorepo branch (`dev` -> `dev`, `main` -> `main`). AgentVillage is Edge-City-owned and is mounted as a git submodule at `packages/edge-city/agentvillage`; `Edge-City/agentvillage` is canonical. The local `scripts/hooks/pre-push` hook still regenerates SKILL.md files before push, but no longer runs subtree push.

#### packages/protocol/ → indexnetwork/protocol

The `@indexnetwork/protocol` npm package (agent graphs, interfaces, tools). Two-way: edit here or in the external repo.

```bash
# Manual push if the hook failed (use dev or main)
git subtree push --prefix=packages/protocol https://github.com/indexnetwork/protocol.git <branch>

# Pull if external repo was edited directly
git subtree pull --squash --prefix=packages/protocol https://github.com/indexnetwork/protocol.git <branch>
```

#### packages/cli/ → indexnetwork/cli

The `@indexnetwork/cli` npm package (CLI binary). Two-way: edit here or in the external repo.

```bash
# Manual push if the hook failed (use dev or main)
git subtree push --prefix=packages/cli https://github.com/indexnetwork/cli.git <branch>

# Pull if external repo was edited directly
git subtree pull --squash --prefix=packages/cli https://github.com/indexnetwork/cli.git <branch>
```

#### packages/claude-plugin/ → indexnetwork/claude-plugin

The `@indexnetwork/claude-plugin` Claude Code plugin — ships two user-invocable skills (`index-orchestrator` and `index-negotiator`) and declares the Index Network MCP endpoint so `/plugin install indexnetwork/claude-plugin` auto-configures it. Skill SKILL.md files are generated by `scripts/build-skills.ts` from templates in `packages/protocol/skills/claude-plugin/` and a shared `core-guidance.partial.md`; the generated files are committed to this package and synced to the subtree on push.

```bash
# Manual push if the hook failed (use dev or main)
git subtree push --prefix=packages/claude-plugin https://github.com/indexnetwork/claude-plugin.git <branch>

# Pull if external repo was edited directly (avoid — always edit via this repo)
git subtree pull --squash --prefix=packages/claude-plugin https://github.com/indexnetwork/claude-plugin.git <branch>
```

#### packages/edge-city/agentvillage/ → Edge-City/agentvillage submodule

The `@edge-city/agentvillage` Agent Village workspace, skills, and installer. Includes skills for edge-esmeralda, index-network, edgeos, and geo-esmeralda. This package is Edge-City-owned; `Edge-City/agentvillage` is canonical and this monorepo records a submodule pointer for local context only. See `docs/guides/agentvillage-submodule.md` for the workflow and migration preservation note. Do not use subtree push/pull for AgentVillage anymore. Make AgentVillage changes inside the submodule, push a branch/fork to `Edge-City/agentvillage`, open the PR there, then update this monorepo's submodule pointer after the canonical PR merges. The nested `skills/` directory syncs from `Edge-City/agentvillage` to `Edge-City/agentvillage-skills` via that repo's workflow.

```bash
# First clone or after switching branches
git submodule update --init packages/edge-city/agentvillage

# Work on AgentVillage against the canonical repository
cd packages/edge-city/agentvillage
git checkout -b <branch>
# edit, commit, push to a fork/branch, then open a PR against Edge-City/agentvillage:main

# After the Edge-City PR merges, update this monorepo's pointer
cd ../../..
git -C packages/edge-city/agentvillage fetch origin main
git -C packages/edge-city/agentvillage checkout origin/main
git add packages/edge-city/agentvillage
```

### Root

```bash
bun install                                # Install dependencies for all workspaces
bun run dev                                # Interactive: select root or a worktree to run dev
bun run worktree:list                       # List worktrees and their setup status
bun run worktree:setup <name>               # Install node_modules & symlink .env files into a worktree
bun run worktree:dev <name>                 # Run all dev servers from a worktree (auto-setups if needed)
bun run worktree:build [name]               # Build at root, or in worktree <name> if given
```

## Architecture Overview

For full architecture details see `docs/design/architecture-overview.md` and `docs/design/protocol-deep-dive.md`.

### Monorepo Structure

```
index/
├── backend/           # Backend API & Agent Engine (Bun, TypeScript)
├── packages/
│   ├── protocol/        # @indexnetwork/protocol NPM package — subtree → indexnetwork/protocol
│   ├── cli/             # @indexnetwork/cli — Bun, TypeScript — subtree → indexnetwork/cli
│   ├── claude-plugin/   # @indexnetwork/claude-plugin — index-orchestrator and index-negotiator skills, subtree → indexnetwork/claude-plugin
│   └── edge-city/       # Edge-City submodules: agentvillage, landing, controlplane
├── frontend/          # Vite + React Router v7 SPA with React 19
├── docs/              # Project documentation (design/, domain/, guides/, specs/)
└── scripts/           # Worktree helpers, hooks, dev launcher
```

### Documentation Directories

- `docs/design/` — Architecture and deep-dive docs. Describes how the system is built: layering, data flow, agent graphs, key subsystems. Update when architecture changes. See `docs/design/opportunity-status-lifecycle.md` for the opportunity status lifecycle (state machine, flows, transition table).
- `docs/domain/` — Domain concept docs. Explains the business model: what intents, indexes, opportunities, profiles, contacts are and how they relate. Update when domain model changes.
- `docs/specs/` — API and CLI specs. Describes external interfaces: endpoints, CLI commands, input/output contracts. Update when public interfaces change.
- `docs/guides/` — Setup and usage guides for developers. Update when dev workflow or environment setup changes.

### Protocol Key Directories

**Tech Stack**: Bun runtime (Bun.serve), Drizzle ORM, PostgreSQL with pgvector, BullMQ (Redis-backed queues), LangChain/LangGraph

- `src/controllers/` - API controllers with decorator-based routing (`@Controller`, `@Get`, `@Post`)
- `src/services/` - Business logic layer
- `src/adapters/` - Infrastructure implementations (database, embedder, cache, queue, scraper, storage)
- `src/gateways/` - Single-point delivery bridges to external chat/notification channels (e.g. Telegram bot for inbound+outbound)
- `src/schemas/` - Drizzle table definitions; primary schema is `schemas/database.schema.ts`
- `src/guards/` - Auth/validation guards
- `src/queues/` - BullMQ job queue definitions
- `src/events/` - Event emitters (intent events, index membership events, premise lifecycle events)
- `src/cli/` - CLI and maintenance scripts
- `packages/protocol/` - `@indexnetwork/protocol` NPM package — the agent graphs, interfaces, and tools layer. Published independently; `backend/` imports it as a versioned NPM dependency.

**Entry point**: `backend/src/main.ts` -- Bun native server on port 3001, controllers registered via `RouteRegistry`.

For full agent/graph/controller listings see `docs/design/protocol-deep-dive.md` and `docs/specs/api-reference.md`.

### Frontend Architecture

**Framework**: Vite, React Router v7, React 19, Tailwind CSS 4, Radix UI

- `src/app/` - Page components (lazy loaded)
- `src/components/` - Reusable React components
- `src/contexts/` - React Context providers
- `src/services/` - Frontend API clients (typed fetch wrappers)

**API Proxy**: Vite proxies `/api/*` to protocol backend (port 3001) in dev. **Auth**: Better Auth (session-based).

## Protocol Layering Rules

Strict layering: **Controllers -> Services -> Adapters**. Dependencies always point inward.

1. **Controllers** import **services** (or protocol graph factories). Must not import adapters.
2. **Services** import **adapters** for data access. Must not import other services -- use events, queues, or shared lib for cross-service orchestration.
3. **Protocol layer** (`@indexnetwork/protocol`) is fully self-contained — zero imports from the app. Receives adapters via **constructor injection** through interfaces. The **composition root** (`src/controllers/mcp.controller.ts`) assembles `ProtocolDeps` inline and injects `ChatGraphFactory` into `ChatSessionService` at startup via `setFactory()`.
4. **Adapters** must not import from `@indexnetwork/protocol` interfaces — they define their own aligned types.

### Template Files

Consult before adding or changing code in each layer:

- `backend/src/controllers/controller.template.md`
- `backend/src/services/service.template.md`
- `backend/src/queues/queue.template.md`


## Important Patterns

### Polymorphic Source Tracking

Intents track their origin via `sourceType` (`file|integration|link|discovery_form|enrichment`) and `sourceId` (uuid FK). Enables filtering by source and bulk re-processing.

### Confidence & Inference Tracking

Intents have `confidence` (0-1) and `inferenceType` (`explicit|implicit`).

### Personal Indexes

Each user has a personal index (`isPersonal=true`) created on registration, tracked via the `personal_networks` mapping table. Ownership via `network_members` with `permissions: ['owner']`, not a denormalized column. Contacts are stored as `network_members` rows with `'contact'` permission on the owner's personal index -- no separate contacts table. `ContactService.addContact(email)` handles finding/creating users (including ghost users) and upserting membership. Personal indexes cannot be deleted, renamed, or listed publicly.

### Index Prompts & Auto-Assignment

Indexes and members have `prompt` fields used by LLM agents to evaluate intent membership. Members have `autoAssign: boolean` for auto-tagging new intents.

### Relevancy Scoring

`IntentIndexer` agent scores intent-network fit as `relevancyScore` (0.0-1.0) in `intent_networks`. Used during opportunity discovery to break ties across shared networks. Indexes without prompts default to 1.0.

### Queue-Based Processing

Intent creation is synchronous; complex processing (indexing, generation) is async via BullMQ queues. Default: 3 retries with exponential backoff, completed jobs removed after 24h. The `EnrichmentQueue` (formerly `ProfileQueue`) handles profile generation, premise decomposition, and user context generation as a unified enrichment pipeline. The premise graph's create path runs a `dedupe` node before persist: a candidate whose embedding is a near-duplicate (cosine ≥ `PREMISE_DEDUP_SIMILARITY`, default 0.93) of an existing ACTIVE premise for the same user is skipped (`findSimilarActivePremise`), so re-running similar input does not accumulate near-identical premises. `PremiseDecomposer` emits a per-premise `validityDays`; contextual premises are persisted `volatile` with `validity.validUntil = now + validityDays` (assertive premises do not expire), and provenance `confidence` is derived from the analyzer's felicity scores when not explicitly supplied. Per-network user contexts are regenerated by the dedicated `UserContextQueue` (`usercontext.queue.ts`), enqueued both on enrichment completion and — chained from `PremiseQueue.handleProfileRegen` after the global-profile aggregate finishes — on every premise change, so the representation discovery matches on refreshes promptly instead of only on the next full enrichment. The queue dedups per user (its jobId frees on settle via `removeOnComplete/Fail: true` so repeated edits re-run rather than dedup against a retained completed job), short-circuits per network via a `premiseHash`, and regenerates the context paragraph + embedding + HyDE docs (forcing HyDE regeneration, since the context row id is stable across upserts). On per-network failure it rolls the `premiseHash` back and fails the job so retries regenerate rather than short-circuit.

### User Contexts & Discovery

Each user has network-scoped **user contexts** (`user_contexts` table) — synthetic paragraph representations generated from their premise graph by `UserContextGenerator` — plus one **global** context row (`networkId = null`, the profile-replacing identity paragraph) enforced unique per user by the partial `user_contexts_user_global_uniq` index. The global row is generated by `UserContextGenerator.generateGlobalColdStart` (a network-agnostic prompt variant) and is always (re)built from active premises even when the user belongs to no non-personal networks; per-network rows use the network-lensed prompt. Contexts are generated during enrichment and regenerated whenever the user's premises change: premise lifecycle events trigger a global-profile aggregate, which then enqueues regeneration via `UserContextQueue` (premise-derived, `premiseHash`-gated, with embeddings + HyDE refreshed) for the global row and each per-network row. They are stored with their embeddings. The opportunity graph uses contexts for **context-to-intent discovery**: it loads a user's contexts, then searches for matching intents via `searchIntentsByContextEmbedding()`. This runs alongside profile-HyDE discovery as a complementary strategy, with results merged via `mergeStrategyCandidates()`. Context discovery candidates carry `discoverySource: 'context-to-intent'`.

### Event-Driven Broker System

Events in `src/events/`: `IntentEvents.onCreated/onUpdated/onArchived` (with `intentId`, `userId`, optional `payload`, `previousStatus`). Index membership events in `network_membership.event.ts`. Premise lifecycle events in `premise.event.ts`: `PremiseEvents.onCreated/onUpdated/onRetracted/onExpired` — each enqueues cascade and profile regeneration jobs via `EnrichmentQueue`. Question lifecycle events in `question.event.ts`: `QuestionEvents.onCreated/onAnswered` — `onAnswered` dispatches to mode-specific handlers (`question.answer.handler.ts`): profile→premise creation, intent→description refinement + HyDE regen, negotiation→opportunity metadata enrichment (read back during continuation via `NegotiationQueries.getOpportunityUserAnswers`), discovery→no-op. Questions have an optional `conversationId` column linking them to the chat session that triggered them, and `detection.messageId` for anchoring to a specific assistant message. `tool.factory.ts` wraps `questionerEnqueue` in `sessionAwareEnqueue` to default `conversationId` from the active session context. The frontend renders conversation-linked questions inline via `InjectedQuestions`; sidebar badge uses `noConversation=true` to exclude them. Services emit events after DB transactions; other services/graphs react independently.

### Agent Registry

All agents are first-class database entities backed by `agents`, `agent_transports`, and `agent_permissions`. System agents (`Index Chat Orchestrator`, `Index Negotiator`) are seeded with well-known UUIDs and receive default permissions during onboarding. MCP auth resolves to `userId + agentId` pairs when API keys include `metadata.agentId`. API-key principal resolution is centralized in `src/lib/apikey/principal.ts` (`resolveApiKeyUserId`), shared by the MCP auth resolver (`mcp.controller.ts`) and `AuthOrApiKeyGuard` so the same key cannot resolve to different users across codepaths: it prefers a verified session, then `userId`, then `referenceId`, and rejects (fails closed) any key whose two principal columns are both set but disagree. Telegram-surfaced MCP requests additionally verify that the request's `x-index-telegram-username`/`-handle` matches the authenticated user's stored telegram handle and isn't owned by another user (`findTelegramHandleOwners` normalizes stored `@h` / `t.me` URL variants to the bare handle), rejecting on mismatch. Personal agents connect by polling `/agents/:id/negotiations/pickup` with an API key; each poll bumps `agents.last_seen_at`. The dispatcher consults that heartbeat: if no personal agent is fresh (seen within 90 s), the system negotiator runs inline; otherwise the turn is parked in `tasks.state='waiting_for_agent'` with a bounded park-window budget (`AMBIENT_PARK_WINDOW_MS`, 5 min by default) that carries over from the `waiting_for_agent` timer to the `claimed` timer rather than stacking.

**Network-scoped agents.** Agents can be bound to a single network via `agent_permissions.scope='network', scopeId=<networkId>`. The `agent-scope.guard.ts` resolves a request's agent scope (null for global agents, the bound `scopeId` otherwise) and `assertAgentNetworkScope(req, networkId)` is wired into network/intent/opportunity controllers — write paths assert, list paths filter via `withAgentScope`. Mismatches throw `ScopeViolationError`, mapped to HTTP 403 in `main.ts`. The MCP layer additionally clamps `indexScope` to `[networkScopeId, personalIndex]` via `computeAgentIndexScope` so every tool call from a scoped key is bounded. **Discovery honors the scope too:** the opportunity graph takes an optional `indexScope` input and its scope node intersects it with the user's memberships (falling back to all networks only when unset), so `discover_opportunities` stays within `[networkScopeId, personalIndex]`. Ambient discovery threads the bound network through the intent HyDE handler into the from-intent queue (`networkIds: [networkScopeId]`), so background matching never reaches networks outside the agent's scope. **Opportunity reads are gated too:** whenever a network is specified — either a scoped key's clamped `networkId` or a user explicitly filtering to a community — `getOpportunitiesForUser(userId, { networkId })` returns an opportunity only when *every* participant (distinct actor user) is anchored on that network, not just the requesting user. Otherwise a cross-network opportunity leaked the out-of-network counterpart's user/profile/intent through the card. An unscoped read (no `networkId`) is unaffected — nothing is filtered when neither the key nor the request specifies a network. Used by experiment-network CSV import (`networkInvitationService.invite`): each imported user receives a network-scoped agent + API key by email — possession of the inbox verifies receipt of that scoped credential, not unrestricted index.network web access; no `users.experimentNetworkId` column is needed.

### Trace Event Instrumentation

`requestContext` carries a `traceEmitter?` callback for real-time TRACE panel in chat UI. Tool files emit `graph_start/graph_end` around graph invocations; graph files emit `agent_start/agent_end` around agent calls. Use kebab-case agent names. See `docs/design/protocol-deep-dive.md` for full examples.

Negotiation-specific events (`negotiation_session_start/end`, `negotiation_turn`, `negotiation_outcome`) carry per-candidate turn and outcome data for orchestrator-inline negotiations. They are persisted into `debugMeta.orchestratorNegotiations.opportunityIds` for later hydration by the debug endpoint. `debugMeta` also now tracks `llm.{calls,totalDurationMs,resets,hallucinations}` accumulated from `llm_start/end`, `response_reset`, and `hallucination_detected` events.

### OpenRouter Configuration

Model settings centralized in `packages/protocol/src/shared/agent/model.config.ts`. Key env vars: `OPENROUTER_API_KEY` (required), `CHAT_MODEL` (override), `CHAT_REASONING_EFFORT` (`minimal|low|medium|high|xhigh`), `RUN_OPPORTUNITY_EVAL_IN_PARALLEL` (experimental), `NEGOTIATION_MAX_TURNS_CHAT` (default 4, chat-path negotiations), `NEGOTIATION_MAX_TURNS_AMBIENT` (default 6, ambient/background negotiations). Use `ToolContext.modelConfig` to inject config per-request via `ChatAgent.create`; only `ChatAgent` reads `ModelConfig` from `ToolContext` — most other protocol agents rely on `OPENROUTER_API_KEY` in the environment (some accept an explicit `ModelConfig` as a direct parameter to `createModel()`).

### Rate Limiting

The protocol applies per-route-class limits via the `RateLimit(class)` guard from `src/guards/limiter.guard.ts`. Three classes:

- `read` — all `GET` routes (default 1200/min)
- `write` — all `POST/PUT/PATCH/DELETE` routes (default 600/min)
- `auth_write` — credential-mutation endpoints on `/api/auth/*` (default 100/min); enforced by Better Auth's own `rateLimit` block

Buckets are keyed per identifier: verified JWT user (signature-checked) or client IP for everything else. Unverified credentials (raw API keys, session cookies) deliberately do NOT get their own buckets — that would let a client rotate values per request to evade IP throttling. Apply via `@UseGuards(RateLimit('read'), AuthOrApiKeyGuard)` — `RateLimit` must be FIRST so it short-circuits before any DB work. Agent-poller endpoints (`POST /agents/:id/negotiations/pickup`, `GET /agents/:id/opportunities/pending`, `GET /agents/:id/opportunities/accepted`) intentionally omit the guard. Storage is Redis (shared across Bun instances) when either `REDIS_URL` or `REDIS_HOST` is set; otherwise the limiter uses an in-memory fallback (single-process, dev only — not multi-instance safe). Set `LIMITER_DISABLE=1` to disable as an incident escape hatch.

**MCP transport throttle.** The `/mcp` endpoint is dispatched in `main.ts` before the `/api/*` branch, so it bypasses the `RateLimit` guard above. It has its own per-principal throttle instead: `checkMcpRateLimit` (`src/lib/limiter/mcp.ts`), injected into the protocol MCP server as the `mcpRateLimiter` hook on `ToolDeps` and invoked in `mcp.server.ts` after identity resolves but before any DB work. It keys two buckets per `(userId, agentId)` principal — a per-tool bucket (`MCP_LIMIT_TOOL_PER_MIN`, default 120; `discover_opportunities` is far tighter at `MCP_LIMIT_DISCOVER_PER_MIN`, default 10) and an aggregate backstop (`MCP_LIMIT_PRINCIPAL_PER_MIN`, default 300). It shares the same limiter storage (Redis or in-memory) and honors `LIMITER_DISABLE`. This stops an over-eager autonomous agent from cascading tool calls until its own LLM provider rate-limits it. Complementing this, `discover_opportunities` **coalesces in-flight MCP discovery runs**: a repeat call with an equivalent request returns the existing queued/running run (`coalesced: true`) via `discoveryRuns.listActive()` instead of spawning a duplicate, so re-firing discovery instead of polling `get_discovery_run` no longer multiplies expensive graph runs.

See `docs/superpowers/specs/2026-05-21-protocol-rate-limiting-design.md` for the full design.

## Environment Setup

See `docs/guides/getting-started.md` for full setup guide.

### Neon Database Topology

Two Neon projects exist:

1. **Protocol-dev-europe** (`patient-pine-89907813`, `aws-eu-central-1`) — local development database. Developers connect here from their machines.
2. **Protocol** (`shiny-cloud-34341469`, `aws-us-east-1`) — has two branches:
   - **`production`** (`br-fragrant-brook-ahexgsek`) — production data. **Never touch.**
   - **`dev`** (`br-late-tooth-ahlsfgdb`) — used by the Railway `dev` environment. Database name: `protocol_prod`.

Railway dev deployments run `db:migrate` against the `dev` branch of the Protocol project.

### Required Environment Variables

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/protocol_db
OPENROUTER_API_KEY=your-openrouter-api-key
PORT=3001
NODE_ENV=development
```

### Optional (see `backend/env.example` for full list)

`REDIS_URL`, `RESEND_API_KEY`, `UNSTRUCTURED_API_URL`, `COMPOSIO_API_KEY`, `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`, `SENTRY_DSN`, `PARALLELS_API_KEY`, `APP_URL`

Frontend: see `frontend/.env.example`. **Auth origin (`invalid_origin`)**: ensure app origin is in Better Auth `trustedOrigins` when developing locally.

## Testing

Always target specific test files rather than running the full suite. `bun test` in protocol is slow.

```bash
cd backend
bun test path/to/test.ts                   # Run specific test (PREFERRED)
bun test --watch                            # Watch mode
bun test                                    # Run ALL tests (avoid unless necessary)
```

**Test locations**: `backend/tests/` (integration/E2E), `backend/src/lib/*/tests/` (unit tests).

**Standards**: Load env at top before imports. Import from `bun:test` (destructured). Use `describe` grouping. Set timeouts (agent: 30s, graph: 60s, LLM: 120s). Clean up in `afterAll`. Mock externals. Test success and error paths. Never commit without running affected tests.

## Database Workflow

**Schema location**: `backend/src/schemas/database.schema.ts`. Drizzle client: `backend/src/lib/drizzle/drizzle.ts`.

### Migration Naming

Drizzle generates random names. **Always rename** to: `{NNNN}_{action}_{target}[_{detail}].sql`

Examples: `0000_initial_schema.sql`, `0001_add_chat_session_share_token.sql`, `0003_drop_agent_wallet_columns.sql`

**After renaming**: Update `tag` in `drizzle/meta/_journal.json` to match (without `.sql`). Do not rename snapshot files.

### Schema Change Checklist

1. Edit `backend/src/schemas/database.schema.ts`
2. `bun run db:generate`
3. Rename the `.sql` file and update `_journal.json` tag
4. `bun run db:migrate`
5. Verify: `bun run db:generate` should report "No schema changes"

### Migration Troubleshooting

Migrations break when: (1) `_journal.json` and `.sql` files diverge, (2) SQL applied outside Drizzle without updating `__drizzle_migrations`, (3) pgvector `CREATE EXTENSION vector` missing from first migration. Always use `bun run db:migrate`.

**Fix corrupted local migrations**: `bun run maintenance:fix-migrations`
**Reset remote DB**: `bun run maintenance:reset-remote-db -- --confirm && bun run db:migrate`

## Code Style & Practices

### TypeScript

- Strict mode. No `any` -- use `unknown` and narrow. ESLint enforces `@typescript-eslint/no-explicit-any`.
- Zod schemas for all agent I/O. Prefer Drizzle type inference over manual types.
- Canonical schema in `src/schemas/database.schema.ts` -- import from there, not `lib/schema`.
- Prefer soft deletes (`deletedAt`) over hard deletes.

### File Naming Convention

Pattern: `{domain}.{purpose}.ts` (e.g. `chat.graph.ts`, `intent.inferrer.ts`, `opportunity.evaluator.ts`)

Common purposes: `.graph`, `.state`, `.agent`, `.generator`, `.evaluator`, `.verifier`, `.inferrer`, `.reconciler`, `.controller`, `.service`, `.queue`, `.spec`

**Adapters**: Name by concept, not tech: `database.adapter.ts` (not `drizzle.adapter.ts`), `cache.adapter.ts` (not `redis.adapter.ts`).

**Exceptions**: `index.ts`, `schema.ts`, `main.ts`, root-level utility files (`constants.ts`, `types.ts`).

### Import Ordering

External packages -> Deep relative imports (`../../+`) -> Nearby relative (`./`, `../`). Separated by blank lines.

### TSDoc

TSDoc on all classes (summary) and public methods (`@param`, `@returns`, `@throws`).

### Layer-Specific Rules

- **Agents**: Use `createModel()` from `model.config.ts`. Keep pure -- no direct DB access.
- **Services**: Handle persistence, emit events. Must not import other services.
- **Controllers**: Delegate to services/graphs. Must not import adapters. Use guards for auth.

## Git Workflow

### Worktrees

**Always use worktrees** for features and fixes. Keep `dev` stable. Worktrees live in `.worktrees/` (gitignored). **Folder names use dashes** (e.g. `feat-my-feature`); branches can use slashes.

```bash
git worktree add .worktrees/feat-foo dev
bun run worktree:setup feat-foo            # symlink .env files + bun install
bun run worktree:dev feat-foo              # start all dev servers
```

### Conventional Commits

Format: `<type>[scope]: <description>`. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`. Breaking changes: `BREAKING CHANGE:` in footer or `!` after type.

### Conventional Branches

Format: `<type>/<short-description>`. No Linear issue IDs. Examples: `feat/user-authentication`, `fix/login-redirect-loop`.

### Pull Requests

Use `gh` CLI to create PRs into `origin/dev`. Description as changelog: New Features, Bug Fixes, Refactors, Documentation, Tests.

### Finishing a Branch

1. Update all relevant documentation (see **Documentation Directories** above for what belongs where):
   - `CLAUDE.md` — if structural or architectural changes were introduced
   - `README.md` files — any affected package READMEs
   - `docs/design/` — if architecture or data flow changed
   - `docs/domain/` — if the domain model changed (entities, relationships, concepts)
   - `docs/specs/` — if public interfaces changed (API endpoints, CLI commands)
   - `docs/guides/` — if dev workflow or environment setup changed
2. Delete any related superpowers plans/specs from `docs/superpowers/plans/` and `docs/superpowers/specs/`
3. **Bump package versions** for every package touched by the branch, following [Semantic Versioning 2.0.0](https://semver.org/). Do this before merging or pushing — never skip it.
   - **`packages/cli/`** and **`packages/protocol/`**: bump `package.json` version.
4. Merge into dev: `git checkout dev && git merge <branch-name>`
5. Push: `git push origin dev`
6. If an npm-published subtree package was updated (`packages/cli/` or `packages/protocol/`): bump its base version before promoting to `main`. Subtree pushes to `dev` publish `-rc` prereleases under the `rc` npm tag, and subtree pushes to `main` publish the stable version when it is not already on npm.
7. Clean up: delete branch and remove worktree

## Superpowers Workflow

### Implementation via Subagents in Worktrees

When executing implementation plans, **always use subagent-driven development with worktree isolation** (`isolation: "worktree"`). This keeps `dev` stable and allows parallel independent tasks. Combine the `superpowers:subagent-driven-development` and `superpowers:using-git-worktrees` skills.

### Receiving Code Review (`/receiving-code-review`)

Code reviews on this project are done by **GitHub Copilot**, triggered manually by the user (via the Reviewers menu on the PR, or `gh pr edit PR-NUMBER --add-reviewer @copilot`). Copilot does not auto-review on push and replies do not trigger it — only an explicit re-review request does.

When handling Copilot reviews on PRs, follow this workflow:

1. **Fetch unresolved conversations**: Use `gh api` to list all review comments on the PR. Focus on unresolved conversation threads from `github-copilot[bot]`.
2. **Evaluate each conversation**: For each unresolved thread, decide whether a code fix is actually needed:
   - **Fix needed**: Implement the fix, push, then **manually resolve the conversation** (Copilot does not auto-resolve when commits are pushed or suggestions are applied).
   - **No fix needed**: Reply in the comment thread with technical reasoning for why the current code is correct (e.g., YAGNI, reviewer lacks context, breaks existing patterns), then resolve it. Use `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies` to reply inline.
3. **Resolve all conversations**: Every conversation must be manually resolved before the PR can merge.

> **IMPORTANT:** Copilot never sees follow-up comments and will not respond to `@copilot` mentions in threads — replies are for human context only. On re-review, Copilot may re-raise already-resolved comments; that is expected behavior.

**Key commands:**
```bash
# List PR review comments (filter for unresolved)
gh api repos/{owner}/{repo}/pulls/{pr}/comments

# Reply to a specific review comment thread (USE THIS — not gh pr comment)
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies -f body="..."

# Request a Copilot review on an existing PR
gh pr edit PR-NUMBER --add-reviewer @copilot
```

## Session Learning Capture

When wrapping up a session that uncovered something **reusable and non-obvious** — a
workflow, a fix for a recurring failure, an exact command sequence, an environment
gotcha, or a convention — run the `learn-skill` skill to persist it before ending.

- `learn-skill` writes to the project-local `.pi/skills/` and **never edits
  protected/home skills in place** (it migrates them local first, then updates the copy).
- It is configurable via `.pi/skills/learn-skill/config.json` (target, protected
  locations, dedup/cross-link features, and rpiv integrations: todo,
  ask-user-question, args, advisor).
- Use `.pi/skills/pi-skill-authoring` for the mechanics of writing a correct `SKILL.md`.
- Skip silently when nothing meets the "reusable and non-obvious" bar — never capture
  one-off facts.
