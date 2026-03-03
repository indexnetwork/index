# Negotiation Concept

> **Related**: [Opportunity Concept](./Opportunity%20Concept.md), Negotiation Graph (`../graphs/negotiation.graph.ts`), Negotiation Agent (`../agents/negotiation.agent.ts`)
> **Last updated**: reflects `feat/negotiations` branch state as of early March 2026

## What is a Negotiation?

A **Negotiation** is an automated, agent-to-agent exchange that happens *before* an Opportunity is shown to a human. It is the system's way of pre-qualifying a potential connection so that the human only sees matches that both parties' agents have already evaluated as worth their time.

The goal of a negotiation is not to make a deal. It is to answer one question:

> *"Is the evaluation cost (a human conversation) justified by the potential asymmetric upside for both parties?"*

If both agents agree the answer is yes — outcome `'opportunity'` — the system creates an Opportunity with status `'pending'` and surfaces it to both users. If either agent declines, defers, or the turn limit is reached without agreement, no Opportunity is created (or it is deferred for later).

Negotiations run **synchronously inside the chat flow** (via `runNegotiations()`) and stream progress events in real time so the user can watch the agents reason about the match.

---

## Data Model

```
negotiations
├── id              UUID, primary key
├── status          Enum: initiated | in_progress | resolved | expired
├── outcome         Enum: opportunity | disengaged | deferred (null while in progress)
├── participants    JSONB[] — the two parties
│   ├── userId      Participant's user ID
│   ├── role        'initiator' | 'responder'
│   └── name        Display name (enriched at read time)
├── trigger         JSONB — what started this negotiation
│   ├── source      'search' | 'subscription'
│   ├── intentId    Intent that triggered discovery (optional)
│   ├── query       Search query used (optional)
│   └── indexId     Index context (optional)
├── turns           JSONB[] — accumulated agent messages
│   ├── turn        Turn number (0-indexed)
│   ├── participantUserId  Who spoke this turn
│   ├── message     { context, upside?, invitation? }
│   ├── decision    'continue' | 'extend' | 'accept' | 'decline' | 'defer'
│   ├── reasoning   Internal agent reasoning (not shown to counterparty)
│   └── timestamp   ISO 8601
├── resolution      JSONB — final outcome details (set when resolved)
│   ├── reasoning   Why the negotiation concluded this way
│   ├── outcome     Mirrors top-level outcome field
│   └── opportunityId  ID of the created Opportunity (when outcome = 'opportunity')
├── opportunityId   FK → opportunities.id (when outcome = 'opportunity')
├── currentTurn     Integer — turn counter
├── maxTurns        Integer — adaptive limit (default 3, up to 5)
├── createdAt / updatedAt / expiresAt
```

Schema source: `protocol/src/schemas/database.schema.ts`

---

## Participant Roles

| Role | Who | Behavior |
|------|-----|----------|
| `initiator` | The user whose discovery search triggered the negotiation | Agent goes first; sets context and invites engagement |
| `responder` | The matched candidate | Agent evaluates the opening and decides whether to engage |

Agents alternate turns, each acting as the other party's representative in sequence: initiator → responder → initiator → … until a terminal decision or the turn limit is reached.

---

## Agent Decision Model

Each turn, the `NegotiationAgent` LLM produces:
- A **message** to send to the counterparty (three optional parts: `context`, `upside`, `invitation`)
- A **decision** that controls graph routing
- Internal **reasoning** (logged, not shown to counterparty)

| Decision | Meaning | Graph effect |
|----------|---------|-------------|
| `continue` | Keep going — the conversation is progressing | Switch to other agent, start next turn |
| `extend` | Need one more turn to assess | Increase `maxTurns` by 1 (up to absolute max of 5), then continue |
| `accept` | Strike zone confirmed, asymmetric upside identified — propose conversation | Terminal: creates Opportunity with status `'pending'` |
| `decline` | Clear mismatch in mandate, scope, or timing | Terminal: no Opportunity; outcome `'disengaged'` |
| `defer` | Timing mismatch but possible future value | Terminal: no Opportunity now; outcome `'deferred'` |

**Terminal decisions** (`accept`, `decline`, `defer`) end the negotiation immediately regardless of remaining turns. Reaching `maxTurns` without a terminal decision defaults to `'deferred'`.

---

## Negotiation Graph Pipeline

```
Init          Load profiles and intents for both parties
  │           Create negotiation DB record (status: 'initiated')
  │
Turn          Active agent generates message + decision
  │           Turn record persisted; progress streamed to UI
  │
  ├─ continue ──────────────────────────────────────────┐
  │                                                      │
  ├─ extend ──► ExtensionCheck                           │
  │              │  maxTurns < 5 → new maxTurns           │
  │              └──► SwitchParticipant ─────────────────┤
  │                                                      │
  └─ accept/decline/defer                      SwitchParticipant
         │                                         │
         ▼                                         └──► Turn (loop)
      Resolution     Determine outcome enum
         │
      Persist        If 'opportunity': create Opportunity (status: pending)
                     Update negotiation record (status: resolved, outcome, resolution)
```

The graph is built by `NegotiationGraphFactory` and uses the same LangGraph conventions as the rest of the protocol (`Start → nodes → conditional edges → End`).

---

## Chat Integration

Negotiations run synchronously inside the `create_opportunities` chat tool after discovery and evaluation, before any Opportunity is persisted:

```
Chat: "find me investors"
  │
  ├─ Opportunity Graph runs (discovery + evaluation)
  │   → scored candidates: [Alice (0.87), Bob (0.75), Carol (0.66)]
  │
  ├─ runNegotiations() runs concurrently (up to 3 at a time)
  │   → Alice: accept → Opportunity created (pending)
  │   → Bob:   decline → no Opportunity
  │   → Carol: defer → no Opportunity, flagged for later
  │
  └─ Tool returns only Alice as a result card
```

Progress events stream to the frontend as `negotiation_progress` events via `context.streamWriter`:

```typescript
{
  type: "negotiation_progress",
  negotiationId: "uuid",
  candidateUserId: "alice-id",
  candidateName: "Alice",
  eventType: "start" | "turn" | "end",
  turn: 1,
  maxTurns: 3,
  speaker: "user_agent" | "candidate_agent",
  message: "Early infra for agent coordination. High upside if distribution compounds.",
  decision: "continue",
  outcome: "opportunity",   // only on "end" events
}
```

These are rendered by `ToolCallsDisplay` in the frontend as a real-time negotiation trace.

### Concurrency and Timeouts

| Setting | Value |
|---------|-------|
| Concurrency (parallel negotiations per tool call) | 3 |
| Max turns per negotiation (default) | 3 |
| Absolute max turns (after extensions) | 5 |
| Per-negotiation timeout | 30 seconds |

---

## Async Path (Queue)

In addition to the synchronous chat path, the `NegotiationQueue` (BullMQ) supports background negotiation jobs. This is used when opportunity discovery is triggered by a background job (e.g. a new intent or index member event) rather than a chat interaction.

`triggerNegotiationsForDiscovery()` (`negotiation.integration.ts`) takes discovery candidates and enqueues one job per candidate pair. The queue processes them asynchronously with the same `NegotiationGraph` pipeline.

**Important**: The synchronous `runNegotiations()` runner and the queue are separate code paths. Never use both for the same discovery event — each handles its own DB persistence.

---

## Outcomes and Their Effects

| Outcome | Meaning | Result |
|---------|---------|--------|
| `opportunity` | Both agents agreed the connection is worth a human conversation | Opportunity created with `status: 'pending'`; both users notified |
| `disengaged` | At least one agent found a clear mismatch | No Opportunity; negotiation stored for reference |
| `deferred` | Timing mismatch or max turns exhausted; possible future value | No Opportunity now; negotiation stored; may be retried later |

### Opportunity created from Negotiation

When outcome is `'opportunity'`, the Persist node creates an Opportunity record with:
- `detection.source = 'negotiation'`
- `detection.negotiationId` pointing back to the negotiation record
- `status = 'pending'` (skips the normal `latent → pending` Send step)
- `actors[0].role = 'agent'` (initiator), `actors[1].role = 'patient'` (responder)
- `interpretation.category = 'negotiated_connection'`
- `interpretation.confidence = 0.85`

---

## API

Three endpoints are exposed by `NegotiationController`:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/negotiations/list` | List negotiations for the authenticated user (filterable by status, with limit/offset) |
| `POST` | `/negotiations/get` | Get full negotiation detail including turns (must be a participant) |
| `GET` | `/negotiations/stats` | Aggregate stats (total, by outcome, by status) |

All endpoints are authenticated and scoped to the requesting user's negotiations.

---

## Key Invariants

- **Agents don't commit**: The `NegotiationAgent` never implies outcomes, commitments, or probabilities — only evaluates fit.
- **Bilateral**: Both parties' agents participate in every negotiation. A single agent's `accept` is not enough; the graph runs until *both* have contributed turns or a terminal decision is reached by either side.
- **Negotiated opportunities skip `latent`**: The normal `latent → Send → pending` lifecycle does not apply. The negotiation itself is the "Send" step; the Opportunity goes straight to `pending`.
- **Timeout safety**: Any negotiation exceeding 30 seconds is abandoned with outcome `'deferred'` — it does not block the chat response.
- **Deduplication**: The opportunity enricher still runs after negotiation, so duplicate opportunities (same actor set) are merged even when they come from separate negotiations.
