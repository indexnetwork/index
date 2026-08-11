# Hermes Desktop Notification Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #1351 compile, preserve notification privacy/actionability, deliver native realtime events through the supported Hermes SDK, recover missed questions/opportunities from persisted state, and leave the updated PR verified and approved.

**Architecture:** Index API lifecycle hooks project authoritative question/opportunity rows into safe user-scoped notification events. API SSE remains upstream; the Hermes Python backend bridges it to SDK-authenticated plugin WebSockets, while a dedicated snapshot endpoint powers 60-second persisted catch-up. Native Desktop shares canonical dedupe between socket and snapshot delivery and suppresses own-message alerts.

**Tech Stack:** Bun/TypeScript, ioredis Pub/Sub, FastAPI/Python `urllib`, Hermes `@hermes/plugin-sdk`, plain ESM/Node tests, Git/GitHub API.

## Global Constraints

- Work only in `/home/yanek/Projects/index/.worktrees/feat-hermes-desktop-sse-notifications` with one writer.
- Rebase onto current `origin/dev`; force-push only with `--force-with-lease`.
- Reject network-scoped API keys at both notification stream and snapshot boundaries.
- Catch up pending questions and actionable latent/pending opportunities only; messages remain realtime-only.
- Never expose raw `interpretation.reasoning`; use `safeFallbackSummary`.
- Keep `OpportunityEvents.onPending` pending-only for uptake and add an independent latent/pending actionable hook.
- Native Desktop must use `ctx.socket`/`ctx.rest`, never raw `window.fetch` or session-token reads.
- First successful snapshot is a silent baseline; subsequent unseen entities notify once.
- Follow red-green-refactor for every behavior change.
- Database-backed tests remain fail-closed unless `DATABASE_URL` is proven disposable and `TEST_DATABASE_SAFE=1` is set.
- Bump rebased `services/api` 0.78.0→0.79.0 and `packages/hermes-plugin` 0.17.0→0.18.0; align plugin metadata and regenerate `bun.lock`/Desktop output.
- Do not merge; GitHub approval is allowed only after all required checks and local validation are green.

---

### Task 1: Rebase and establish the lifecycle contracts

**Files:**
- Modify: `services/api/src/events/opportunity.event.ts`
- Modify: `services/api/src/events/question.event.ts`
- Modify: `services/api/src/adapters/opportunity.database.adapter.ts`
- Modify: `services/api/src/adapters/conversation.database.adapter.ts`
- Create: `services/api/src/events/tests/opportunity.event.lifecycle.isolated.ts`
- Modify: `services/api/.test-isolated`
- Modify: `services/api/src/services/intent-recovery-refinement.service.ts`
- Modify: `services/api/src/services/tests/intent-recovery-refinement.service.isolated.ts`

**Interfaces:**
- Produces: `OpportunityEvents.onActionable(payload: OpportunityActionablePayload): void | Promise<void>`.
- Produces: `emitOpportunityLifecycleBestEffort(opportunity: PendingOpportunityEvent): void`.
- Produces: exported `QuestionCreatedPayload`.
- Preserves: `OpportunityEvents.onPending` fires only for `status === 'pending'`.

- [ ] **Step 1: Rebase the branch and preserve the approved docs commits**

```bash
cd /home/yanek/Projects/index/.worktrees/feat-hermes-desktop-sse-notifications
git fetch origin dev feat/hermes-desktop-sse-notifications
git status --short --branch
git rebase origin/dev
git push --force-with-lease origin feat/hermes-desktop-sse-notifications
git fetch origin feat/hermes-desktop-sse-notifications
git status --short --branch
```

Expected: clean worktree; local and remote PR branch have zero ahead/behind drift.

- [ ] **Step 2: Write failing lifecycle tests**

Add cases proving:

```ts
OpportunityEvents.onPending = pending;
OpportunityEvents.onActionable = actionable;
emitOpportunityLifecycleBestEffort(row('latent'));
expect(actionable).toHaveBeenCalledTimes(1);
expect(pending).not.toHaveBeenCalled();

emitOpportunityLifecycleBestEffort(row('pending'));
expect(actionable).toHaveBeenCalledTimes(2);
expect(pending).toHaveBeenCalledTimes(1);
```

Add a recovery test that constructs `IntentRecoveryRefinementService`, replaces `QuestionEvents.onCreated`, executes a successful recovery, and expects the replacement callback—not the pre-construction callback—to receive the created question.

- [ ] **Step 3: Run the isolated suite and verify RED**

Add the new isolated test path to `services/api/.test-isolated`, then run:

```bash
cd services/api
bun run test:isolated
```

Expected: FAIL because `onActionable`/`emitOpportunityLifecycleBestEffort` do not exist and the recovery service snapshots the old callback.

- [ ] **Step 4: Implement the minimal lifecycle changes**

Use this contract in `opportunity.event.ts`:

```ts
export type OpportunityActionablePayload = OpportunityPendingPayload;

export const OpportunityEvents = {
  onPending: async (_payload: OpportunityPendingPayload): Promise<void> => {},
  onActionable: async (_payload: OpportunityActionablePayload): Promise<void> => {},
};

export function emitOpportunityLifecycleBestEffort(opportunity: PendingOpportunityEvent): void {
  if (opportunity.status !== 'latent' && opportunity.status !== 'pending') return;
  try { Promise.resolve(OpportunityEvents.onActionable({ opportunity })).catch(() => {}); } catch {}
  if (opportunity.status !== 'pending') return;
  try { Promise.resolve(OpportunityEvents.onPending({ opportunity })).catch(() => {}); } catch {}
}
```

Rename every existing post-commit helper call to `emitOpportunityLifecycleBestEffort`. Export `QuestionCreatedPayload`. Change the recovery default to:

```ts
this.onCreated = deps?.onCreated ?? ((payload) => QuestionEvents.onCreated(payload));
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 3 command. Expected: PASS.

- [ ] **Step 6: Commit the lifecycle slice**

```bash
git add services/api/src/events services/api/src/adapters/opportunity.database.adapter.ts services/api/src/adapters/conversation.database.adapter.ts services/api/src/services/intent-recovery-refinement.service.ts services/api/src/services/tests/intent-recovery-refinement.service.isolated.ts
git commit -m "fix(api): emit actionable notification lifecycle events"
```

---

### Task 2: Build authoritative notification projections and snapshot

**Files:**
- Create: `services/api/src/services/notification-projection.ts`
- Create: `services/api/src/services/tests/notification-projection.isolated.ts`
- Create: `services/api/src/services/tests/notification-delivery.service.isolated.ts`
- Modify: `services/api/src/services/notification-delivery.service.ts`
- Modify: `services/api/src/lib/notification-stream-events.ts`
- Modify: `services/api/src/main.ts`

**Interfaces:**
- Produces: `actionableRecipientIds(opportunity: OpportunityRow): string[]`.
- Produces: `counterpartForRecipient(opportunity, recipientId)` that prefers non-introducers.
- Produces: `buildOpportunityNotificationEvent(...)` with fixed safe headline and sanitized summary.
- Produces: `NotificationDeliveryService.snapshot(userId): Promise<NotificationStreamEvent[]>`.
- Consumes: `OpportunityEvents.onActionable` from Task 1.

- [ ] **Step 1: Write failing pure projection tests**

Cover the actionability matrix from the design with real actor arrays. Include:

```ts
expect(actionableRecipientIds(pendingWithActedViewer)).not.toContain('acted-user');
expect(actionableRecipientIds(latentWithUnapprovedIntroducer)).toEqual(['introducer']);
expect(counterpartForRecipient(threePartyOpportunity, 'viewer')?.role).not.toBe('introducer');
expect(event.summary).not.toContain('internal scoring');
```

Use `UserIdentity` fixtures shaped as `{ userId, identity: { name, bio: '', location: '' }, context: '' }`.

- [ ] **Step 2: Run projection tests and verify RED**

Add the new isolated test path to `services/api/.test-isolated`, then run:

```bash
cd services/api
bun run test:isolated
```

Expected: FAIL because the projection module does not exist.

- [ ] **Step 3: Implement the pure projection module**

Use canonical protocol helpers:

```ts
import { isActionableForViewer, safeFallbackSummary } from '@indexnetwork/protocol';

export function actionableRecipientIds(opportunity: OpportunityRow): string[] {
  return [...new Set(opportunity.actors.map(({ userId }) => userId))]
    .filter((userId) => isActionableForViewer(opportunity.actors, opportunity.status, userId));
}
```

Prefer a non-introducer actor when selecting a counterpart. Read display names from `identity.name`. Use the fixed headline `A promising connection`; never import the unexported `DEFAULT_FALLBACK_HEADLINE`.

- [ ] **Step 4: Run projection tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Write failing delivery/snapshot tests**

Inject fakes for:

```ts
questioner: Pick<QuestionerAdapter, 'getById' | 'findPending'>
opportunities: Pick<OpportunityDatabaseAdapter, 'getOpportunity' | 'getOpportunitiesForUser'>
getIdentity: (userId) => Promise<UserIdentity | null>
getIntentLabel: (intentId) => Promise<string | undefined>
publish: (userId, event) => Promise<void>
```

Prove realtime and snapshot projections return the same question/opportunity IDs and copy, pending acted recipients are excluded, and labels are bounded.

- [ ] **Step 6: Run delivery tests and verify RED**

Add the new isolated test path to `services/api/.test-isolated`, then run:

```bash
cd services/api
bun run test:isolated
```

Expected: FAIL because the service lacks injectable dependencies and `snapshot`.

- [ ] **Step 7: Implement delivery orchestration and main wiring**

Refactor the service around the injected boundary, add `snapshot(userId)`, and wire:

```ts
OpportunityEvents.onPending = ({ opportunity }) => uptakeQuestionService.handlePending(opportunity.id);
OpportunityEvents.onActionable = (payload) => notificationDeliveryService.publishOpportunityActionable(payload);
QuestionEvents.onCreated = (payload) => { void notificationDeliveryService.publishQuestionCreated(payload); };
```

Keep all event publishing best-effort and logged.

- [ ] **Step 8: Run projection/delivery tests and API typecheck**

```bash
cd services/api
bun run test:isolated
bunx tsc --noEmit
```

Expected: tests PASS; the six original TypeScript errors are gone.

- [ ] **Step 9: Commit the projection slice**

```bash
git add services/api/src/services/notification-* services/api/src/lib/notification-stream-events.ts services/api/src/main.ts
git commit -m "fix(api): project actionable desktop notifications"
```

---

### Task 3: Make stream and snapshot authorization fail closed

**Files:**
- Modify: `services/api/src/services/notification.service.ts`
- Modify: `services/api/src/controllers/notification.controller.ts`
- Modify: `services/api/src/main.ts`
- Delete: `services/api/src/controllers/tests/notification.controller.spec.ts`
- Create: `services/api/src/controllers/tests/notification.controller.isolated.ts`
- Create: `services/api/src/services/tests/notification.service.isolated.ts`
- Modify: `services/api/.test-isolated`

**Interfaces:**
- Produces: `NotificationService.open(userId): Promise<NotificationSubscription>`.
- `NotificationSubscription` provides `onMessage(handler)` and idempotent `cleanup()`.
- Produces: `GET /notifications/snapshot` returning `{ events: NotificationStreamEvent[] }`.

- [ ] **Step 1: Write failing service tests**

Inject a fake Redis subscriber and prove:

```ts
await expect(service.open('user-1')).rejects.toThrow('subscribe failed');
expect(disconnect).toHaveBeenCalledTimes(1);

const subscription = await service.open('user-1');
subscription.onMessage(handler);
emit('message', channel, '{"type":"question.new"}');
expect(handler).toHaveBeenCalled();
await subscription.cleanup();
await subscription.cleanup();
expect(disconnect).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run service tests and verify RED**

Add the new isolated test path to `services/api/.test-isolated`, then run:

```bash
cd services/api
bun run test:isolated
```

Expected: FAIL because `open` and injection do not exist.

- [ ] **Step 3: Implement awaited subscription readiness**

Attach the Redis listener, await `subscribe(channel)`, buffer messages until `onMessage` is registered, and disconnect on failed readiness or cleanup.

- [ ] **Step 4: Run service tests and verify GREEN**

Run Step 2. Expected: PASS.

- [ ] **Step 5: Write failing controller tests**

Inject `resolveNetworkScope` and a fake delivery service. Prove:

- non-null scope throws `ScopeViolationError` before `open`/`snapshot`;
- rejected `open` returns status 503 with no connected frame;
- successful open emits connected and cancellation cleans once;
- snapshot returns the delivery service events and rejects scoped keys.

- [ ] **Step 6: Run controller tests and verify RED**

Add `src/controllers/tests/notification.controller.isolated.ts` to `services/api/.test-isolated`, then run:

```bash
cd services/api
bun run test:isolated
```

Expected: FAIL because controller dependencies/snapshot/503 behavior do not exist.

- [ ] **Step 7: Implement controller scope/readiness/snapshot behavior**

Use `resolveAgentNetworkScope(req)`. Throw `ScopeViolationError` for scoped keys. Catch only subscription-establishment errors and return a 503 JSON response. Do not convert authorization errors to 503.

- [ ] **Step 8: Run controller/service tests and verify GREEN**

```bash
cd services/api
bun run test:isolated
```

Expected: PASS.

- [ ] **Step 9: Commit the stream boundary slice**

```bash
git add services/api/.test-isolated services/api/src/services/notification.service.ts services/api/src/services/tests/notification.service.isolated.ts services/api/src/controllers/notification.controller.ts services/api/src/controllers/tests/notification.controller.spec.ts services/api/src/controllers/tests/notification.controller.isolated.ts
git commit -m "fix(api): secure notification stream readiness"
```

---

### Task 4: Add authenticated Hermes WebSocket relays

**Files:**
- Modify: `packages/hermes-plugin/dashboard/plugin_api.py`
- Modify: `packages/hermes-plugin/tests/smoke.py`

**Interfaces:**
- Produces: `/notifications/socket`, `/conversations/socket`, `/notifications/snapshot` plugin routes.
- Produces: pure `parse_sse_data_line(line: bytes) -> dict[str, Any] | None`.
- Consumes: Index `/notifications/stream`, `/conversations/stream`, `/notifications/snapshot`.

- [ ] **Step 1: Write failing Python relay tests**

Extend smoke coverage with fake upstream responses and a fake async WebSocket proving valid `data:` JSON forwards, comments/malformed frames do not, disconnect closes the upstream response, and snapshot proxy preserves upstream errors.

- [ ] **Step 2: Run Hermes tests and verify RED**

```bash
cd packages/hermes-plugin
python3 tests/smoke.py
```

Expected: FAIL because WebSocket routes/helpers do not exist.

- [ ] **Step 3: Implement the relay helpers and routes**

Import `asyncio`, `WebSocket`, and `WebSocketDisconnect` with smoke-test fallbacks. Use `asyncio.to_thread` for blocking `urllib` open/read/close calls. Send parsed dictionaries with `websocket.send_json` and always close the upstream response in `finally`.

- [ ] **Step 4: Run Python tests and verify GREEN**

Run Step 2. Expected: PASS.

- [ ] **Step 5: Commit the bridge slice**

```bash
git add packages/hermes-plugin/dashboard/plugin_api.py packages/hermes-plugin/tests/smoke.py
git commit -m "fix(hermes): relay Index notifications through plugin sockets"
```

---

### Task 5: Implement native dedupe, sender suppression, and catch-up

**Files:**
- Create: `packages/hermes-plugin/desktop/notifications.mjs`
- Create: `packages/hermes-plugin/tests/desktop-notifications.mjs`
- Modify: `packages/hermes-plugin/desktop/build.mjs`
- Modify: `packages/hermes-plugin/desktop/tail.js`
- Modify: `packages/hermes-plugin/package.json`
- Modify: `packages/hermes-plugin/tests/smoke.py`
- Generate: `packages/hermes-plugin/desktop/dist/plugin.js`

**Interfaces:**
- Produces: `notificationEntityKey(event)`, `isOwnMessage(event, currentUserId)`, `composeNotification(event)`, and snapshot-delta helpers.
- Consumes: `ctx.socket`, `ctx.rest`, `ctx.storage`, `ctx.os.notify`.

- [ ] **Step 1: Write failing Node helper tests**

Cover:

```js
assert.equal(notificationEntityKey({ type: 'question.attention', questionId: 'q1' }), 'question:q1')
assert.equal(notificationEntityKey({ type: 'question.new', questionId: 'q1' }), 'question:q1')
assert.equal(isOwnMessage(messageFrom('user-1'), 'user-1'), true)
assert.equal(isOwnMessage(messageFrom('agent:user-1'), 'user-1'), true)
assert.deepEqual(firstSnapshot.notifications, [])
assert.deepEqual(nextSnapshot.notifications.map(notificationEntityKey), ['question:q2', 'opportunity:o2'])
```

- [ ] **Step 2: Run Node tests and verify RED**

```bash
cd packages/hermes-plugin
node tests/desktop-notifications.mjs
```

Expected: FAIL because `desktop/notifications.mjs` does not exist.

- [ ] **Step 3: Implement pure helpers**

Use store key `notifiedEntitiesV2`, canonical entity keys independent of realtime/catch-up event variant, a bounded 200-entry list, and pure first-baseline/delta functions. Unknown identity returns `true` from message suppression so no message alert is emitted.

- [ ] **Step 4: Run Node tests and verify GREEN**

Run Step 2. Expected: PASS.

- [ ] **Step 5: Write failing Desktop integration smoke assertions**

Require generated source to contain `ctx.socket`, `/notifications/socket`, `/conversations/socket`, `/notifications/snapshot`, and the 60-second interval; forbid raw `window.fetch` in the notification fragment and the old capped retry function.

- [ ] **Step 6: Run smoke and verify RED**

```bash
cd packages/hermes-plugin
python3 tests/smoke.py
```

Expected: FAIL until `tail.js` consumes the helpers and SDK doors.

- [ ] **Step 7: Implement native runtime and build composition**

Inline `notifications.mjs` before `tail.js` from `build.mjs`. At registration, resolve `/auth/status`, start both `ctx.socket` subscriptions, run immediate and 60-second snapshot reconciliation, share canonical dedupe, and dispose sockets/timer. Catch `ctx.os.notify` promise rejection without mutating dedupe twice.

- [ ] **Step 8: Regenerate and run Hermes tests**

```bash
cd packages/hermes-plugin
bun run build:desktop
bun run test
node --check desktop/tail.js
node --check desktop/dist/plugin.js
```

Expected: PASS and generated output matches source.

- [ ] **Step 9: Commit the Desktop slice**

```bash
git add packages/hermes-plugin/desktop packages/hermes-plugin/tests packages/hermes-plugin/package.json
git commit -m "fix(hermes): recover native desktop notifications"
```

---

### Task 6: Version, verify, push, and approve PR #1351

**Files:**
- Modify: `services/api/package.json`
- Modify: `packages/hermes-plugin/package.json`
- Modify: `packages/hermes-plugin/plugin.yaml`
- Modify: `packages/hermes-plugin/dashboard/manifest.json`
- Modify: `packages/hermes-plugin/dashboard/README.md`
- Modify: `packages/hermes-plugin/README.md`
- Generate: `bun.lock`
- Delete before final commit: `docs/superpowers/specs/2026-08-10-hermes-desktop-notification-reliability-design.md`
- Delete before final commit: `docs/superpowers/plans/2026-08-10-hermes-desktop-notification-reliability.md`

**Interfaces:**
- Produces: API version `0.79.0`, Hermes plugin version `0.18.0`, aligned generated metadata, and a verified/approved open PR.

- [ ] **Step 1: Update versions and documentation**

Set the exact versions above. Document SDK WebSocket realtime delivery, 60-second snapshot fallback, scoped-key rejection, and messages being realtime-only. Remove the temporary superpowers spec/plan as required by repository finishing policy.

- [ ] **Step 2: Regenerate lockfile and Desktop artifact**

```bash
cd /home/yanek/Projects/index/.worktrees/feat-hermes-desktop-sse-notifications
bun install
bun run --cwd packages/hermes-plugin build:desktop
```

- [ ] **Step 3: Run targeted verification**

```bash
cd services/api
bun run test:isolated
bun run build
bunx eslint src/events/opportunity.event.ts src/events/question.event.ts src/services/intent-recovery-refinement.service.ts src/services/notification-projection.ts src/services/notification-delivery.service.ts src/services/notification.service.ts src/controllers/notification.controller.ts src/main.ts
cd ../../packages/hermes-plugin
bun run test
bun run build:desktop
node --check desktop/tail.js
node --check desktop/dist/plugin.js
cd ../..
bun run check:subtree-parity
git diff --check
git status --short --branch
```

Expected: every command exits 0; only intended tracked changes exist.

- [ ] **Step 4: Independently review the final diff**

Run fresh-context deep and final reviewers against `origin/dev...HEAD`. Resolve every blocker/high finding with one writer and rerun affected validation.

- [ ] **Step 5: Commit release metadata and push**

```bash
git add -A
git commit -m "fix: make Hermes desktop notifications reliable"
git push origin feat/hermes-desktop-sse-notifications
git fetch origin feat/hermes-desktop-sse-notifications
git status --short --branch
```

Expected: clean and zero ahead/behind.

- [ ] **Step 6: Update PR evidence and verify checks**

Use the GitHub API/available forge tooling to update PR #1351's body with exact local evidence. Wait for required checks to reach terminal states; diagnose and fix failures rather than approving early.

- [ ] **Step 7: Approve the PR**

Submit an approving review only when the PR is open, non-draft, mergeable, required checks are green, no blocking review threads remain, versions are correct, and the final diff has no unresolved findings. Do not merge.
