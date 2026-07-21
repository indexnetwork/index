---
description:
alwaysApply: true
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Index Network is a private, intent-driven discovery protocol built on autonomous agents. Users define "intents" and competing Broker Agents work to fulfill them through relevant connections. The system leverages LangChain/LangGraph for agent orchestration, PostgreSQL with pgvector for semantic search, and a monorepo structure with user-facing apps (`apps/web`, `apps/mac`), deployable services (`services/api`), and shared packages.

## Development Commands

### API Service

```bash
cd services/api

# Development
bun run dev                                 # Start dev server with hot reload (Bun.serve, port 3001)
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
bun run maintenance:backfill-premises       # Backfill: enqueue enrichment for users in a network
bun run maintenance:backfill-context-hyde   # Backfill: generate HyDE docs for user contexts
bun run maintenance:backfill-global-user-contexts # Backfill: generate the global user_context (networkId=null) for every user, synthesized from active premises
bun run maintenance:backfill-intent-questions # Backfill: enqueue intent-refinement question generation (most recent active intent per user)

# Background workers
bun run integration-worker                  # Start integration sync worker
bun run social-worker                       # Start social media sync worker
```

### Web App

```bash
cd apps/web
bun run dev                                 # Start Vite dev server (with API proxy to protocol)
bun run build                               # Build blog assets then run Vite production build
bun run start                               # Start Vite preview server
bun run lint                                # Run ESLint
```

### Mac App

```bash
cd apps/mac/HaloApp
./build.sh                                  # Assemble HTML and build the macOS WKWebView app

cd ../HaloApp-iOS
./build.sh assemble                         # Regenerate mobile Resources/index.html without Xcode
./preview/build-preview.sh                  # Build the macOS preview shell for the mobile UI
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

The following paths are git subtrees tracked to external repos. **Syncing is automatic for Index-owned subtrees** — the `.github/workflows/sync-subtrees.yml` workflow runs on every push to `dev` or `main` of the canonical `indexnetwork/index` repo (including PR merges), splitting each prefix and force-pushing to the corresponding subtree repo with the `SUBTREE_SYNC_PAT` secret. Subtree branches stay aligned with the monorepo branch (`dev` -> `dev`, `main` -> `main`). AgentVillage is Edge-City-owned and is mounted as a git submodule at `packages/edge-city/agentvillage`; `Edge-City/agentvillage` is canonical. The local `scripts/hooks/pre-push` hook still regenerates SKILL.md files before push, but no longer runs subtree push.

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

#### packages/hermes-plugin/ → indexnetwork/hermes-plugin

The `@indexnetwork/hermes-plugin` Hermes-native plugin package — ships the Index Network Hermes plugin manifest, Python registration surface, MCP-backed tool handlers, generated bundled skills, and dashboard placeholder. Skill SKILL.md files are generated by `scripts/build-skills.ts` from templates in `packages/protocol/skills/hermes-plugin/` and the shared `core-guidance.partial.md`. Edit via this monorepo; the standalone `indexnetwork/hermes-plugin` repo is a public subtree mirror synced on `dev`/`main` pushes.

```bash
# Manual push if the workflow failed (use dev or main)
git subtree push --prefix=packages/hermes-plugin https://github.com/indexnetwork/hermes-plugin.git <branch>

# Pull if the external repo was edited directly (avoid — always edit via this repo)
git subtree pull --squash --prefix=packages/hermes-plugin https://github.com/indexnetwork/hermes-plugin.git <branch>
```

#### apps/mac/ → indexnetwork/mac-client

The native Apple client prototype (macOS + iOS WKWebView shells around self-contained React/HTML bundles). The monorepo path is synced to the standalone `indexnetwork/mac-client` repo on `dev`/`main` pushes.

```bash
# Manual push if the workflow failed (use dev or main)
git subtree push --prefix=apps/mac https://github.com/indexnetwork/mac-client.git <branch>

# Pull if the external repo was edited directly
git subtree pull --squash --prefix=apps/mac https://github.com/indexnetwork/mac-client.git <branch>
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
herdr worktree open --path <path> --label <name> --focus --json # Open/focus the visible worktree workspace
bun run worktree:dev <name>                 # Run all dev servers from a worktree (auto-setups if needed)
bun run worktree:build [name]               # Build at root, or in worktree <name> if given
bun run skills:validate                      # Validate every project-local Pi skill
bun run test:scripts                         # Run focused deterministic script tests
bun run pr:snapshot -- <number|URL|branch>   # Emit factual PR/review/worktree JSON
```

### Deployment Config

- API service: root `railway.toml` watches `services/api/**` and `packages/protocol/**`, runs migrations from `services/api`, and starts `services/api`.
- Web app: `apps/web/railway.toml` watches `apps/web/**` and starts the Vite/Bun server from `apps/web`.
- If Railway service settings reference a config path or root directory, update them from the legacy `frontend` path to `apps/web`; the API service continues to use the root `railway.toml`.

## Architecture Overview

For full architecture details see `docs/design/architecture-overview.md` and `docs/design/protocol-deep-dive.md`.

### Monorepo Structure

```
index/
├── apps/
│   ├── web/             # Vite + React Router v7 SPA with React 19
│   └── mac/             # Native Apple client subtree → indexnetwork/mac-client
├── services/
│   └── api/             # Backend API & Agent Engine (Bun, TypeScript)
├── packages/
│   ├── protocol/        # @indexnetwork/protocol NPM package — subtree → indexnetwork/protocol
│   ├── cli/             # @indexnetwork/cli — Bun, TypeScript — subtree → indexnetwork/cli
│   ├── claude-plugin/   # @indexnetwork/claude-plugin — index-orchestrator and index-negotiator skills, subtree → indexnetwork/claude-plugin
│   ├── hermes-plugin/   # @indexnetwork/hermes-plugin — Hermes-native plugin, subtree → indexnetwork/hermes-plugin
│   └── edge-city/       # Edge-City submodules: agentvillage, landing, controlplane
├── docs/                # Project documentation (design/, domain/, guides/, specs/)
└── scripts/             # Worktree helpers, hooks, dev launcher
```

### Documentation Directories

- `docs/design/` — Architecture and deep-dive docs. Describes how the system is built: layering, data flow, agent graphs, key subsystems. Update when architecture changes. See `docs/design/opportunity-status-lifecycle.md` for the opportunity status lifecycle (state machine, flows, transition table).
- `docs/domain/` — Domain concept docs. Explains the business model: what intents, indexes, opportunities, identity and context, contacts are and how they relate. Update when domain model changes.
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
- `src/events/` - Event emitters (intent events, network membership events, premise lifecycle events)
- `src/cli/` - CLI and maintenance scripts
- `packages/protocol/` - `@indexnetwork/protocol` NPM package — the agent graphs, interfaces, and tools layer. Published independently; `services/api/` imports it as a versioned NPM dependency.

**Entry point**: `services/api/src/main.ts` -- Bun native server on port 3001, controllers registered via `RouteRegistry`.

For full agent/graph/controller listings see `docs/design/protocol-deep-dive.md` and `docs/specs/api-reference.md`.

### Web App Architecture

**Framework**: Vite, React Router v7, React 19, Tailwind CSS 4, Radix UI

- `src/app/` - Page components (lazy loaded)
- `src/components/` - Reusable React components
- `src/contexts/` - React Context providers
- `src/services/` - Web API clients (typed fetch wrappers)

**API Proxy**: Vite proxies `/api/*` to protocol backend (port 3001) in dev. **Auth**: Better Auth (session-based).

## Protocol Layering Rules

Strict layering: **Controllers -> Services -> Adapters**. Dependencies always point inward.

1. **Controllers** import **services** (or protocol graph factories). Must not import adapters.
2. **Services** import **adapters** for data access. Must not import other services -- use events, queues, or shared lib for cross-service orchestration.
3. **Protocol layer** (`@indexnetwork/protocol`) is fully self-contained — zero imports from the app. Receives adapters via **constructor injection** through interfaces. The **composition root** (`src/controllers/mcp.controller.ts`) assembles `ProtocolDeps` inline and injects `ChatGraphFactory` into `ChatSessionService` at startup via `setFactory()`.
4. **Adapters** must not import from `@indexnetwork/protocol` interfaces — they define their own aligned types.

### Template Files

Consult before adding or changing code in each layer:

- `services/api/src/controllers/controller.template.md`
- `services/api/src/services/service.template.md`
- `services/api/src/queues/queue.template.md`


## Important Patterns

### Polymorphic Source Tracking

Intents track their origin via `sourceType` (`file|integration|link|discovery_form|enrichment`) and `sourceId` (uuid FK). Enables filtering by source and bulk re-processing.

### Confidence & Inference Tracking

Intents have `confidence` (0-1) and `inferenceType` (`explicit|implicit`).

### Personal Networks

Each user has a personal network (`isPersonal=true`) created on registration, tracked via the `personal_networks` mapping table. Ownership via `network_members` with `permissions: ['owner']`, not a denormalized column. Contacts are stored as `network_members` rows with `'contact'` permission on the owner's personal network -- no separate contacts table. `ContactService.addContact(email)` handles finding/creating users (including ghost users) and upserting membership. Personal networks cannot be deleted, renamed, or listed publicly.

### Network Prompts & Auto-Assignment

Networks and members have `prompt` fields used by LLM agents to evaluate intent membership. Members have `autoAssign: boolean` for auto-tagging new intents.

### Relevancy Scoring

`IntentIndexer` agent scores intent-network fit as `relevancyScore` (0.0-1.0) in `intent_networks`. Used during opportunity discovery to break ties across shared networks. Networks without prompts default to 1.0.

### Queue-Based Processing

Intent creation is synchronous; complex processing (indexing, generation) is async via BullMQ queues. Default: 3 retries with exponential backoff, completed jobs removed after 24h. The `EnrichmentQueue` (formerly `ProfileQueue`) handles enrichment, premise decomposition, and user context generation as a unified enrichment pipeline (the protocol graph that runs it is the `EnrichmentGraphFactory` in `packages/protocol/src/enrichment/`, renamed from the profile graph in WS11/IND-368). The premise graph's create path runs a `dedupe` node before persist: a candidate whose embedding is a near-duplicate (cosine ≥ `PREMISE_DEDUP_SIMILARITY`, default 0.93) of an existing ACTIVE premise for the same user is skipped (`findSimilarActivePremise`), so re-running similar input does not accumulate near-identical premises. `PremiseDecomposer` emits a per-premise `validityDays`; contextual premises are persisted `volatile` with `validity.validUntil = now + validityDays` (assertive premises do not expire), and provenance `confidence` is derived from the analyzer's felicity scores when not explicitly supplied. Per-network user contexts are regenerated by the dedicated `UserContextQueue` (`usercontext.queue.ts`), enqueued both on enrichment completion and — chained from `PremiseQueue.handleProfileRegen` — on every premise change, so the representation discovery matches on refreshes promptly instead of only on the next full enrichment. The queue dedups per user (its jobId frees on settle via `removeOnComplete/Fail: true` so repeated edits re-run rather than dedup against a retained completed job), short-circuits per network via a `premiseHash`, and regenerates the context paragraph + embedding + HyDE docs (forcing HyDE regeneration, since the context row id is stable across upserts). On per-network failure it rolls the `premiseHash` back and fails the job so retries regenerate rather than short-circuit.

### Frame-Drift Monitoring

IND-430 adds disabled-by-default, measurement-only daily monitoring through `FrameDriftQueue` → `FrameDriftMonitoringService` → `FrameDriftDatabaseAdapter`. A unique `frame_drift_observation_runs` header claims the whole bucket before any measurement read; in the same repeatable-read transaction, its rows immutably record privacy-thresholded, user-balanced capture-time premise/intent/user-context centroids and a bounded **non-causal** intent-assignment-pair normalized opportunity-yield proxy. `minUsers` applies both to centroid contributors and to each yield-pair side. `[bucketStart,bucketEnd)` is the closed opportunity window; centroids and denominator are observed at `capturedAt`, not reconstructed as of bucket end, and historical qualifying aggregates are not recomputed after later user deletion. The source-vector model field is explicitly `configuredEmbeddingModel`/`configured_embedding_model`: it records capture configuration, not source provenance. It has no API/UI and must never mutate embeddings, prompts, vocabulary, assignments, opportunities, or networks. BullMQ's once-daily UTC scheduler is omitted from Bull Board; enabled startup reuses a materially matching scheduler without upsert (including overdue `next` values), upserts only missing/changed definitions, and retries lookup/upsert, while disabled removal retries and creates no worker. The separate `frame_drift_execution_attempts` ledger records one privacy-minimized started/terminal row per BullMQ attempt and has no observation-run FK or role in the atomic measurement transaction. Tracking is awaited before measurement and failures retry the job; absent rows remain unobserved/unknown rather than proof that BullMQ never enqueued. See `docs/design/frame-drift-monitoring.md` for privacy, attribution, stable cohort, scheduling, attempt semantics, logging, and limitations.

### Pool-Aware Intent Questions

Discovery completion in both the MCP `DiscoveryRunQueue` and web `FromIntentQueue` runs the shared pool-discriminator mining hook. With `POOL_QUESTIONS_MODE=on`, the top evidence-verified axis becomes an intent-scoped `pool_discovery` question (at most one pending per intent; “Both matter” is always available). The queued/chained final gate re-reads the exact recipient+intent pool and normalized payload+summary fingerprint: it accepts only unchanged fingerprints with pool Jaccard ≥`0.7`; otherwise no row, push, or dismissal is created. Completion system-voids pending drifted rows with `detection.voidedReason='pool_drift'`; voided rows never render, push, count, affect dismissal decay, or suppress novelty. Repeated MODE-on mining skips when the latest durable non-voided snapshot has the same fingerprint and Jaccard ≥`0.7`; independently gated shadow-only mining has no durable cadence anchor. Answer handling is deterministic: the same shared `0.7` threshold governs P3 retained-assignment admission, then chosen/other/live-unassigned candidates receive `1.0`/`0.6`/`0.9` metadata adjustments and matching `pool_discriminator` signals through row-locked adapter writes. Substantive answers also refine the canonical owned intent and fresh resolved axes are suppressed by a full normalized payload+summary fingerprint. No premise is created. With both `POOL_QUESTIONS_MODE=on` and default-off `POOL_QUESTIONS_STAMP_NEWBORN=on`, an evidence-verified fixed-axis classifier stamps the same factors and `questionId` provenance onto genuinely new intent-triggered opportunities immediately before insertion; lifecycle/fingerprint drift, unsafe callback output, and classifier failure fail open to the original insert. `POOL_QUESTIONS_RANKING=on` makes an intent-scoped HomeGraph order by confidence × cumulative adjustment (floor `0.3`) and stamps a template-only deprioritization reason onto cards; off preserves the prior order. Every new adjustment carries `recipientUserId + intentId` provenance, legacy unscoped entries are ignored, and ranking/reasons apply only when both the viewer and selected intent match. Tier-0 reads and row-locked writes require the opportunity's exact `detection.triggeredBy` intent (the broader actor-intent Radar fallback is never used), while canonical refinement deliberately remains keyed only by `questions.detection.sourceId`; newborn stamping uses the same scoped provenance. A preference answer also uses one BullMQ deduplication key per intent (`pool-rerun-<intentId>`) with a sliding 60-second replace/extend window and `keepLastIfActive`, so bursts coalesce while an answer received during an active run is retained as one trailing run; the worker reads the latest durable answers into its search query, re-runs from-intent discovery, awaits failure-isolated mining, and appends count-only Beat 2 narration to the stable intent negotiator session. The intent page uses bounded refresh checkpoints rather than permanent polling. With default-off `POOL_QUESTIONS_PUSH=on` (plus pool-question mode and negotiator availability), both initial and chained producers enqueue the dedicated `PoolQuestionPushQueue` after the shared persist choke point. A per-recipient advisory transaction lock enforces strict dismissal-decayed VoI, pool ≥8, active/owned lifecycle, explicit `intents.lastVisitedAt`, one claim per run/mined cycle, and two claims per UTC day. Delivery inserts/verifies the question ID as one deterministic message in the stable unscoped Personal Agent DM and stamps `detection.pushedAt` atomically; resolved-before-delivery rows are suppressed. Only successfully delivered pending pool rows join the Personal Agent badge. The global Questions page, unscoped injected questions, REST/MCP payloads, and intent-pinned sessions remain pool-push-free. Material payload/summary intent edits void pending stale questions, let an answered axis be asked once under the new fingerprint, and mark exact recipient+intent `poolAdjustments` as `stale:true`; stale adjustments remain for audit but do not rank or demote, while legacy unscoped/malformed entries are preserved. `POOL_QUESTIONS_MINING`, `POOL_QUESTIONS_MODE`, `POOL_QUESTIONS_PUSH`, `POOL_QUESTIONS_STAMP_NEWBORN`, and `POOL_QUESTIONS_RANKING` remain independent gates. The seven-day TTL is unchanged.

### Intent Pause/Resume

`PATCH /api/intents/:id/status` accepts only `ACTIVE` or `PAUSED`, is owner- and network-scope-guarded, and returns `409` for archived or terminal intents. Null legacy status is treated as `ACTIVE`. Pause preserves existing opportunities/Radar cards, pending questions, conversations, intent-network assignments, and HyDE while blocking admission of not-yet-started intent-driven discovery, candidate matching against the intent, new pool mining/questions, and answer-triggered Tier-1 reruns; already-admitted work may finish. Existing questions remain answerable and Tier-0 re-ranking can still apply. Resume sets `ACTIVE` and immediately enqueues a lifecycle-version-deduplicated from-intent discovery run; the HTTP response awaits enqueue acknowledgement. If a changed resume cannot enqueue, an owner/scope/version compare-and-set compensates it back to `PAUSED` without overwriting concurrent changes and the endpoint returns retryable `enqueue_failed` instead of success. The intent page keeps the existing workspace visible, toggles live/Pause to paused/Resume with mutation loading and error feedback, and after successful Resume uses bounded refresh checkpoints through 180 seconds for Radar, pending questions, and the negotiator rather than permanent polling.

### User Contexts & Discovery

Each user has network-scoped **user contexts** (`user_contexts` table) — synthetic paragraph representations generated from their premise graph by `UserContextGenerator` — plus one **global** context row (`networkId = null`, the profile-replacing identity paragraph) enforced unique per user by the partial `user_contexts_user_global_uniq` index. The global row is generated by `UserContextGenerator.generateGlobalColdStart` (a network-agnostic prompt variant) and is always (re)built from active premises even when the user belongs to no non-personal networks; per-network rows use the network-lensed prompt. Contexts are generated during enrichment and regenerated whenever the user's premises change: premise lifecycle events enqueue regeneration via `UserContextQueue` (premise-derived, `premiseHash`-gated, with embeddings + HyDE refreshed) for the global row and each per-network row. (The legacy profile-graph `aggregate` step that preceded this enqueue was removed in WS8/IND-365 along with the `user_profiles` table it wrote.) They are stored with their embeddings. **"Category A" prompt consumers read the global row instead of flattening discrete profile fields** (`identity`/`narrative`/`attributes`) into LLM text: intent HyDE context (`intent.queue.ts`), the QuestionerAgent intent/enrichment/negotiation presets (`questioner.presets.ts`, fed by `intent.graph`/`enrichment.graph`/`negotiation.graph`), the discovery-questioner prompt (`question.prompt.ts`), the network ranker (`network.recommender.ts`), and the intent vague-job role hint (`intent.graph.ts`). The backend `ensureGlobalUserContext(userId)` helper (`services/api/src/lib/usercontext/global-context.ts`) is the single read-or-generate entry point — it returns the stored global text or synthesizes it on demand from ACTIVE premises via `generateGlobalColdStart` and upserts it (no HyDE for the global row, since it is excluded from context-to-intent discovery), returning `''` only when the user has no premises. It is injected into chat tool deps as `getUserContextText` (onboarding network ranking) and called directly by the intent HyDE queue and the question-backfill CLIs; protocol graphs read the global row read-only via their injected `getUserContext`. The opportunity graph uses contexts for **context-to-intent discovery**: it loads a user's contexts, then searches for matching intents via `searchIntentsByContextEmbedding()` (or HyDE-enhanced context embeddings). Discovery runs on **context-to-intent + premise similarity**; results are merged via `mergeStrategyCandidates()`. Context discovery candidates carry `discoverySource: 'context-to-intent'`. **Profile-HyDE discovery was retired in WS10 (IND-367)** — the `searchProfiles`/`'profiles'`-corpus reader (the last runtime read of `user_profiles`) was already unreachable (the live `searchWithHydeEmbeddings` path remaps the `profiles` corpus hint to `premises`, and nothing passed `'profiles'` to `embedder.search()`), so it was removed along with the `backfill-profile-hyde` CLI; the `ensure_profile_hyde` enrichment gate now keys on **ACTIVE premises** instead of a `user_profiles` row. Legacy `hyde_documents` rows with `sourceType='profile'` were orphaned (never read) and are deleted in WS8's teardown migration (`0084_drop_user_profiles`).

**Profile reads are sourced from `users`, not `user_profiles`.** The adapter `getProfile`/`getProfileByUserId`/`getProfileRow` (`database.adapter.ts`) build the `UserIdentity` (WS11/IND-368, replacing the removed `ProfileDocument`/`ProfileRow` — shape `{ identity:{name,bio,location}, context }`) from the `users` table (`name`/`intro`→bio/`location`) via a single `buildProfileFromUser` helper; the typed `attributes.skills[]`/`interests[]` and `narrative.context` are dropped (returned empty) since they have no home on `users` and their content lives in premises + the global context. `getProfile` therefore returns a row for **every existing user** (null only when the user does not exist) — it is a presentation read, not an existence check. Code that needs "has the user been enriched?" must use a real signal instead: the enrichment graph's check node keys on **ACTIVE premises** (`getPremisesForUser`), and `findWithGraph`'s `hasProfile` (the `/me` auto-enrichment gate) keys on the presence of a **global `user_context`** row. The `user_profiles` table was **dropped in WS8 (IND-365)** (migration `0084_drop_user_profiles`); `saveProfile` now persists identity (name / bio→`intro` / location) to `users`, `deleteProfile` is a no-op, the legacy placeholder/backfill writers were removed, and the profile graph's dead `aggregate_profile`→`generate_profile`→`save_profile` tail was deleted (premise creation is now the terminal effect; `ProfileGenerator` survives only for the WS11-scoped onboarding draft tools). The public `read_user_profiles` tool reflects this: single-user reads (self / `userId`) return thin identity (`name`, `bio`, `location`) plus a `context` paragraph (the global `user_context` text, injected in the tool layer via `getUserContextText`); list reads (name search / `networkId` roster) return thin identity only (no per-member context fan-out). The retired `skills`/`interests` arrays are no longer returned by any read path. The onboarding draft tools (`preview_/confirm_/create_user_profile`) still emit a structured draft for user approval. **WS11 (IND-368) eliminated the internal "profile" concept**: the pipeline/files/service/controller/adapter/`profile_tool_runs` table were renamed to `enrichment` (`EnrichmentService`, `enrichment.controller` at `/enrichment/sync`, `EnrichmentDatabaseAdapter`, `enrichment-run.*`, `enrichment_tool_runs`), `ProfileDocument`→`UserIdentity`, `read_user_profiles` returns a flat identity+context payload (no nested `profile` object), and the questioner `profile` mode is now `enrichment`. The MCP tool names (`read_user_profiles`/`*_user_profiles`/`get_profile_run`), the user-facing `index profile` CLI command, the discovery `discoverySource:'profile'` state value, and the questioner `sourceType:'profile'` metadata are retained as frozen/product-facing labels.

### Event-Driven Broker System

Events in `src/events/`: `IntentEvents.onCreated/onPaused/onResumed/onArchived`; pause/resume handlers receive `intentId`, `userId`, and `lifecycleVersionMs`, and `onResumed` is async so callers can await enqueue acknowledgement. Network membership events in `network_membership.event.ts`. Premise lifecycle events in `premise.event.ts`: `PremiseEvents.onCreated/onUpdated/onRetracted/onExpired` — each enqueues cascade and profile regeneration jobs via `EnrichmentQueue`. Question lifecycle events in `question.event.ts`: `QuestionEvents.onCreated/onAnswered/onDismissed` — `onAnswered` dispatches to mode-specific handlers (`question.answer.handler.ts`): enrichment→premise creation, intent→description refinement + HyDE regen, negotiation→opportunity metadata enrichment (read back during continuation via `NegotiationQueries.getOpportunityUserAnswers`), discovery→no-op, chat→resolves the in-memory wait bus (`lib/chat-question.events.ts`) so a chat turn blocked on the orchestrator's `ask_user_question` tool resumes with the answer; `onDismissed` resolves the same bus for chat-mode dismissals. The `ask_user_question` tool (chat-only, AskUserQuestion-style human-in-the-loop) generates questions synchronously via the QuestionerAgent's `chat` preset (hybrid: orchestrator-authored purpose/drafts + conversation excerpt + global user context), persists them with mode `chat` and `conversationId`, streams a `user_question` SSE event, and blocks the turn until answer/dismiss/timeout (`QUESTIONER_CHAT_WAIT_TIMEOUT_MS`, default 4 min; runtime `interactive` timeout class default 5 min); `POST /questions/:id/answer` returns `resumed` so the frontend knows whether to feed a late answer back as a new turn. Questions have an optional `conversationId` column linking them to the chat session that triggered them, and `detection.messageId` for anchoring to a specific assistant message. `tool.factory.ts` wraps `questionerEnqueue` in `sessionAwareEnqueue` to default `conversationId` from the active session context. The frontend renders conversation-linked questions inline via `InjectedQuestions`; sidebar badge uses `noConversation=true` to exclude them. The uptake guard (IND-424) reuses `mode='negotiation'` with internal `detection.purpose='uptake'`: committed `pending` opportunity writes emit `OpportunityEvents.onPending`, low-authority counterparty intents enqueue one network-scoped preparatory question, and accept paths return a non-mutating advisory until the current questions are resolved or explicitly acknowledged. Uptake answers remain private on the question row rather than entering shared `opportunities.metadata.userAnswers`; `QUESTIONER_UPTAKE_ENABLED` defaults off beneath the master Questioner flag. Services emit events after DB transactions; other services/graphs react independently.

### Agent Registry

**Main-web Signal Agent.** `WEB_SIGNAL_AGENT_ENABLED` is a strict, default-off cutover for new session-authenticated home/ordinary web chats. Flag-on creation explicitly persists `conversations.persona='signal'`; follow-ups inherit that stored persona, while request mismatches and unknown stored personas fail closed. Legacy orchestrator web sessions remain readable but are server-side read-only and the UI starts a separate Signal chat rather than rewriting history. Authentication provenance, not a caller-controlled route/surface value, classifies session-authenticated compatibility stream/message/resolver calls as web; API-key callers keep compatibility orchestrator behavior. The sole session-only onboarding exception authoritatively requires an incomplete `users.onboarding` record and forces orchestrator, so completed users cannot use it as a bypass. Compatibility histories are orchestrator-only, while the session-only web history returns legacy orchestrator plus Signal sessions. The Signal persona reuses the persona-neutral `ChatGraphFactory` runtime with a positive allowlist limited to signals/intents, assignment to existing memberships, profile context/premises, read-only network/membership context, pasted-URL scraping, and chat clarification. Signal wrappers live-recheck membership and clamp focused reads; confirmed network assignment validates and locks current membership in the same transaction as intent/assignment creation. It has no opportunity/discovery-run, negotiation, contact/import, agent/network administration, or membership-mutation tools, and disables the discovery-coupled create-intent callback while retaining proposal hallucination recovery. Browser-based `index login` mints a 90-day CLI API credential and the CLI sends it with `x-api-key`, preserving the non-web orchestrator surface without making generic session JWTs a bypass. API-key, Telegram, MCP, CLI, direct-tool, and default orchestrator behavior is otherwise unchanged.

All agents are first-class database entities backed by `agents`, `agent_transports`, and `agent_permissions`. System agents (`Index Chat Orchestrator`, `Index Negotiator`) are seeded with well-known UUIDs and receive default permissions during onboarding. MCP auth resolves to `userId + agentId` pairs when API keys include `metadata.agentId`. API-key principal resolution is centralized in `src/lib/apikey/principal.ts` (`resolveApiKeyUserId`), shared by the MCP auth resolver (`mcp.controller.ts`) and `AuthGuard` so the same key cannot resolve to different users across codepaths: it prefers a verified session, then `userId`, then `referenceId`, and rejects (fails closed) any key whose two principal columns are both set but disagree. `AuthGuard` accepts JWT or API key everywhere except **session-only endpoints** (`SessionOnlyGuard` in `auth.guard.ts`): `DELETE /auth/account` and the `/agents` management writes (create/update/delete agent, tokens, permissions, transports) reject API keys with 403 (`SessionRequiredError`), so a leaked agent key cannot delete the account or mint successor credentials that survive rotation; the agent-poller endpoints (negotiations pickup/respond, test messages, opportunity pickup/delivery) intentionally stay API-key reachable. Telegram-surfaced MCP requests additionally verify that the request's `x-index-telegram-username`/`-handle` matches the authenticated user's stored telegram handle and isn't owned by another user (`findTelegramHandleOwners` normalizes stored `@h` / `t.me` URL variants to the bare handle), rejecting on mismatch. Personal agents connect by polling `/agents/:id/negotiations/pickup` with an API key; each poll bumps `agents.last_seen_at`. The dispatcher consults that heartbeat: if no personal agent is fresh (seen within 90 s), the system negotiator runs inline; otherwise the turn is parked in `tasks.state='waiting_for_agent'` with a bounded park-window budget (`AMBIENT_PARK_WINDOW_MS`, 5 min by default) that carries over from the `waiting_for_agent` timer to the `claimed` timer rather than stacking.

**Network-scoped agents.** Agents can be bound to a single network via `agent_permissions.scope='network', scopeId=<networkId>`. The `agent-scope.guard.ts` resolves a request's agent scope (null for global agents, the bound `scopeId` otherwise) and `assertAgentNetworkScope(req, networkId)` is wired into network/intent/opportunity controllers — write paths assert, list paths filter via `withAgentScope`. Mismatches throw `ScopeViolationError`, mapped to HTTP 403 in `main.ts`. The MCP layer promotes `networkScopeId` into the canonical `{ scopeType: 'network', scopeId }` envelope; tools derive concrete allowed networks from that envelope plus memberships, and the request-scoped `systemDb` is built from the same derived set. **Discovery honors the scope too:** the opportunity tool derives focused discovery networks from the scope envelope (focused network only, not the personal-index write reach) before invoking the graph, so `discover_opportunities` stays within the bound network. Ambient discovery threads the bound network through the intent HyDE handler into the from-intent queue (`networkIds: [networkScopeId]`), so background matching never reaches networks outside the agent's scope. Every trigger-intent job recomputes its authoritative search set as `intent_networks assignments ∩ active owner memberships ∩ optional explicit caller/agent scope`; empty intersections fail closed and all surviving assigned networks are forwarded. Scoped intent/premise/context searches require an active candidate membership on the exact returned network (permission-agnostic so personal-network contacts remain valid), and the graph rechecks both participants before evaluation, then uses transaction-held active-membership plus active-owned-intent assignment locks for final creation/reactivation so member removal, pause/archive, or unassignment cannot race persistence. Owned-intent persistence is also trigger-aware: 30-day/lifecycle reuse and enrichment are same-trigger-only (`detection.triggeredBy`, with owner actor-intent fallback), while a normalized participant-pair + trigger advisory lock performs the final duplicate recheck and a shared pair-global negotiation claim prevents concurrent active tasks across different trigger rows. Create-time discovery is enqueued only by the post-assignment HyDE worker, never directly from `IntentEvents.onCreated`. Intent Radar also requires the viewer-owned intent's current assigned/member scope and active participant anchors. **Opportunity reads are gated too:** whenever a network is specified — either a scoped key's clamped `networkId` or a user explicitly filtering to a community — `getOpportunitiesForUser(userId, { networkId })` returns an opportunity only when *every* participant (distinct actor user) is anchored on that network, not just the requesting user. Otherwise a cross-network opportunity leaked the out-of-network counterpart's user/profile/intent through the card. An unscoped read (no `networkId`) is unaffected — nothing is filtered when neither the key nor the request specifies a network. Event/community metadata is never evidence of attendance, membership, residence, acquaintance, or shared presence: evaluator/presenter prompts prohibit those inferences, evaluator output is rejected deterministically when it makes them, user-facing fallbacks and raw list reasoning strip them, and presentation caches use versioned keys so unsafe legacy copy is not served. Used by experiment-network CSV import (`networkInvitationService.invite`): each imported user receives a network-scoped agent + API key by email — possession of the inbox verifies receipt of that scoped credential, not unrestricted index.network web access; no `users.experimentNetworkId` column is needed.

### Trace Event Instrumentation

`requestContext` carries a `traceEmitter?` callback for real-time TRACE panel in chat UI. Tool files emit `graph_start/graph_end` around graph invocations; graph files emit `agent_start/agent_end` around agent calls. Use kebab-case agent names. See `docs/design/protocol-deep-dive.md` for full examples.

Negotiation-specific events (`negotiation_session_start/end`, `negotiation_turn`, `negotiation_outcome`) carry per-candidate turn and outcome data for orchestrator-inline negotiations. They are persisted into `debugMeta.orchestratorNegotiations.opportunityIds` for later hydration by the debug endpoint. `debugMeta` also now tracks `llm.{calls,totalDurationMs,resets,hallucinations}` accumulated from `llm_start/end`, `response_reset`, and `hallucination_detected` events.

### HyDE Generation Modes

IND-426 adds a default-off frame-v1 path behind `HYDE_FRAME_CONSTRAINTS_ENABLED=true` (strict literal). Legacy remains `infer → cache → generate → embed → persist`; frame-v1 extracts a source-only frame in a separate model call (profile context is lens-selection context only), uses fingerprinted Redis/context provenance plus stable versioned DB lens identities, validates generated documents before embedding, supports partial/all rejection, and treats validator failures as ephemeral failed-open output that is never cached or persisted. Bulk context discovery filters persisted HyDE rows to the active mode, current source-text hash, and newest generation marker. The paired `packages/protocol/eval/hyde` suite provides retrieval diagnostics; `eval/matching` invokes `OpportunityEvaluator` directly and is only a secondary regression check.

### OpenRouter Configuration

Model settings centralized in `packages/protocol/src/shared/agent/model.config.ts`. Key env vars: `OPENROUTER_API_KEY` (required), `CHAT_MODEL` (override), `CHAT_REASONING_EFFORT` (`minimal|low|medium|high|xhigh`), `RUN_OPPORTUNITY_EVAL_IN_PARALLEL` (experimental), `NEGOTIATION_MAX_TURNS_CHAT` (default 4, chat-path negotiations), `NEGOTIATION_MAX_TURNS_AMBIENT` (default 6, ambient/background negotiations). Use `ToolContext.modelConfig` to inject config per-request via `ChatAgent.create`; only `ChatAgent` reads `ModelConfig` from `ToolContext` — most other protocol agents rely on `OPENROUTER_API_KEY` in the environment (some accept an explicit `ModelConfig` as a direct parameter to `createModel()`).

### Rate Limiting

The protocol applies per-route-class limits via the `RateLimit(class)` guard from `src/guards/limiter.guard.ts`. Three classes:

- `read` — all `GET` routes (default 1200/min)
- `write` — all `POST/PUT/PATCH/DELETE` routes (default 600/min)
- `auth_write` — credential-mutation endpoints on `/api/auth/*` (default 100/min); enforced by Better Auth's own `rateLimit` block

Buckets are keyed per identifier: verified JWT user (signature-checked) or client IP for everything else. Unverified credentials (raw API keys, session cookies) deliberately do NOT get their own buckets — that would let a client rotate values per request to evade IP throttling. Apply via `@UseGuards(RateLimit('read'), AuthGuard)` — `RateLimit` must be FIRST so it short-circuits before any DB work. Agent-poller endpoints (`POST /agents/:id/negotiations/pickup`, `GET /agents/:id/opportunities/pending`, `GET /agents/:id/opportunities/accepted`) intentionally omit the guard. Storage is Redis (shared across Bun instances) when either `REDIS_URL` or `REDIS_HOST` is set; otherwise the limiter uses an in-memory fallback (single-process, dev only — not multi-instance safe). Set `LIMITER_DISABLE=1` to disable as an incident escape hatch.

**MCP transport throttle.** The `/mcp` endpoint is dispatched in `main.ts` before the `/api/*` branch, so it bypasses the normal controller `RateLimit` guards. It therefore has two limiter layers. First, `checkMcpHttpRateLimit` (`src/lib/limiter/mcp.ts`) runs in `mcp.controller.ts` before the request body is drained and before a per-request MCP server/transport is allocated; it keys a cheap `mcp_http` bucket by verified JWT user or client IP (never raw API keys), defaults to `MCP_HTTP_LIMIT_PER_MIN=240`, shares Redis/in-memory limiter storage, honors `LIMITER_DISABLE`, and fails open on limiter storage/identity errors so Redis incidents do not take down MCP. Second, `checkMcpRateLimit` is injected into the protocol MCP server as the `mcpRateLimiter` hook on `ToolDeps` and invoked in `mcp.server.ts` after identity resolves but before any DB work. It keys two buckets per `(userId, agentId)` principal — a per-tool bucket (`MCP_LIMIT_TOOL_PER_MIN`, default 120; `discover_opportunities` is far tighter at `MCP_LIMIT_DISCOVER_PER_MIN`, default 10) and an aggregate backstop (`MCP_LIMIT_PRINCIPAL_PER_MIN`, default 300). The MCP controller still creates a fresh `McpServer` and `WebStandardStreamableHTTPServerTransport` per HTTP request to avoid JSON-RPC response-routing leaks between clients that reuse message IDs; both SDK objects are closed after the response, and static tool registration metadata/schema conversion is cached in `mcp.server.ts` so high-churn clients do not rebuild every tool schema on every request. Do not cache raw MCP/JSON-RPC responses (`initialize`, `tools/list`, or `tools/call`) or pool SDK server/transport objects; the SDK owns envelopes, message IDs, and client-capability state. Complementing this, `discover_opportunities` **coalesces in-flight MCP discovery runs**: a repeat call with an equivalent request returns the existing queued/running run (`coalesced: true`) via `discoveryRuns.listActive()` instead of spawning a duplicate, so re-firing discovery instead of polling `get_discovery_run` no longer multiplies expensive graph runs.

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

Runtime env files live at the **repo root** (`.env.development`, `.env.test`, … — gitignored); the root `.env.example` is the canonical reference. Validation happens at API boot in `services/api/src/startup.env.ts` (hard-fail on invalid, deployment warnings for commonly forgotten vars); `services/api/tests/env-example-drift.spec.ts` keeps example and schema in sync; `bun scripts/audit-railway-env.ts` diffs a Railway service against the schema.

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/protocol_db
OPENROUTER_API_KEY=your-openrouter-api-key
PORT=3001
NODE_ENV=development
```

### Optional (see the root `.env.example` for full list)

`REDIS_URL`, `RESEND_API_KEY`, `UNSTRUCTURED_API_URL`, `COMPOSIO_API_KEY`, `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`, `SENTRY_DSN`, `PARALLELS_API_KEY`, `APP_URL`

Web app: `VITE_`-prefixed vars, documented in the root `.env.example` (section 16). **Auth origin (`invalid_origin`)**: ensure app origin is in Better Auth `trustedOrigins` when developing locally.

## Testing

Always target specific test files rather than running the full suite. `bun test` in protocol is slow.

```bash
cd services/api
bun test path/to/test.ts                   # Run specific test (PREFERRED)
bun test --watch                            # Watch mode
bun test                                    # Run ALL tests (avoid unless necessary)
```

**Test locations**: `services/api/tests/` (integration/E2E), `services/api/src/lib/*/tests/` (unit tests).

**Standards**: Load env at top before imports. Import from `bun:test` (destructured). Use `describe` grouping. Set timeouts (agent: 30s, graph: 60s, LLM: 120s). Clean up in `afterAll`. Mock externals. Test success and error paths. Never commit without running affected tests.

## Database Workflow

**Schema location**: `services/api/src/schemas/database.schema.ts`. Drizzle client: `services/api/src/lib/drizzle/drizzle.ts`.

### Migration Naming

Drizzle generates random names. **Always rename** to: `{NNNN}_{action}_{target}[_{detail}].sql`

Examples: `0000_initial_schema.sql`, `0001_add_chat_session_share_token.sql`, `0003_drop_agent_wallet_columns.sql`

**After renaming**: Update `tag` in `drizzle/meta/_journal.json` to match (without `.sql`). Do not rename snapshot files.

### Schema Change Checklist

1. Edit `services/api/src/schemas/database.schema.ts`
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

**Always use worktrees** for features and fixes. Keep the canonical root on `dev` and
read-only for source mutations. Worktrees live in `.worktrees/` (gitignored). Branches
use semantic `<type>/<description>` names and the only valid folder is the dashed form
`<type>-<description>`; never accept a separate folder name.

Before socket orchestration, follow the Herdr setup in
`docs/guides/getting-started.md`; its server and Pi integration must be available. From
the canonical root, create or reuse the exact Git worktree after checking
`git worktree list --porcelain`, then always run setup:

```bash
bun run worktree:setup feat-user-authentication
herdr worktree open \
  --path "$PWD/.worktrees/feat-user-authentication" \
  --label feat-user-authentication \
  --focus \
  --json
herdr agent start feat-user-authentication --kind pi --pane <returned-pane-id>
```

Herdr is the default visible execution plane. Record the workspace and pane IDs returned
by `herdr worktree open`; reuse an existing workspace/Pi only when its worktree path,
branch, and cwd match. The canonical/root Pi remains the coordinator, sends one complete
handoff, and polls with `herdr agent get/read/wait` directly—never through a hidden
implementation subagent, background watcher process, or watcher pane. It answers routine
implementation questions with the safe/recommended option and escalates only genuine
product/architecture ambiguity, destructive actions, external infrastructure mutation,
credentials/secrets, or merge approval. A structured question/editor draft must be
answered through targeted `herdr pane read/send-text/send-keys`, not a new agent prompt.
Never infer merge approval.

Parallel implementation uses separate semantic branches, Git worktrees, visible Herdr
workspaces, and Pi sessions, with one writer per worktree. Reuse the same visible session
for review and finish-pr fix loops. The legacy `bun run worktree:session` helper remains
a fallback when Herdr is unavailable, not the default workflow.

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

### Implementation in Visible Herdr Worktrees

Execute implementation and fix plans in visible Herdr-managed Pi sessions for isolated
Git worktrees. The canonical/root Pi coordinates, remains active, polls Herdr directly,
and keeps `dev` stable; it does not delegate implementation to hidden subagents. When
parallel work is genuinely useful, use separate worktrees/workspaces with one writer per
checkout. Follow the `create-worktree` and `run-worktree-session` skills.

### Receiving Code Review (`/address-code-review`)

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
- Use `.pi/skills/create-skill` for the mechanics of writing a correct `SKILL.md`.
- Skip silently when nothing meets the "reusable and non-obvious" bar — never capture
  one-off facts.
