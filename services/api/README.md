# API Service

Backend API and agent engine for Index Network: Bun runtime, Bun.serve routing, Drizzle ORM, PostgreSQL with pgvector, BullMQ, and LangChain/LangGraph.

## Quick start

```bash
# Install dependencies (from repo root)
bun install

# Development: Bun server (Bun.serve, port 3001)
bun run dev

# Database
bun run db:generate   # Generate migrations after schema changes
bun run db:migrate    # Apply migrations
bun run db:studio     # Drizzle Studio (DB GUI)
```

## Tests

Use a repo-root `.env.test` that points to a dedicated disposable database:

```bash
# In .env.test: NODE_ENV=test, TEST_DATABASE_SAFE=1, disposable DATABASE_URL
bun run db:migrate:test
bun test           # default hermetic/disposable-DB baseline
bun run test:all   # also runs mock/env-contaminating tests in isolated processes
```

Paid providers, a real Redis instance, and localhost-server E2E tests are opt-in
via `RUN_PAID_INTEGRATION_TESTS=1`, `RUN_REDIS_INTEGRATION_TESTS=1`, and
`RUN_LOCAL_API_E2E=1`, respectively. See
[the getting-started guide](../../docs/guides/getting-started.md#testing).

## More

- **[../../README.md](../../README.md)** — Project overview and getting started
- **[../../CLAUDE.md](../../CLAUDE.md)** — Full development commands, architecture, and conventions
