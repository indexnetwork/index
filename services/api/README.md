# API Service

Backend API and agent engine for Index Network: Bun runtime, Bun.serve routing, Drizzle ORM, PostgreSQL with pgvector, Redis, and LangChain/LangGraph.

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

## Personal-agent TUI

From the repository root:

```bash
bun run --cwd services/api agent:tui
# Optional ordered OpenRouter model IDs:
bun run --cwd services/api agent:tui google/gemini-3.8-flash anthropic/claude-haiku-4.5
```

Uses the root `.env.development`, existing database principals/intents, and the
API's negotiation services. Space selects principal/intent sessions; Enter starts
all selected agents. No HTTP server or login is needed for this trusted local
command. HTTP guards are unchanged. Models, the session store, protocol guidance,
and protocol-backed reads/writes are injected into `@indexnetwork/agent`.

`packages/protocol` owns participation rules and consent/transition gates;
`packages/agent` owns reasoning, parallel matches, and the shared H2A inbox.
The API composes both. It persists `protocol_*` domain tables, `agent_sessions`
checkpoints/leases, and intent-tagged H2A `messages` in the owner's existing DM.
A2A agreement remains pending human approval. The normal API server does not
start these local runtimes automatically.

See [agent-tui controls and behavior](../../packages/agent-tui/README.md).

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

`POST /api/chat/onboarding/stream` is session-only and reloads the authoritative user before every turn. It persists the restricted `onboarding` persona unconditionally and rejects spoofed, mismatched, unknown, or completed-user access. `POST /api/tools/complete_onboarding` accepts an optional exact first-signal `intentId`, validates a durable profile-approval timestamp and an active owned signal created at or after it, and awaits the `users.onboarding` completion write.

## More

- **[../../README.md](../../README.md)** — Project overview and getting started
- **[Development Reference](../../docs/guides/development-reference.md)** — Full development commands, architecture, and conventions
