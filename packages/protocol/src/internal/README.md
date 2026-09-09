# Private implementation map

Nothing under `internal/` is a consumer import path. The package root and the
capability façades decide what is supported.

| Area | Used by | Responsibility |
| --- | --- | --- |
| `agents/` | Agent registry ports | Agent records and permissions |
| `intents/` | `Intents` | Signal lifecycle, clarification, and verification |
| `networks/` | `Networks` | Community lifecycle, membership, and assignments |
| `discovery/` | Opportunity workflows | HyDE search preparation and retrieval |
| `opportunities/` | Opportunity/Radar factories | Matching, presentation, radar, and the read-only negotiation context loader |
| `shared/` | Internal implementation only | Cross-cutting model, scope, schemas, observability, and utilities |

Start from a root export or a capability façade, then follow its internal
module/graph entry point. Do not treat sibling files as standalone APIs.
