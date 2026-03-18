# Opportunity Summary

> **Status**: Living document
> **Related**: `schemas/database.schema.ts`, `graphs/opportunity.graph.ts`, `agents/opportunity.evaluator.ts`, `agents/opportunity.presenter.ts`, `support/opportunity.*.ts`

## What Is an Opportunity?

An **opportunity** is a validated connection between two or more users where semantic alignment exists — one party's need (intent) can be satisfied by another party's capability (profile) or complementary need. Opportunities are the core output of the Index Network discovery protocol: they represent actionable introductions that emerge from the intersection of user intents, profiles, and shared community context.

Every opportunity answers: _"Why should these people meet?"_

## Core Entities

| Entity | Role | Example |
|--------|------|---------|
| **Intent** | A user's stated goal or need | "Seeking a React developer for my startup" |
| **Profile** | A user's identity and capabilities | "Alice: React expert, based in SF" |
| **Index** | A community that scopes discovery | "Founders Network" |
| **Opportunity** | A validated match between actors | "Bob needs React expertise; Alice offers it" |
| **Actor** | A participant with a defined role | Alice (agent), Bob (patient), Carol (introducer) |

## Data Model

An opportunity record contains four JSONB payloads alongside metadata:

```
┌─────────────────────────────────────────────────────────────┐
│  Opportunity                                                │
├──────────────┬──────────────────────────────────────────────┤
│  id          │  UUID primary key                            │
│  status      │  latent → pending → accepted/rejected/expired│
│  confidence  │  0–100 numeric score                         │
│  detection   │  How it was found (source, trigger, creator) │
│  actors      │  Who is involved (userId, role, intentId)    │
│  interpretation │ Why it's a match (reasoning, score, category) │
│  context     │  Scoping info (indexId, conversationId)      │
│  timestamps  │  createdAt, updatedAt, expiresAt             │
└──────────────┴──────────────────────────────────────────────┘
```

### Detection Sources

| Source | Trigger | Description |
|--------|---------|-------------|
| `opportunity_graph` | Intent HyDE generation | Background discovery after a user creates an intent |
| `chat` | User asks "find opportunities" | On-demand discovery during a chat session |
| `manual` | Explicit introduction | User introduces two people via chat |
| `cron` | Scheduled job | Periodic discovery run on a schedule |
| `member_added` | New index member joins | Discovery triggered when a member is added to an index |
| `enrichment` | Profile enrichment | New signals surface a match |

## Actor Roles

Opportunities use a **valency model** to assign roles based on who can do something for whom:

| Role | Who They Are | Analogy |
|------|-------------|---------|
| **Agent** | The provider/helper — can fulfill a need | "Can DO something for the other party" |
| **Patient** | The seeker/requester — has the need | "NEEDS something from the other party" |
| **Peer** | Symmetric collaborator — mutual benefit | "Both bring and seek value equally" |
| **Introducer** | The curator who connects two parties | "Sees the match and facilitates it" |
| **Party** | Generic participant (no introducer present) | "Involved but no directional role" |

### Role Derivation

Roles are derived from the **corpus** used during discovery:

- **Profiles corpus** (searching for people who can help) → candidate is **agent**, source is **patient**
- **Intents corpus** (searching for people who need what you offer) → candidate is **patient**, source is **agent**
- **Both match symmetrically** → both are **peers**

## Status Lifecycle

```
           ┌──[dismiss]──→ expired
           │
  latent ──┤──[send]──→ pending ──┤──[accept]──→ accepted
           │                      │
           └──[TTL]───→ expired   └──[reject]──→ rejected
```

| Status | Meaning |
|--------|---------|
| `latent` | Discovered but not yet acted upon |
| `pending` | Sent to the next actor, awaiting response |
| `viewed` | Recipient has seen the opportunity |
| `accepted` | Recipient accepted — connection established |
| `rejected` | Recipient declined |
| `expired` | Time-to-live elapsed or manually dismissed |

## Visibility Model

Visibility is **role-based and tier-gated**: not all actors see an opportunity at the same time. This protects agents from noise and gives patients/introducers control over when to surface a connection.

| Tier | Statuses | Who Can See |
|------|----------|-------------|
| **Tier 0** | `latent` | Introducer, Patient (no introducer), Peer |
| **Tier 1** | `pending`, `viewed` | Above + Patient (with introducer) |
| **Tier 2** | `accepted`, `rejected`, `expired` | All actors |

**Key rule**: An **agent** only sees the opportunity after the patient commits (accepts). This prevents providers from being overwhelmed with speculative matches.

### Three Scenarios

1. **Introducer connects two people** (A introduces B ↔ C): Only A sees at `latent` → A sends → B (patient) sees at `pending` → B accepts → C (agent) is notified
2. **User discovers a match** (B finds B ↔ C): B sees at `latent` → B sends → C (agent) is notified at `pending` → C accepts → both connected
3. **Peer match** (B ↔ C are peers): Both see at `latent` → either sends → other notified → acceptance opens a shared chat

## Discovery Flow

Opportunities are discovered through three paths:

### 1. Chat-Driven Discovery (Synchronous)

```
User: "Find opportunities for me"
  → create_opportunities tool invoked
    → HyDE embeddings generated from query (on-the-fly)
      → Vector similarity search across index members
        → LLM evaluator scores candidates and assigns roles
          → Opportunities persisted as latent
            → Formatted results returned to chat
```

### 2. Background Discovery (Asynchronous)

```
User creates an intent
  → Intent Graph generates HyDE documents (mirror + reciprocal strategies)
    → Opportunity job enqueued
      → Opportunity Queue Worker runs graph with stored HyDE
        → Candidates discovered and evaluated
          → Latent opportunities created silently
```

### 3. Manual Introduction

```
User: "Introduce Alice and Bob"
  → create_opportunities tool with partyUserIds
    → Opportunity Graph in introduction mode
      → LLM evaluates entity bundle (profiles + intents of both parties)
        → Opportunity created with introducer actor role
```

### Chat vs. Background Discovery

| Aspect | Chat Discovery | Background Discovery |
|--------|---------------|---------------------|
| Trigger | User asks in chat | Intent HyDE generation completes |
| HyDE source | Generated from search query | Stored from intent |
| Timing | Synchronous (same request) | Asynchronous (queue worker) |
| User feedback | Immediate (formatted cards) | Silent (latent opportunities) |

## Graph Architecture

The opportunity graph is a LangGraph state machine with 13 nodes organized into three flows:

```
┌─────────────────────────────────────────────────┐
│  routeByMode (conditional)                      │
├─────────────────────────────────────────────────┤
│                                                  │
│  Discovery Flow:                                 │
│    prep → scope → resolve → discovery            │
│      → evaluation → ranking → persist → END      │
│                                                  │
│  Introduction Flow:                              │
│    intro_validation → intro_evaluation            │
│      → persist → END                             │
│                                                  │
│  CRUD Operations:                                │
│    read / update / delete_opp / send → END       │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Node Responsibilities

| Node | Purpose |
|------|---------|
| **prep** | Load user intents, profile; validate index memberships |
| **scope** | Determine which indexes to search |
| **resolve** | Resolve trigger intent within scoped indexes |
| **discovery** | Vector similarity search using HyDE embeddings |
| **evaluation** | LLM scores candidates, assigns roles (agent/patient/peer) |
| **ranking** | Sort by score, deduplicate, apply limit |
| **persist** | Save opportunities with `status='latent'` |
| **intro_validation** | Validate introduction entities (profiles exist, not self-referential) |
| **intro_evaluation** | LLM evaluates multi-party entity bundle for introduction |
| **read/update/delete_opp/send** | CRUD fast paths for existing opportunities |

## Scoring & Evaluation

The **OpportunityEvaluator** agent scores candidate pairs on a 0–100 scale:

| Score Range | Label | Meaning |
|-------------|-------|---------|
| 90–100 | Must Meet | Perfect role alignment; compelling, immediate value |
| 70–89 | Should Meet | Strong overlap with clear potential |
| 50–69 | Worth Considering | Tangential overlap (introductions only) |
| < 50 | No Opportunity | Not worth surfacing |

### Evaluation Guards

- **Same-side matching**: If both parties seek the same resource (e.g., both seeking funding), no opportunity is created
- **Already-known check**: If parties clearly already know each other, skip
- **Complementary role check**: A candidate who would fund/advise rather than fill the role scores ≤ 30
- **Deduplication**: No duplicate opportunities between the same actors

## Presentation

The **OpportunityPresenter** agent generates user-facing content for each opportunity:

- **Headline**: Concise, compelling summary of the match
- **Personalized summary**: Viewer-specific explanation using "you" language
- **Suggested action**: What the viewer should do next
- **Card text**: Minimal summary for inline chat display

The presenter tailors its output to the viewer's role — an agent sees different framing than a patient or introducer.

## Integration Points

| System | How It Uses Opportunities |
|--------|---------------------------|
| **Chat Graph** | Invokes `create_opportunities` tool; displays results as cards |
| **Home Graph** | Lists opportunities with LLM-categorized sections |
| **Intent Graph** | Enqueues opportunity discovery after HyDE generation |
| **Profile Graph** | Provides user capability data for evaluation |
| **HyDE Graph** | Generates embeddings for vector similarity matching |
| **Notification Queue** | Sends notifications on status transitions |
| **Contact Service** | Auto-adds counterpart as contact on acceptance |

## Related Documentation

- [Latent Opportunity Lifecycle](./Latent%20Opportunity%20Lifecycle.md) — Role-based visibility model and status tiers
- [The Semantic Intersection of Profile, Intent and Opportunity](./The%20Semantic%20Intersection%20of%20Profile%2C%20Intent%20and%20Opportunity.md) — Linguistic theory behind matching
- [Linguistic Architectures for Multi-Agent Opportunity Detection](./Linguistic%20Architectures%20for%20Multi-Agent%20Opportunity%20Detection.md) — LLM agent strategies
- [HyDE Strategies for Explicit Intent Matching and Retrieval](./HyDE%20Strategies%20for%20Explicit%20Intent%20Matching%20and%20Retrieval.md) — Embedding generation methodology
- [Intent and Opportunity Flows](../../../docs/intent-and-opportunity-flows.md) — End-to-end flow diagrams
- [Opportunity Redesign Plan](../../../docs/opportunity-redesign-plan.md) — Architectural design specification
