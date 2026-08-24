# Private implementation map

Nothing under `internal/` is a consumer import path. The package root and the
capability façades decide what is supported.

| Area | Used by | Responsibility |
| --- | --- | --- |
| `agents/`, `chat/` | `ChatGraphFactory`, tool registry | Chat runtime, personas, streaming, and agent registration |
| `intents/` | `Intents`, tool registry | Signal lifecycle, intake, verification, and indexing |
| `networks/` | `Networks`, tool registry | Community lifecycle, membership, and assignments |
| `contexts/`, `enrichment/`, `premises/` | Public-profile research tools and premise lifecycle | Parallel-backed profile suggestions and participant premise decomposition |
| `discovery/` | Opportunity and context workflows | HyDE search preparation and retrieval |
| `opportunities/` | Opportunity/Radar factories, tool registry | Matching, presentation, delivery, and radar |
| `negotiations/`, `questions/` | Negotiation factory, tool registry | Bilateral negotiation and decision questions |
| `maintenance/` | Scheduler host | Periodic radar-health and expiration work |
| `mcp/` | `createMcpServer` | MCP transport composition and authorization |
| `shared/` | Internal implementation only | Cross-cutting model, tool-runtime, schemas, observability, and utilities |

Start from a root export or a capability façade, then follow its internal
module/graph entry point. Do not treat sibling files as standalone APIs.
