# Design

- Navigation: [Overview](README.md) · [Implementation map](spec.md).
- Accepted ownership and activation below; further wake sources remain deferred.

## Domain ownership

```mermaid
flowchart TD
    P["Principal's intent<br/>and H2A conversation"] --> H["Our H2A session"]
    H -->|"discover_counterparties"| D["Authorized retrieval"]
    D -->|"Candidate statements<br/>and evidence"| H
    H -->|"open_negotiation<br/>Selected candidate + brief"| O["Host opening<br/>and private checkpoint"]
    O -->|"Saved brief + eligible turn"| A["Our A2A negotiator"]
    C["Counterparty A2A"] -->|"Offers, questions, claims"| A
```

| Decision | Reason |
|---|---|
| H2A owns discovery and opening | The principal's intent, answers and current negotiations inform whom to pursue. |
| Retrieval returns candidates | H2A evaluates actual statements and decides whether to search again or open; no lens/HyDE planning pipeline remains. |
| Host enforces search scope and protocol opening | Model selection cannot grant membership, ownership or execution authority. |
| Intent-scoped H2A owns questions and briefs | Decides whether input is needed, independently of A2A stalls; questions have no negotiation linkage. |
| A2A's only private context is its brief | H2A supplies objectives, facts and authority; no separate task, raw intent or principal history enters A2A. |
| Counterparty text remains negotiation data | Cannot rewrite our brief or establish principal consent. |
| H2A pulls current negotiations | Removes accumulated requests, answer promises and child wakeups. |

## H2A review

```mermaid
flowchart TD
    W["Accepted principal<br/>message or answer"] --> R["Read scope, search history,<br/>negotiations and principal context"]
    R --> D{"What helps now?"}
    D -->|"Find counterparties"| F["discover_counterparties"]
    F --> E["Evaluate candidates"]
    E -->|"Refine query"| F
    E -->|"Select and brief"| O["open_negotiation"]
    O --> N["Start or resume selected<br/>eligible A2A work"]
    E -->|"Need input or stop searching"| D
    D -->|"Enough evidence"| B["Save briefs"]
    B --> N
    D -->|"Missing principal input"| Q["Ask independent<br/>questions together"]
    Q --> A["Save complete<br/>answer batch"]
    A --> R
    D -->|"Outcome or obstacle"| U["Concise update"]
    D -->|"No useful interruption"| S["Stay silent"]
```

- Actions may coexist: one H2A review can search, open selected negotiations, reply, rebrief other work and ask questions.
- One H2A tool loop owns these decisions; replace the reference branch's separate pursuit run and the current one-step, reply-only review restriction.
- Search results create no negotiation; only an explicit `open_negotiation` selection crosses that boundary.
- Review the whole intent, including passive negotiations and agreements.
- Active/passive counts inform agent judgment; no count threshold chooses the action.
- A2A pause, arrival, outcome and persistence callbacks never trigger this review.
- Start/resume only selected eligible work with a saved brief; re-read current terms and turn ownership.

## Scope contracts

| Scope | Decision |
|---|---|
| [Discovery and opening](discovery.md) | Reuse explicit-query retrieval and protocol opening; put both tools under H2A and require an initial private brief. |
| [Briefs](briefs.md) | Replace raw intent as A2A orientation with H2A-owned private briefs. |
| [Negotiations](negotiations.md) | Explicit local pause; reuse existing outcomes, turn ownership and history. |
| [Question batches](question-batches.md) | Save all answers before reconsideration or resumption. |
| [Wake patterns](wake-patterns.md) | Accepted user input activates H2A; further wake sources and deadline delivery remain deferred. |
| [Agent instructions](agent-instructions.md) | Separate agreement, authority and confirmed execution. |

## Boundaries

- In scope: `packages/agent`, API host tool/activation wiring, affected TUI consumers and existing private session JSON.
- Implementation baseline: the reference branch removes lenses, HyDE artifacts and automatic pipeline selection/opening; carry that work forward once.
- Outside scope: application layouts, macOS, infrastructure redesign, protocol transitions.
- No new accumulator, consent ledger or schema changes for the H2A integration.
- Retain protocol intent IDs for ownership and pair identity; this does not supply A2A with separate intent context.
