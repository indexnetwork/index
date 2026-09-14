# Question batches

- Navigation: [Overview](README.md) · [Agent instructions](agent-instructions.md).
- Decision: H2A authors independent questions; the principal submits one complete answer batch.
- Ownership: questions belong to the intent-scoped H2A conversation, with no negotiation references or A2A answer waits.

## Ask

```mermaid
flowchart TD
    R["H2A reviews evidence"] --> D{"What is missing?"}
    D -->|"Already known"| B["Rebrief relevant work"]
    D -->|"Principal fact or approval"| Q["Compose 1–3<br/>independent questions"]
    Q --> S["Save questions"]
    S --> V["Show one stable batch"]
```

| Rule | Contract |
|---|---|
| Batch size | 1–3 useful questions; never fill a quota. |
| Options | 2–4 concise suggestions per question; custom text remains available. |
| Ownership | H2A may ask before or after negotiations exist; no opportunity IDs or match-scoped question metadata. |
| Permission scope | Preserve the specific terms and limits in the question and answer wording; H2A carries applicable authority into briefs. |
| Independence | Separate unrelated decisions; defer follow-ups that depend on another answer. |
| Coherent offer | Several terms may form one approval for one opportunity. |
| Stability | IDs, wording and options stay fixed until answered or retired by H2A. |
| Later A2A arrivals | Do not append to, replace or retire displayed questions. |

## Answer

```mermaid
sequenceDiagram
    participant P as Principal
    participant H as H2A
    participant S as Session store
    P->>H: Submit complete answer array
    H->>H: Validate against current question IDs
    H->>S: Save all answers + clear pending batch
    S-->>H: Saved atomically
    H->>H: Interpret whole batch and whole intent
    Note over H: Save selected briefs before A2A resumes
```

```ts
export interface PrincipalAnswer { questionId: string; text: string }
get pending(): readonly PrincipalQuestion[];
answer(answers: readonly PrincipalAnswer[]): Promise<readonly PrincipalMessage[] | null>;
message(text: string): Promise<PrincipalMessage | null>;
```

| Submission / event | Required behavior |
|---|---|
| Exact current IDs; one nonempty answer each | Save together with the context of the exact displayed questions. |
| Missing, extra, duplicate, empty, stale or retired ID | Return `null`; save nothing and resume nothing. |
| Save failure | Reject; publish no dependent effect and resume nothing. |
| Uncertain client result / retry | Reconcile saved batch/history; never create duplicate answers or resumes. |
| Draft answer | No persistence or negotiation effects. |
| “I don't know” | Save explicit uncertainty; do not immediately repeat the same question. |
| Direct message during a batch | Save as `user`; interpret in H2A, never assign it arbitrarily to a question. |
| Explicit correction makes a question obsolete | H2A retires it; retain unrelated questions/drafts; reject obsolete submissions. |

- Preserve full answer text, including conditions, uncertainty and additional instructions.
- After save: reconsider the whole intent, even with no waiting negotiation; H2A may use the answers to revise discovery, select a counterpart or rebrief existing work.
- Questions need no negotiation or search candidate; H2A decides whether to ask from its intent context.
- Resume selected eligible work only after H2A saves its updated briefs; A2A receives no raw answers.
- New terms/turn ownership can invalidate an intended resume; refresh before acting.
- Remove request attachments and release-all answer promises; retain canonical H2A history.
- Keep `PrincipalQuestion`, `PrincipalMessage` and generic `Agent.ask_user`.
