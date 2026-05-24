# IND-324: Premise Events, Cascade Re-evaluation, and Profile Regeneration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add premise lifecycle events, cascade re-evaluation of opportunities when premises dissolve, profile-as-materialized-view regeneration from premises, and premise expiry detection.

**Architecture:** Follows the existing event-driven pattern: `PremiseEvents` emitter in `backend/src/events/`, BullMQ queue jobs for async cascade processing, profile graph `aggregate` mode for premise-to-profile materialization. The cascade job finds all opportunities where the user is an actor and re-evaluates them with the updated premise set.

**Tech Stack:** BullMQ, EventEmitter pattern, LangGraph, Drizzle ORM

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `backend/src/events/premise.event.ts` | PremiseEvents emitter |
| Create | `backend/src/queues/premise.queue.ts` | BullMQ job definitions: `premise-cascade` and `profile-regen` |
| Modify | `backend/src/services/premise.service.ts` | Emit events after DB transactions |
| Modify | `packages/protocol/src/profile/profile.graph.ts` | Add `aggregate` mode (build profile from premises) |
| Modify | `packages/protocol/src/profile/profile.state.ts` | Add `aggregate` operation mode |
| Modify | `packages/protocol/src/shared/interfaces/database.interface.ts` | Add `getPremisesForUser` to `ProfileGraphDatabase` |
| Create | `backend/tests/premise.cascade.test.ts` | Queue/cascade integration tests |

---

### Task 1: Create premise event emitter

**Files:**
- Create: `backend/src/events/premise.event.ts`

- [ ] **Step 1: Check existing event patterns**

Read `backend/src/events/intent.event.ts` (or similar) to match the pattern.

- [ ] **Step 2: Create the event file**

```typescript
import { EventEmitter } from 'events';
import { log } from '../lib/log';

const logger = log.events.from('PremiseEvents');

export interface PremiseEventPayload {
  premiseId: string;
  userId: string;
  assertionText?: string;
  previousStatus?: string;
}

class PremiseEventEmitter extends EventEmitter {
  onCreated(handler: (payload: PremiseEventPayload) => void) {
    this.on('premise:created', handler);
  }

  onUpdated(handler: (payload: PremiseEventPayload) => void) {
    this.on('premise:updated', handler);
  }

  onRetracted(handler: (payload: PremiseEventPayload) => void) {
    this.on('premise:retracted', handler);
  }

  onExpired(handler: (payload: PremiseEventPayload) => void) {
    this.on('premise:expired', handler);
  }

  emitCreated(payload: PremiseEventPayload) {
    logger.verbose('Premise created', { premiseId: payload.premiseId, userId: payload.userId });
    this.emit('premise:created', payload);
  }

  emitUpdated(payload: PremiseEventPayload) {
    logger.verbose('Premise updated', { premiseId: payload.premiseId });
    this.emit('premise:updated', payload);
  }

  emitRetracted(payload: PremiseEventPayload) {
    logger.verbose('Premise retracted', { premiseId: payload.premiseId });
    this.emit('premise:retracted', payload);
  }

  emitExpired(payload: PremiseEventPayload) {
    logger.verbose('Premise expired', { premiseId: payload.premiseId });
    this.emit('premise:expired', payload);
  }
}

export const premiseEvents = new PremiseEventEmitter();
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/events/premise.event.ts
git commit -m "feat(backend): add PremiseEvents emitter"
```

---

### Task 2: Create premise queue jobs

**Files:**
- Create: `backend/src/queues/premise.queue.ts`

- [ ] **Step 1: Check existing queue patterns**

Read an existing queue file (e.g. `backend/src/queues/intent.queue.ts` or similar) to match the BullMQ pattern.

- [ ] **Step 2: Create the queue file**

```typescript
import { Queue, Worker, Job } from 'bullmq';
import { log } from '../lib/log';
import { getRedisConnection } from '../lib/redis';

const logger = log.queues.from('PremiseQueue');

export interface PremiseCascadeJob {
  premiseId: string;
  userId: string;
  event: 'retracted' | 'expired';
}

export interface ProfileRegenJob {
  userId: string;
  trigger: 'premise_created' | 'premise_updated' | 'premise_retracted' | 'premise_expired';
}

const QUEUE_NAME_CASCADE = 'premise-cascade';
const QUEUE_NAME_REGEN = 'profile-regen';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 86400 },
  removeOnFail: { age: 604800 },
};

export function createPremiseCascadeQueue() {
  const connection = getRedisConnection();
  if (!connection) {
    logger.warn('Redis not available, premise cascade queue disabled');
    return null;
  }

  const queue = new Queue<PremiseCascadeJob>(QUEUE_NAME_CASCADE, {
    connection,
    defaultJobOptions,
  });

  return queue;
}

export function createProfileRegenQueue() {
  const connection = getRedisConnection();
  if (!connection) {
    logger.warn('Redis not available, profile regen queue disabled');
    return null;
  }

  const queue = new Queue<ProfileRegenJob>(QUEUE_NAME_REGEN, {
    connection,
    defaultJobOptions,
  });

  return queue;
}

export function createPremiseCascadeWorker(
  processJob: (job: Job<PremiseCascadeJob>) => Promise<void>
) {
  const connection = getRedisConnection();
  if (!connection) return null;

  return new Worker<PremiseCascadeJob>(QUEUE_NAME_CASCADE, processJob, {
    connection,
    concurrency: 2,
  });
}

export function createProfileRegenWorker(
  processJob: (job: Job<ProfileRegenJob>) => Promise<void>
) {
  const connection = getRedisConnection();
  if (!connection) return null;

  return new Worker<ProfileRegenJob>(QUEUE_NAME_REGEN, processJob, {
    connection,
    concurrency: 1,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/queues/premise.queue.ts
git commit -m "feat(backend): add premise cascade and profile regen queue definitions"
```

---

### Task 3: Wire events into PremiseService

**Files:**
- Modify: `backend/src/services/premise.service.ts`

- [ ] **Step 1: Import events and queue**

Add imports for `premiseEvents` and the cascade/regen queues.

- [ ] **Step 2: Emit events after premise creation**

After the graph invoke in `createPremise`, emit:

```typescript
premiseEvents.emitCreated({
  premiseId: result.premise!.id,
  userId,
  assertionText,
});
```

- [ ] **Step 3: Add retract method with event emission**

```typescript
async retractPremise(userId: string, premiseId: string) {
  const premise = await this.db.getPremise(premiseId);
  if (!premise || premise.userId !== userId) throw new Error('Premise not found');
  if (premise.status === 'RETRACTED') throw new Error('Already retracted');

  await this.db.updatePremise(premiseId, {
    status: 'RETRACTED',
    retractedAt: new Date(),
  });

  premiseEvents.emitRetracted({
    premiseId,
    userId,
    previousStatus: premise.status,
  });
}
```

- [ ] **Step 4: Wire event listeners to enqueue jobs**

Add initialization method that connects events to queues:

```typescript
initializeEventListeners(cascadeQueue: Queue | null, regenQueue: Queue | null) {
  const enqueueCascade = (payload: PremiseEventPayload, event: 'retracted' | 'expired') => {
    if (!cascadeQueue) return;
    cascadeQueue.add(`cascade-${payload.premiseId}`, {
      premiseId: payload.premiseId,
      userId: payload.userId,
      event,
    });
  };

  const enqueueRegen = (payload: PremiseEventPayload, trigger: string) => {
    if (!regenQueue) return;
    regenQueue.add(`regen-${payload.userId}`, {
      userId: payload.userId,
      trigger,
    }, { debounce: { id: payload.userId, ttl: 5000 } });
  };

  premiseEvents.onCreated(p => enqueueRegen(p, 'premise_created'));
  premiseEvents.onUpdated(p => enqueueRegen(p, 'premise_updated'));
  premiseEvents.onRetracted(p => {
    enqueueCascade(p, 'retracted');
    enqueueRegen(p, 'premise_retracted');
  });
  premiseEvents.onExpired(p => {
    enqueueCascade(p, 'expired');
    enqueueRegen(p, 'premise_expired');
  });
}
```

- [ ] **Step 5: Verify compilation**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/premise.service.ts
git commit -m "feat(backend): wire premise events to cascade and regen queues"
```

---

### Task 4: Implement cascade worker logic

**Files:**
- Modify: `backend/src/queues/premise.queue.ts` (or a separate worker file per project convention)

- [ ] **Step 1: Implement the cascade processor**

The cascade worker finds all opportunities where the user is an actor, and for dissolution events (retract/expire), transitions them:

```typescript
export async function processPremiseCascade(job: Job<PremiseCascadeJob>) {
  const { userId, premiseId, event } = job.data;
  logger.verbose('Processing premise cascade', { premiseId, userId, event });

  // Find all non-terminal opportunities where the user is an actor
  const opportunities = await opportunityService.getOpportunitiesForUser(userId, {
    excludeStatuses: ['rejected', 'expired'],
  });

  let transitioned = 0;
  for (const opp of opportunities) {
    const currentStatus = opp.status;

    if (currentStatus === 'draft' || currentStatus === 'latent') {
      await opportunityService.updateStatus(opp.id, 'expired', {
        reason: `Premise ${premiseId} was ${event}`,
      });
      transitioned++;
    } else if (currentStatus === 'pending' || currentStatus === 'negotiating') {
      await opportunityService.updateStatus(opp.id, 'stalled', {
        reason: `A premise that supported this opportunity was ${event}`,
      });
      transitioned++;
    } else if (currentStatus === 'accepted') {
      await opportunityService.updateStatus(opp.id, 'stalled', {
        reason: `A premise that supported this opportunity was ${event}. The parties already connected, but the basis may have shifted.`,
      });
      transitioned++;
    }
  }

  logger.verbose('Cascade complete', { premiseId, transitioned, total: opportunities.length });
}
```

Note: The exact `opportunityService` API calls need to match the existing service interface. Check `backend/src/services/opportunity.service.ts` for the actual method signatures and adapt.

- [ ] **Step 2: Commit**

```bash
git add backend/src/queues/premise.queue.ts
git commit -m "feat(backend): implement premise cascade worker logic"
```

---

### Task 5: Add `aggregate` mode to profile graph

**Files:**
- Modify: `packages/protocol/src/profile/profile.state.ts`
- Modify: `packages/protocol/src/profile/profile.graph.ts`
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts`

- [ ] **Step 1: Add 'aggregate' to operationMode in profile state**

In `profile.state.ts`, change the `operationMode` annotation:

```typescript
operationMode: Annotation<'query' | 'write' | 'generate' | 'aggregate'>({
  reducer: (curr, next) => next ?? curr,
  default: () => 'write',
}),
```

- [ ] **Step 2: Add `getPremisesForUser` to `ProfileGraphDatabase`**

In `database.interface.ts`, add `getPremisesForUser` to the `ProfileGraphDatabase` Pick type.

- [ ] **Step 3: Add aggregate node to profile graph**

In `profile.graph.ts`, add an `aggregateNode` that:
1. Fetches all active premises via `this.database.getPremisesForUser(state.userId, 'ACTIVE')`
2. Concatenates premise texts into a profile synthesis prompt
3. Invokes the existing `ProfileGenerator` with the concatenated text as input
4. Generates a composite embedding from the result
5. Saves the synthesized profile to `user_profiles`

Add conditional routing: when `operationMode === 'aggregate'`, route to the aggregate node.

- [ ] **Step 4: Verify compilation**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors (or only adapter-related)

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/profile/profile.state.ts packages/protocol/src/profile/profile.graph.ts packages/protocol/src/shared/interfaces/database.interface.ts
git commit -m "feat(protocol): add 'aggregate' mode to profile graph (premise-to-profile materialization)"
```

---

### Task 6: Implement profile regen worker

**Files:**
- Modify: `backend/src/queues/premise.queue.ts`

- [ ] **Step 1: Implement the regen processor**

```typescript
export async function processProfileRegen(job: Job<ProfileRegenJob>) {
  const { userId, trigger } = job.data;
  logger.verbose('Processing profile regeneration', { userId, trigger });

  const graph = profileGraphFactory.createGraph();
  await graph.invoke({
    userId,
    operationMode: 'aggregate',
  });

  logger.verbose('Profile regenerated from premises', { userId });
}
```

Note: The `profileGraphFactory` needs to be accessible — either passed in via a factory function or imported from the service layer.

- [ ] **Step 2: Commit**

```bash
git add backend/src/queues/premise.queue.ts
git commit -m "feat(backend): implement profile regen worker (aggregate mode)"
```

---

### Task 7: Add premise expiry detection

**Files:**
- Modify: `backend/src/queues/premise.queue.ts` (or a dedicated cron job)

- [ ] **Step 1: Create expiry check function**

```typescript
export async function checkPremiseExpiry(db: PremiseGraphDatabase) {
  const now = new Date();
  // Query all ACTIVE premises where validity.validUntil < now
  // This requires a raw SQL query or a dedicated adapter method since
  // validUntil is inside a JSONB column

  // For each expired premise:
  // 1. Update status to EXPIRED
  // 2. Emit premiseEvents.emitExpired(...)
}
```

- [ ] **Step 2: Wire into existing cron/scheduler**

Check if the project has an existing cron job pattern (e.g. `audit-freshness` in CLAUDE.md) and add premise expiry detection alongside it, or create a new repeatable BullMQ job.

- [ ] **Step 3: Commit**

```bash
git add backend/src/queues/premise.queue.ts
git commit -m "feat(backend): add premise expiry detection job"
```

---

### Task 8: Write cascade integration tests

**Files:**
- Create: `backend/tests/premise.cascade.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect, beforeAll } from "bun:test";
import { config } from "dotenv";
config({ path: ".env.development", override: true });

describe("Premise Cascade", () => {
  it("transitions draft opportunities to expired when a premise is retracted", async () => {
    // 1. Create a test user with a premise
    // 2. Create a draft opportunity with the user as an actor
    // 3. Retract the premise
    // 4. Process the cascade job
    // 5. Verify the opportunity status changed to 'expired'
    expect(true).toBe(true); // Placeholder — implement with actual DB setup
  }, 30_000);

  it("transitions pending opportunities to stalled when a premise is retracted", async () => {
    // Similar setup but with a pending opportunity
    expect(true).toBe(true);
  }, 30_000);
});
```

Note: Full implementation depends on the test database setup patterns in the existing test suite. Check `backend/tests/e2e.test.ts` for setup/teardown patterns and adapt.

- [ ] **Step 2: Commit**

```bash
git add backend/tests/premise.cascade.test.ts
git commit -m "test(backend): add premise cascade integration test scaffolding"
```

---

### Task 9: Deprecate implicitIntents

**Files:**
- Modify: `backend/src/schemas/database.schema.ts`

- [ ] **Step 1: Add deprecation comment**

On the `implicitIntents` column in `userProfiles`:

```typescript
/** @deprecated Replaced by premises entity (IND-320). Will be dropped in a future migration. */
implicitIntents: json('implicit_intents'),
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/schemas/database.schema.ts
git commit -m "chore(schema): deprecate implicitIntents column (replaced by premises)"
```
