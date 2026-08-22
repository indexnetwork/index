# Protocol kernel migration

`@indexnetwork/protocol` is moving incrementally to a stable protocol kernel
with host capabilities and private AI/workflow implementation. This changes no
tool names, serialized data, or supported root exports.

| Boundary | Responsibility | First-slice contents |
| --- | --- | --- |
| `protocol/` | Framework-free vocabulary, schemas, and deterministic rules | Schemas, request scope, retrieval lenses, and intent-indexing contracts |
| `platform/` | Host ports and supported runtime hooks | TypeScript contracts for database, cache, queue, embedder, scraper, logging, request context, and errors; no adapter implementations |
| `capabilities/` | Small executable entry points | Executable intent, network, context, contact, opportunity, negotiation, agent, and discovery capability classes |

`internal/` is private and now contains graphs, prompts, agents, retrieval,
tests, and the existing domain-first implementation directories.

## Dependency rules

```text
capabilities -> protocol + platform + internal
internal     -> protocol + platform
platform     -> protocol types only when needed
protocol     -> zod only (no package code or AI/host frameworks)
```

Capabilities may use their own private implementation and neutral internal
support only. They cannot deep-import another capability. The root package
import remains the only supported Node entry point; these directories add no
subpaths.

## Migration status

| Current area | Boundary | Status |
| --- | --- | --- |
| Stable schemas and deterministic vocabulary | `protocol/` | Moved where framework-free |
| Database, cache, queue, embedder, scraper, request/context, and service contracts | `platform/` | Contracts only; no Drizzle/Postgres/Redis/BullMQ adapters, API controllers, web concerns, configuration, or host wiring |
| Intent, network, context, contact, opportunity, negotiation, chat-agent, and HyDE discovery composition | `capabilities/` | Executable capability modules; internal graphs and tools remain private |
| Existing domain-first implementation directories | `internal/` | Moved without workflow rewrites |

`scripts/architecture/kernel-boundaries.ts` enforces the dependency direction
and rejects export-only source modules outside the root entry point. The
existing host-isolation and cross-capability checks ensure no host adapter or
private cross-capability import enters the package.
