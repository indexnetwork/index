# Backend Queues

## Responsibility
Asynchronous work orchestration with BullMQ workers and cron-style maintenance. Queues enqueue heavy work from services/controllers and run protocol graphs/adapters outside the request cycle.

## Dependencies
- **BullMQ via QueueFactory**: queue/worker creation, retries, concurrency, tracing.
- **node-cron**: maintenance jobs without BullMQ where appropriate.
- **Injected adapters/protocol deps**: canonical access to persistence and graph work.

## Consumers
- **`main.ts`**: starts workers/crons and closes queues.
- **Services/controllers/events**: enqueue jobs as producers.
- **Dev queue UI**: reads queue singletons for Bull Board.

## Module Structure
```
queues/
├── *.queue.ts              # one domain/workflow queue class + singleton
├── opportunity/            # opportunity discovery/expiration workflows
├── negotiations/           # negotiation timeout/run workflows
└── tests/                  # queue class tests with mocked deps/factory
```

## Queue Class Pattern
```ts
export interface WidgetJobData { widgetId: string; userId: string }
export interface WidgetQueueDeps { database: WidgetDatabase; graph: WidgetGraph }

export class WidgetQueue {
  readonly queue = QueueFactory.createQueue<WidgetJobData>('widget-queue');
  private worker?: Worker<WidgetJobData>;

  constructor(private readonly deps: WidgetQueueDeps) {}

  addJob(data: WidgetJobData) {
    return this.queue.add('process_widget', data, { jobId: `widget-${data.widgetId}` });
  }

  startWorker() {
    this.worker = QueueFactory.createWorker('widget-queue', (job) => this.processJob(job));
  }

  async processJob(job: Job<WidgetJobData>) {
    const widget = await this.deps.database.getWidget(job.data.widgetId);
    if (!widget) return;
    await this.deps.graph.invoke({ widget, userId: job.data.userId });
  }
}
```

## Producer Boundary
```ts
// Producers enqueue only; they do not call worker internals.
await widgetQueue.addJob({ widgetId, userId });
```

## Boundary Rules
- New queue code should use injected adapters/deps; direct Drizzle/schema imports are legacy and should not be copied.
- Workers start from `main.ts`, not at module import time.
- Queues may enqueue downstream queues, but only via public enqueue methods.

<important if="you are adding a new queue">
1. Define `*JobData`, optional `*QueueDeps`, class, singleton export, and public enqueue method.
2. Use `QueueFactory.createQueue/createWorker`; keep job names stable.
3. Inject adapters/protocol deps for worker logic.
4. Register `startWorker/startCrons` and `close` in `main.ts`.
5. Add queue tests that instantiate the class with mocked deps and call `processJob`.
</important>
