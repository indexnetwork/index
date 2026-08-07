# Hermes Personal Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Index macOS Negotiator Agent selector durably route negotiation-only work to a local Hermes runtime, with owner consultation, heartbeat-based Index fallback, and safe disconnect/reconciliation.

**Architecture:** Keep the stable Personal Agent owner-scoped; represent Hermes as one external executor identified by `(ownerId, runtimeKind='hermes', installationId)`. A dedicated owner-control API prepares credentials and atomically selects Index or Hermes, while agent-bound polling routes require the exact selected principal. Hermes runs only four negotiation capabilities on a one-minute cron; Index macOS owns setup, health, escalation, and teardown.

**Tech Stack:** Bun/TypeScript, Drizzle/PostgreSQL, BullMQ, `@indexnetwork/protocol`, Python Hermes plugin, Swift/WKWebView macOS shell, React/JSX, Bun tests, Python smoke tests.

## Global Constraints

- Preserve one visible Personal Agent identity, memory, policy, and history across Index and Hermes execution.
- A Mac-provisioned Hermes principal receives exactly `manage:negotiations`; broad Index capabilities stay unavailable.
- Owner-control routes accept a Better Auth session or the Mac app's unbound owner credential; every agent-bound key is rejected.
- Polling routes require the exact selected agent-bound principal, not merely another credential owned by the same user.
- Use the existing 90-second negotiation-heartbeat freshness threshold and existing bounded park/claim fallback.
- External consultation must reuse the exact `input_required`/Questioner/expiry/continuation lifecycle and expose only `disclosureSubject` plus `draftQuestion`.
- `INDEX_PLUGIN_MODE=negotiator` registers only identity, pickup, response, consultation, and the negotiator skill; it installs no Index dashboard.
- Cron name: `Index Personal Agent Negotiator`; schedule: `every 1m`; prompt: `Use skill_view("index-network:index-negotiator") and run one scheduled autonomous Index negotiation pass.`
- Selecting Index pauses the owned cron but keeps Hermes connected; disconnect removes the owned cron, revokes executor credentials, and marks the executor inactive.
- Never render, log, journal, or return the Hermes agent credential after the transient bootstrap bridge transfer.
- Follow targeted validation only. Database-backed tests may run only with a proven dedicated disposable `DATABASE_URL` and `TEST_DATABASE_SAFE=1`.
- Before PR publication, delete this plan and its design spec, bump touched package versions, update changelogs/docs, regenerate `bun.lock`, and follow `manage-pr`.

---

## File Structure

### Backend runtime binding

- Modify `services/api/src/schemas/database.schema.ts` — typed Hermes installation and negotiation heartbeat columns plus partial unique indexes.
- Generate `services/api/drizzle/0119_add_hermes_runtime_binding.sql` and Drizzle metadata — migration/backfill/indexes.
- Modify `services/api/src/guards/auth.guard.ts` — owner-control guard that rejects agent-bound keys.
- Modify `services/api/src/adapters/agent.database.adapter.ts` — atomic installation preparation, binding selection, exact permission replacement, health reads, negotiation heartbeat.
- Create `services/api/src/services/agent-runtime.service.ts` — owner-facing orchestration and DTO calculation.
- Create `services/api/src/controllers/agent-runtime.controller.ts` — prepare/read/select/disconnect routes.
- Modify `services/api/src/main.ts` — controller registration.
- Modify `services/api/src/services/agent-dispatcher.service.ts` — shared freshness helper and selected negotiation heartbeat.
- Modify `services/api/src/controllers/agent.controller.ts` and `services/api/src/services/agent.service.ts` — principal binding, generic key-management hardening, and atomic negotiation selection compatibility.
- Create `services/api/tests/agent-runtime.service.spec.ts` and `services/api/src/controllers/tests/agent-runtime.controller.spec.ts`.
- Update `services/api/src/controllers/tests/agent.controller.heartbeat.spec.ts`, `services/api/src/services/tests/agent-dispatcher.spec.ts`, and `services/api/tests/agent.service.spec.ts`.

### External consultation and claim safety

- Create `services/api/src/services/negotiation-consultation.service.ts` — shared polling eligibility/admission coordinator over existing adapters/queues.
- Modify `services/api/src/services/negotiation-polling.service.ts` — exact agent CAS, `canConsultOwner`, and consult method.
- Modify `services/api/src/controllers/agent.controller.ts` — strict consult endpoint.
- Modify `services/api/src/adapters/conversation.database.adapter.ts` — claimed-to-working CAS must include agent ID.
- Create `services/api/src/services/tests/negotiation-polling.consult.isolated.ts`.
- Update `services/api/src/services/tests/negotiation-polling.seat.isolated.ts` and `docs/specs/api-reference.md`.

### Hermes plugin

- Modify `packages/hermes-plugin/__init__.py`, `schemas.py`, `tools.py`, and `plugin.yaml` — mode gating and consultation capability.
- Modify `packages/protocol/skills/hermes-plugin/index-negotiator.template.md` — allowed-actions/v2/consultation contract.
- Regenerate `packages/hermes-plugin/skills/index-negotiator/SKILL.md`.
- Modify `packages/hermes-plugin/tests/smoke.py` and `packages/hermes-plugin/README.md`.

### macOS native and web layers

- Create `apps/mac/IndexApp/Sources/HermesRuntime.swift` — installation store, command runner, env/plugin/cron reconciliation.
- Modify `apps/mac/IndexApp/Sources/main.swift` and `apps/mac/IndexApp/build.sh` — request-correlated bridge and runtime manager integration.
- Create `apps/mac/IndexApp/hermes-runtime.spec.mjs` — source-level native contract checks usable off macOS.
- Create `apps/mac/api/agent-runtime.mjs` and `apps/mac/api/agent-runtime.spec.mjs` — pure visual-state mapper.
- Modify `apps/mac/api/client.mjs` and `apps/mac/api/client.spec.mjs` — runtime-control endpoints.
- Modify `apps/mac/IndexApp/src/index-amiga/api.jsx` — request-correlated native bridge.
- Modify `apps/mac/IndexApp/src/index-amiga/agents.jsx` — durable setup/select/health/disconnect flow.
- Modify `apps/mac/IndexApp/assemble.py` and regenerate `apps/mac/IndexApp/Resources/index.html`.

---

### Task 1: Persist and authorize the Hermes runtime binding

**Files:**
- Modify: `services/api/src/schemas/database.schema.ts`
- Create: `services/api/drizzle/0119_add_hermes_runtime_binding.sql`
- Modify: `services/api/drizzle/meta/_journal.json`
- Create/modify generated snapshot: `services/api/drizzle/meta/0119_snapshot.json`
- Modify: `services/api/src/guards/auth.guard.ts`
- Modify: `services/api/src/adapters/agent.database.adapter.ts`
- Create: `services/api/src/services/agent-runtime.service.ts`
- Create: `services/api/src/controllers/agent-runtime.controller.ts`
- Modify: `services/api/src/main.ts`
- Modify: `services/api/src/services/agent-dispatcher.service.ts`
- Modify: `services/api/src/controllers/agent.controller.ts`
- Modify: `services/api/src/services/agent.service.ts`
- Create: `services/api/tests/agent-runtime.service.spec.ts`
- Create: `services/api/src/controllers/tests/agent-runtime.controller.spec.ts`
- Test: `services/api/src/controllers/tests/agent.controller.heartbeat.spec.ts`
- Test: `services/api/src/services/tests/agent-dispatcher.spec.ts`
- Test: `services/api/tests/agent.service.spec.ts`

**Interfaces:**
- Produces:

```ts
export const NEGOTIATION_EXECUTOR_FRESHNESS_MS = 90_000;

export type NegotiationRuntimeView = {
  selectedRuntime: 'index' | 'hermes';
  executor: null | {
    id: string;
    installationId: string;
    status: 'active' | 'inactive';
    lastNegotiationPickupAt: string | null;
  };
  health: 'active' | 'stale' | 'never-seen';
  indexCovering: boolean;
  freshnessThresholdMs: number;
};

export type PrepareHermesRuntimeResult = {
  binding: NegotiationRuntimeView;
  executorId: string;
  credential: { id: string; key: string };
};
```

- Routes:

```text
GET    /api/agent-runtime?installationId=<uuid>
POST   /api/agent-runtime/hermes/prepare  { installationId, setupAttemptId }
PUT    /api/agent-runtime                 { runtime:'index' } | { runtime:'hermes', installationId, executorId }
DELETE /api/agent-runtime/hermes/:installationId
```

- Adapter operations:

```ts
ensureHermesInstallation(input: { ownerId: string; installationId: string }): Promise<AgentWithRelations>;
setNegotiationExecutorBinding(input: { ownerId: string; targetAgentId: string | null; exactTargetPermissions: boolean }): Promise<AgentWithRelations | null>;
getNegotiationExecutorBinding(ownerId: string): Promise<AgentWithRelations | null>;
touchNegotiationPickup(agentId: string): Promise<void>;
```

- Consumes: existing `AgentTokenStore.revokeAllForAgent()` and `create()`.

- [ ] **Step 1: Capture the baseline**

Run:

```bash
cd services/api
bun test tests/agent.service.spec.ts src/controllers/tests/agent.controller.heartbeat.spec.ts src/services/tests/agent-dispatcher.spec.ts
```

Expected: PASS. Record any pre-existing failure before editing.

- [ ] **Step 2: Write failing service and controller tests**

Cover these exact assertions:

```ts
expect((await service.prepareHermes(ownerId, installationId, setupAttemptId)).executorId).toBe(agentId);
expect(store.createdAgents).toHaveLength(1); // repeat prepare reuses
expect(store.globalActions(agentId)).toEqual(['manage:negotiations']);
expect((await service.setRuntime(ownerId, { runtime: 'index' })).selectedRuntime).toBe('index');
expect(store.enabledNegotiators(ownerId)).toEqual([]);
expect(await ownerControlGuard(agentBoundRequest)).rejects.toThrow('owner credential');
```

Controller tests must prove an unbound owner key and JWT session are accepted while an agent-bound key is rejected.

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```bash
cd services/api
bun test tests/agent-runtime.service.spec.ts src/controllers/tests/agent-runtime.controller.spec.ts
```

Expected: FAIL because the service, controller, routes, and guard do not exist.

- [ ] **Step 4: Add typed columns and migration**

Add to `agents`:

```ts
runtimeKind: text('runtime_kind').$type<'hermes' | null>(),
installationId: text('installation_id'),
lastNegotiationPickupAt: timestamp('last_negotiation_pickup_at', { withTimezone: true }),
```

Add partial unique indexes for `(ownerId, runtimeKind, installationId)` on live external Hermes rows and one live external `handleNegotiations=true` row per owner. Generate with `bun run db:generate`, rename the SQL to `0119_add_hermes_runtime_binding.sql`, and update `_journal.json`. Before creating the selected-executor index, deterministically retain the most recently updated selected row per owner and set duplicate `handle_negotiations=false`; do not infer installation IDs from names.

- [ ] **Step 5: Implement the owner-control guard**

Add `OwnerControlGuard` that delegates authentication to `AuthGuard`, then rejects request auth context `{kind:'api_key', agentId:string}`. It accepts sessions and unbound owner keys. Apply it to all new runtime-control routes and replace generic agent token-create/delete guards where an agent-bound key could mint successors or delete an executor.

- [ ] **Step 6: Implement atomic adapter operations**

Inside one transaction, use an owner-scoped advisory lock, validate the target Hermes installation, remove `manage:negotiations` from every other owned external permission row, clear every other `handleNegotiations`, replace the target's permissions with one global `['manage:negotiations']` row when `exactTargetPermissions=true`, and set the target active/selected. Index selection clears external negotiation authority but leaves the executor and tokens connected.

- [ ] **Step 7: Implement service/controller and health DTO**

`prepareHermes()` must create/reuse an inactive exact installation, revoke its old tokens, mint one new credential, and return it once. `disconnectHermes()` must select Index first, revoke all installation tokens, and mark the executor inactive. Health uses server time and `lastNegotiationPickupAt`, never `lastSeenAt`.

- [ ] **Step 8: Bind polling principal and negotiation heartbeat**

Pickup/respond must compare `resolveApiKeyAgentId(req)` to `params.id`, require selected active external Hermes plus `manage:negotiations`, and reject sessions/unbound/wrong-agent keys. `GET /agents/me` remains available before activation. An authorized empty pickup touches `lastNegotiationPickupAt`; unrelated pickup endpoints continue touching only `lastSeenAt`.

- [ ] **Step 9: Update dispatcher and generic selection path**

Export the shared 90-second constant/helper. Dispatcher filters `handleNegotiations=true` and uses `lastNegotiationPickupAt`. Route generic `handleNegotiations` updates through the same single-executor transaction so the old endpoint cannot violate uniqueness.

- [ ] **Step 10: Run focused verification**

Run:

```bash
cd services/api
bun test tests/agent-runtime.service.spec.ts src/controllers/tests/agent-runtime.controller.spec.ts src/controllers/tests/agent.controller.heartbeat.spec.ts src/services/tests/agent-dispatcher.spec.ts tests/agent.service.spec.ts
bun run build
bun run lint
bun run db:generate
```

Expected: all tests/build/lint PASS; final `db:generate` reports no schema changes.

- [ ] **Step 11: Commit**

```bash
git add services/api
git commit -m "feat(api): add Hermes negotiation runtime binding"
```

---

### Task 2: Add safe external owner consultation and exact claim CAS

**Files:**
- Create: `services/api/src/services/negotiation-consultation.service.ts`
- Modify: `services/api/src/services/negotiation-polling.service.ts`
- Modify: `services/api/src/controllers/agent.controller.ts`
- Modify: `services/api/src/adapters/conversation.database.adapter.ts`
- Create: `services/api/src/services/tests/negotiation-polling.consult.isolated.ts`
- Modify: `services/api/src/services/tests/negotiation-polling.seat.isolated.ts`
- Modify: `docs/specs/api-reference.md`

**Interfaces:**
- Produces:

```ts
export type ConsultNegotiationInput = {
  disclosureSubject: string;
  draftQuestion?: string;
};

export type ConsultNegotiationResult = {
  success: true;
  status: 'input_required';
  settlementId: string;
};

NegotiationPollingService.consult(
  agentId: string,
  userId: string,
  negotiationId: string,
  input: ConsultNegotiationInput,
): Promise<ConsultNegotiationResult>;
```

- Extends `PickupResult` with `canConsultOwner: boolean`.
- Changes claimed transition to:

```ts
transitionClaimedTaskToWorking(
  taskId: string,
  claimedByAgentId: string,
  continuationExecution?: NegotiationContinuationExecution,
): Promise<Task | null>;
```

The SQL CAS must include task ID, `state='claimed'`, and `claimed_by_agent_id` before changing state.

- [ ] **Step 1: Write failing claim and consultation tests**

Tests must prove:

```ts
expect(await pickup()).toMatchObject({ canConsultOwner: true });
await expect(service.consult(otherAgentId, ownerId, taskId, safeInput)).rejects.toBeInstanceOf(ConflictError);
await expect(service.consult(agentId, ownerId, taskId, unsafeInput)).rejects.toBeInstanceOf(SeatViolationError);
expect(task.state).toBe('claimed'); // rejected consult preserves claim
expect(success.status).toBe('input_required');
expect(questionerPayload.context).not.toContain(counterpartyName);
```

Also cover v1, opening turn, final turn, prior same-seat consultation, disabled Questioner/expiry wiring, wrong owner, duplicate call, queue failure with expiry recovery, and respond-from-wrong-agent not consuming the claim.

- [ ] **Step 2: Run tests and verify RED**

```bash
cd services/api
bun test src/services/tests/negotiation-polling.consult.isolated.ts src/services/tests/negotiation-polling.seat.isolated.ts
```

Expected: FAIL on missing consult API and current state-only CAS.

- [ ] **Step 3: Fix claimed-to-working CAS at the adapter boundary**

Move agent identity into the SQL predicate; remove the current post-transition ownership check as the security boundary. Preserve continuation-fence predicates.

- [ ] **Step 4: Implement one eligibility function used by pickup and consult**

Return true only for v2, non-opening, non-final turns with exact opportunity/intent/network coordinates, enabled ask-user/Questioner/expiry wiring, no same-seat prior `ask_user`, and a current claim. Do not duplicate the predicate between response construction and admission.

- [ ] **Step 5: Implement consultation admission**

Reuse `validateInflightAskUserFields`, `negotiationQuestionSettlementId`, `captureNegotiationAskUserBinding`, `askUserAnswerWindowMs`, `negotiationTimeoutQueue.enqueueAskUserExpiry`, `questionerEnqueueIfEnabled`, and the existing `negotiation_inflight` payload. Persist a server-authored `ask_user` turn with roles projected from the preceding turn; cancel the claim timeout, enter `input_required`, and return the settlement ID. On unsafe/ineligible input, do not consume the claim.

- [ ] **Step 6: Add strict controller schema and route**

```ts
const consultNegotiationSchema = z.object({
  disclosureSubject: z.string().trim().min(1),
  draftQuestion: z.string().trim().min(1).optional(),
}).strict();
```

Register `POST /agents/:id/negotiations/:negotiationId/consult` under the same exact bound-principal requirement as pickup/respond. Remove `ask_user` from the ordinary respond schema.

- [ ] **Step 7: Document the public contract**

Update pickup (`canConsultOwner`) and consult request/response/error semantics in `docs/specs/api-reference.md`, including that rejected consultation preserves the original claim/deadline.

- [ ] **Step 8: Verify**

```bash
cd services/api
bun test src/services/tests/negotiation-polling.consult.isolated.ts src/services/tests/negotiation-polling.seat.isolated.ts src/services/tests/negotiation-polling.remaining-budget.spec.ts src/controllers/tests/agent.controller.heartbeat.spec.ts
bun run build
bun run lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/api docs/specs/api-reference.md
git commit -m "feat(api): let external negotiators consult owners"
```

---

### Task 3: Add Hermes negotiator mode and v2-safe scheduled guidance

**Files:**
- Modify: `packages/hermes-plugin/__init__.py`
- Modify: `packages/hermes-plugin/schemas.py`
- Modify: `packages/hermes-plugin/tools.py`
- Modify: `packages/hermes-plugin/plugin.yaml`
- Modify: `packages/hermes-plugin/tests/smoke.py`
- Modify: `packages/hermes-plugin/README.md`
- Modify: `packages/protocol/skills/hermes-plugin/index-negotiator.template.md`
- Generate: `packages/hermes-plugin/skills/index-negotiator/SKILL.md`
- Test: `scripts/tests/build-skills.spec.ts`

**Interfaces:**
- Environment: `INDEX_PLUGIN_MODE=full|negotiator`; missing means `full`; unknown non-empty values fail closed to `negotiator`.
- Negotiator-mode tools:

```text
index_agent_me
index_pickup_negotiation
index_respond_negotiation
index_consult_owner
```

- Handler:

```python
def index_consult_owner(args: dict, **kwargs) -> str
```

It resolves optional `agentId`, requires `negotiationId` and `disclosureSubject`, accepts optional `draftQuestion`, and forwards only those two body fields.

- [ ] **Step 1: Add failing mode/v2/consult smoke assertions**

Create a full-mode context and a negotiator-mode context. Assert exact tool sets, one skill, no hook/command/dashboard copy in negotiator mode, 204 pickup preservation, v2 action union, and strict consult body filtering.

- [ ] **Step 2: Run smoke test and verify RED**

```bash
cd packages/hermes-plugin
bun run test
```

Expected: FAIL because mode/consult/v2 support is missing.

- [ ] **Step 3: Implement mode-gated registration**

`register(ctx)` must skip `_install_desktop_plugin`, broad wrappers, `index_open_app`, hook, command, and orchestrator skill in negotiator mode. Remove a stale copied `~/.hermes/desktop-plugins/index-network` directory best-effort. Keep default full registration backward-compatible. The static manifest remains the package capability union; actual registered handlers are the runtime authorization surface.

- [ ] **Step 4: Implement consultation and v2 action union**

Allow `propose|accept|reject|counter|question|outreach|withdraw|decline`; never send `ask_user` through response. Add `index_consult_owner` and explicitly reconstruct the two-field body.

- [ ] **Step 5: Rewrite scheduled skill contract**

The template must select one action verbatim from pickup `allowedActions`, inspect `protocolVersion`, `seat`, `deadline`, and `canConsultOwner`, call consult only when eligible, stop after successful consultation, and retain exact `[SILENT]` for no work. It must submit at most one response or consultation per pass.

- [ ] **Step 6: Regenerate skills and update docs**

```bash
bun run build:skills
```

Document negotiator mode, consultation, cron name/schedule/prompt, full-mode compatibility, and no dashboard in negotiator mode.

- [ ] **Step 7: Verify**

```bash
bun run build:skills
bun test scripts/tests/build-skills.spec.ts
cd packages/hermes-plugin && bun run test
```

Expected: PASS with no generated diff after the second skill build.

- [ ] **Step 8: Commit**

```bash
git add packages/hermes-plugin packages/protocol/skills/hermes-plugin scripts/tests/build-skills.spec.ts
git commit -m "feat(hermes): add negotiation-only runtime mode"
```

---

### Task 4: Reconcile local Hermes installation and cron from the native shell

**Files:**
- Create: `apps/mac/IndexApp/Sources/HermesRuntime.swift`
- Modify: `apps/mac/IndexApp/Sources/main.swift`
- Modify: `apps/mac/IndexApp/build.sh`
- Create: `apps/mac/IndexApp/hermes-runtime.spec.mjs`

**Interfaces:**

```swift
enum HermesRuntimeCommand: String {
    case inspect, configureDisabled, enable, disable, disconnect
}

struct HermesRuntimeRequest: Decodable {
    let requestId: String
    let command: HermesRuntimeCommand
    let installationId: String?
    let executorId: String?
    let credential: String?
}

struct HermesRuntimeResult: Encodable {
    let requestId: String
    let ok: Bool
    let stage: String
    let state: HermesLocalState?
    let errorCode: String?
    let retryable: Bool
}
```

The owned cron uses exact name `Index Personal Agent Negotiator`. Reconciliation uses documented Hermes CLI commands `cron create`, `cron edit`, `cron pause`, `cron resume`, and `cron remove`; name lookup is case-insensitive and refuses ambiguity.

- [ ] **Step 1: Write failing source-contract tests**

The test reads the Swift sources and asserts the request ID round trip, installation ID persistence, `INDEX_PLUGIN_MODE=negotiator`, exact cron schedule/prompt/name, pause/resume/remove commands, stable error codes, no credential in callback state, and build inclusion of `HermesRuntime.swift`.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mac/IndexApp
bun test hermes-runtime.spec.mjs
```

Expected: FAIL because the runtime manager does not exist.

- [ ] **Step 3: Extract command runner and installation store**

Persist a non-secret UUID under the app's Application Support directory, preserve it across select/disconnect, and use it only as identity—not authorization. Keep command execution off the main thread and return stable error codes without third-party output.

- [ ] **Step 4: Implement disabled setup reconciliation**

Upsert `INDEX_API_KEY`, `INDEX_API_URL`, `INDEX_MCP_URL`, `INDEX_AGENT_ID`, `INDEX_INSTALLATION_ID`, and `INDEX_PLUGIN_MODE=negotiator` with `0600`; install/enable the plugin; remove stale Desktop dashboard copy; reconcile exactly one owned cron and pause it. Repeated setup edits/reuses the named job and fails closed on ambiguous duplicates.

- [ ] **Step 5: Implement enable/disable/disconnect**

Enable resumes the job and starts/restarts the gateway; failure is returned. Disable pauses the job without removing credentials/plugin. Disconnect pauses/removes only the exact owned job, removes Index env keys and plugin/dashboard wiring, and never deletes unrelated Hermes jobs/configuration.

- [ ] **Step 6: Implement request-correlated native bridge**

Replace the uncorrelated setup/teardown callbacks with `hermesRuntime` messages and `window.__indexHermesRuntimeResult(...)`. Never echo the credential in callbacks, logs, journals, or errors.

- [ ] **Step 7: Verify non-macOS contracts**

```bash
cd apps/mac/IndexApp
bun test hermes-runtime.spec.mjs
python3 assemble.py
bash -n build.sh dev.sh
```

Expected: PASS. The GitHub macOS build remains the authoritative Swift compile check.

- [ ] **Step 8: Commit**

```bash
git add apps/mac/IndexApp
git commit -m "feat(mac): manage local Hermes negotiation runtime"
```

---

### Task 5: Wire the durable macOS Negotiator selector and finish the release surface

**Files:**
- Create: `apps/mac/api/agent-runtime.mjs`
- Create: `apps/mac/api/agent-runtime.spec.mjs`
- Modify: `apps/mac/api/client.mjs`
- Modify: `apps/mac/api/client.spec.mjs`
- Modify: `apps/mac/IndexApp/src/index-amiga/api.jsx`
- Modify: `apps/mac/IndexApp/src/index-amiga/agents.jsx`
- Modify: `apps/mac/IndexApp/assemble.py`
- Generate: `apps/mac/IndexApp/Resources/index.html`
- Modify: `apps/mac/README.md`
- Modify: `packages/hermes-plugin/README.md`
- Modify: `docs/design/architecture-overview.md`
- Modify: `docs/design/protocol-deep-dive.md`
- Modify: `docs/domain/negotiation.md`
- Modify: `services/api/CHANGELOG.md`
- Modify: `packages/protocol/CHANGELOG.md`
- Modify: package versions and `bun.lock`
- Delete before PR: `docs/superpowers/specs/2026-08-07-hermes-personal-agent-runtime-design.md`
- Delete before PR: `docs/superpowers/plans/2026-08-07-hermes-personal-agent-runtime.md`

**Interfaces:**

```js
mapAgentRuntimeState({ binding, localState, operation }) => ({
  selectorValue: 'index' | 'hermes',
  visualState: 'index' | 'connecting' | 'active' | 'unavailable' | 'needs-attention',
  statusLine: String,
  canRetry: Boolean,
  canDisconnect: Boolean,
});

hermesRuntime(command, payload?) => Promise<HermesRuntimeResult>;
```

State precedence: in-flight operation; reconciliation failure/mismatch; Index selected; Hermes active; Hermes stale/never-seen with Index covering.

- [ ] **Step 1: Write failing API and state-mapper tests**

Test all endpoint paths/bodies and each visual state. Explicitly prove Index-selected-but-connected Hermes remains selectable, stale Hermes says Index is covering, installation mismatch needs attention, and JSX does not calculate freshness.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mac
bun test api/client.spec.mjs api/agent-runtime.spec.mjs
```

Expected: FAIL on missing client methods and mapper.

- [ ] **Step 3: Implement client and pure mapper**

Add `getRuntimeBinding`, `prepareHermesRuntime`, `setRuntimeBinding`, and `disconnectHermesRuntime`. Export/inject the mapper through `assemble.py`.

- [ ] **Step 4: Implement correlated JS bridge**

Store waiters by `requestId`, apply a bounded timeout, and expose `inspect|configureDisabled|enable|disable|disconnect`. The credential exists only in the transient prepare result and one bridge message; never put it in React state or callback output.

- [ ] **Step 5: Implement the setup/select saga in `agents.jsx`**

For Hermes selection: prepare server runtime; configure disabled locally; activate server binding; enable local schedule/gateway; refresh until server reports active within the 90-second window; otherwise disable locally and select Index. For Index selection: select Index, then disable schedule while retaining connection. On relaunch: inspect local state and server binding, fail safe to Index on partial mismatch, and expose retry. Disconnect: select Index/revoke server first, then local cleanup.

- [ ] **Step 6: Replace local-only controls and copy**

Remove local-only permission toggles for Hermes and show a fixed `negotiations only` authority statement. Wire Disconnect. Render `connecting`, `active`, `unavailable — Index is covering`, and `needs attention` from the pure mapper. Do not claim a last handled turn without backend attribution evidence.

- [ ] **Step 7: Regenerate and verify Mac assets**

```bash
cd apps/mac
bun test api/
cd IndexApp
python3 assemble.py
bun test deep-link-host.spec.mjs link-host.spec.mjs notarize.spec.mjs provisioning-profile.spec.mjs hermes-runtime.spec.mjs
git status --short Resources/index.html
```

The generated resource must be staged; the final verification reruns assembly and requires no diff.

- [ ] **Step 8: Update architecture/domain/public docs**

Document stable persona versus executor binding, exact owner/poller auth boundaries, negotiation-specific heartbeat/fallback, consultation endpoint, Hermes negotiator mode, cron lifecycle, and select-versus-disconnect behavior.

- [ ] **Step 9: Version and changelog**

Apply minor bumps for feature-touched `services/api`, `packages/protocol`, and `packages/hermes-plugin`; keep `package.json`, plugin manifest/dashboard version, and root `bun.lock` synchronized. Add user-facing changelog entries.

- [ ] **Step 10: Delete planning artifacts**

Delete the approved design and implementation plan per repository finishing policy. Their durable design content now lives in architecture/domain/API/package docs.

- [ ] **Step 11: Run final targeted verification**

```bash
bun run build:skills
bun test scripts/tests/build-skills.spec.ts
bun run check:subtree-parity

cd packages/hermes-plugin && bun run test
cd ../../services/api && bun test tests/agent-runtime.service.spec.ts src/controllers/tests/agent-runtime.controller.spec.ts src/controllers/tests/agent.controller.heartbeat.spec.ts src/services/tests/agent-dispatcher.spec.ts src/services/tests/negotiation-polling.consult.isolated.ts src/services/tests/negotiation-polling.seat.isolated.ts
bun run build
bun run lint

cd ../../apps/mac && bun test api/
cd IndexApp && python3 assemble.py && git diff --exit-code -- Resources/index.html
bun test deep-link-host.spec.mjs link-host.spec.mjs notarize.spec.mjs provisioning-profile.spec.mjs hermes-runtime.spec.mjs
```

Also run repository static checks applicable to the final diff:

```bash
bun run lint
bun run build:package:protocol
bun run build:api
```

Expected: every command PASS; no generated drift; no database-backed command unless its safety gate is proven.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: let Hermes carry the Personal Agent negotiator"
```

---

## PR and Review Gate

- [ ] Rebase/merge `origin/dev` only if needed from this feature worktree; resolve conflicts without touching canonical root.
- [ ] Inspect `git diff origin/dev...HEAD`, run `git diff --check`, and verify no secrets or local runtime files are tracked.
- [ ] Push the semantic branch, fetch it back, and prove no ahead/behind drift.
- [ ] Open a PR into `dev` with changelog sections for Features, Security, Documentation, and Tests.
- [ ] Use `manage-pr` to snapshot the PR, inspect checks, request Copilot review, resolve every conversation, apply accepted fixes through the same worktree, rerun affected validation, and request re-review when warranted.
- [ ] Stop only when the PR is published, all required checks are green, and independent reviews have no unresolved blocking findings. Do not merge without separate explicit authorization.
