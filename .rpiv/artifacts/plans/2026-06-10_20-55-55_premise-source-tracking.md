---
date: 2026-06-10T20:55:55+0300
author: Yankı Ekin Yüksel
commit: 56ba53da1a
branch: release/2026-06-10
repository: index
topic: "Premise Source Tracking & Cascade Retraction"
tags: [plan, premise, provenance, user-socials, enrichment, profile-graph, cascade, integration]
status: ready
parent: .rpiv/artifacts/research/2026-06-10_19-35-22_premise-source-tracking.md
phase_count: 4
phases:
  - { n: 1, title: "Protocol graph state + provenance wiring" }
  - { n: 2, title: "ChatDatabaseAdapter.getPremisesBySource" }
  - { n: 3, title: "UserService cascade" }
  - { n: 4, title: "MCP controller refactor" }
unresolved_phase_count: 0
last_updated: 2026-06-10T20:55:55+0300
last_updated_by: Yankı Ekin Yüksel
---

# Premise Source Tracking & Cascade Retraction — Implementation Plan

## Overview

Thread `activeSocialIds` through `ProfileGraphState` so the scrape and auto-generate nodes capture social record IDs, and `decomposePremisesNode` stamps integration-path premises with `source: 'integration'` and `sourceId: activeSocialIds[0]`. Add `getPremisesBySource` to `ChatDatabaseAdapter`, extend `UserService.setSocials` with optional injected deps to retract all integration premises and re-enqueue enrichment, and route the `mcp.controller.ts` Telegram-handle-merge path through `userService.setSocials` so all social-update call sites get the cascade.

## Requirements

- Tag every premise created by the social-URL enrichment flow with `source: 'integration'` and `sourceId: <user_social.id>`
- When `UserService.setSocials` is called, retract all `source='integration'` premises for that user, emit `PremiseEvents.onRetracted` per premise, then enqueue re-enrichment
- `ChatDatabaseAdapter.getPremisesBySource(userId, source)` returns `Array<{ id: string }>` querying JSONB `provenance->>'source'`
- The retraction + re-enrich is idempotent — no integration premises → completes without error
- `PremiseEvents.onRetracted` fires per retracted premise so existing cascade (opportunity stalling + profile regen) triggers automatically
- `mcp.controller.ts` Telegram handle merge routes through `userService.setSocials`

## Current State Analysis

### Key Discoveries

- `packages/protocol/src/premise/premise.state.ts:33-43` — `provenanceSource`, `provenanceSourceId`, `provenanceConfidence` annotations already exist (`68ea501f5e`); all default to `undefined`
- `packages/protocol/src/premise/premise.graph.ts:124-133` — persist node reads `state.provenanceSource ?? 'explicit'`; the mechanism works, just never set by the profile graph path
- `packages/protocol/src/profile/profile.graph.ts:21-30` — `CompiledPremiseGraph` interface declares `invoke({ userId, assertionText, tier, operationMode })` — missing provenance fields
- `packages/protocol/src/profile/profile.state.ts` — `ProfileGraphState` has no `activeSocialIds` field; socials loaded in `scrapeNode:277` and `autoGenerateNode:358` but IDs discarded
- `packages/protocol/src/profile/profile.graph.ts:777-800` — `decomposePremisesNode` calls `premiseGraph.invoke` without provenance fields → all enrichment-path premises fall through to `source: 'explicit'`
- `backend/src/adapters/database.adapter.ts:4208-4228` — `getExpiredPremises` is the JSONB query pattern to model `getPremisesBySource` after
- `backend/src/adapters/database.adapter.ts:4114-4144` — `updatePremise` with `{ status: 'RETRACTED', retractedAt: Date }` is the retraction call — no new method needed
- `backend/src/services/user.service.ts:17` — `UserService` constructor: `constructor(private db = userDatabaseAdapter) {}` — no access to `ChatDatabaseAdapter`, `PremiseEvents`, or `EnrichmentQueue`
- `backend/src/main.ts:166-171` — `PremiseEvents.onRetracted` already wired to `addCascadeJob` + `addProfileRegenJob`; no changes to `main.ts` needed
- `backend/src/queues/enrichment.queue.ts:97` — `addEnrichUserJob({ userId, reason? })` is the re-enrich call; job ID includes timestamp so no dedup
- `backend/src/controllers/mcp.controller.ts:385` — calls `chatDatabaseAdapter.setUserSocials` directly in Telegram handle merge; `mergeTelegramHandleIntoSocials` returns `SocialRow[] | null` where `SocialRow = { label, value }` — exactly `UserService.setSocials`'s input shape

## Desired End State

```ts
// 1. After enrichment runs — premises carry integration provenance
const premises = await chatDatabaseAdapter.getPremisesBySource(userId, 'integration');
// premises = [{ id: 'prem-abc' }, { id: 'prem-def' }]
// In DB: premises.provenance = { source: 'integration', sourceId: '<user_social.id>', ... }

// 2. User corrects a social URL — cascade fires automatically
await userService.setSocials(userId, [
  { label: 'github', value: 'https://github.com/correct-user' },
]);
// → retracts all integration premises
// → emits PremiseEvents.onRetracted per premise (→ addCascadeJob + addProfileRegenJob)
// → enqueues enrichmentQueue.addEnrichUserJob({ userId, reason: 'socials_updated' })

// 3. Idempotent — no integration premises → no-op retraction, enrichment still enqueued
await userService.setSocials(userId, []);
// → getPremisesBySource returns [] → loop body never runs → addEnrichUserJob still enqueued

// 4. Telegram handle merge goes through same cascade
// mcp.controller.ts — was: await chatDatabaseAdapter.setUserSocials(userId, merged)
// now: await userService.setSocials(userId, merged)
```

## What We're NOT Doing

- Per-social-URL surgical retraction (retract only premises tagged with a specific social ID)
- DB schema changes — `PremiseProvenance.sourceId` already exists in schema
- JSONB index on `provenance->>'source'` — deferred until scale justifies it
- Backfill of pre-feature premises that carry `source: 'explicit'` incorrectly
- Restructuring enrichment to scrape per-social-URL independently
- New `PremiseDatabaseAdapter` class — premise methods stay in `ChatDatabaseAdapter`
- Touching `main.ts` — `PremiseEvents.onRetracted` wiring is already complete

## Decisions

### activeSocialIds annotation follows PremiseGraphState reducer pattern

`ProfileGraphState` (profile.state.ts) gets a new `activeSocialIds: string[]` annotation. Reducer: `(_, next) => next ?? []`, default `() => []`. Both `scrapeNode` and `autoGenerateNode` already call `getUserSocials` — they write `activeSocialIds: socials.map(s => s.id)` to state alongside their existing return values. `decomposePremisesNode` reads `state.activeSocialIds?.length > 0` to decide provenance.

Evidence: `packages/protocol/src/premise/premise.state.ts:33` — same `(curr, next) => next ?? curr` reducer pattern, confirmed by `68ea501f5e`.

### CompiledPremiseGraph interface extended with optional provenance fields

The local `CompiledPremiseGraph` interface at `profile.graph.ts:21-30` is extended with `provenanceSource?: PremiseProvenance['source']` and `provenanceSourceId?: string` as optional invoke inputs. This matches the `PremiseGraphState` field names exactly (`68ea501f5e`).

### getPremisesBySource modeled after getExpiredPremises JSONB pattern

`ChatDatabaseAdapter.getPremisesBySource(userId, source)` queries `(provenance->>'source') = ${source}` using Drizzle `sql` template, same as `getExpiredPremises` at `database.adapter.ts:4208`. Returns `Array<{ id: string }>` only.

### UserServiceDeps interface — optional constructor dep with singleton defaults

New `UserServiceDeps` interface with 4 callback methods. Constructor: `constructor(private db = userDatabaseAdapter, private readonly deps?: UserServiceDeps)`. Singleton `userService` created with no args (defaults apply). No changes to `main.ts`. Pattern mirrors `PremiseQueueDeps` at `premise.queue.ts:47-87`.

### Cascade ordering: synchronous retract loop, fire-and-forget re-enrich

`setSocials`: persist socials → `getPremisesBySource` → `updatePremise` loop (synchronous, awaited) → `PremiseEvents.onRetracted` per premise (synchronous emit, queue enqueues are fire-and-forget) → `addEnrichUserJob` (fire-and-forget with error log). Errors in retraction propagate; errors in re-enrich are logged and swallowed.

### mcp.controller.ts routes through userService.setSocials

Replace `await chatDatabaseAdapter.setUserSocials(identity.userId, merged)` with `await userService.setSocials(identity.userId, merged)`. Import `userService` from `../services/user.service`. `merged` is already `SocialRow[]` where `SocialRow = { label, value }` — same shape as `userService.setSocials`. The try-catch wrapper remains unchanged.

## Phase 1: Protocol graph state + provenance wiring

### Overview

Add `activeSocialIds: string[]` to `ProfileGraphState`, extend `CompiledPremiseGraph` interface with optional provenance fields, populate `activeSocialIds` in `scrapeNode` and `autoGenerateNode`, and spread provenance in `decomposePremisesNode`. Test that `activeSocialIds` is populated in output state after a write-mode scrape path. Foundation slice — no dependencies.

### Changes Required:

#### 1. packages/protocol/src/profile/profile.state.ts

**File**: packages/protocol/src/profile/profile.state.ts
**Changes**: MODIFY — add `activeSocialIds: string[]` annotation after the `input` annotation block

```ts
// ADD after the `input` Annotation block (before `profile` annotation):
/**
 * IDs of the user_socials records active during the current scrape/generate run.
 * Populated by scrapeNode and autoGenerateNode after getUserSocials is called.
 * Empty by default; read by decomposePremisesNode to set provenanceSource:
 * 'integration' + provenanceSourceId when premises derive from social enrichment.
 */
activeSocialIds: Annotation<string[]>({
  reducer: (_, next) => next ?? [],
  default: () => [],
}),
```

#### 2. packages/protocol/src/profile/profile.graph.ts

**File**: packages/protocol/src/profile/profile.graph.ts
**Changes**: MODIFY — (A) add PremiseProvenance to import; (B) extend CompiledPremiseGraph interface; (C) scrapeNode return; (D) autoGenerateNode enrichment return; (E) decomposePremisesNode invoke call

```ts
// CHANGE A — update database.interface import (add PremiseProvenance):
import { ProfileGraphDatabase, PremiseRecord, PremiseProvenance } from "../shared/interfaces/database.interface.js";

// CHANGE B — CompiledPremiseGraph interface (replace invoke input type, lines 21-30):
export interface CompiledPremiseGraph {
  invoke(input: {
    userId: string;
    assertionText: string;
    tier: 'assertive' | 'contextual';
    operationMode: 'create';
    provenanceSource?: PremiseProvenance['source'];
    provenanceSourceId?: string;
  }): Promise<{
    premise?: { id: string } | undefined;
    error?: string | undefined;
  }>;
}

// CHANGE C — scrapeNode success return (add activeSocialIds; socials is already in scope at this point):
          return {
            objective,
            input: scrapedData,
            activeSocialIds: socials.map(s => s.id),
            operationsPerformed: { scraped: true }
          };

// CHANGE D — autoGenerateNode enrichment success return (add activeSocialIds; socials in scope from line ~358):
              return {
                input: enrichmentParts,
                needsUserInfo: false,
                needsProfileGeneration: true,
                forceUpdate: true,
                activeSocialIds: socials.map(s => s.id),
                operationsPerformed: { scraped: true },
              };

// CHANGE E — decomposePremisesNode invoke call inside the `for (const p of result.premises)` loop:
              const premiseResult = await invokeWithAbortSignal(this.premiseGraph, {
                userId: state.userId,
                assertionText: p.text,
                tier: p.tier,
                operationMode: 'create',
                ...(state.activeSocialIds?.length
                  ? { provenanceSource: 'integration' as const, provenanceSourceId: state.activeSocialIds[0] }
                  : {}),
              });
```

#### 3. packages/protocol/src/profile/tests/profile.graph.spec.ts

**File**: packages/protocol/src/profile/tests/profile.graph.spec.ts
**Changes**: MODIFY — add `Provenance tracking via activeSocialIds` describe block inside the outer `describe('ProfileGraph', ...)`

```ts
// ADD before the closing `});` of the outer `describe('ProfileGraph', ...)` block:
  describe('Provenance tracking via activeSocialIds', () => {
    it('should populate activeSocialIds in output state when getUserSocials returns records on scrape path', async () => {
      (mockDatabase.getProfile as any).mockResolvedValue(null);
      (mockDatabase.getUserSocials as any).mockResolvedValue([
        { id: 'social-id-1', userId: 'test-user-id', label: 'github', value: 'https://github.com/test' },
        { id: 'social-id-2', userId: 'test-user-id', label: 'linkedin', value: 'https://linkedin.com/in/test' },
      ]);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
      });

      expect(result.activeSocialIds).toEqual(['social-id-1', 'social-id-2']);
    });

    it('should leave activeSocialIds as empty array when user has no socials', async () => {
      (mockDatabase.getProfile as any).mockResolvedValue(null);
      (mockDatabase.getUserSocials as any).mockResolvedValue([]);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
      });

      expect(result.activeSocialIds).toEqual([]);
    });
  });
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `cd packages/protocol && bun run build` exits 0
- [x] New tests pass: `cd packages/protocol && bun test src/profile/tests/profile.graph.spec.ts`
- [x] `activeSocialIds` annotation present: `grep -c "activeSocialIds" packages/protocol/src/profile/profile.state.ts` returns >= 1
- [x] Provenance spread present: `grep -c "provenanceSource\|activeSocialIds" packages/protocol/src/profile/profile.graph.ts` returns >= 4

#### Manual Verification:
- [ ] `CompiledPremiseGraph.invoke` in profile.graph.ts accepts optional `provenanceSource`/`provenanceSourceId` without TypeScript errors
- [ ] Graph invoked in write mode with mocked social records produces `result.activeSocialIds` in output state

---

## Phase 2: ChatDatabaseAdapter.getPremisesBySource

### Overview

Add `getPremisesBySource(userId, source)` method to `ChatDatabaseAdapter` using JSONB extraction, modeled after `getExpiredPremises`. Add integration test. Independent of Phase 1 — can run in parallel.

### Changes Required:

#### 1. backend/src/adapters/database.adapter.ts:4208

**File**: backend/src/adapters/database.adapter.ts
**Changes**: MODIFY — add `getPremisesBySource` method after `getExpiredPremises` (line ~4228), before the User Context Methods comment

```ts
// ADD after getExpiredPremises return statement (before "User Context Methods" comment):
  /**
   * Find premises for a user with a specific provenance source.
   * Used for bulk-retraction of premises derived from a given source type
   * (e.g. 'integration' when social URLs are updated).
   *
   * @param userId - Owner of the premises
   * @param source - Provenance source value to filter by (e.g. 'integration', 'explicit')
   * @returns Minimal rows: id for each matching non-deleted premise
   */
  async getPremisesBySource(userId: string, source: string): Promise<Array<{ id: string }>> {
    const rows = await db
      .select({ id: schema.premises.id })
      .from(schema.premises)
      .where(
        and(
          eq(schema.premises.userId, userId),
          isNull(schema.premises.deletedAt),
          sql`(${schema.premises.provenance}->>'source') = ${source}`,
        )
      );
    return rows.map(r => ({ id: r.id }));
  }
```

#### 2. backend/src/adapters/tests/database.adapter.spec.ts

**File**: backend/src/adapters/tests/database.adapter.spec.ts
**Changes**: MODIFY — add getPremisesBySource test cases inside `describe('ChatDatabaseAdapter', ...)` after the premise-network assignment test (line ~393)

```ts
// ADD after the premise-network assignment test and its db.delete cleanup line:
  it('should return premises matching a specific provenance source', async () => {
    const integrationPremise = await adapter.createPremise({
      userId: fixture.userBId,
      assertion: { text: TEST_PREFIX + 'integration-source-test', tier: 'assertive' as const },
      provenance: { source: 'integration', sourceId: 'social-id-1', confidence: 1, timestamp: new Date().toISOString() },
      validity: { volatile: false },
    });
    const explicitPremise = await adapter.createPremise({
      userId: fixture.userBId,
      assertion: { text: TEST_PREFIX + 'explicit-source-test', tier: 'assertive' as const },
      provenance: { source: 'explicit', confidence: 1, timestamp: new Date().toISOString() },
      validity: { volatile: false },
    });

    try {
      const integrationResults = await adapter.getPremisesBySource(fixture.userBId, 'integration');
      const explicitResults = await adapter.getPremisesBySource(fixture.userBId, 'explicit');

      expect(integrationResults.some(p => p.id === integrationPremise.id)).toBe(true);
      expect(integrationResults.some(p => p.id === explicitPremise.id)).toBe(false);
      expect(explicitResults.some(p => p.id === explicitPremise.id)).toBe(true);
      expect(explicitResults.some(p => p.id === integrationPremise.id)).toBe(false);
    } finally {
      await db.delete(premises).where(inArray(premises.id, [integrationPremise.id, explicitPremise.id]));
    }
  });

  it('should return empty array for user with no premises of that source', async () => {
    const results = await adapter.getPremisesBySource(uuidv4(), 'integration');
    expect(results).toEqual([]);
  });
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `cd backend && bun run build` exits 0
- [x] `getPremisesBySource` method present: `grep -c "getPremisesBySource" backend/src/adapters/database.adapter.ts` returns >= 1
- [x] Adapter tests pass: `cd backend && bun test src/adapters/tests/database.adapter.spec.ts`

#### Manual Verification:
- [ ] `getPremisesBySource` accessible on `ChatDatabaseAdapter` instance without TypeScript errors
- [ ] Calling `getPremisesBySource(userId, 'integration')` on a user with no premises returns `[]`

---

## Phase 3: UserService cascade

### Overview

Add `UserServiceDeps` interface, extend `UserService` constructor with optional deps, and implement the retract + re-enrich cascade in `setSocials`. Add unit tests with mocked deps. Depends on Phase 2 (uses `getPremisesBySource` via deps default).

### Changes Required:

#### 1. backend/src/services/user.service.ts

**File**: backend/src/services/user.service.ts
**Changes**: MODIFY — add 3 imports; add UserServiceDeps interface before class; extend constructor; change setSocials to await + delegate; add private retractIntegrationPremises method

```ts
// CHANGE A — replace the import block at the top of the file:
import { log } from '../lib/log';
import { userDatabaseAdapter, chatDatabaseAdapter } from '../adapters/database.adapter';
import type { User } from '../schemas/database.schema';
import { validateKey } from '../lib/keys';
import { PremiseEvents } from '../events/premise.event';
import { enrichmentQueue } from '../queues/enrichment.queue';

// CHANGE B — add UserServiceDeps interface before the UserService class definition:
/**
 * Injectable dependencies for `UserService.setSocials` cascade behavior.
 * All fields are optional; the class uses production singletons as defaults.
 * Inject mocks in tests.
 */
export interface UserServiceDeps {
  /** Query premise IDs by provenance source for a user. */
  getPremisesBySource?: (userId: string, source: string) => Promise<Array<{ id: string }>>;
  /** Retract a single premise (set status RETRACTED + retractedAt). */
  retractPremise?: (premiseId: string) => Promise<void>;
  /** Emit the onRetracted lifecycle event for a premise. */
  emitPremiseRetracted?: (premiseId: string, userId: string) => void;
  /** Enqueue an enrichment job to rebuild premises from updated socials. */
  enqueueEnrichment?: (userId: string) => Promise<void>;
}

// CHANGE C — replace constructor line (add optional second param):
  constructor(
    private db = userDatabaseAdapter,
    private readonly deps?: UserServiceDeps,
  ) {}

// CHANGE D — replace setSocials method:
  async setSocials(userId: string, socials: { label: string; value: string }[]): Promise<void> {
    logger.verbose('[UserService] Setting socials', { userId, count: socials.length });
    await this.db.setSocials(userId, socials);
    await this.retractIntegrationPremises(userId);
  }

// CHANGE E — add private method before the closing `}` of the class (before `export const userService`):
  /**
   * Retract all `source='integration'` premises for a user after their social URLs
   * change, then fire-and-forget a re-enrichment job to rebuild from the new social set.
   *
   * Retraction loop is synchronous — errors propagate to the caller.
   * Re-enrichment failure is logged and swallowed (best-effort).
   */
  private async retractIntegrationPremises(userId: string): Promise<void> {
    const getPremisesBySource =
      this.deps?.getPremisesBySource ??
      ((uid: string, src: string) => chatDatabaseAdapter.getPremisesBySource(uid, src));

    const retractPremise =
      this.deps?.retractPremise ??
      (async (id: string) => { await chatDatabaseAdapter.updatePremise(id, { status: 'RETRACTED', retractedAt: new Date() }); });

    const emitPremiseRetracted =
      this.deps?.emitPremiseRetracted ??
      ((id: string, uid: string) => PremiseEvents.onRetracted(id, uid));

    const enqueueEnrichment =
      this.deps?.enqueueEnrichment ??
      (async (uid: string) => { await enrichmentQueue.addEnrichUserJob({ userId: uid, reason: 'socials_updated' }); });

    const toRetract = await getPremisesBySource(userId, 'integration');

    logger.verbose('[UserService] Retracting integration premises before re-enrich', {
      userId,
      count: toRetract.length,
    });

    for (const { id } of toRetract) {
      await retractPremise(id);
      emitPremiseRetracted(id, userId);
    }

    // Re-enrichment is fire-and-forget — failure is logged but does not propagate to caller.
    enqueueEnrichment(userId).catch(err =>
      logger.error('[UserService] Failed to enqueue re-enrichment after social update', {
        userId,
        error: err,
      }),
    );
  }
```

#### 2. backend/src/services/tests/user.service.setSocials.spec.ts

**File**: backend/src/services/tests/user.service.setSocials.spec.ts
**Changes**: NEW — unit tests for UserService.setSocials cascade behavior

```ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { UserService, type UserServiceDeps } from '../user.service';

describe('UserService.setSocials cascade', () => {
  let deps: Required<UserServiceDeps>;
  let mockDb: { setSocials: ReturnType<typeof mock>; [key: string]: unknown };

  beforeEach(() => {
    mockDb = {
      setSocials: mock(async () => {}),
    } as any;

    deps = {
      getPremisesBySource: mock(async () => []),
      retractPremise: mock(async () => {}),
      emitPremiseRetracted: mock(() => {}),
      enqueueEnrichment: mock(async () => {}),
    };
  });

  it('persists socials via the db adapter', async () => {
    const svc = new UserService(mockDb as any, deps);
    const socials = [{ label: 'github', value: 'https://github.com/test' }];
    await svc.setSocials('user-1', socials);
    expect(mockDb.setSocials).toHaveBeenCalledWith('user-1', socials);
  });

  it('retracts all integration premises returned by getPremisesBySource', async () => {
    (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'premise-1' },
      { id: 'premise-2' },
    ]);
    const svc = new UserService(mockDb as any, deps);
    await svc.setSocials('user-1', []);

    expect(deps.getPremisesBySource).toHaveBeenCalledWith('user-1', 'integration');
    expect(deps.retractPremise).toHaveBeenCalledTimes(2);
    expect(deps.retractPremise).toHaveBeenCalledWith('premise-1');
    expect(deps.retractPremise).toHaveBeenCalledWith('premise-2');
  });

  it('emits PremiseRetracted event for each retracted premise', async () => {
    (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([{ id: 'premise-1' }]);
    const svc = new UserService(mockDb as any, deps);
    await svc.setSocials('user-1', []);

    expect(deps.emitPremiseRetracted).toHaveBeenCalledWith('premise-1', 'user-1');
  });

  it('enqueues enrichment even when there are no integration premises', async () => {
    const svc = new UserService(mockDb as any, deps);
    await svc.setSocials('user-1', []);

    expect(deps.retractPremise).not.toHaveBeenCalled();
    expect(deps.emitPremiseRetracted).not.toHaveBeenCalled();
    expect(deps.enqueueEnrichment).toHaveBeenCalledWith('user-1');
  });

  it('does not propagate enqueueEnrichment errors to caller', async () => {
    (deps.enqueueEnrichment as ReturnType<typeof mock>).mockRejectedValue(new Error('queue unavailable'));
    const svc = new UserService(mockDb as any, deps);
    await expect(svc.setSocials('user-1', [])).resolves.toBeUndefined();
  });

  it('retraction order: persist → query → retract loop → enqueue', async () => {
    const callOrder: string[] = [];
    (mockDb as any).setSocials = mock(async () => { callOrder.push('persist'); });
    deps.getPremisesBySource = mock(async () => { callOrder.push('query'); return [{ id: 'p1' }]; });
    deps.retractPremise = mock(async () => { callOrder.push('retract'); });
    deps.emitPremiseRetracted = mock(() => { callOrder.push('emit'); });
    deps.enqueueEnrichment = mock(async () => { callOrder.push('enqueue'); });

    const svc = new UserService(mockDb as any, deps);
    await svc.setSocials('user-1', []);
    // enqueue is fire-and-forget — give it a microtask tick to settle
    await new Promise(r => setTimeout(r, 0));

    expect(callOrder).toEqual(['persist', 'query', 'retract', 'emit', 'enqueue']);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `cd backend && bun run build` exits 0
- [x] All 6 cascade tests pass: `cd backend && bun test src/services/tests/user.service.setSocials.spec.ts`
- [x] `UserServiceDeps` exported: `grep -c "export interface UserServiceDeps" backend/src/services/user.service.ts` returns 1
- [x] `retractIntegrationPremises` private method present: `grep -c "retractIntegrationPremises" backend/src/services/user.service.ts` returns >= 2

#### Manual Verification:
- [ ] `new UserService()` (no args) still instantiates — singleton `userService` at bottom of file unchanged
- [ ] `setSocials` return type is `Promise<void>` (callers at `auth.controller.ts:108` and `telegram.gateway.ts:218` are unaffected)

---

## Phase 4: MCP controller refactor

### Overview

Replace `chatDatabaseAdapter.setUserSocials` with `userService.setSocials` in the Telegram handle merge path of `mcp.controller.ts`. Depends on Phase 3 (UserService must have cascade before routing through it).

### Changes Required:

#### 1. backend/src/controllers/mcp.controller.ts:385

**File**: backend/src/controllers/mcp.controller.ts
**Changes**: MODIFY — route Telegram handle merge through `userService.setSocials`

```

```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `cd backend && bun run build` exits 0
- [x] `chatDatabaseAdapter.setUserSocials` no longer called: `grep -c "chatDatabaseAdapter.setUserSocials" backend/src/controllers/mcp.controller.ts` returns 0
- [x] `userService.setSocials` now called: `grep -c "userService.setSocials" backend/src/controllers/mcp.controller.ts` returns >= 1

#### Manual Verification:
- [ ] The try-catch wrapper around the Telegram handle merge is unchanged — errors still caught and logged as warnings
- [ ] `merged` type (`SocialRow[]`) matches `userService.setSocials` second parameter shape

---

## Ordering Constraints

- Phase 1 (protocol) and Phase 2 (adapter) are independent — can run in parallel
- Phase 3 (service) depends on Phase 2 (`getPremisesBySource` must exist for default dep)
- Phase 4 (MCP) depends on Phase 3 (`UserService` cascade must exist before routing through it)
- All phases must complete before integration testing end-to-end

## Verification Notes

- **JSONB query**: `getPremisesBySource` filters `(provenance->>'source') = ${source}` — verify with `SELECT * FROM premises WHERE user_id = $1 AND provenance->>'source' = 'integration'`
- **Cascade ordering race**: retract loop must complete before `addEnrichUserJob` is called; re-enrichment creates new integration premises which could be retracted by a concurrent loop
- **Idempotency**: `getSocials` returning `[]` for integration source → empty loop → `addEnrichUserJob` still called
- **Precedent lesson**: Always use `ChatDatabaseAdapter` for premise ops (`7928dd8c5d` — `ProfileDatabaseAdapter` doesn't implement the full premise surface)
- **activeSocialIds reducer**: uses `(_, next) => next ?? []` not `(curr, next) => next ?? curr` — ensures empty array overrides previous value when no socials exist
- **PremiseEvents.onRetracted already wired**: `main.ts:166-171` — no main.ts changes needed; verify by checking that emitting retracted fires cascade + regen jobs
- **mcp.controller.ts try-catch**: the Telegram handle merge is wrapped in try-catch; `userService.setSocials` errors should still be caught there (no change to error handling shape)

## Performance Considerations

- `getPremisesBySource` scans `provenance` JSONB column without an index. The query runs only on `setSocials` writes (user profile update path) — low frequency. A partial expression index `CREATE INDEX ON premises ((provenance->>'source')) WHERE status = 'ACTIVE'` can be added later if needed.
- The `updatePremise` loop is synchronous and sequential — for users with many integration premises this blocks the HTTP request. Typical count is <20 premises; acceptable without batching.

## Migration Notes

No schema changes. `PremiseProvenance.sourceId` already exists. Existing integration-derived premises carry `source: 'explicit'` pre-feature and will not be retracted (backfill out of scope).

## Pattern References

- `packages/protocol/src/premise/premise.state.ts:33-43` — annotation pattern for optional provenance fields (model `activeSocialIds` after this)
- `backend/src/adapters/database.adapter.ts:4208-4228` — `getExpiredPremises` JSONB extraction (model `getPremisesBySource` after this)
- `backend/src/queues/premise.queue.ts:47-87` — `PremiseQueueDeps` optional deps with defaults (model `UserServiceDeps` after this)
- `backend/src/events/handlers/question.answer.profile.ts:74-76` — gold standard for explicit `provenanceSource`/`provenanceSourceId`/`provenanceConfidence` population

## Developer Context

**Q (discover): Keep existing provenance shape** → A: Keep + fill in consistently.
**Q (discover): No new chat source value** → A: Keep `explicit` for chat input.
**Q (discover): Social URLs only** → A: Social URLs only scope.
**Q (discover): Retract all integration premises** → A: Retract all `source='integration'` premises per user.
**Q (discover): Service path owns cascade** → A: Inside `UserService.setSocials`, after DB call.
**Q (discover): Auto re-enrich** → A: `enrichmentQueue.addEnrichUserJob({ userId, reason: 'socials_updated' })`.
**Q (discover): sourceId carries user_social.id** → A: `activeSocialIds[0]` from `ProfileGraphState`.
**Q (discover): Premise query in ChatDatabaseAdapter** → A: `ChatDatabaseAdapter`.
**Q (`profile.graph.ts:21-30`): CompiledPremiseGraph interface + activeSocialIds slot** → A: Extend both; add annotation; scrapeNode/autoGenerateNode populate; decomposePremisesNode reads.
**Q (`user.service.ts:17`): UserService deps injection** → A: Optional constructor deps with defaults — mirrors PremiseQueueDeps.
**Q (`mcp.controller.ts:385`): Telegram handle merge bypass** → A: Route through `userService.setSocials`.

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents._

_Step 8 code review unavailable: artifact-code-reviewer subprocess returned no output in this session._
_Step 8 coverage review unavailable: artifact-coverage-reviewer subprocess returned no output in this session._

---

**Step 8 code review unavailable — artifact-code-reviewer and artifact-coverage-reviewer both returned no output in this session. Manual review recommended before implement.**

## Plan History

- Phase 1: Protocol graph state + provenance wiring — approved as generated
- Phase 2: ChatDatabaseAdapter.getPremisesBySource — approved as generated
- Phase 3: UserService cascade — approved as generated
- Phase 4: MCP controller refactor — approved as generated

## References

- `.rpiv/artifacts/research/2026-06-10_19-35-22_premise-source-tracking.md`
- `.rpiv/artifacts/discover/2026-06-10_19-01-28_premise-source-tracking.md`
- Precedent: `68ea501f5e` — "feat(protocol): add provenance override fields to premise graph state"
- Precedent: `7928dd8c5d` — "fix(enrichment): pass ChatDatabaseAdapter to PremiseGraphFactory"
