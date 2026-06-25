# Latent Opportunity Lifecycle

> **Status**: Design
> **Related**: Opportunity Graph (`../graphs/opportunity.graph.ts`), Chat Graph, Intent Graph

## Motivation

Users should not create opportunities directly. Instead, the agent discovers, evaluates, and presents opportunities — and the user chooses to act on them (send, dismiss, or explore). Visibility of an opportunity is **role-based**: who can see it at each status depends on the actor's role (introducer, patient, agent, peer, party), not on who triggered discovery.

### Target Experience

```
User:  "Hey agent, find opportunities for me"
Agent: [Runs opportunity graph: prep → scope → discovery → evaluation → ranking → persist]
       "Here are some draft opportunities. You can send an intro when ready."

User sees only the drafts they are allowed to see (by role). User chooses to send or dismiss.
When user sends, the system notifies the appropriate next person based on roles.
```

## Role-Based Visibility Model

Who can see an opportunity is determined by **actor role** and **status**. Two distinct predicates govern this:

- **`canUserSeeOpportunity`** — read-level ACL for fetching opportunity details. Broadly: introducer and peer always see; patient/party/agent see when the opportunity has cleared the introducer gate or has no introducer. Details in `opportunity.utils.ts`.
- **`isActionableForViewer`** — home feed visibility ("act on this now"). Governed by the introducer's `approved` flag, not a tier/send sequence. See the Role–Visibility Matrix below.

### Role–Visibility Matrix (Home / Actionable)

Whether an opportunity shows up on the viewer's **home feed** (the "act on this now" surface). The broader read-level ACL is covered by `canUserSeeOpportunity` and is unchanged here.

The `introducer` actor carries an `approved: boolean` field on its `actors` JSONB entry. Default `false` at creation; flipped to `true` by `updateOpportunityActorApproval` when the introducer approves the match. Status remains `latent` across the flip — the change is actor-level, not status-level. After approval, a background negotiation runs; on accept the status moves to `pending`; on reject to `rejected`.

| Status | No introducer | Has introducer, `approved=false` | Has introducer, `approved=true` |
|---|---|---|---|
| `latent` | all actors | **introducer only** | all non-introducer actors |
| `pending` | all non-introducer actors | all non-introducer actors | all non-introducer actors |
| `accepted` / `rejected` / `expired` / `stalled` / `draft` / `negotiating` | not on home | not on home | not on home |

Rules, expressed compactly:

- **Introducer**: actionable iff `status === 'latent'` **and** `approved !== true`.
- **Patient / party / agent / peer**: actionable iff
  - `status === 'pending'`, **or**
  - `status === 'latent'` **and** (no introducer **or** introducer is approved).

> **Terminal statuses (`accepted`, `rejected`, `expired`)** never appear on home. `accepted` opportunities surface only in the conversations sidebar because the counterparty is now a contact.
>
> **`stalled`** is not in `DEFAULT_HOME_STATUSES`; the home graph never loads it in the default path.
>
> **`draft`** is the chat-orchestrator equivalent of `pending` and is internal to that flow; it never reaches the home feed.
>
> **Future work — peer + introducer interaction:** the current rule treats `peer` like `patient` / `agent` under introducer gating (hidden while `approved=false`). If we add a scenario where peer opportunities can exist alongside an introducer (currently they don't in the model), revisit this row.

## Three Scenarios

### Scenario 1: Introducer Recommends Two People (A introduces B ↔ C)

- **Latent**: Only the introducer (A) sees the opportunity.
- **A sends** → status becomes `pending`. The **patient** (e.g. B) is notified and can now see it.
- **Patient sends message** (e.g. "Start Chat") → status becomes `accepted`. The **agent** (C) now sees it and is auto-added to the chat.

```mermaid
sequenceDiagram
    participant A as Introducer
    participant B as Patient
    participant C as Agent
    participant Sys as System

    Note over Sys: Opportunity created (latent). Only A sees it.
    A->>Sys: Send opportunity
    Sys->>B: Notify (pending)
    Note over B: B sees opportunity, can act
    B->>Sys: Accept / Start Chat
    Sys->>C: Notify (accepted). C sees it + chat.
```

### Scenario 2: User Discovers Connection with Someone Else (B discovers B ↔ C)

- **Latent**: The **patient** (B) sees it (B is the discoverer and has the "need" role in this example). If B were the **agent** (has something to offer), B would **not** see the draft — only the patient (C) would see it once sent.
- **B sends** → `pending`. The **agent** (C) is notified and can accept/reject.
- **C accepts** → `accepted`; both see it and chat starts.

```mermaid
sequenceDiagram
    participant B as Patient_Discoverer
    participant C as Agent
    participant Sys as System

    Note over Sys: Opportunity created (latent). B sees it.
    B->>Sys: Send opportunity
    Sys->>C: Notify (pending)
    C->>Sys: Accept or Skip
    Sys->>B: Accepted → both in chat
```

### Scenario 3: Peer Match (Both Are Peers)

- **Latent**: **Both** peers see the opportunity.
- **Either peer sends** → `pending`. The other peer is notified.
- **Other peer accepts** → `accepted`; both can start talking.

```mermaid
sequenceDiagram
    participant P1 as Peer1
    participant P2 as Peer2
    participant Sys as System

    Note over Sys: Opportunity created (latent). Both see it.
    P1->>Sys: Send opportunity
    Sys->>P2: Notify (pending)
    P2->>Sys: Accept
    Note over Sys: accepted; both see it
```

## Status Transitions

| Transition                      | Trigger                                                                 |
|---------------------------------|-------------------------------------------------------------------------|
| create → `latent`               | Discovery graph (introducer-gated branches) or chat orchestrator.       |
| create → `pending`              | Ambient discovery graph (no introducer).                                |
| `latent` + introducer approves  | `updateOpportunityActorApproval` sets `actor.approved=true`; status unchanged; negotiation enqueued. |
| `latent` / `pending` → `negotiating` | Negotiation graph starts a turn cycle.                              |
| `negotiating` → `pending`       | Negotiation graph finalize, `lastTurn.action === 'accept'`.             |
| `negotiating` → `rejected`      | Negotiation graph finalize, `lastTurn.action === 'reject'`.             |
| `negotiating` → `stalled`       | Negotiation graph finalize, other/no terminal action.                   |
| `pending` → `accepted`          | User action (e.g. Start Chat / `update_opportunity`).                   |
| any → `expired`                 | Expiry job.                                                             |

## Notification Targeting

When an opportunity transitions to `pending`, **only the role that becomes newly visible** is notified:

- **Introducer path** (`negotiating → pending` after approval): notify **patient** (and party if present); agent is notified later on `pending → accepted`.
- **No introducer — patient/party initiates**: notify **agent**.
- **No introducer — ambient** (`create → pending`): notify the non-discovering actor(s) based on the roles assigned by the evaluator.
- **Peer** sends: notify the **other peer(s)**.

No schema changes are required; targeting is derived from `actors[].role`.

## Key Constraint: Network-Scoped Discovery

**Opportunities only exist between intents that share the same index.** Non-indexed intents cannot participate in opportunity discovery. This ensures:

- Privacy: Users control which indexes they join and what they share
- Relevance: Network prompts guide matching
- Scalability: Search space is bounded by network membership

## Lifecycle State Diagram

```mermaid
stateDiagram-v2
    [*] --> latent: Agent creates (introducer-gated)
    [*] --> pending: Agent creates (ambient / no introducer)
    latent --> negotiating: Introducer approves → negotiation enqueued
    latent --> expired: User dismisses / TTL
    negotiating --> pending: Negotiation accepts
    negotiating --> rejected: Negotiation rejects
    negotiating --> stalled: No terminal action
    pending --> accepted: User accepts (Start Chat)
    pending --> rejected: User declines
    pending --> expired: TTL
```

## Opportunity Graph Architecture

### Graph Structure (Linear Multi-Step Workflow)

```mermaid
graph LR
    START([START]) --> Prep[Prep Node]
    Prep --> Check{Has indexed intents?}
    Check -->|No| Empty([Return empty])
    Check -->|Yes| Scope[Scope Node]
    Scope --> Discovery[Discovery Node]
    Discovery --> Evaluation[Evaluation Node]
    Evaluation --> Ranking[Ranking Node]
    Ranking --> Persist[Persist Node]
    Persist --> END([END])
```

**Linear Flow:** `Prep → Scope → Discovery → Evaluation → Ranking → Persist → END`

**Node Responsibilities:**

1. **Prep Node**: Fetches user's active indexed intents with hyde documents; validates at least one indexed intent.
2. **Scope Node**: Determines target indexes (single or all user indexes).
3. **Discovery Node**: Vector similarity search on hyde embeddings within network scope; returns candidate pairs.
4. **Evaluation Node**: OpportunityEvaluator (LLM) scores each candidate and assigns **valency role** (Agent / Patient / Peer). This role drives visibility and notifications.
5. **Ranking Node**: Sorts by score, applies limit, deduplicates.
6. **Persist Node**: Creates opportunities with `status: 'latent'` and assigns actor roles from valency.

### Send Node (CRUD Path)

- Validates opportunity is latent and caller is an actor.
- **Authorization**: Only non-introducer actors who can see at latent (peer, patient without introducer, party without introducer) can send. The introducer's action is `updateOpportunityActorApproval` (actor-level flip), which enqueues a background negotiation rather than directly promoting status.
- Updates status to `pending` and queues notifications only to the role that becomes visible (see Notification Targeting above).

## How LLM Agents Use Role Information

| Agent | Use of roles |
|-------|------------------|
| **OpportunityEvaluator** | Assigns valency (Agent / Patient / Peer). System prompt explains that this choice controls who sees the opportunity and when — Agent last, Patient early, Peer both. |
| **OpportunityPresenter** | Receives `viewerRole`. Suggests role-appropriate actions (e.g. patient: "Send a message to start the conversation"; agent: "Someone is interested — check their message"; introducer: "Share this with [name]"). |
| **Chat agent** | Prompt explains role-based visibility in natural language (no jargon). Tool descriptions state that `update_opportunity` with `status: "pending"` notifies "the next person in the connection" based on roles, and that `list_opportunities` only returns opportunities the user is allowed to see. |

## Chat Tools

| Tool | Behavior |
|------|----------|
| `discover_opportunities` | Invokes opportunity graph; creates draft (latent) opportunities. Discovered opportunities may not all be visible to the user depending on their role in each match. |
| `list_opportunities` | Returns opportunities the user is allowed to see (role + status). Filtered by visibility guard in `getOpportunitiesForUser`. |
| `update_opportunity` (with `status: "pending"`) | Promotes latent → pending. System notifies the appropriate next person by role (patient if sent by introducer, agent if sent by patient, other peer if sent by peer). |

## Data Flow (Discovery and Send)

Discovery flow is unchanged: user or agent calls `discover_opportunities` → graph runs Prep through Persist → opportunities created as latent. List and send use the same graph in read/send mode; `getOpportunitiesForUser` applies the role-based visibility guard so only allowed opportunities are returned. On send, only the next-tier role is notified.

## Hyde Documents and Semantic Search

Discovery uses hyde embeddings for vector similarity within network scope. Both source and candidate must have hyde documents. The evaluator assigns valency (and thus actor roles) from profile and intent context; that assignment is persisted and used for visibility and notifications only — no extra schema fields.

## Future Extensions

- Notification on pending → accepted (agent notified when patient sends message).
- Chat creation on accept.
- Auto-expire latent after N days.
- Batch send; UI card view with send/dismiss.
- Fast path: list-only and send-only routes without running discovery.
