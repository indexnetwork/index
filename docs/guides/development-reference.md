# Development Reference

This is the canonical project reference for development commands, architecture, conventions, testing, Git workflow, and operational safety.

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
bun run db:seed:sandbox                     # Seed protocol_sandbox with the curated population (--minimal: two people)
bun run db:flush                            # Flush all data from database

# Testing
bun test                                    # Run tests with bun test
bun test tests/e2e.spec.ts                  # Run specific test file
bun test --watch                            # Run tests in watch mode

# Code quality
bun run lint                                # Run ESLint
bun run typecheck                           # Type-check the API without emitting

# Maintenance/CLI tools
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
cd apps/mac
./build.sh                                  # Assemble HTML and build the macOS WKWebView app
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

### Evals (removed)

The eval system — the `packages/protocol/eval/` harnesses, the `apps/eval-ops/`
console, and the `services/api` `discovery` CLI that drove them — was removed on
2026-08-16. It was roughly 400 files and 56k LOC, larger than the protocol code
it measured, and nothing in `packages/protocol/src/` ever depended on it.

The final state is preserved in the annotated tag `archive/eval-2026-08-16`.
Restore any part of it by path:

```bash
git checkout archive/eval-2026-08-16 -- packages/protocol/eval
git checkout archive/eval-2026-08-16 -- apps/eval-ops
# Scope the CLI restore to the eval files. `services/api/src/cli/` still holds
# 19 live operational tools and its own AGENTS.md; restoring the whole
# directory would overwrite them with their pre-removal state.
git checkout archive/eval-2026-08-16 -- 'services/api/src/cli/discovery*'
git checkout archive/eval-2026-08-16 -- 'services/api/src/cli/tests/discovery*'
git checkout archive/eval-2026-08-16 -- \
  services/api/src/cli/tests/fixtures/discovery-env-matrix-base-runtime-handoff.fixture.ts \
  services/api/src/cli/tests/fixtures/historical-quality-lease-process.ts
git checkout archive/eval-2026-08-16 -- services/api/eval
```

Those five pathspecs are the complete set: the two fixtures sit under
`src/cli/tests/fixtures/` alongside retained `backfill-*` fixtures, so the
`discovery*` globs do not reach them. A restore also needs the CI jobs, the
`eval:*` scripts and `.env.example` § 15d, all in the same tag.

Restoring the harnesses also means restoring the CI jobs that gated them
(`eval-verify`, `eval-ops`, `eval-cli-tests` in `.github/workflows/lint.yml`,
and `.github/workflows/eval-canary.yml`), the `eval:*` package scripts, and
`.env.example` § 15d, all of which are in the same tag.

The `eval_matrix_metadata` table and its migrations (`0115`, `0125`) were
deliberately left in place — see the removal notes on that change.


### Subtrees

The following paths are git subtrees tracked to external repos. **Syncing is automatic for Index-owned subtrees** — the `.github/workflows/sync-subtrees.yml` workflow runs on every push to `dev` or `main` of the canonical `indexnetwork/index` repo (including PR merges), splitting each prefix and force-pushing to the corresponding subtree repo with the `SUBTREE_SYNC_PAT` secret. Subtree branches stay aligned with the monorepo branch (`dev` -> `dev`, `main` -> `main`). AgentVillage is Edge-City-owned and is mounted as a git submodule at `packages/edge-city/agentvillage`; `Edge-City/agentvillage` is canonical. The local `scripts/hooks/pre-push` hook still regenerates SKILL.md files before push, but no longer runs subtree push.

**Mirrored packages must declare exact dependency versions.** A subtree repo receives only its own prefix, so it has no lockfile — the root `bun.lock` is not part of the split, and the mirrors' own `bun install --frozen-lockfile` has nothing to freeze. Any range therefore resolves to the newest match on npm, and the mirror builds and publishes versions this monorepo never built. That is how a floating `^2.0.0-alpha.2` let `@modelcontextprotocol/server` 2.0.0-beta.5/2.0.0 break every `indexnetwork/protocol` publish for nine runs while the monorepo stayed green. Pin `dependencies` and `devDependencies` of every mirrored package exactly (peer ranges are the consumer's resolution and stay ranged), and upgrade by changing the pin plus `bun.lock` together. `bun run check:subtree-parity` enforces this and runs in the `lint` workflow.

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

The native macOS client prototype (Swift WKWebView shell around a self-contained React/HTML bundle). The monorepo path is synced to the standalone `indexnetwork/mac-client` repo on `dev`/`main` pushes.

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
bun run worktree:dev <name>                 # Run all dev servers from a worktree (auto-setups if needed)
bun run worktree:build [name]               # Build at root, or in worktree <name> if given
bun run worktree:new <type>/<description>    # Create/reuse a worktree, collision-safe, then setup
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
- `docs/guides/` — Setup and usage guides for developers. Update when dev workflow or environment setup changes. Beyond this reference and `getting-started.md`: [`feature-flags.md`](./feature-flags.md) (there are none, and what to do instead), [`routing-and-surfaces.md`](./routing-and-surfaces.md) (deep links, universal links, web persona cutovers), [`ci-troubleshooting.md`](./ci-troubleshooting.md) (toolchain failures that look like test failures), [`railway-auth.md`](./railway-auth.md) (headless Railway tokens), and [`squash-release-reconciliation.md`](./squash-release-reconciliation.md).
- `docs/research/` — Research reports and historical analysis that inform design but are not normative runtime documentation. Link to current design/spec docs when applying their conclusions.

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


### Queue-Based Processing

Intent creation is synchronous; complex processing (indexing, generation) is async via BullMQ queues. Default: 3 retries with exponential backoff, completed jobs removed after 24h. The `EnrichmentQueue` (formerly `ProfileQueue`) handles enrichment, premise decomposition, and user context generation as a unified enrichment pipeline (the protocol graph that runs it is the `EnrichmentGraphFactory` in `packages/protocol/src/enrichment/`, renamed from the profile graph in WS11/IND-368). The premise graph's create path runs a `dedupe` node before persist: a candidate whose embedding is a near-duplicate (cosine ≥ `PREMISE_DEDUP_SIMILARITY`, default 0.93) of an existing ACTIVE premise for the same user is skipped (`findSimilarActivePremise`), so re-running similar input does not accumulate near-identical premises. `PremiseDecomposer` emits a per-premise `validityDays`; contextual premises are persisted `volatile` with `validity.validUntil = now + validityDays` (assertive premises do not expire), and provenance `confidence` is derived from the analyzer's felicity scores when not explicitly supplied. Per-network user contexts are regenerated by the dedicated `UserContextQueue` (`usercontext.queue.ts`), enqueued both on enrichment completion and — chained from `PremiseQueue.handleProfileRegen` — on every premise change, so the representation discovery matches on refreshes promptly instead of only on the next full enrichment. The queue dedups per user (its jobId frees on settle via `removeOnComplete/Fail: true` so repeated edits re-run rather than dedup against a retained completed job), short-circuits per network via a `premiseHash`, and regenerates the context paragraph + embedding + HyDE docs (forcing HyDE regeneration, since the context row id is stable across upserts). On per-network failure it rolls the `premiseHash` back and fails the job so retries regenerate rather than short-circuit.

### Frame-Drift Monitoring

IND-430 adds disabled-by-default, measurement-only daily monitoring through `FrameDriftQueue` → `FrameDriftMonitoringService` → `FrameDriftDatabaseAdapter`. A unique `frame_drift_observation_runs` header claims the whole bucket before any measurement read; in the same repeatable-read transaction, its rows immutably record privacy-thresholded, user-balanced capture-time premise/intent/user-context centroids and a bounded **non-causal** intent-assignment-pair normalized opportunity-yield proxy. `minUsers` applies both to centroid contributors and to each yield-pair side. `[bucketStart,bucketEnd)` is the closed opportunity window; centroids and denominator are observed at `capturedAt`, not reconstructed as of bucket end, and historical qualifying aggregates are not recomputed after later user deletion. The source-vector model field is explicitly `configuredEmbeddingModel`/`configured_embedding_model`: it records capture configuration, not source provenance. It has no API/UI and must never mutate embeddings, prompts, vocabulary, assignments, opportunities, or networks. BullMQ's once-daily UTC scheduler is omitted from Bull Board; enabled startup reuses a materially matching scheduler without upsert (including overdue `next` values), upserts only missing/changed definitions, and retries lookup/upsert, while disabled removal retries and creates no worker. The separate `frame_drift_execution_attempts` ledger records one privacy-minimized started/terminal row per BullMQ attempt and has no observation-run FK or role in the atomic measurement transaction. Tracking is awaited before measurement and failures retry the job; absent rows remain unobserved/unknown rather than proof that BullMQ never enqueued. See `docs/design/frame-drift-monitoring.md` for privacy, attribution, stable cohort, scheduling, attempt semantics, logging, and limitations.

### Pool-Aware Intent Questions (retired)

The pool-discriminator mining hook, its `pool_discovery` questions, the proactive `PoolQuestionPushQueue` delivery cycle, answer chaining, and newborn preference stamping were retired with the card question generators ([conversational questions](../plans/2026-08-18-conversational-questions.md), "Retirements"). What survives: `POOL_QUESTIONS_RANKING` still orders intent-scoped Radar results by previously written `poolAdjustments` (opportunity metadata, not the questions table), and the Lens C negotiation-evidence shadow still runs on its own flag from `FromIntentQueue` completion.

### Intent-Page Refinement Questions (retired)

Creation-time intent questions, the post-discovery recovery hooks, and `IntentRecoveryRefinementService` were retired with the card question generators. A signal's open questions now surface as the negotiator's question-message in the signal's DM, derived from the parked negotiation set.

### Intent Pause/Resume

`PATCH /api/intents/:id/status` accepts only `ACTIVE` or `PAUSED`, is owner- and network-scope-guarded, and returns `409` for archived or terminal intents. Null legacy status is treated as `ACTIVE`. Pause preserves existing opportunities/Radar cards, pending questions, conversations, intent-network assignments, and HyDE while blocking admission of not-yet-started intent-driven discovery, candidate matching against the intent, new pool mining/questions, and answer-triggered Tier-1 reruns; already-admitted work may finish. Existing questions remain answerable and Tier-0 re-ranking can still apply. Resume sets `ACTIVE` and immediately enqueues a lifecycle-version-deduplicated from-intent discovery run; the HTTP response awaits enqueue acknowledgement. If a changed resume cannot enqueue, an owner/scope/version compare-and-set compensates it back to `PAUSED` without overwriting concurrent changes and the endpoint returns retryable `enqueue_failed` instead of success. The intent page keeps the existing workspace visible, toggles live/Pause to paused/Resume with mutation loading and error feedback, and after successful Resume uses bounded refresh checkpoints through 180 seconds for Radar, pending questions, and the negotiator rather than permanent polling.

### User Contexts & Discovery

Each user has network-scoped **user contexts** (`user_contexts` table) — synthetic paragraph representations generated from their premise graph by `UserContextGenerator` — plus one **global** context row (`networkId = null`, the profile-replacing identity paragraph) enforced unique per user by the partial `user_contexts_user_global_uniq` index. The global row is generated by `UserContextGenerator.generateGlobalColdStart` (a network-agnostic prompt variant) and is always (re)built from active premises even when the user belongs to no non-personal networks; per-network rows use the network-lensed prompt. Contexts are generated during enrichment and regenerated whenever the user's premises change: premise lifecycle events enqueue regeneration via `UserContextQueue` (premise-derived, `premiseHash`-gated, with embeddings + HyDE refreshed) for the global row and each per-network row. (The legacy profile-graph `aggregate` step that preceded this enqueue was removed in WS8/IND-365 along with the `user_profiles` table it wrote.) They are stored with their embeddings. **"Category A" prompt consumers read the global row instead of flattening discrete profile fields** (`identity`/`narrative`/`attributes`) into LLM text: intent HyDE context (`intent.queue.ts`), the network ranker (`network.recommender.ts`), and the intent vague-job role hint (`intent.graph.ts`). The backend `ensureGlobalUserContext(userId)` helper (`services/api/src/lib/usercontext/global-context.ts`) is the single read-or-generate entry point — it returns the stored global text or synthesizes it on demand from ACTIVE premises via `generateGlobalColdStart` and upserts it (no HyDE for the global row, since it is excluded from context-to-intent discovery), returning `''` only when the user has no premises. It is injected into chat tool deps as `getUserContextText` (onboarding network ranking) and called directly by the intent HyDE queue and the question-backfill CLIs; protocol graphs read the global row read-only via their injected `getUserContext`. The opportunity graph uses contexts for **context-to-intent discovery**: it loads a user's contexts, then searches for matching intents via `searchIntentsByContextEmbedding()` (or HyDE-enhanced context embeddings). Discovery runs on **context-to-intent + premise similarity**; results are merged via `mergeStrategyCandidates()`. Context discovery candidates carry `discoverySource: 'context-to-intent'`. **Profile-HyDE discovery was retired in WS10 (IND-367)** — the `searchProfiles`/`'profiles'`-corpus reader (the last runtime read of `user_profiles`) was already unreachable (the live `searchWithHydeEmbeddings` path remaps the `profiles` corpus hint to `premises`, and nothing passed `'profiles'` to `embedder.search()`), so it was removed along with the `backfill-profile-hyde` CLI; the `ensure_profile_hyde` enrichment gate now keys on **ACTIVE premises** instead of a `user_profiles` row. Legacy `hyde_documents` rows with `sourceType='profile'` were orphaned (never read) and are deleted in WS8's teardown migration (`0084_drop_user_profiles`).

**Profile reads are sourced from `users`, not `user_profiles`.** The adapter `getProfile`/`getProfileByUserId`/`getProfileRow` (`database.adapter.ts`) build the `UserIdentity` (WS11/IND-368, replacing the removed `ProfileDocument`/`ProfileRow` — shape `{ identity:{name,bio,location}, context }`) from the `users` table (`name`/`intro`→bio/`location`) via a single `buildProfileFromUser` helper; the typed `attributes.skills[]`/`interests[]` and `narrative.context` are dropped (returned empty) since they have no home on `users` and their content lives in premises + the global context. `getProfile` therefore returns a row for **every existing user** (null only when the user does not exist) — it is a presentation read, not an existence check. Code that needs "has the user been enriched?" must use a real signal instead: the enrichment graph's check node keys on **ACTIVE premises** (`getPremisesForUser`), and `findWithGraph`'s `hasProfile` (the `/me` auto-enrichment gate) keys on the presence of a **global `user_context`** row. The `user_profiles` table was **dropped in WS8 (IND-365)** (migration `0084_drop_user_profiles`); `saveProfile` now persists identity (name / bio→`intro` / location) to `users`, `deleteProfile` is a no-op, the legacy placeholder/backfill writers were removed, and the profile graph's dead `aggregate_profile`→`generate_profile`→`save_profile` tail was deleted (premise creation is now the terminal effect; `ProfileGenerator` survives only for the WS11-scoped onboarding draft tools).

The public `read_user_contexts` tool reflects the current model: single-user reads (self / `userId`) return thin identity (`name`, `bio`, `location`) plus a `context` paragraph (the global `user_context` text, injected in the tool layer via `getUserContextText`); list reads (name search / `networkId` roster) return thin identity only (no per-member context fan-out). The retired `skills`/`interests` arrays are no longer returned by any read path. The onboarding draft tools (`preview_user_context`, `confirm_user_context`, and `create_user_context`) emit a structured draft for user approval. **WS11 (IND-368) eliminated the internal "profile" concept**: the pipeline/files/service/controller/adapter/`profile_tool_runs` table were renamed to `enrichment` (`EnrichmentService`, `enrichment.controller` at `/enrichment/sync`, `EnrichmentDatabaseAdapter`, `enrichment-run.*`, `enrichment_tool_runs`), `ProfileDocument`→`UserIdentity`, the public read payload became a flat identity+context payload (no nested `profile` object), and the questioner `profile` mode became `enrichment`. The former MCP/REST/chat names (`read_user_profiles`, `*_user_profile`, and `*_profile_run`) were retained temporarily as compatibility labels but are now retired; callers must use the canonical `*_user_context` and `*_enrichment_run` names. The historical persisted enrichment-run operation values `preview_user_profile` and `update_user_profile` remain supported solely for old database rows. The user-facing `index profile` CLI command and questioner `sourceType:'profile'` metadata remain product-facing or persisted labels.

### Event-Driven Broker System

**Retracting integration premises and re-enriching are a pair.** `UserService.setSocials`
retracts every `source='integration'` premise for the user and then enqueues `enrich.user`
(`reason: 'socials_updated'`) to rebuild them. Retracting without re-enriching leaves the
user with no ACTIVE premises at all, which drops them out of discovery and — via
`PremiseEvents.onRetracted` → `premise_cascade` — expires their live opportunities. The
retraction runs only when the **stored** social set actually changed: the web and mac
settings screens submit the full socials array on every save, so `setSocials` compares
stored rows either side of the write (post-normalization, ignoring row ids) and returns
early when they match. Contact/ghost creation in `contact.service` is the other
`enrich.user` trigger.

Events in `src/events/`: `IntentEvents.onCreated/onPaused/onResumed/onArchived`; pause/resume handlers receive `intentId`, `userId`, and `lifecycleVersionMs`, and `onResumed` is async so callers can await enqueue acknowledgement. Network membership events in `network_membership.event.ts`. Premise lifecycle events in `premise.event.ts`: `PremiseEvents.onCreated/onUpdated/onRetracted/onExpired` — each enqueues cascade and profile regeneration jobs via `EnrichmentQueue`. `OpportunityEvents.onTransition` drives the conversational-questions exhaustion evaluator. The card question lifecycle (QuestionerAgent generation, `QuestionEvents` reaction dispatch, the blocking `ask_user_question` chat tool and its wait bus, the uptake acceptance guard, and the pending-question read surface) is retired — questions are conversation now: a parked negotiation surfaces as a question-message in the signal's DM (`question-message.queue.ts`), replies route back through the serialized answer consumption seam, and the exact-task settlement machinery lives on in `questioner.adapter.ts` (admission re-resolution, lock ladder, ask_user expiry, DM settle, fenced continuations). Leftover card rows void on contact via `POST /questions/:id/answer|dismiss`. Services emit events after DB transactions; other services/graphs react independently.

### Agent Registry

**Main-web Signal Agent.** Signal is the primary web chat persona and is always on — `WEB_SIGNAL_AGENT_ENABLED` was retired along with the orchestrator persona it fell back to. There is no default persona anywhere: web chat creation explicitly persists `conversations.persona='signal'`, follow-ups inherit the stored persona, and request mismatches and unknown stored personas fail closed. Retired orchestrator sessions stay readable and listable but are server-side read-only; the UI starts a separate Signal chat rather than rewriting history. Authentication provenance, not a caller-controlled route/surface value, classifies dual-auth stream/resolver calls: session principals are the web surface, API-key principals are the agent surface and must name a persona explicitly (`CHAT_PERSONA_REQUIRED` when they do not). `signal` stays web-only, so `negotiator` — reached through its intent-pinned session — is the persona an agent client can start, which is what the macOS app uses. The sole session-only onboarding exception authoritatively requires an incomplete `users.onboarding` record and forces the `onboarding` persona. The Signal persona reuses the persona-neutral `ChatGraphFactory` runtime with a positive allowlist limited to signals/intents, assignment to existing memberships, profile context/premises, read-only network/membership context, pasted-URL scraping, and chat clarification. Signal wrappers live-recheck membership and clamp focused reads; confirmed network assignment validates and locks current membership in the same transaction as intent/assignment creation. It has no opportunity/discovery-run, negotiation, contact/import, agent/network administration, or membership-mutation tools. Browser-based `index login` mints a 90-day CLI API credential sent as `x-api-key`; CLI agent chat itself was removed with the orchestrator, and Telegram inbound chat with it (notification delivery is unaffected).

All agents are first-class database entities backed by `agents`, `agent_transports`, and `agent_permissions`. System agents (`Index Chat Orchestrator`, `Index Negotiator`) are seeded with well-known UUIDs and receive default permissions during onboarding. MCP auth resolves to `userId + agentId` pairs when API keys include `metadata.agentId`. API-key principal resolution is centralized in `src/lib/apikey/principal.ts` (`resolveApiKeyUserId`), shared by the MCP auth resolver (`mcp.controller.ts`) and `AuthGuard` so the same key cannot resolve to different users across codepaths: it prefers a verified session, then `userId`, then `referenceId`, and rejects (fails closed) any key whose two principal columns are both set but disagree. `AuthGuard` accepts JWT or API key everywhere except **session-only endpoints** (`SessionOnlyGuard` in `auth.guard.ts`): `DELETE /auth/account` and agent **create** reject API keys with 403 (`SessionRequiredError`). Owner-control writes (`OwnerControlGuard`) — update/delete agent, mint tokens, grant/revoke permissions — accept unbound owner API keys (Mac CLI credential) but reject agent-bound keys, so a leaked agent key cannot mint successor credentials or flip `handleNegotiations`. The agent-poller endpoints (negotiations pickup/respond, test messages, opportunity pickup/delivery) intentionally stay API-key reachable. The Hermes plugin (ordinary agent key, full mode) keeps `lastNegotiationPickupAt` fresh by listening to `GET /conversations/stream` keepalive (~15s) and non-own negotiation messages, running one cheap pickup (and a conservative consult/respond when pending) rather than a dedicated cron. MCP requests that carry the Telegram identity headers additionally verify that the request's `x-index-telegram-username`/`-handle` matches the authenticated user's stored telegram handle and isn't owned by another user (`findTelegramHandleOwners` normalizes stored `@h` / `t.me` URL variants to the bare handle), rejecting on mismatch. Personal agents connect by polling `/agents/:id/negotiations/pickup` with an API key; each poll bumps `agents.last_seen_at`. The dispatcher consults that heartbeat: if no personal agent is fresh (seen within 90 s), the system negotiator runs inline; otherwise the turn is parked in `tasks.state='waiting_for_agent'` with a bounded park-window budget (`AMBIENT_PARK_WINDOW_MS`, 5 min by default) that carries over from the `waiting_for_agent` timer to the `claimed` timer rather than stacking.


### Trace Event Instrumentation

`requestContext` carries a `traceEmitter?` callback for real-time TRACE panel in chat UI. Tool files emit `graph_start/graph_end` around graph invocations; graph files emit `agent_start/agent_end` around agent calls. Use kebab-case agent names. See `docs/design/protocol-deep-dive.md` for full examples.

Negotiation-specific events (`negotiation_session_start/end`, `negotiation_turn`, `negotiation_outcome`) carry per-candidate turn and outcome data for orchestrator-inline negotiations. They are persisted into `debugMeta.orchestratorNegotiations.opportunityIds` for later hydration by the debug endpoint. `debugMeta` also now tracks `llm.{calls,totalDurationMs,resets,hallucinations}` accumulated from `llm_start/end`, `response_reset`, and `hallucination_detected` events.

### HyDE Generation Modes

IND-426 adds a default-off frame-v1 path behind `HYDE_FRAME_CONSTRAINTS_ENABLED=true` (strict literal). Legacy remains `infer → cache → generate → embed → persist`; frame-v1 extracts a source-only frame in a separate model call (profile context is lens-selection context only), uses fingerprinted Redis/context provenance plus stable versioned DB lens identities, validates generated documents before embedding, supports partial/all rejection, and treats validator failures as ephemeral failed-open output that is never cached or persisted. Bulk context discovery filters persisted HyDE rows to the active mode, current source-text hash, and newest generation marker. (Retrieval diagnostics for this path used to live in the removed `eval/hyde` and `eval/matching` suites; see **Evals (removed)**.)

### OpenRouter Configuration

Model settings centralized in `packages/protocol/src/shared/agent/model.config.ts`. Key env vars: `OPENROUTER_API_KEY` (required), `CHAT_MODEL` (override), `CHAT_REASONING_EFFORT` (`minimal|low|medium|high|xhigh`), `RUN_OPPORTUNITY_EVAL_IN_PARALLEL` (experimental), `NEGOTIATION_MAX_TURNS_CHAT` (default 4, chat-path negotiations), `NEGOTIATION_MAX_TURNS_AMBIENT` (default 6, ambient/background negotiations), and strict `NEGOTIATION_INCLUDE_OTHER_INTENTS` (default `true`; `false` restricts autonomous opportunity negotiations to each participant's exact opportunity-bound intent before prompt/dispatch/persistence). Use `ToolContext.modelConfig` to inject config per-request via `ChatAgent.create`; only `ChatAgent` reads `ModelConfig` from `ToolContext` — most other protocol agents rely on `OPENROUTER_API_KEY` in the environment (some accept an explicit `ModelConfig` as a direct parameter to `createModel()`).

### Rate Limiting

The protocol applies per-route-class limits via the `RateLimit(class)` guard from `src/guards/limiter.guard.ts`. Four classes:

- `read` — all `GET` routes (default 1200/min)
- `write` — all `POST/PUT/PATCH/DELETE` routes (default 600/min)
- `auth_write` — credential-mutation endpoints on `/api/auth/*` (default 100/min); enforced by Better Auth's own `rateLimit` block
- `intake_synthesis` — write routes that launch an LLM synthesis plus a full intent-graph run and persist a durable proposal per call (`POST /intents/intake/prepare`, `POST /intents/intake/revise`); default 20/min via `LIMITER_INTAKE_SYNTHESIS_PER_MIN`

Buckets are keyed per identifier: verified JWT user (signature-checked) or client IP for everything else. Unverified credentials (raw API keys, session cookies) deliberately do NOT get their own buckets — that would let a client rotate values per request to evade IP throttling. Apply via `@UseGuards(RateLimit('read'), AuthGuard)` — `RateLimit` must be FIRST so it short-circuits before any DB work. Agent-poller endpoints (`POST /agents/:id/negotiations/pickup`, `GET /agents/:id/opportunities/pending`, `GET /agents/:id/opportunities/accepted`) intentionally omit the guard. Storage is Redis (shared across Bun instances) when either `REDIS_URL` or `REDIS_HOST` is set; otherwise the limiter uses an in-memory fallback (single-process, dev only — not multi-instance safe). Set `LIMITER_DISABLE=1` to disable as an incident escape hatch.


See `docs/superpowers/specs/2026-05-21-protocol-rate-limiting-design.md` for the full design.

## Environment Setup

See `docs/guides/getting-started.md` for full setup guide.

### Neon Database Topology

Two Neon projects exist:

1. **Protocol-dev-europe** (`patient-pine-89907813`, `aws-eu-central-1`) — local development database. Developers connect here from their machines.
2. **Protocol** (`shiny-cloud-34341469`, `aws-us-east-1`) — has these branches:
   - **`production`** (`br-fragrant-brook-ahexgsek`) — production data. **Never touch.**
   - **`dev`** (`br-late-tooth-ahlsfgdb`) — used by the Railway `dev` environment. Database name: `protocol_prod`.
   - **`local-dev`** (`br-delicate-dream-ahoh7xkw`) — local interactive development.
     Its `protocol_prod` database is a real-data copy; `protocol_sandbox` is the
     synthetic, curated sandbox and is the safe default for `.env.development`.
   - **`eval-discovery-base`** (`br-wispy-queen-ahmxwx1s`), **`eval-ab-a`**
     (`br-old-meadow-ahw6rnu1`) and **`eval-ab-b`** (`br-snowy-math-ahnnrwew`) —
     orphaned. These were the seeded fixture base and its two A/B children for the
     discovery evals (database `protocol_eval`). The evals were removed on
     2026-08-16 (see **Evals (removed)**), so nothing reads or resets them any
     more. They hold no data worth keeping and are pending manual deprovision.

Railway dev deployments run `db:migrate` against the `dev` branch of the Protocol project.

#### Curated local sandbox

`protocol_sandbox` contains 96 deterministic fictional contemporary personas, 12
thematic networks, 322 intents, 475 authored first-person premises, and embedded
profile context. The personas are authored in scenarios: two people designed to
match each other, often joined by a third, adjacent-but-not-designed match so
evaluation has a real decision to make. Three investor personas
(`mira.kovac@`, `deniz.arslan@`, `ruth.langley@sandbox.test`) carry fixed ids
that docs and prior threads reference. Every persona has a Better Auth
email/password credential with the shared test password `sandbox-sandbox`, so
the normal login form works for any of them (`.test` addresses are marked
verified by the seed). Re-seed the fixtures after schema migrations with:

```bash
bun run db:seed:sandbox -- --confirm             # full population
bun run db:seed:sandbox -- --confirm --minimal   # exactly two people with very specific, matching intents
```

Both modes wipe and recreate every seed-owned user (including personal networks
created by signing in as one), so switching modes is just re-running the command.

#### Fast local sandbox reset

After a successful full seed, save a local database snapshot once:

```bash
bun run db:snapshot:sandbox
```

Later resets can restore that snapshot without regenerating embeddings or
recreating every fixture:

```bash
bun run db:restore:sandbox
```

The snapshot lives at `.cache/index/protocol_sandbox.dump` and is ignored by
Git. It replaces the whole `protocol_sandbox` database, so stop the local API
server before restoring. Recreate the snapshot after schema migrations or
fixture changes.

The command derives the sandbox connection from the repo-root
`.env.development`, refuses unrelated source database names, always replaces
the URL database component with `protocol_sandbox`, and writes directly to
Postgres without publishing jobs to shared Redis. It requires
`OPENROUTER_API_KEY` to generate the fixture embeddings. Automated tests must
continue to use the disposable local `index_test` database through `.env.test`.

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

### Database-backed tests

Run them against **local Postgres**, not a remote Neon branch. Provision once:

```bash
bun run db:setup:local            # postgresql@17 + pgvector, database `index_test`, migrations
bun run db:setup:local --recreate # start over from an empty database
```

Then set the repo-root `.env.test` to `DATABASE_URL=postgresql://<your-unix-user>@localhost:5432/index_test`
and run with `TEST_DATABASE_SAFE=1`. The `index_test` name matters: the fail-closed
guard in `src/lib/drizzle/test-database-readiness.ts` refuses any database whose name
matches `/^(.*_)?(prod|production)$/`, which is what every Neon branch calls its copy of
real user data.

Why local: the four questioner adapter suites take **~0.6 s** locally against **~340 s**
on a remote branch, individual specs were taking 25-90 s, and one stalled for 905 s.
That latency was also the source of failures indistinguishable from real ones —
`questioner.recovery.lifecycle.spec.ts` failed intermittently on remote and passes
consistently on local.

Note that CI's `test` job runs only the hermetic specs that mock Redis, the LLM and the
database, so the database-backed suite is gated **nowhere** except locally. Running it
before pushing is the only coverage it gets.

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

Use `bun run worktree:new <type>/<description>` to create or reuse one semantic branch.
It fetches and bases on `origin/dev` (not the local `dev`, which is routinely behind),
validates the branch name, refuses path and branch collisions rather than mutating them,
checks out a remote-only branch with `--track` instead of recreating it at base, and
always runs the mandatory `bun run worktree:setup <dashed-folder>` — for reused worktrees
as well as new ones. `--no-fetch` for offline; `--base <ref>` to cut from anything else.

Keep one writer per worktree, reuse the same worktree for review and PR-closeout fixes,
and independently verify every completion claim. Never wait, poll, sleep, create
watcher processes, infer merge approval, or treat `idle`/`done` as success. Escalate
only genuine product/architecture ambiguity, destructive actions, external
infrastructure mutation, credentials/secrets, or merge approval.

### Git remote-state reconciliation

After every `git push`, fetch the pushed branch and verify the local branch has no
ahead/behind drift from its upstream (`git fetch origin <branch>` followed by
`git status --short --branch`). After `gh pr merge`, first verify the server-side
merge, then fetch the base branch; if its canonical checkout is clean, fast-forward it
with `git pull --ff-only origin <base>`. Do not continue from stale remote refs. If a
dirty checkout prevents the fast-forward, preserve its work and report the pending
reconciliation rather than merging or resetting over it.

Parallel implementation uses separate semantic branches and Git worktrees, with one
writer per worktree. Reuse the same worktree for review and PR-closeout fix loops.

### Conventional Commits

Format: `<type>[scope]: <description>`. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`. Breaking changes: `BREAKING CHANGE:` in footer or `!` after type.

### Conventional Branches

Format: `<type>/<short-description>`. No Linear issue IDs. Examples: `feat/user-authentication`, `fix/login-redirect-loop`.

### Pull Requests

Use `gh` CLI to create PRs into `origin/dev`. Description as changelog: New Features, Bug Fixes, Refactors, Documentation, Tests.

### Finishing a Branch

1. Update all relevant documentation (see **Documentation Directories** above for what belongs where):
   - `AGENTS.md` — if agent workflow or repository-wide agent guidance changes
   - this reference — if development workflow, architecture, or operational policy changes
   - `README.md` files — any affected package READMEs
   - `docs/design/` — if architecture or data flow changed
   - `docs/domain/` — if the domain model changed (entities, relationships, concepts)
   - `docs/specs/` — if public interfaces changed (API endpoints, CLI commands)
   - `docs/guides/` — if dev workflow or environment setup changed
2. Delete any related superpowers plans/specs from `docs/superpowers/plans/` and `docs/superpowers/specs/`.
3. **Bump package versions** for every package touched by the branch, following [Semantic Versioning 2.0.0](https://semver.org/), before merging or pushing. `feat` is a minor bump, `fix` is a patch bump, and breaking changes are a major bump (minor before 1.0). Apply this to each touched package: `packages/protocol/`, `packages/cli/`, `services/api/`, and `apps/web/`; then run `bun run sync:lockfile-versions` and commit the root `bun.lock`.

    Bun refreshes the workspace `version` fields in `bun.lock` only unreliably, so they cannot be left to an install. Verified against bun 1.3.14: when `node_modules` is already in sync with the lockfile — exactly the case for a version-only bump, where nothing about the dependency graph changed — `bun install` leaves the recorded version stale, and will even rewrite other parts of `bun.lock` in the same run without correcting it. When the install has other work to do, the version usually is picked up. Because the result turns on unrelated local state, the same command updates the version on one machine and not on the next. `bun install --frozen-lockfile` passes while the fields are stale, so nothing in the normal workflow catches the drift. `bun run sync:lockfile-versions` rewrites the fields in place; `bun run check:lockfile-versions` reports drift and exits non-zero.
4. Finish the PR through `manage-pr`:
   - Snapshot the actual PR with `bun run pr:snapshot -- <number|URL|branch>`, inspect related issues and matching worktree state, and verify base freshness against the actual base/head refs.
   - Resolve every blocking review thread, run targeted checks for changed surfaces, and require all required GitHub checks/reviews to be green. For environment changes, explain every variable and verify its committed schema/example, local development state, and applicable Railway service state before any mutation.
   - Obtain a separate, explicit merge authorization only after every gate passes. Merge server-side from a non-canonical coordinator checkout; never check out or merge `dev` in a feature worktree, and never mutate source from the canonical root.
   - Confirm the forge merge, wait for required post-merge checks and terminal Railway deployment success before claiming release health or closing related issues, then update issues and clean up the finished worktree only after preservation checks.
   - For a squash-merged `dev`→`main` release, after main-branch checks pass, follow [squash-release reconciliation](./squash-release-reconciliation.md): prove the `main` and `dev` trees match and the merge simulation is clean, then have the root coordinator create and push the sanctioned no-content merge from `main` back into `dev` and wait for its `dev` workflows. Stop rather than force it when either check fails.
5. If the canonical `dev` checkout is clean, synchronize it only with `git pull --ff-only origin dev`; otherwise preserve its work and report pending reconciliation.
6. If an npm-published subtree package was updated (`packages/cli/` or `packages/protocol/`): bump its base version before promoting to `main`. Subtree pushes to `dev` publish `-rc` prereleases under the `rc` npm tag, and subtree pushes to `main` publish the stable version when it is not already on npm.
7. Clean up only after merge and preservation checks. Remove the Git worktree and branch from another checkout.

## Superpowers Workflow

### Implementation in Git Worktrees

Execute implementation and fix plans in isolated Git worktrees created with
`bun run worktree:new`. Keep `dev` stable, never use hidden implementation subagents,
and preserve one writer per checkout.

### Receiving Code Review

**There is no automated reviewer on this project.** No bot reviews a PR on push, and
none is triggered by opening one. Unless a human is explicitly asked to look, a PR
arrives at merge time with nothing but its checks behind it.

That has one consequence worth stating outright, because it is easy to drift into: a
green PR is an *unreviewed* PR. Checks prove the suite passes, not that the change is
correct, well-scoped, or wanted. When handing work over, say which it is — "green, not
reviewed" — rather than letting green imply more than it does. `dev` is unprotected, so
nothing else will catch the difference.

When review comments *do* get opened, by a human or anything else:

1. **Fetch the threads**: `gh api` lists review comments on the PR; work through the
   unresolved ones.
2. **Evaluate each**: decide whether a code fix is actually needed.
   - **Fix needed**: implement it, push, then resolve the conversation. Pushing a commit
     does not resolve a thread on its own.
   - **No fix needed**: reply inline with the technical reasoning for why the current
     code is right (YAGNI, missing context, conflicts with an existing pattern), then
     resolve it.
3. **Resolve everything before merge**: an unresolved thread is an open question, and
   merging over it silently discards the question rather than answering it.

**Key commands:**
```bash
# List PR review comments (filter for unresolved)
gh api repos/{owner}/{repo}/pulls/{pr}/comments

# Reply to a specific review comment thread (USE THIS — not gh pr comment)
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies -f body="..."

# Ask a human for review
gh pr edit PR-NUMBER --add-reviewer USERNAME
```

## Session Learning Capture

When a session uncovers something **reusable and non-obvious** — a workflow, a fix for a
recurring failure, an exact command sequence, an environment gotcha, or a convention —
write it down before ending. Where it goes depends on what kind of thing it is:

| Kind of learning | Home |
|---|---|
| A deterministic, repeatable procedure | a script in `scripts/`, wired to a `bun run` name |
| Judgment that applies to specific files | the nearest `AGENTS.md` (create one; it loads by location) |
| A rare diagnostic — "when X breaks, read Y" | a page under `docs/guides/`, linked from here |
| A long, rare, high-stakes procedure | a skill under `.claude/skills/` |
| Anything short and always relevant | the root `AGENTS.md` or `CLAUDE.md` |

Prefer the earlier rows. A script cannot be half-followed; a nested `AGENTS.md` loads
whenever the relevant files are open, without depending on a description matching the
prompt. Reach for a new skill only when the content is genuinely long, genuinely rare,
and would bloat always-on context if it lived anywhere else.

Skip silently when nothing meets the "reusable and non-obvious" bar — never capture
one-off facts, and never duplicate something the code, tests, or git history already
record.
