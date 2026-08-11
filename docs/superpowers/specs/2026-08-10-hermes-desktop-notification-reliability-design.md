# Hermes Desktop Notification Reliability Design

**Date:** 2026-08-10  
**PR:** #1351 — Deliver Hermes Desktop notifications over Index SSE  
**Status:** Approved for implementation planning

## Problem

PR #1351 replaces Hermes Desktop's 30-second opportunity poll with realtime Index notification SSE, but the current implementation has correctness, privacy, transport, and release blockers:

- the API does not typecheck;
- network-scoped API keys can subscribe to a user-wide channel;
- native Desktop uses unauthenticated raw `window.fetch` instead of its plugin SDK;
- opportunity delivery bypasses canonical actionability and counterpart rules and omits actionable `latent` opportunities;
- recovery questions retain the startup no-op lifecycle callback;
- native message alerts include the sender's own messages;
- Redis Pub/Sub and a capped retry loop can lose events permanently;
- package versions and generated release artifacts are stale.

The fix must retain low-latency notifications without creating a second durable event store or broadening this PR into a general notification platform.

## Decisions

1. Use **SDK-native realtime delivery plus persisted catch-up**.
2. Keep **Index API SSE** as the upstream protocol.
3. Bridge upstream SSE to native Desktop through the supported **`ctx.socket` plugin WebSocket** transport.
4. Reconcile persisted **questions and opportunities only** every 60 seconds through an authenticated notification snapshot; messages remain realtime-only.
5. **Reject network-scoped API keys** at `/notifications/stream` until events have authoritative per-network provenance.
6. Rebase the PR onto current `origin/dev` with `--force-with-lease` before implementation/versioning.
7. Apply feature-level minor bumps to both affected packages and regenerate lock/generated metadata.

## Non-goals

- Cursor-based Redis Streams or guaranteed replay of every emitted event.
- Message-history replay or unread-message cursor redesign.
- Supporting notification streams for network-scoped agents in this PR.
- A general user notification-preferences redesign.
- Refactoring the existing conversation SSE architecture beyond the native transport and own-message alert bug.
- Merging the PR.

## Architecture

### 1. Opportunity lifecycle events

Preserve the existing pending-only lifecycle callback used by uptake processing, and add an independent actionable callback:

```ts
OpportunityEvents.onPending(payload)    // existing uptake behavior, pending only
OpportunityEvents.onActionable(payload) // desktop notifications, latent or pending
```

Replace the misleading pending-only emission helper with a lifecycle helper invoked at the existing post-commit call sites. It must:

- call `onActionable` for `latent` and `pending` rows;
- call `onPending` only for `pending` rows;
- preserve fail-open, best-effort behavior so lifecycle writes cannot roll back because a callback fails.

This gives introducers and no-introducer parties realtime events while preserving uptake semantics.

### 2. Notification delivery service

`NotificationDeliveryService` reloads authoritative persisted state before publishing.

For opportunities it must:

1. accept only `latent` or `pending` rows;
2. derive recipients with canonical `isActionableForViewer`;
3. select the visible non-introducer counterpart, not merely the first other actor;
4. read names from `UserIdentity.identity.name`;
5. use a fixed safe fallback headline and `safeFallbackSummary` for the body;
6. publish only to actionable recipient channels.

For questions it must:

- use the exported canonical `QuestionCreatedPayload` type;
- reload the pending question before publishing;
- keep intent/opportunity labels bounded;
- preserve the specialized inflight-negotiation attention copy;
- route every event only to the question owner.

Raw evaluator reasoning must never reach the wire except through `safeFallbackSummary`. A regression test must prove unsupported/internal details are stripped.

### 3. Live lifecycle callback lookup

`IntentRecoveryRefinementService` must not snapshot `QuestionEvents.onCreated` during module initialization. Production defaults use a closure that resolves the current callback at invocation time:

```ts
this.onCreated = deps?.onCreated ?? ((payload) => QuestionEvents.onCreated(payload));
```

Explicit test injections remain stable.

### 4. Notification stream authorization and readiness

`GET /api/notifications/stream` must:

1. run the existing rate limit and authentication guards;
2. resolve the caller's agent network scope;
3. reject a non-null network scope with `ScopeViolationError`/403;
4. establish and acknowledge the Redis subscription before returning a healthy stream;
5. return 503 when subscription establishment fails;
6. emit the connected frame only after readiness;
7. always clear keepalive state and disconnect the Redis subscriber on cancellation.

`NotificationService` exposes an awaited subscription-opening boundary rather than logging subscribe failures behind an already-connected response.

`GET /api/notifications/snapshot` applies the same auth and scoped-key rejection, then uses `QuestionerAdapter.findPending` plus `OpportunityDatabaseAdapter.getOpportunitiesForUser` to return the current notification projections for all pending questions and actionable latent/pending opportunities. It reuses the same delivery projection helpers as realtime publishing so catch-up cannot drift in actionability, counterpart selection, or safe presentation. Messages are intentionally absent.

### 5. Hermes plugin WebSocket bridge

The Python plugin backend keeps the upstream Index SSE routes and adds WebSocket relays for native Desktop:

- `/notifications/socket` relays `/notifications/stream`;
- `/conversations/socket` relays `/conversations/stream`;
- `/notifications/snapshot` proxies `/notifications/snapshot` as authenticated JSON for native catch-up.

Each relay:

- authenticates upstream with the configured Index API key;
- opens the upstream SSE connection;
- parses complete `data:` frames;
- sends parsed JSON through the accepted plugin WebSocket;
- forwards neither keepalive comments nor malformed frames;
- closes the upstream response when Desktop disconnects;
- closes the WebSocket on upstream failure so the SDK reconnect policy takes over.

Blocking `urllib` reads run outside the event loop. Relay helpers are isolated so SSE parsing and cleanup can be tested without a live server.

### 6. Native Desktop client

Desktop uses the native plugin SDK only:

```js
ctx.socket('/notifications/socket', onNotification)
ctx.socket('/conversations/socket', onConversation)
ctx.rest('/notifications/snapshot')
ctx.rest('/auth/status')
```

No notification code calls raw `window.fetch` or reads Hermes session tokens.

Extract pure notification helpers into a source fragment that can be imported by Node tests and inlined by `desktop/build.mjs`. Helpers own:

- event-to-copy composition;
- canonical entity dedupe keys (`question:<id>`, `opportunity:<id>`, `message:<id>`);
- bounded, versioned persisted dedupe state;
- own-message detection (`userId` and `agent:<userId>`);
- snapshot extraction for pending questions and actionable opportunities;
- first-baseline versus later-catch-up decisions.

At registration:

1. resolve the current user from `/auth/status`;
2. start both SDK sockets;
3. start 60-second `/notifications/snapshot` reconciliation;
4. establish the first successful snapshot as a silent baseline;
5. on later snapshots, notify only unseen question/opportunity IDs;
6. let realtime and catch-up share the same canonical dedupe store;
7. suppress all message OS alerts until current-user identity is known;
8. dispose sockets and timers through `ctx.onDispose`.

The reconciliation path is also the required fallback when `ctx.socket` is unavailable on an OAuth remote.

## Data flow

### Realtime question/opportunity

```text
Committed row
  -> lifecycle callback
  -> NotificationDeliveryService authoritative reload/filter
  -> Redis user channel
  -> authenticated Index SSE
  -> Hermes Python WebSocket relay
  -> Desktop ctx.socket
  -> canonical dedupe
  -> ctx.os.notify
```

### Catch-up

```text
60-second ctx.rest('/notifications/snapshot')
  -> API-projected pending questions/actionable opportunities
  -> silent first baseline OR unseen-ID delta
  -> canonical dedupe
  -> ctx.os.notify
```

### Realtime message

```text
Persisted message
  -> existing conversation Redis/SSE publisher
  -> Hermes Python WebSocket relay
  -> Desktop ctx.socket
  -> current-user sender suppression
  -> canonical dedupe
  -> ctx.os.notify
```

Messages are not reconstructed during catch-up.

## Failure behavior

| Failure | Required behavior |
|---|---|
| Network-scoped API key | 403 before Redis subscription |
| Redis subscribe failure | 503; no connected frame |
| Upstream Index SSE failure | Close relay socket; SDK reconnects |
| Native socket unavailable | 60-second authenticated reconciliation still runs |
| Realtime gap | Persisted question/opportunity appears on next reconciliation |
| Identity unresolved | Suppress message alerts; continue identity refresh through reconciliation |
| Duplicate realtime/catch-up entity | Canonical dedupe emits at most once |
| Notification rendering failure | Log/fail open; do not affect lifecycle persistence |
| Plugin disposal | Cancel sockets/timers and close upstream responses |

## Testing strategy

All behavioral changes follow red-green-refactor. No production behavior changes before a failing regression test exists.

### API tests

- Typecheck regression for protocol exports and `UserIdentity` shape.
- Opportunity actionability matrix:
  - latent unapproved introducer;
  - latent no-introducer parties;
  - latent approved-introducer parties;
  - pending unacted party;
  - pending acted party excluded;
  - duplicate actor rows with one `actedAt` excluded;
  - three-party counterpart selection excludes introducer.
- Safe fallback strips unsupported/internal details.
- Pending callback remains pending-only while actionable callback receives latent and pending.
- Recovery service observes a callback assigned after construction.
- Network-scoped requests are rejected before stream subscription or snapshot reads.
- Snapshot and realtime projection return the same IDs, copy, and actionability decisions.
- Redis subscription failure yields 503 and successful readiness yields connected SSE.
- Cancellation performs cleanup exactly once.

Prefer isolated/provider-free tests. Database-backed tests run only when the fail-closed disposable-database guard is satisfied.

### Hermes tests

- Python SSE frame parser handles chunking, comments, malformed JSON, EOF, and cleanup.
- WebSocket relay forwards valid events and closes both directions correctly.
- Pure Desktop helper tests cover:
  - canonical dedupe across realtime and catch-up;
  - silent first baseline;
  - later question/opportunity catch-up;
  - own user and own agent message suppression;
  - unknown identity suppression;
  - bounded versioned storage;
  - notification copy fallbacks.
- Existing Python smoke suite passes.
- `node --check` passes for source and generated Desktop bundle.
- `bun run build:desktop` leaves the committed generated artifact unchanged.

## Validation and rollout

1. Commit this design before implementation planning.
2. After plan approval, fetch current `origin/dev` and rebase the PR branch.
3. Force-push only with `--force-with-lease`.
4. Implement test-first in the existing worktree with one writer.
5. Bump after rebasing:
   - `services/api` from the current base `0.78.0` to `0.79.0`;
   - `packages/hermes-plugin` from `0.17.0` to `0.18.0`;
   - keep Hermes `package.json`, `plugin.yaml`, and dashboard manifest aligned;
   - regenerate root `bun.lock` and Desktop bundle.
6. Run focused API tests, API typecheck/build, targeted ESLint, Hermes Python/Node tests, generated-artifact checks, subtree parity, and lockfile checks.
7. Commit with a conventional fix commit, push normally, fetch the branch, and prove zero ahead/behind drift.
8. Update PR #1351 with exact validation evidence and residual manual checks.
9. Do not merge without a separate explicit merge authorization.

## Manual verification still required

Automated checks cannot prove native notification presentation in the actual Hermes shell. Before merge, manually verify:

- a pending question produces one OS notification without polling latency;
- latent and pending opportunity roles receive alerts only when actionable;
- the sender does not receive an OS alert for their own message;
- disabling plugin notifications suppresses OS output;
- stopping the Index API or Redis causes reconnect/fallback behavior without duplicate alerts;
- login/logout refreshes identity and transport correctly.
