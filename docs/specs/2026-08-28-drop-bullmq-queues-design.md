# Drop BullMQ: background work becomes fire-and-forget async functions

Date: 2026-08-28
Branch: `refactor/drop-bullmq-queues`

## Why

`services/api` runs nine BullMQ queues behind a `QueueFactory`, a hermetic
in-memory double for tests, and a Bull Board UI. Two observations drive this
change.

First, the machinery costs more than it returns. Nine queue classes, a factory,
a test double and a dashboard exist to run work that is, in every case, "do this
after the request returns."

Second, two of the nine queues are not background work at all. `sendEmail`
enqueues a job and then blocks on `waitUntilFinished` with a 60-second timeout,
followed by defensive code that re-reads job state when `QueueEvents` misses a
completion. The chat controller's `user_message` path does the same: subscribe
to a Redis channel, enqueue, await the result. Both are synchronous function
calls routed through Redis and back.

Redis stays. It continues to serve the HyDE/opportunity cache, the app rate
limiter, Better Auth secondary storage, the MCP owner-approval store and
integration connect tokens. Only the job framework and the pub/sub channels that
existed to bridge worker and controller processes are removed.

## What replaces it

### The primitive

A single new file, `services/api/src/lib/background.ts`:

```ts
background(name: string, fn: () => Promise<void>, opts?: { retries?: number }): void
```

Returns immediately. Runs `fn`, catches everything, logs failures under
`log.job.from(name)`, and opens the same Sentry span that the `QueueFactory`
processor wrapper opens today, so queue traces do not disappear from Sentry.

`retries` defaults to none. When set, the call is retried with exponential
backoff. It exists for one call site: notification delivery, which has no
reconciler behind it, so a transient provider blip would otherwise be a silently
lost notification. Everything else runs once.

Email is not a `background()` call. `sendEmail` becomes an ordinary awaited
function, so its callers handle a thrown error as they would any other await.
Email sent as part of a notification inherits that path's retries; email sent
directly does not, where today it gets three BullMQ attempts.

No registry, no persistent state, no returned handle.

### Per-queue disposition

| Today | After |
|---|---|
| `email-processing-queue` | Deleted. `sendEmail` calls `executeSendEmail` directly. |
| `personal-agent-queue` — `user_message` | Direct await. Controller calls `processEvent`. |
| `personal-agent-queue` — `matches_ready`, `all_paused`, `needs_principal`, `counterparty_resolved` | `background('personal-agent', …)` from `lib/negotiation/negotiation-graph.ts` |
| `intent-hyde-queue` — `generate_hyde`, `delete_hyde`, `reconcile_intent_networks`, `reconcile_orphaned_intent` | `background('intent', …)`, four exported functions |
| `opportunity-discovery` | `background('discovery', …)`, unbounded |
| `negotiation-reflect` — `reflect` | `background('reflect', …)` |
| `negotiation-reflect` — `chat_reflect` | `Map<sessionId, Timeout>` debounce, same `CHAT_REFLECT_DELAY_MS` |
| `notification-queue` | `background('notification', …, { retries: 3 })` |
| `premise-queue` | `background('premise', …)` |
| `negotiation-watchdog` | `node-cron`, every 5 minutes |
| `frame-drift-monitoring` | `node-cron`, daily |

Handler bodies move as-is from class methods to exported module functions. The
job-name `switch` statements in `processJob` disappear: each former job name
becomes its own exported function.

### What survives unchanged

- `serializeIntent` in `personal-agent.queue.ts` — a per-intent ordering lane,
  already an in-process map. It preserves the no-interleaving contract for one
  signal's agent turns and is independent of BullMQ.
- The discovery intent-lock (`opportunity/discovery.intent-lock.ts`) — same-intent
  dedup, not a concurrency cap. Its in-process map path (today the hermetic test
  baseline) becomes the only path.
- The four existing `node-cron` jobs: HyDE cleanup and refresh, opportunity
  expiration, checkpoint retention. The two BullMQ schedulers join them, leaving
  one scheduling mechanism instead of two.
- Every protocol interface. `MatchesReadyFn`, `NegotiationRoundReflectEnqueueFn`
  and `AgentDispatcher` are satisfied by plain async functions, so
  `packages/protocol` needs no change and no version bump.

### Pub/sub collapse

Three transports exist only because publisher and subscriber were different
processes. Each already has an in-process `EventEmitter` implementation, used
today under the `useHermeticRedis()` guard. That path becomes the only path and
the Redis client is dropped:

- `lib/agent/personal-agent-reply.stream.ts` — agent reply chunks to the chat controller
- `lib/notification-stream-events.ts` + `services/notification.service.ts` — notification SSE
- `services/conversation.service.ts` — conversation event SSE

### Deleted

- `lib/bullmq/` in full: `bullmq.ts`, `bullmq.hermetic.ts`, `bullmq.spec.ts`,
  `bullmq.redis-contract.isolated.ts`, `queue-template.md`
- `controllers/queues.controller.ts` and the Bull Board mount in `main.ts`
- The nine queue classes' queue/worker/job plumbing, their `close()` methods and
  the shutdown block in `main.ts`
- `queues/queue.template.md`
- Dependencies: `bullmq`, `@bull-board/api`, `@bull-board/hono`
- The `RUN_REDIS_INTEGRATION_TESTS` escape hatch and every test that asserts
  enqueue-and-worker mechanics

Tests asserting handler *behaviour* are rewired to call the exported functions
directly rather than deleted.

## Error handling

A failure inside `background()` is logged and dropped. It never propagates into
the caller's request path — that is the point of the helper, and it matches what
several call sites already do by hand today (`.catch(err => logger.error(...))`
around `addCascadeJob`, `addNetworkReconcileForUser`, `addDecomposeProfileJob`).

`processEvent` currently throws on a graph-level error so BullMQ retries and the
controller falls back. With no retry, it still throws, and the chat controller's
existing fallback path handles it unchanged.

## Testing

Handlers become plain async functions, so unit tests call them directly with
injected dependencies — the `deps` constructor parameters already present on
most queue classes carry over unchanged.

E2E coverage continues to start from the graph with a fake host and a live
`graph.invoke`; nothing in this change touches that layer.

`bun run architecture:check` in `packages/protocol` and
`bun run check:subtree-parity` must still pass. The host-isolation check that
forbids `bullmq` in the protocol package becomes trivially satisfied.

## Risks accepted

These were raised during design and accepted deliberately.

1. **In-flight work dies on process restart.** Railway redeploys, crashes and
   OOMs lose whatever was running. Recovery is the existing reconcilers:
   `cli/reenqueue-orphaned-discovery.ts`,
   `cli/reconcile-orphaned-intent-indexing.ts`, the negotiation watchdog sweep
   and opportunity expiration.

2. **Discovery fan-out is unbounded.** `DISCOVERY_WORKER_CONCURRENCY = 4` exists
   because one scan already issues one LLM call per candidate on top of HyDE and
   embedder calls. Removing the cap means simultaneous onboardings multiply
   provider load and may hit OpenRouter or embedder rate limits. No gate
   replaces it.

3. **The API is already single-replica, and already depends on it.** Three
   pre-existing `node-cron` schedules (opportunity expiration, checkpoint
   retention, HyDE refresh) already run unguarded on every process, so a
   second replica already double-fires them today. This change adds the three
   worker→controller SSE pub/sub channels to that same single-replica
   dependency — it does not introduce the constraint. Horizontal scaling later
   means restoring a shared transport for those three paths, alongside
   whatever cron-guarding a second replica would already have needed.

## Out of scope

Removing Redis entirely. The cache, rate limiter, Better Auth storage, MCP
owner-approval store and integration connect tokens keep using it. The rate
limiter and owner-approval store already have in-memory implementations
(`lib/limiter/storage.memory.ts`, `createMemoryOwnerApprovalStore`) should that
ever become a separate project.
