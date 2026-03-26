---
title: "Getting Started"
type: guide
tags: [getting-started, setup, onboarding, development, environment]
created: 2026-03-26
updated: 2026-03-26
---

# Getting Started

This guide walks you through setting up a local development environment for Index Network from scratch. By the end you will have the protocol server (port 3001) and the frontend dev server running locally, connected to a seeded PostgreSQL database.

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

`bun install` at the root installs dependencies for all workspaces (protocol, frontend).

### Workspace structure

```
index/
├── protocol/          # Backend API and agent engine (Bun, Express, TypeScript)
├── frontend/          # Vite + React Router v7 SPA (React 19, Tailwind CSS 4)
├── scripts/           # Worktree helpers, hooks, dev launcher
├── package.json       # Root workspace config
└── CLAUDE.md          # Comprehensive project reference
```

## Environment setup

Copy the example environment files for both workspaces:

```bash
cp protocol/.env.example protocol/.env
cp frontend/.env.example frontend/.env
```

### Protocol environment variables (protocol/.env)

Open `protocol/.env` and fill in the required values:

**Required:**

```bash
# PostgreSQL connection
DATABASE_URL=postgresql://username:password@localhost:5432/index_dev

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
# Allow the frontend dev server origin for auth
TRUSTED_ORIGINS=http://localhost:3000
```

**Optional (features degrade gracefully when absent):**

```bash
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

# Observability
# LANGFUSE_PUBLIC_KEY=...
# LANGFUSE_SECRET_KEY=...
# SENTRY_DSN=...
```

See `protocol/.env.example` for the full list with inline comments.

### Frontend environment variables (frontend/.env)

The frontend needs no configuration for local development. The Vite dev server proxies `/api/*` requests to the protocol server on port 3001 automatically.

For production builds you would set:

```bash
VITE_PROTOCOL_URL=https://protocol.example.com
```

## Database setup

### 1. Create the database

```bash
createdb index_dev
```

Or via psql:

```sql
CREATE DATABASE index_dev;
```

### 2. Enable pgvector

Connect to the new database and enable the extension:

```bash
psql index_dev -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

### 3. Run migrations

```bash
cd protocol
bun run db:migrate
```

This applies all migration files under `protocol/drizzle/` in sequence. The first migration creates the pgvector extension as well, but creating it manually in step 2 avoids permission issues on some setups.

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
# Terminal 1: Protocol server (port 3001)
cd protocol
bun run dev

# Terminal 2: Frontend dev server (port 3000, proxies /api to 3001)
cd frontend
bun run dev
```

Once both servers are running, open http://localhost:3000 in your browser.

### What to expect

- The protocol server starts on **port 3001** with hot reload via Bun.serve.
- The frontend Vite dev server starts on **port 3000** and proxies API requests to the protocol.
- On first visit you will see the authentication flow. If you have not configured Google OAuth, use email-based auth.
- After login the onboarding flow guides you through profile creation, community selection, and intent definition.

## Common dev commands

### Testing

```bash
cd protocol

# Run a specific test file (preferred)
bun test tests/e2e.test.ts

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
cd protocol && bun run lint
cd frontend && bun run lint
```

### Database operations

```bash
cd protocol

bun run db:generate     # Generate migrations after schema changes
bun run db:migrate      # Apply pending migrations
bun run db:studio       # Interactive database GUI
bun run db:seed         # Seed sample data
bun run db:flush        # Flush all data (development only)
```

After generating a migration, always rename the SQL file to a descriptive name and update the `tag` field in `drizzle/meta/_journal.json` to match.

### Queue monitoring

When the protocol server is running, Bull Board is available at:

```
http://localhost:3001/dev/queues/
```

This shows all BullMQ job queues, their status, and lets you retry failed jobs or clear queues.

### Background workers

```bash
cd protocol

bun run integration-worker    # Integration sync worker
bun run social-worker         # Social media sync worker
```

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

The `worktree:setup` script symlinks `.env*` files from the main working tree (so you do not need to copy them) and installs `node_modules` in each workspace.

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
refactor(intent): use NegotiationDatabase adapter interface
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

Use the `gh` CLI to create PRs targeting `upstream/dev`:

```bash
gh pr create --base dev --title "feat: add streaming responses" --body "..."
```

Write the PR description as a changelog with categories: New Features, Bug Fixes, Refactors, Documentation, Tests.

## Troubleshooting

### "invalid_origin" auth error

The app's origin is not in the allowed list. Set `TRUSTED_ORIGINS` in `protocol/.env`:

```bash
TRUSTED_ORIGINS=http://localhost:3000
```

Restart the protocol server after changing this value.

### pgvector extension missing

If migrations fail with an error about the `vector` type:

```bash
psql index_dev -c 'CREATE EXTENSION IF NOT EXISTS vector;'
bun run db:migrate
```

On some managed PostgreSQL services, pgvector may need to be enabled through the provider's dashboard.

### Redis connection refused

If you see `ECONNREFUSED` errors related to Redis:

1. Verify Redis is running: `redis-cli ping` should return `PONG`.
2. If Redis is on a non-default host/port, set `REDIS_URL` in `protocol/.env`.
3. The protocol server will start without Redis, but job queues and caching will not function.

### Migrations out of sync

If migrations fail or the database is in an inconsistent state:

```bash
cd protocol

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

Or change the protocol port via the `PORT` variable in `protocol/.env`.

### Frontend proxy not reaching protocol

Make sure the protocol server is running on port 3001 before starting the frontend. The Vite dev server proxies `/api/*` to `http://localhost:3001`. If you changed the protocol port, update `frontend/vite.config.ts` accordingly.
