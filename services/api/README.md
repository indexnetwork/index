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
open an intent. Its private H2A chat keeps direct messages separate from answers.
Our hosted agent displays stable batches of 1–3 independent questions; suggestions
and custom drafts remain attached to their IDs until the complete batch is submitted.
Radar retains its match categories, A2A transcripts, Start Chat and Skip.

`PersonalAgentService` is the default API host for `@indexnetwork/agent`.
`@indexnetwork/agentv2` and its independent runner remain separate; the API does
not start a second hosted scheduler. Startup reconstructs domain records without
resuming interrupted model work. Redis ownership and PostgreSQL owner locks exclude
competing hosted execution and fence external-executor handover.

The service reconciles active seats at boot and follows Redis Streams for intent
and executor changes. Only accepted principal input, explicit creation/broadcast/resume
and trusted manual wakes activate H2A. Resume receipts name the committed lifecycle
version; stale and duplicate resumes cannot activate another review. Negotiation changes refresh A2A observations;
stalls and reconnects never create H2A activations. Stable activation IDs make
retained-event delivery idempotent. Stream acknowledgement means dispatch, not
successful completion of model work. Failed runtimes restore an idle inbox without
replaying failed reviews. Transient startup failures keep retrying with capped
backoff, retaining explicit activations until the runtime is ready. The web listens
for status, lifecycle and question changes rather than waiting for its fallback poll.
Hosted review activity also refreshes the web's Thinking indicator, collapsible tool
calls and review notices. These observations are ephemeral, not authority or model
checkpoints. Failed-review notices survive idle runtime recovery until another
explicit input is accepted.

Local development preserves inherited environment variables. If OpenRouter returns
401 despite a valid key in `.env.development`, restart the API with
`env -u OPENROUTER_API_KEY bun run dev:api` from the repository root so a stale
shell or tmux key cannot override the file.

`GET /api/conversations/agent/messages?intentId=<id>` returns H2A history and
`agent: { status, pending, reviewing, toolCalls, reviewNotice }` for the hosted agent;
external executors retain their own policy and expose `status` and `pending`.
Question status is read from canonical records even while a hosted runtime is
restarting or paused. Send direct text to
`POST /api/conversations/agent/messages` with `parts: [{ kind: "text", text }]`
and `metadata: { intentId }`. Submit answers at
`POST /api/conversations/:id/answers` (including the `agent` alias) with
`{ intentId, answers: [{ questionId, text }, ...] }`. Hosted batches reject missing,
extra, duplicate, empty, stale or retired answers without partial writes or a wake.
Direct messages never implicitly answer questions. External agents retain their
own question policy and publish through `/conversations/agent/h2a?executorId=...`;
owner input reaches that executor only after its messages are durable.

Migration `0003_add_principal_records_and_negotiation_sessions` follows dev's
squashed `0000`–`0002` baseline. It preserves checkpoint-era question wording,
scoped answers and advisory notes, assigns historical singleton batch IDs, then
drops `agent_sessions`. It does not invent standing authority or replay model work.
Existing unbriefed hosted intents need permitted fresh input or a trusted manual
wake before they become match-ready. Record fingerprints and protocol turn guards
reject stale hosted writes; private briefs and retirement records stay out of chat.

The TUI and web Wake action use the same runtime `wake()` operation. Authenticated
owners can request it at `POST /api/conversations/:id/wake` with `{ intentId }`.
It records a private receipt, not a chat message, answer or new permission, and
returns 202 after acceptance rather than waiting for model work. Inactive intents,
other owners' conversations and selected external executors cannot be woken through
this hosted route. Shutdown cancels model work and releases ownership; agents need
no browser or TUI connection.

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

Each resume shuffles eligible paused intents and selects at most five before
activating any, then activates them through the normal lifecycle graph with
10–30-second gaps. Discovery scans can overlap; the command waits for them to
finish and exits. Progress logs include activation times, intent IDs, and scan
failures, with selected, resumed, and remaining eligible paused counts in the
final result (`remaining` is unavailable if the control connection is lost).
Archived intents and intents without a current network assignment/member are
reported and skipped. Re-running resume selects another batch from the remaining
eligible paused intents. Use reset to start the experiment from the beginning.

Reset briefly stops the dev API and any replay in its container, then pauses
non-archived, non-terminal intents and clears discovery progress, opportunities,
negotiations/turns, outcome feedback and agent conversations.
Human conversations keep their messages but lose old match provenance. Users,
API keys/sessions, profiles, intents, networks, memberships, assignments and
embeddings remain. The exact API deployment is restarted and health-checked,
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
command. HTTP guards are unchanged. Models, record operations, protocol guidance,
and protocol-backed reads/writes are injected into `@indexnetwork/agent`.

`packages/protocol` owns participation rules and consent/transition gates;
`packages/agent` owns reasoning, parallel matches, and the shared H2A inbox.
The API and TUI compose both against the same unprefixed domain tables and
intent-tagged H2A messages. Standing briefs, specific delegations and question
retirements are typed private records excluded from chat history, previews,
unread counts and notifications. `intents.standing_brief_id` gates hosted match
readiness; selected external executors keep their own eligibility. A2A agreement
still requires human approval. Stop the normal API before running this TUI for
the same intents: Redis permits one hosted owner per principal/intent.

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
