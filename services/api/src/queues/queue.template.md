# Queue Implementation Guide

Queues offload asynchronous or heavy tasks from the request/response cycle. We use **BullMQ** via `QueueFactory`. Each queue is implemented as a **class** in a single file: queue, worker, and job handlers live together by domain.

This guide follows **clean architecture**: queues sit in the interface-adapters/infrastructure layer; they orchestrate by calling inward (services, protocol graphs, adapters) and must not contain business logic or depend on outer details (e.g. direct DB, HTTP).

## Location & Naming

- **File**: `src/queues/<domain>.queue.ts` (e.g. `intent.queue.ts`, `notification.queue.ts`)
- **Queue name**: kebab-case, e.g. `<domain>-queue` or `<domain>-hyde-queue`
- **Class**: `<Domain>Queue` (e.g. `IntentQueue`, `NotificationQueue`)
- **Singleton**: `<domain>Queue` (e.g. `intentQueue`, `notificationQueue`)

## Exports

- **Class** – For tests (construct with optional deps) and type reference
- **Singleton** – Default instance used by the app (e.g. `intentQueue`)
- **Types** – Job payload interfaces and optional deps interface for testing
- **Convenience** – Optional standalone function if call sites expect it (e.g. `queueOpportunityNotification`)

Workers are **not** created at module load. The protocol server calls `startWorker()` on the singleton so CLI scripts (e.g. `db:seed`) only enqueue jobs and do not run workers.

## Standard Template (BullMQ queue + worker)

```typescript
import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';

export const QUEUE_NAME = 'my-domain-queue';

export interface MyJobData {
  entityId: string;
  action: 'process' | 'analyze';
}

/** Optional deps for testing. Use abstractions (Pick<Adapter, ...> or protocol interfaces). */
export interface MyQueueDeps {
  database?: Pick<SomeAdapter, 'getEntity' | 'saveResult'>;
}

/**
 * My-domain queue: queue + worker + job handlers in one class.
 * Workers are started only by the protocol server (startWorker()); CLI scripts only add jobs.
 * Handlers orchestrate by calling services, protocol graphs, or adapters—no business logic here.
 */
export class MyQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<MyJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('MyJob');
  private readonly queueLogger = log.queue.from('MyQueue');
  private readonly deps: MyQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<MyJobData>> | null = null;

  constructor(deps?: MyQueueDeps) {
    this.deps = deps;
    // When deps is omitted, assign default adapter(s) that implement the same interface.
  }

  async addJob(name: 'process' | 'analyze', data: MyJobData, options?: { jobId?: string; priority?: number }) {
    return this.queue.add(name, data, { jobId: options?.jobId, priority: options?.priority });
  }

  /** Run job handler (for testing with injected deps). Log only in the worker (one line with job id + name). */
  async processJob(name: string, data: MyJobData): Promise<void> {
    switch (name) {
      case 'process':
        await this.handleProcess(data);
        break;
      case 'analyze':
        await this.handleAnalyze(data);
        break;
      default:
        this.queueLogger.warn(`[MyProcessor] Unknown job name: ${name}`);
    }
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<MyJobData>) => {
      this.queueLogger.info(`[MyProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<MyJobData>(QUEUE_NAME, processor);
  }

  private async handleProcess(data: MyJobData): Promise<void> {
    // Use deps (tests) or default adapter; depend on interface, not concrete class.
    const db = this.deps?.database ?? this.getDefaultDb();
    // Orchestrate only: call service, protocol graph, or adapter—no business logic.
    // await myService.process(data.entityId);  or  await someGraph.invoke(...);
    this.logger.info('[MyJob] Processed', { entityId: data.entityId });
  }

  private async handleAnalyze(data: MyJobData): Promise<void> {
    // Same: delegate to service or protocol layer.
  }

  /** Default when deps not provided (production). Return type should match deps abstraction. */
  private getDefaultDb(): Pick<SomeAdapter, 'getEntity' | 'saveResult'> {
    return new SomeAdapter();
  }
}

export const myQueue = new MyQueue();
```

## Cron-only “queue” (no BullMQ)

For scheduled maintenance (e.g. HyDE cleanup/refresh), use a class with no BullMQ queue and a `startCrons()` method. Same clean-architecture rules apply: depend on adapters/services via deps, keep handlers thin (orchestrate only).

```typescript
import cron from 'node-cron';
import { log } from '../lib/log';

export interface HydeQueueDeps {
  database?: Pick<ChatDatabaseAdapter, 'deleteExpiredHydeDocuments' | 'getStaleHydeDocuments'>;
}

/**
 * HyDE maintenance: cron-scheduled cleanup and refresh (no BullMQ queue).
 * Call startCrons() from the protocol server.
 */
export class HydeQueue {
  private readonly logger = log.job.from('HydeJob');
  private readonly deps: HydeQueueDeps | undefined;

  constructor(deps?: HydeQueueDeps) {
    this.deps = deps;
  }

  async cleanupExpiredHyde(): Promise<number> {
    // ...
  }

  async refreshStaleHyde(): Promise<number> {
    // ...
  }

  startCrons(): void {
    cron.schedule('0 3 * * *', () => this.cleanupExpiredHyde().catch((err) => this.logger.error('Cron failed', { error: err })));
    cron.schedule('0 4 * * 0', () => this.refreshStaleHyde().catch((err) => this.logger.error('Cron failed', { error: err })));
  }
}

export const hydeQueue = new HydeQueue();
```

In `main.ts`, start workers and crons only in the server process:

```typescript
import { intentQueue } from './queues/intent.queue';
import { notificationQueue } from './queues/notification.queue';
import { hydeQueue } from './queues/hyde.queue';

intentQueue.startWorker();
notificationQueue.startWorker();
hydeQueue.startCrons();
```

## Usage from application code

Enqueue from services, graphs, or controllers via the singleton:

```typescript
import { intentQueue } from '../queues/intent.queue';

await intentQueue.addJob('generate_hyde', { intentId, userId }, { jobId: `intent-hyde-${intentId}` });
```

If you keep a convenience function for backward compatibility:

```typescript
export async function queueOpportunityNotification(
  opportunityId: string,
  recipientId: string,
  priority: NotificationPriority
) {
  return notificationQueue.queueOpportunityNotification(opportunityId, recipientId, priority);
}
```

## Bull Board (dev UI)

The queues controller uses the **BullMQ Queue** instance for the adapter. Expose it as `readonly queue` on the class and pass the singleton’s `.queue`:

```typescript
import { intentQueue } from '../queues/intent.queue';

new BullMQAdapter(intentQueue.queue)
```

## Clean architecture

### Layering

Queues are **interface adapters**: they receive work (job payloads) and **orchestrate** by calling inward. They must not implement business rules or depend on frameworks/DB directly.

- **Dependency rule**: Dependencies point **inward**. Queue handlers may depend on:
  - **Adapters** (database, embedder, cache) — prefer protocol interfaces or `Pick<Adapter, 'method'>` in deps so tests can inject mocks.
  - **Protocol layer** — graph factories, agents (e.g. `HydeGraphFactory`, `OpportunityGraphFactory`). Invoke with the correct database/view interface.
  - **Services** — when logic already lives in a service (e.g. `userService.getUserForNewsletter`), call it instead of duplicating or reaching into adapters the service uses.
  - **Other queues** — only to **enqueue** downstream jobs (e.g. intent handler enqueuing opportunity job). Do not depend on another queue’s worker or internals.
  - **Infrastructure** — Redis (digest/dedupe), email queue, event emitters (e.g. WebSocket), only where necessary.

- **Handlers stay thin**: Parse payload → call one or more of the above → log result. No business logic in the queue class.

### What queues must avoid

- **Direct `db` or schema imports**: Use adapters (or services that use adapters) so tests can inject a minimal interface.
- **Business logic**: If “how to do it” is more than “call this service/graph,” move that logic into a service or protocol layer and call it from the handler.
- **Controller/HTTP concerns**: No `Request`/`Response`; queues are backend-only.

### Dependency injection

- **Deps interface**: Define a `MyQueueDeps` (or similar) with optional fields typed as **abstractions** (e.g. `Pick<ChatDatabaseAdapter, 'getIntentForIndexing'>`, or a protocol interface). Production uses the real adapter when `deps` is omitted; tests pass mocks.
- **No `new` for cross-cutting concerns in handlers**: Prefer `this.deps?.database ?? defaultAdapter` (or constructor-injected default) so tests can replace behavior without touching real DB/Redis.

---

## Best Practices

### 1. Type safety
- Define interfaces for job payloads in the same file.
- Use a single payload type or a union and narrow in the processor with `job.name`.

### 2. Job names
- Use snake_case (e.g. `generate_hyde`, `discover_opportunities`, `process_opportunity_notification`).
- Route in `processJob` (and in the worker’s processor) with a `switch` on `job.name`.
- **Custom job IDs must not contain colons** — BullMQ uses colons internally for Redis key namespacing. Use dashes as separators (e.g. `intent-hyde-${intentId}`, not `intent-hyde:${intentId}`).

### 3. Testing
- Constructor accepts optional **deps** (e.g. mock database, mock email) so tests don’t hit real DB or Redis.
- Tests call `processJob(name, data)` on an instance created with deps; they do not call `startWorker()`.

### 4. Error handling
- QueueFactory handles retries and logging. Use `UnrecoverableError` in handlers when retries should be skipped.
- In cron handlers, catch and log so one failure doesn’t break the schedule.

### 5. Dependencies (dependency inversion)
- **Depend on abstractions**: Deps and default collaborators should be typed as interfaces or `Pick<Adapter, 'method'>`, not as concrete classes in the type of the field (implementation can still be the real adapter when `deps` is omitted).
- Use `log` from `../lib/log` (e.g. `log.job.from('MyJob')`, `log.queue.from('MyQueue')`); no `console.log`.
- **Job processing log**: Log once per job in the worker only: `this.queueLogger.info(\`[XProcessor] Processing job ${job.id} (${job.name})\`)`. Do not log in `processJob()` so all queues have one consistent line per job.

### 6. Workers only in the server
- Only the protocol server (e.g. `main.ts`) should call `startWorker()` or `startCrons()`.
- CLI scripts (e.g. `db:seed`) should only call `addJob` (or the domain enqueue method) so jobs are processed by the running server.
