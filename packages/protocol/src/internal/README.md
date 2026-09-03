# Private implementation map

Nothing under `internal/` is a consumer import path. The package root and the
capability façades decide what is supported.

| Area | Used by | Responsibility |
| --- | --- | --- |
| `agents/` | Tool registry | Agent registry and permission tools |
| `intents/` | `Intents`, tool registry | Signal lifecycle, intake, verification, and indexing |
| `networks/` | `Networks`, tool registry | Community lifecycle, membership, and assignments |
| `contexts/`, `enrichment/` | Public-profile research tools | Parallel-backed profile suggestions |
| `discovery/` | Opportunity and context workflows | HyDE search preparation and retrieval |
| `opportunities/` | Opportunity/Radar factories, tool registry | Matching, presentation, and radar |
| `negotiations/` | Opportunity tools | Negotiation turn shapes shared with the host's persistence |
| `mcp/` | `createMcpServer` | MCP transport composition and authorization |
| `shared/` | Internal implementation only | Cross-cutting model, tool-runtime, schemas, observability, and utilities |

Start from a root export or a capability façade, then follow its internal
module/graph entry point. Do not treat sibling files as standalone APIs.
