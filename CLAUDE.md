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
bun test tests/e2e.test.ts                  # Run specific test file
bun test --watch                            # Run tests in watch mode

# Code quality
bun run lint                                # Run ESLint

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

The following packages are git subtrees tracked to external repos. **Syncing is automatic** — the `scripts/hooks/pre-push` hook detects commits touching each prefix and runs `git subtree push` whenever you push `dev` or `main` to the canonical `indexnetwork/index` repo, regardless of whether that remote is named `origin`, `upstream`, or something else. Subtree branches stay aligned with the monorepo branch (`dev` -> `dev`, `main` -> `main`).

#### packages/openclaw-plugin/ → indexnetwork/openclaw-plugin

The `indexnetwork-openclaw-plugin` package — an OpenClaw plugin that (a) registers the Index Network MCP server via a bootstrap skill, and (b) runs a background poller that pulls pending negotiation turns from `POST /agents/:id/negotiations/pickup` and dispatches silent subagents via `api.runtime.subagent.run` to respond via `POST /agents/:id/negotiations/:negotiationId/respond`. Behavioral guidance for the negotiation subagent lives in the MCP server's `MCP_INSTRUCTIONS`, not in the plugin. The `skills/index-network/SKILL.md` shipped inside the package is generated from `packages/protocol/skills/openclaw/SKILL.md.template` by `scripts/build-skills.ts` — edit the template, re-run the build, then commit both the template and the materialized output.

```bash
# Manual push if the hook failed (use dev or main)
git subtree push --prefix=packages/openclaw-plugin https://github.com/indexnetwork/openclaw-plugin.git <branch>

# Pull if external repo was edited directly (avoid — always edit via this repo)
git subtree pull --squash --prefix=packages/openclaw-plugin https://github.com/indexnetwork/openclaw-plugin.git <branch>
```

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
├── backend/           # Backend API & Agent Engine (Bun, Express, TypeScript)
├── packages/
│   ├── protocol/        # @indexnetwork/protocol NPM package — subtree → indexnetwork/protocol
│   ├── cli/             # @indexnetwork/cli — Bun, TypeScript — subtree → indexnetwork/cli
│   ├── openclaw-plugin/ # indexnetwork-openclaw-plugin — bootstrap + negotiation poller, subtree → indexnetwork/openclaw-plugin
│   └── claude-plugin/   # @indexnetwork/claude-plugin — index-orchestrator and index-negotiator skills, subtree → indexnetwork/claude-plugin
├── frontend/          # Vite + React Router v7 SPA with React 19
├── docs/              # Project documentation (design/, domain/, guides/, specs/)
└── scripts/           # Worktree helpers, hooks, dev launcher
```

### Documentation Directories

- `docs/design/` — Architecture and deep-dive docs. Describes how the system is built: layering, data flow, agent graphs, key subsystems. Update when architecture changes.
- `docs/domain/` — Domain concept docs. Explains the business model: what intents, networks, opportunities, profiles, contacts are and how they relate. Update when domain model changes.
- `docs/specs/` — API and CLI specs. Describes external interfaces: endpoints, CLI commands, input/output contracts. Update when public interfaces change.
- `docs/guides/` — Setup and usage guides for developers. Update when dev workflow or environment setup changes.

### Protocol Key Directories

**Tech Stack**: Bun runtime, Express.js, Drizzle ORM, PostgreSQL with pgvector, BullMQ (Redis-backed queues), LangChain/LangGraph

- `src/controllers/` - API controllers with decorator-based routing (`@Controller`, `@Get`, `@Post`)
- `src/services/` - Business logic layer
- `src/adapters/` - Infrastructure implementations (database, embedder, cache, queue, scraper, storage)
- `src/gateways/` - Single-point delivery bridges to external chat/notification channels (e.g. Telegram bot for inbound+outbound)
- `src/schemas/` - Drizzle table definitions; primary schema is `schemas/database.schema.ts`
- `src/guards/` - Auth/validation guards
- `src/queues/` - BullMQ job queue definitions
- `src/events/` - Event emitters (intent events, index membership events)
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
3. **Protocol layer** (`@indexnetwork/protocol`) is fully self-contained — zero imports from the app. Receives adapters via **constructor injection** through interfaces. The **composition root** (`src/protocol-init.ts`) wires concrete adapters via `createDefaultProtocolDeps()`.
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

Intent creation is synchronous; complex processing (indexing, generation) is async via BullMQ queues. Default: 3 retries with exponential backoff, completed jobs removed after 24h.

### Event-Driven Broker System

Events in `src/events/`: `IntentEvents.onCreated/onUpdated/onArchived` (with `intentId`, `userId`, optional `payload`, `previousStatus`). Index membership events in `network_membership.event.ts`. Services emit events after DB transactions; other services/graphs react independently.

### Agent Registry

All agents are first-class database entities backed by `agents`, `agent_transports`, and `agent_permissions`. System agents (`Index Chat Orchestrator`, `Index Negotiator`) are seeded with well-known UUIDs and receive default permissions during onboarding. MCP auth resolves to `userId + agentId` pairs when API keys include `metadata.agentId`. Personal agents connect by polling `/agents/:id/negotiations/pickup` with an API key; each poll bumps `agents.last_seen_at`. The dispatcher consults that heartbeat: if no personal agent is fresh (seen within 90 s), the system negotiator runs inline; otherwise the turn is parked in `tasks.state='waiting_for_agent'` with a bounded park-window budget (`AMBIENT_PARK_WINDOW_MS`, 5 min by default) that carries over from the `waiting_for_agent` timer to the `claimed` timer rather than stacking.

### Trace Event Instrumentation

`requestContext` carries a `traceEmitter?` callback for real-time TRACE panel in chat UI. Tool files emit `graph_start/graph_end` around graph invocations; graph files emit `agent_start/agent_end` around agent calls. Use kebab-case agent names. See `docs/design/protocol-deep-dive.md` for full examples.

Negotiation-specific events (`negotiation_session_start/end`, `negotiation_turn`, `negotiation_outcome`) carry per-candidate turn and outcome data for orchestrator-inline negotiations. They are persisted into `debugMeta.orchestratorNegotiations.opportunityIds` for later hydration by the debug endpoint. `debugMeta` also now tracks `llm.{calls,totalDurationMs,resets,hallucinations}` accumulated from `llm_start/end`, `response_reset`, and `hallucination_detected` events.

### OpenRouter Configuration

Model settings centralized in `packages/protocol/src/shared/agent/model.config.ts`. Key env vars: `OPENROUTER_API_KEY` (required), `CHAT_MODEL` (override), `CHAT_REASONING_EFFORT` (`minimal|low|medium|high|xhigh`), `RUN_OPPORTUNITY_EVAL_IN_PARALLEL` (experimental). Use `configureProtocol({ apiKey, chatModel, ... })` to inject config programmatically.

## Environment Setup

See `docs/guides/getting-started.md` for full setup guide.

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

Use `gh` CLI to create PRs into `upstream/dev`. Description as changelog: New Features, Bug Fixes, Refactors, Documentation, Tests.

### Finishing a Branch

1. Update all relevant documentation (see **Documentation Directories** above for what belongs where):
   - `CLAUDE.md` — if structural or architectural changes were introduced
   - `README.md` files — any affected package READMEs
   - `docs/design/` — if architecture or data flow changed
   - `docs/domain/` — if the domain model changed (entities, relationships, concepts)
   - `docs/specs/` — if public interfaces changed (API endpoints, CLI commands)
   - `docs/guides/` — if dev workflow or environment setup changed
2. Delete any related superpowers plans/specs from `docs/superpowers/plans/` and `docs/superpowers/specs/`
3. Bump package versions following [Semantic Versioning 2.0.0](https://semver.org/) for all affected packages
4. Merge into dev: `git checkout dev && git merge <branch-name>`
5. Push both remotes: `git push upstream dev && git push origin dev`
6. If an npm-published subtree package was updated (`packages/cli/` or `packages/protocol/`): bump its base version before promoting to `main`. Subtree pushes to `dev` publish `-rc` prereleases under the `rc` npm tag, and subtree pushes to `main` publish the stable version when it is not already on npm.
7. Clean up: delete branch and remove worktree

## Superpowers Workflow

### Implementation via Subagents in Worktrees

When executing implementation plans, **always use subagent-driven development with worktree isolation** (`isolation: "worktree"`). This keeps `dev` stable and allows parallel independent tasks. Combine the `superpowers:subagent-driven-development` and `superpowers:using-git-worktrees` skills.

### Receiving Code Review (`/receiving-code-review`)

When handling CodeRabbitAI reviews on PRs, follow this workflow:

1. **Fetch unresolved conversations**: Use `gh api` to list all review comments on the PR. Focus on unresolved conversation threads from CodeRabbitAI.
2. **Evaluate each conversation**: For each unresolved thread, decide whether a code fix is actually needed:
   - **Fix needed**: Implement the fix, push, and let the resolved code speak for itself.
   - **No fix needed**: Reply in the comment thread with technical reasoning for why the current code is correct (e.g., YAGNI, reviewer lacks context, breaks existing patterns). Use `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies` to reply inline.
3. **Resolve all conversations**: Every conversation must be resolved (either by fixing or by responding with reasoning) before the PR can merge. Zero unresolved conversations is the merge gate.

> **IMPORTANT:** Always reply directly in each conversation thread using the replies endpoint. Never post a top-level PR comment to address review feedback — CodeRabbitAI tracks resolution per conversation thread, and a top-level comment does not mark threads as resolved or create memory for the bot.

**Key commands:**
```bash
# List PR review comments (filter for unresolved)
gh api repos/{owner}/{repo}/pulls/{pr}/comments

# Reply to a specific review comment thread (USE THIS — not gh pr comment)
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies -f body="..."
```
