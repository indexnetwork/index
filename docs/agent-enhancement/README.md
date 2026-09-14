# Agent enhancements

- Status: proposed design; product code unchanged.
- Scope: H2A-owned discovery, negotiation opening and communication in `packages/agent`, plus affected host/TUI callers.
- Start: [Design](design.md) → [Implementation map](spec.md) → [Vertical slices](TODO.md).
- Baseline: reuse the retrieval and opening work from `refactor/remove-hyde-lenses`; [integration boundary](discovery.md#current-behavior-and-baseline).

| Domain | Owner | Contract |
|---|---|---|
| Counterparty discovery and negotiation opening | Our H2A session | [Discovery and opening](discovery.md) |
| Private briefs | Our H2A session | [Briefs](briefs.md) |
| A2A turns and local pause | Our A2A negotiator | [Negotiations](negotiations.md) |
| Questions and complete answer batches | H2A | [Question batches](question-batches.md) |
| Independent H2A activation | Policy still open | [Wake patterns](wake-patterns.md) |
| Identity, context and authority | Prompt builders | [Agent instructions](agent-instructions.md) |

## Decisions

- H2A chooses queries, evaluates candidates and calls `discover_counterparties` / `open_negotiation` in its own tool loop.
- Retrieval performs one explicit query per call; H2A decides whether another search or an opening is useful.
- Opening saves an H2A-authored private brief before our A2A starts; opening grants no authority to commit the principal.
- H2A reviews existing negotiation records when independently awake.
- A2A children never wake H2A or generate principal questions.
- Our H2A session authors each private negotiation brief.
- Questions and answers travel in batches; decisions retain their scopes.
- Reuse existing records, H2A history and session storage; the H2A integration adds no schema changes beyond the reference branch's HyDE removal.
