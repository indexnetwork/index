# Private implementation map

Nothing under `internal/` is a consumer import path. The package root and the
capability classes decide what is supported.

| Area | Used by | Responsibility |
| --- | --- | --- |
| `intents/` | `Intents` | Signal lifecycle, clarification, and verification |
| `networks/` | `Networks` | Community lifecycle, membership, and assignments |
| `opportunities/` | Root opportunity exports | Lifecycle, presentation, radar, outcome mining, and the read-only negotiation context loader |
| `shared/` | Internal implementation only | Cross-cutting model configuration, observability, and utilities |

Start from a root export or a capability class, then follow its internal
module/graph entry point. Do not treat sibling files as standalone APIs.
