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

## Personal agents and live web testing

From the repository root, run these in separate terminals:

```bash
bun run dev:api
bun run dev:web
```

The API loads the root `.env.development`. Use the disposable development
database with the migrations applied. Open the web app, sign in normally, and
open an intent. Its private H2A chat accepts a message whenever no question is
displayed; otherwise the same input answers that exact question. Suggested
answers and custom drafts stay attached to the displayed question. Radar keeps
its Needs you, Waiting, Connected, and Closed categories, with an expandable
A2A conversation inside each match. Pending matches retain Start Chat and Skip.

The normal API server starts agents for active intents at boot and reconciles
new intents, profile/intent changes, and selected external executors every five
seconds. Agents run with no browser or TUI connected. Shutdown saves outstanding
work and releases session leases. Restart restores pending questions and resumes
matches from current protocol records.

`GET /api/conversations/agent/messages?intentId=<id>` returns that intent's H2A
history and `agent` state (`status`, `pending`, `queuedQuestions`). Send text to
`POST /api/conversations/agent/messages` with `parts: [{ kind: "text", text }]`,
`metadata: { intentId }`, and the displayed `questionId`, or `null` for a direct
message. A successful response contains the persisted message; a changed
question returns 409 without recording the input. Normal authentication and
intent ownership checks apply.

`PersonalAgentService` owns runtime lifecycle and HTTP input routing; its
injected model and shared `ApiNegotiationHost` supply infrastructure. Input is
handled by the API process owning the session. An external executor selection
revokes local execution leases atomically and uses the existing external message
transport. Removing that selection lets the server restore its local agent.

## Railway dev intent replay

After these scripts have been deployed to Railway dev, use the repository root:

```bash
bun run db:dev:reset --confirm
bun run db:dev:resume --confirm
```

The launcher requires an authenticated Railway CLI. Resume also requires a
registered SSH key (`railway ssh keys add`). It runs inside the dev API container,
using that service's Redis and model credentials. Keep the terminal connected;
Ctrl+C stops new activations and waits for current discovery scans to finish.

Resume shuffles eligible paused intents and activates one every 10–30 seconds
through the normal lifecycle graph. Discovery scans can overlap. Progress logs
include activation times, intent IDs, and scan failures. Archived intents and
intents without a current network assignment/member are reported and skipped.
Re-running resume processes the remaining paused intents. Use reset to start
the experiment from the beginning.

Reset briefly stops the dev API and any replay in its container, then pauses
non-archived, non-terminal intents and clears discovery progress, opportunities,
negotiations/turns, outcome feedback, agent checkpoints and agent conversations.
Human conversations keep their messages but lose old match provenance. Users,
API keys/sessions, profiles, intents, networks, memberships, assignments and
embeddings/HyDE remain. The exact API deployment is restarted and health-checked,
including after a cleanup failure. Advisory locks exclude overlapping runs.

Both commands are pinned to Railway's dev API and its Neon `protocol_prod`
endpoint. They reject production and `protocol_sandbox`; local `.env` files
never choose the target. Reset does not recopy production or replace credentials.
These commands replace `db:playground:resume` and `db:clear-negotiations`.

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
A2A agreement remains pending human approval. Stop the normal API server before
using this standalone TUI for the same intents: each session has one runtime
owner, shared across both entry points.

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

## Web onboarding boundary

`POST /api/auth/onboarding/complete` accepts an optional exact first-signal `intentId`, validates a durable profile-approval timestamp and an active owned signal created at or after it, and awaits the `users.onboarding` completion write.

## More

- **[../../README.md](../../README.md)** — Project overview and getting started
- **[Development Reference](../../docs/guides/development-reference.md)** — Full development commands, architecture, and conventions
