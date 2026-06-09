# Backend

## Responsibility
Bun HTTP server and application host for REST APIs, MCP, auth, queues, events, gateways, and protocol graph wiring. `src/main.ts` is the composition root and runtime lifecycle owner.

## Dependencies
- **Bun.serve**: request dispatch and server lifecycle.
- **Better Auth**: session/auth route integration.
- **Drizzle/PostgreSQL**: persistence via adapters and schema.
- **BullMQ/Redis**: async workers and queue UI.
- **@indexnetwork/protocol**: graph/tool factories injected with backend adapters.

## Consumers
- **Frontend/CLI/Claude plugin/MCP clients**: call backend HTTP and `/mcp` endpoints.
- **Workers/scripts**: reuse services, adapters, queues, and schema.

## Module Structure
```
backend/
├── src/main.ts                 # composition root, server, queue/event wiring
├── src/controllers/            # HTTP/MCP request boundary
├── src/services/               # application orchestration
├── src/adapters/               # Drizzle/external infrastructure adapters
├── src/queues/, src/events/    # async work and lifecycle hooks
├── src/schemas/                # canonical Drizzle schema
└── src/lib/                    # shared infrastructure helpers
```

## Composition Root Wiring
```ts
// main.ts shape: instantiate app boundaries and wire side effects once.
import { RouteRegistry } from './lib/router/registry';
import { intentQueue } from './queues/intent.queue';
import { IntentEvents } from './events/intent.event';

IntentEvents.onCreated = ({ intentId, userId }) => {
  void intentQueue.addGenerateHydeJob({ intentId, userId });
};

const server = Bun.serve({
  async fetch(req) {
    // route registry, Better Auth, MCP, dev queue UI live here
    return RouteRegistry.handle(req);
  },
});
```

## Layer Boundary Pattern
```ts
// Controller -> Service -> Adapter. Protocol deps are assembled at composition roots.
class NetworkController {
  constructor(private readonly service: NetworkService) {}
  async create(req: Request) { return this.service.create(await req.json()); }
}

class NetworkService {
  constructor(private readonly db: NetworkDatabaseAdapter) {}
  async create(input: CreateNetworkInput) { return this.db.createNetwork(input); }
}
```

## Boundary Rules
- Controllers do not import adapters except explicit composition roots such as MCP wiring.
- Services may call adapters, queues, and events; avoid service-to-service coupling.
- Protocol package receives backend implementations through constructor/interface injection.

<important if="you are adding backend runtime wiring">
1. Add implementation in the owning layer first (controller/service/adapter/queue/event).
2. Register controllers or queue workers in `src/main.ts` only after implementation is testable.
3. Keep shutdown/close handling symmetrical for every worker or external connection.
</important>
