# Agent enhancements

- Status: accepted decisions below; implementation progress and open prerequisites are tracked in [TODO.md](TODO.md).
- Scope: H2A-owned discovery, negotiation opening and communication in `packages/agent`, plus affected host/TUI callers.
- Start: [Design](design.md) → [Implementation map](spec.md) → [Vertical slices](TODO.md).
- Baseline: reuse the retrieval and opening work from `refactor/remove-hyde-lenses`; [integration boundary](discovery.md#current-behavior-and-baseline).

| Domain | Owner | Contract |
|---|---|---|
| Counterparty discovery and negotiation opening | Our H2A run | [Discovery and opening](discovery.md) |
| Private briefs | H2A authors durable delegations | [Briefs](briefs.md) |
| A2A turns and local pause | Our A2A negotiator | [Negotiations](negotiations.md) |
| Questions and complete answer batches | H2A | [Question batches](question-batches.md) |
| H2A activation | Accepted user input; further wakes deferred | [Wake patterns](wake-patterns.md) |
| Runtime context | Reconstructed from durable records | [Reconstruction](design.md#runtime-reconstruction) |
| Identity, context and authority | Prompt builders | [Agent instructions](agent-instructions.md) |

## Decisions

- H2A chooses queries, evaluates candidates and calls `discover_counterparties` / `open_negotiation` in its own tool loop.
- Retrieval performs one explicit query per call; H2A decides whether another search or an opening is useful.
- Opening saves an H2A-authored private brief before our A2A starts; opening grants no authority to commit the principal.
- H2A reviews existing negotiation records when independently awake.
- A2A children never wake H2A or generate principal questions.
- H2A records each private negotiation brief when it issues or changes a delegation; A2A loads that brief on each permitted run.
- Questions and answers travel in batches; decisions retain their scopes.
- Reconstruct working context from records; remove `agent_sessions` and mutable runtime checkpoints. Search results and execution machinery remain in memory.
- Persist messages, explicit delegations and domain effects; resolve the minimal record layout, migration and host coordination before implementation. [Storage](spec.md#database-touches)
