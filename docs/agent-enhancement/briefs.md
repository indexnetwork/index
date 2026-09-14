# Briefs

- Navigation: [Overview](README.md) · [Implementation map](spec.md).
- Decision: our H2A session exclusively writes our A2A brief.

## Ownership

```mermaid
flowchart TD
    P["Intent + principal evidence"] --> H["Our H2A session"]
    H -->|"Save private brief"| B["Existing session storage"]
    B -->|"Read current brief"| A["Our A2A negotiator"]
    C["Counterparty A2A"] -->|"Negotiation data"| A
    A -->|"Permitted terms only"| C
```

| Content | Rule | Reason |
|---|---|---|
| Objective | Preserve the principal's actual goal | Avoid drifting into a generic intro. |
| Facts and conditions | Use confirmed evidence; retain qualifications | Summaries cannot create facts. |
| Authority | State applicable permission and its scope | One opportunity's approval cannot authorize another. |
| Current focus | Identify the selected counterpart's next unresolved issue | Orient initial and resumed A2A work. |
| Source evidence | Keep full H2A history available | Briefs remain summaries, not independent authority. |

## Handoff

- Initial outgoing work: H2A supplies `brief` to [`open_negotiation`](discovery.md#opening-and-brief-ordering); persist it before our first A2A run.
- Existing or counterparty-opened work: H2A selects the observed opportunity and uses `reconsider()` below; a received record is insufficient to start an unbriefed task.
- Keep selection `reasoning` suitable for disclosure separate from the private brief.

```mermaid
sequenceDiagram
    participant H as H2A
    participant S as Session store
    participant A as Our A2A
    H->>H: Select work and write briefs
    H->>S: Save selected briefs atomically
    S-->>H: Saved
    H->>A: Resume eligible targets
    A->>A: Re-read record and principal context
    A->>A: Act within current brief
```

- Proposed method for existing opportunities: `reconsider(updates: readonly { opportunityId: string; brief: string }[])`.
- Save failure → no dependent resume.
- Reuse saved/runtime `reviewNote` as `brief`; replace turn input `communicationReview` in place.
- Retain the brief across ordinary turns; no H2A call or brief reset after each read.
- Keep per-opportunity briefs in turn inputs; never mutate a shared system prompt.
- New principal input invalidates stale work; older briefs cannot override newer instructions.
- No initial brief → wait for H2A delegation; never synthesize one in A2A or wake H2A to obtain it.
- Current protocol eligibility still applies; a brief cannot reopen completed negotiations.
- Keep briefs and private deliberation out of counterparty messages.

## Example: Leo

| Brief statement | Source / limit |
|---|---|
| Pursue co-authorship within six weeks. | Principal's intent |
| Aggregates are acceptable only if the product can be named. | Principal's conditional answer |
| Maya wants first authorship; agreement remains unresolved. | Desired term, not an agreed term |
| Address authorship on the next permitted turn; preserve the data condition. | H2A's negotiation focus |
