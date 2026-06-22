# Backend Services

## Responsibility
Application orchestration layer. Services coordinate adapters, queues, events, and protocol graph factories while keeping HTTP and DB implementation details out of business flows.

## Dependencies
- **Adapters**: persistence/external IO through backend adapter classes.
- **Queues/events**: async work and decoupled lifecycle side effects.
- **Protocol factories**: invoked through injected or composition-root-created deps.

## Consumers
- **Controllers**: primary callers.
- **Queues/CLI scripts**: reuse service workflows for maintenance/backfills.

## Module Structure
```
services/
├── *.service.ts          # one application service per domain/capability
├── *-token.service.ts    # focused utility services
└── tests/                # service-level behavior specs with mocked adapters/queues
```

## Service Orchestration Pattern
```ts
export class IntentService {
  constructor(
    private readonly db: IntentDatabaseAdapter,
    private readonly queue = intentQueue,
  ) {}

  async create(userId: string, input: CreateIntentInput) {
    const intent = await this.db.createIntent({ ...input, userId });

    // Emit or enqueue after persistence succeeds.
    IntentEvents.onCreated({ intentId: intent.id, userId });
    await this.queue.addGenerateHydeJob({ intentId: intent.id, userId });

    return intent; // plain domain DTO, controller formats HTTP response
  }
}
```

## Adapter + Queue Boundary
```ts
// Services import queues as producers only; workers own processing.
await enrichmentQueue.addEnsureProfileHydeJob({ userId, networkId });

// Services call adapters, not Drizzle directly.
const profile = await profileAdapter.getProfile(userId);
```

## Boundary Rules
- Avoid service-to-service imports; use events, queues, or shared pure helpers instead.
- Keep HTTP `Request/Response` out of services.
- Services may enforce domain invariants and emit lifecycle hooks after DB writes.

<important if="you are adding a service workflow">
1. Define adapter methods needed for persistence.
2. Keep method inputs as domain DTOs, not raw `Request` objects.
3. Persist first; enqueue/emit side effects after successful state changes.
4. Mock adapters/queues/events in targeted service tests.
</important>
