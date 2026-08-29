# Host ports

`platform/` defines the contracts that a consuming host supplies to
`@indexnetwork/protocol`. It does not contain adapters, configuration, HTTP
handlers, vendor clients, or dependency wiring.

An adapter belongs in the host: for example, a Drizzle database adapter,
a Redis cache adapter, or an `AsyncLocalStorage`
request-context store. This package consumes the matching TypeScript port.

## Naming

- Group ports by host concern: `discovery/cache.ts`, `chat/ports.ts`,
  `runtime/follow-up.ts`, and `negotiation/summary.ts`. `database/` remains a
  separate group because it owns a larger set of persistence contracts.
- Use `ports.ts` only when one file contains several closely related, actual
  port contracts. It is not a re-export barrel. For example, `chat/ports.ts`
  owns session reads, message writes, and digest reads.
- Use `*Port` only when an interface needs distinguishing from a protocol
  entity. Do not use `*.interface.ts`.
- Keep vendor, transport, and persistence words out of port names:
  `Drizzle`, `Postgres`, `Redis`, `BullMQ`, `HTTP`, and `Controller` signal a
  host implementation and do not belong here.

## Boundary test

Put a type in `platform/` when the protocol needs a host to perform an effect
or provide runtime context. Put it in `protocol/` when it is portable
vocabulary or deterministic policy. Put it in `internal/` when it exists only
to implement a workflow.
