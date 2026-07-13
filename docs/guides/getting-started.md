---
title: "Getting Started"
type: guide
tags: [getting-started, setup, onboarding, development, environment]
created: 2026-03-26
updated: 2026-04-06
---

# Getting Started

This guide walks you through setting up a local development environment for Index Network from scratch. By the end you will have the API service (port 3001) and the web dev server running locally, connected to a seeded PostgreSQL database.

## Prerequisites

Install the following before cloning the repository.

### Required software

| Tool | Minimum version | Purpose |
|------|----------------|---------|
| **Bun** | 1.2+ | JavaScript/TypeScript runtime, package manager, test runner |
| **PostgreSQL** | 14+ | Primary data store |
| **pgvector** extension | 0.5+ | 2000-dimensional vector similarity search |
| **Redis** | 6+ | Job queues (BullMQ) and caching |
| **Git** | 2.30+ | Version control, worktrees |

Install Bun (if not already installed):

```bash
curl -fsSL https://bun.sh/install | bash
```

Install the pgvector extension for PostgreSQL. The method varies by platform:

```bash
# macOS (Homebrew)
brew install pgvector

# Ubuntu / Debian
sudo apt install postgresql-16-pgvector   # match your PG version

# Arch Linux
paru -S postgresql-pgvector
```

### Required accounts and API keys

| Account | Required | Purpose |
|---------|----------|---------|
| **OpenRouter** | Yes | LLM provider for all agents. Get a key at https://openrouter.ai/keys |
| **Google OAuth** | No | Social login (leave blank to disable) |
| **Resend** | No | Email delivery |
| **Composio** | No | Third-party integrations (Slack, Notion, Gmail) |

## Clone and install

```bash
git clone https://github.com/indexnetwork/index.git
cd index
bun install
```

`bun install` at the root installs dependencies for all Bun workspaces (API service, web app, protocol package, CLI, and plugin).

### Workspace structure

```
index/
├── apps/
│   ├── web/             # Vite + React Router v7 SPA (React 19, Tailwind CSS 4)
│   └── mac/             # Native Apple client subtree
├── services/
│   └── api/             # Backend API and agent engine (Bun, TypeScript)
├── packages/
│   ├── protocol/        # @indexnetwork/protocol NPM package (graphs, agents, tools)
│   ├── cli/             # @indexnetwork/cli — CLI client, Bun, TypeScript
├── docs/                # Project documentation (design, domain, specs, guides)
├── scripts/             # Worktree helpers, hooks, dev launcher
├── package.json         # Root workspace config
└── CLAUDE.md            # Comprehensive project reference
```

## Environment setup

Exactly two runtime env files exist, both at the **repo root** and gitignored;
the root `.env.example` is the single canonical reference for every variable
(API, web, and protocol evals). `.env.development` is used for local
development (and whenever `NODE_ENV` is unset); `.env.test` is used when
`NODE_ENV=test` (API tests, protocol tests/evals). There is deliberately no
bare `.env` and no `.env.production` — deployments use platform-injected
variables, never files.

```bash
cp .env.example .env.development
```

### API service environment variables

Open `.env.development` and fill in the required values:

**Required:**

```bash
# PostgreSQL connection
DATABASE_URL=postgresql://username:password@localhost:5432/protocol_db

# Authentication secret (generate a strong random value)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)

# LLM provider
OPENROUTER_API_KEY=your-openrouter-api-key

# Server
PORT=3001
NODE_ENV=development
```

**Recommended for local development:**

```bash
# Allow the web dev server origin for auth
TRUSTED_ORIGINS=http://localhost:3000
```

**Optional (features degrade gracefully when absent):**

```bash
# Protocol base URL for auth callbacks and email links (required in production)
# BASE_URL=https://protocol.example.com

# Web app URL for notification links (required in production)
# FRONTEND_URL=https://index.network

# Redis (defaults to localhost:6379 if omitted)
# REDIS_URL=redis://localhost:6379

# S3-compatible storage (for avatars, file uploads)
# S3_ENDPOINT=https://t3.storageapi.dev
# S3_REGION=auto
# S3_BUCKET=your-bucket
# S3_ACCESS_KEY_ID=...
# S3_SECRET_ACCESS_KEY=...

# Google OAuth
# GOOGLE_CLIENT_ID=...
# GOOGLE_CLIENT_SECRET=...

# Email delivery (emails are skipped if absent)
# RESEND_API_KEY=...

# Document parsing
# UNSTRUCTURED_API_URL=...

# Web crawling and profile extraction
# PARALLELS_API_KEY=...

# MCP runtime limits (defaults shown)
# MCP_MAX_REQUEST_BYTES=1000000
# MCP_TOOL_MAX_OUTPUT_BYTES=1000000
# MCP_TOOL_TIMEOUT_FAST_MS=10000
# MCP_TOOL_TIMEOUT_BOUNDED_SLOW_MS=45000
# MCP_TOOL_TIMEOUT_ASYNC_CANDIDATE_MS=50000

# Telegram bot (optional — enables bot notifications and chat)
# TELEGRAM_BOT_TOKEN=          # Bot token from @BotFather
# TELEGRAM_BOT_USERNAME=       # Bot username without @, e.g. IndexBot
# TELEGRAM_WEBHOOK_SECRET=     # Random secret for webhook validation

# Observability
# LANGFUSE_PUBLIC_KEY=...
# LANGFUSE_SECRET_KEY=...
# SENTRY_DSN=...                # Backend Sentry project DSN only; use separate projects/DSNs for other runtimes.

# Logging (default: debug in dev, info in prod)
# LOG_LEVEL=debug
```

See the root `.env.example` for the full list with inline comments.

### Web app environment variables (VITE_ prefix)

The web app needs no configuration for local development. The Vite dev server proxies `/api/*` requests to the API service on port 3001 automatically.

For production builds you would set:

```bash
VITE_PROTOCOL_URL=https://protocol.example.com
```

## Database setup

### 1. Create the database

```bash
createdb protocol_db
```

Or via psql:

```sql
CREATE DATABASE protocol_db;
```

### 2. Enable pgvector

Connect to the new database and enable the extension:

```bash
psql protocol_db -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

### 3. Run migrations

```bash
cd services/api
bun run db:migrate
```

This applies all migration files under `services/api/drizzle/` in sequence. The first migration creates the pgvector extension as well, but creating it manually in step 2 avoids permission issues on some setups.

### 4. Seed sample data (optional)

```bash
bun run db:seed
```

This populates the database with sample users, intents, and indexes for local testing.

### 5. Verify

Open Drizzle Studio to inspect the database:

```bash
bun run db:studio
```

This launches an interactive GUI where you can browse tables and data.

## Running the app

From the repository root:

```bash
bun run dev
```

This opens an interactive selector that lets you pick which workspace to run. Alternatively, start each workspace directly:

```bash
# Terminal 1: API service (port 3001)
cd services/api
bun run dev

# Terminal 2: Web dev server (port 3000, proxies /api to 3001)
cd apps/web
bun run dev
```

Once both servers are running, open http://localhost:3000 in your browser.

### What to expect

- The API service starts on **port 3001** with hot reload via Bun.serve.
- The web Vite dev server starts on **port 3000** and proxies API requests to the API service.
- On first visit you will see the authentication flow. If you have not configured Google OAuth, use email-based auth.
- After login the onboarding flow guides you through profile creation, community selection, and intent definition.

## Common dev commands

### Testing

```bash
cd services/api

# Run a specific test file (preferred)
bun test tests/e2e.spec.ts

# Run tests in watch mode
bun test --watch

# Run the full suite (slow -- avoid unless necessary)
bun test
```

Always target specific test files affected by your changes rather than running the full suite.

### Linting

```bash
# Lint both workspaces from root
bun run lint

# Or per workspace
cd services/api && bun run lint
cd apps/web && bun run lint
```

### Database operations

```bash
cd services/api

bun run db:generate     # Generate migrations after schema changes
bun run db:migrate      # Apply pending migrations
bun run db:studio       # Interactive database GUI
bun run db:seed         # Seed sample data
bun run db:flush        # Flush all data (development only)
```

After generating a migration, always rename the SQL file to a descriptive name and update the `tag` field in `services/api/drizzle/meta/_journal.json` to match.

### Queue monitoring

When the API service is running, Bull Board is available at:

```
http://localhost:3001/dev/queues/
```

This shows all BullMQ job queues, their status, and lets you retry failed jobs or clear queues.

## Git workflow

### Worktrees

All feature and fix work happens in git worktrees, keeping the main working tree (`dev` branch) stable.

Worktrees live in `.worktrees/` (gitignored). Folder names use dashes; branches inside can use slashes.

```bash
# Create a worktree for a new feature
git worktree add .worktrees/feat-my-feature dev

# Set up env symlinks and install dependencies
bun run worktree:setup feat-my-feature

# Start dev servers from the worktree
bun run worktree:dev feat-my-feature

# List all worktrees and their setup status
bun run worktree:list
```

The `worktree:setup` script symlinks the root `.env*` files from the main working tree into the worktree root (so you do not need to copy them) and installs `node_modules` in each workspace.

### Conventional commits

Commit messages follow the Conventional Commits format:

```
<type>[optional scope]: <description>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

Examples:

```
feat(chat): add streaming response support
fix(auth): resolve invalid_origin error for localhost
docs: update getting started guide
refactor(intent): use NegotiationGraphDatabase adapter interface
```

Breaking changes use `!` after the type or `BREAKING CHANGE:` in the footer.

### Branch naming

Branches always follow `<type>/<short-description>`:

```
feat/user-authentication
fix/login-redirect-loop
refactor/intent-service
docs/getting-started
```

### Pull requests

Use the `gh` CLI to create PRs targeting `origin/dev`:

```bash
gh pr create --base dev --title "feat: add streaming responses" --body "..."
```

Write the PR description as a changelog with categories: New Features, Bug Fixes, Refactors, Documentation, Tests.

## Troubleshooting

### "invalid_origin" auth error

The app's origin is not in the allowed list. Set `TRUSTED_ORIGINS` in the root `.env.development`:

```bash
TRUSTED_ORIGINS=http://localhost:3000
```

Restart the API service after changing this value.

### pgvector extension missing

If migrations fail with an error about the `vector` type:

```bash
psql protocol_db -c 'CREATE EXTENSION IF NOT EXISTS vector;'
bun run db:migrate
```

On some managed PostgreSQL services, pgvector may need to be enabled through the provider's dashboard.

### Redis connection refused

If you see `ECONNREFUSED` errors related to Redis:

1. Verify Redis is running: `redis-cli ping` should return `PONG`.
2. If Redis is on a non-default host/port, set `REDIS_URL` in the root `.env.development`.
3. The API service will start without Redis, but job queues and caching will not function.

### Migrations out of sync

If migrations fail or the database is in an inconsistent state:

```bash
cd services/api

# Nuclear option: reset and regenerate (development only)
bun run maintenance:fix-migrations
```

This resets the database, regenerates a single migration with pgvector, then restores the drizzle directory.

For more details on migration workflows, see the Database Workflow section in `CLAUDE.md`.

### Port already in use

If port 3001 or 3000 is already in use:

```bash
# Find the process using the port
lsof -i :3001

# Kill it
kill -9 <PID>
```

Or change the backend port via the `PORT` variable in the root `.env.development`.

### Web proxy not reaching API service

Make sure the API service is running on port 3001 before starting the web app. The Vite dev server proxies `/api/*` to `http://localhost:3001`. If you changed the API port, update `apps/web/vite.config.ts` accordingly.
