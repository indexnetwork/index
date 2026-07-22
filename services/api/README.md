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
bun test                # complete baseline, including isolated subprocesses
bun run test:isolated   # isolated manifest only
bun run test:all        # explicit alias of the complete bare-Bun baseline
```

Test mode is captured before `.env.test` loads. A conflicting `NODE_ENV` aborts,
and `db:migrate:test` cannot bypass `TEST_DATABASE_SAFE=1` through dotenv.
Paid providers, a dedicated disposable Redis instance, and localhost-server E2E
tests are opt-in via `RUN_PAID_INTEGRATION_TESTS=1`,
`RUN_REDIS_INTEGRATION_TESTS=1` plus an explicit `REDIS_URL`, and
`RUN_LOCAL_API_E2E=1`, respectively. See
[the getting-started guide](../../docs/guides/getting-started.md#testing).

## Web onboarding chat boundary

`POST /api/chat/onboarding/stream` is session-only and reloads the authoritative user before every turn. With `WEB_SIGNAL_AGENT_ENABLED=true`, it persists the restricted `onboarding` persona and rejects spoofed, mismatched, unknown, or completed-user access; flag off retains the legacy orchestrator flow. `POST /api/tools/complete_onboarding` accepts an optional exact first-signal `intentId`, validates the durable profile-approval marker and active owned signal, and awaits the `users.onboarding` completion write.

## More

- **[../../README.md](../../README.md)** — Project overview and getting started
- **[../../CLAUDE.md](../../CLAUDE.md)** — Full development commands, architecture, and conventions
