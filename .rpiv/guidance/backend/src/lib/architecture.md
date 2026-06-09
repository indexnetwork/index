# Backend Lib

## Responsibility
Shared infrastructure utilities for backend runtime: routing, auth, database/client singletons, BullMQ, logging, limiting, email, uploads, Sentry, protocol URL helpers, and external SDK glue.

## Dependencies
- **Router decorators/registry**: controller discovery and dispatch.
- **Better Auth/JWT/API key helpers**: identity and trusted-origin behavior.
- **Drizzle/BullMQ/Redis clients**: shared infrastructure singletons.
- **Sentry/logging/limiter**: cross-cutting runtime instrumentation.

## Consumers
- **Controllers/services/queues/adapters/main.ts**: import infrastructure helpers.
- **Tests**: mock or instantiate focused utilities.

## Module Structure
```
lib/
├── router/, auth/, apikey/       # request identity and routing infrastructure
├── drizzle/, bullmq/, limiter/   # shared runtime clients/factories
├── email/, upload/, storage/     # IO helper sublayers
├── log*, sentry*                 # observability
└── protocol-url, utils           # cross-cutting helpers
```

## Decorator Registry Pattern
```ts
export function Controller(prefix: string) {
  return (target: Function) => RouteRegistry.registerController(target, prefix);
}

export function Get(path: string) {
  return (target: object, key: string) => RouteRegistry.registerRoute(target, key, 'GET', path);
}
```

## Shared Factory Boundary
```ts
export class QueueFactory {
  static createQueue<T>(name: string) {
    return new Queue<T>(name, { connection: getRedisConnection(), defaultJobOptions });
  }

  static createWorker<T>(name: string, processor: Processor<T>) {
    return new Worker<T>(name, traceProcessor(processor), { connection: getRedisConnection() });
  }
}
```

## Boundary Rules
- Keep `lib/` infrastructure-oriented; domain workflows belong in services/protocol.
- Shared factories should centralize retry, connection, tracing, and environment fallback behavior.
- Identity helpers should fail closed on ambiguous principals.

<important if="you are adding shared infrastructure">
1. Place it under a focused subfolder (`auth/`, `limiter/`, `bullmq/`, etc.).
2. Keep public API small and documented enough for controllers/queues to use safely.
3. Add unit tests for fallback/error behavior because many callers will share it.
</important>
