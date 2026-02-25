# Opportunity Concept

> **Related**: [Latent Opportunity Lifecycle](./Latent%20Opportunity%20Lifecycle.md), [The Semantic Intersection of Profile, Intent and Opportunity](./The%20Semantic%20Intersection%20of%20Profile%2C%20Intent%20and%20Opportunity.md), Opportunity Graph (`../graphs/opportunity.graph.ts`)

## What is an Opportunity?

An **Opportunity** is a suggested connection between two or more people within a shared Index. It is the AI-detected or manually-created answer to the question: *"Who in this community can help — or be helped by — this person, given their stated intentions?"*

Opportunities are not created by users. They are **discovered** by the system — either in the background when an intent is created, or on-demand when a user asks the agent to find matches. A user's role in an opportunity (and therefore when they see it and what they can do) is determined by **actor roles**, not by who triggered discovery.

The three core entities that interact to produce an Opportunity are:

| Entity | Role in Opportunity |
|--------|---------------------|
| **Intent** | The expressed want or need that is being matched |
| **Profile** | The identity and skills context that validates the match |
| **Index** | The community scope — all discovery is index-scoped |

An Opportunity exists at the intersection of these three: one user's intent, another user's profile (or intent), and a shared Index that contains both.

---

## Data Model

```
opportunities
├── id              UUID, primary key
├── detection       JSONB — how/when/by whom the opportunity was found
│   ├── source      'opportunity_graph' | 'chat' | 'manual' | 'cron' | 'member_added'
│   ├── createdBy   userId or system identifier
│   ├── triggeredBy intentId that triggered discovery (if any)
│   └── timestamp   ISO 8601
├── actors          JSONB[] — the participants and their roles
│   ├── userId      ID of the participant
│   ├── indexId     Index where this actor is a member
│   ├── role        'agent' | 'patient' | 'peer' | 'introducer'
│   └── intent      Optional intent ID associated with this actor
├── interpretation  JSONB — the LLM's analysis of the match
│   ├── category    Type of connection (e.g. "mentorship", "collaboration")
│   ├── reasoning   Human-readable explanation (third-person perspective)
│   ├── confidence  Score 0–100
│   └── signals     Optional array of {type, weight} signal pairs
├── context         JSONB — scope information
│   ├── indexId     Index where discovery happened
│   └── conversationId  Chat session that triggered discovery (if any)
├── confidence      Numeric confidence score
├── status          Enum: latent | draft | pending | viewed | accepted | rejected | expired
└── expiresAt       Optional TTL timestamp
```

Schema source: `protocol/src/schemas/database.schema.ts`

---

## Actor Roles

Every participant in an opportunity has a **role** that controls when they can see the opportunity and what actions they can take.

| Role | Meaning | When they see it |
|------|---------|-----------------|
| `patient` | The person who **needs** something (seeker, requester) | At `latent` when there is no introducer; at `pending` when there is |
| `agent` | The person who **can offer** something (helper, provider) | At `pending` when there is no introducer; at `accepted` when there is |
| `peer` | Symmetric match — both parties benefit equally | Always, from `latent` |
| `introducer` | A curator who manually created the match | Always, from `latent` |

**Why does this matter?** The role drives the entire notification cascade. The agent sees the opportunity *last* — only after the patient has committed — so that agents are not flooded with low-quality outreach. The patient sees it first and decides whether to reach out. This asymmetry protects the agent's attention.

Role assignment is done by the **OpportunityEvaluator** LLM agent, which analyzes both parties' profiles and intents to decide which participant is the seeker and which is the provider (or whether both are peers).

---

## Status Lifecycle

```
latent
  │  (opportunity discovered; only patient/peer/introducer can see it)
  ▼
pending
  │  (patient or introducer sent it; agent can now see it)
  ▼
viewed
  │  (recipient opened it)
  ▼
accepted ✓     rejected ✗     expired ⏱
```

**`draft`** is a special status used when an opportunity is created directly from a chat session (the conversation ID is stored in `context.conversationId`). It behaves like `latent` for visibility purposes.

| Transition | Who can trigger |
|------------|-----------------|
| `latent → pending` | Introducer, patient (no introducer), peer |
| `pending → viewed` | Recipient (on open) |
| `pending/viewed → accepted` | Recipient (e.g. "Start Chat") |
| `pending/viewed → rejected` | Recipient (e.g. "Skip") |
| `latent/pending → expired` | TTL or user dismissal |

---

## Discovery: How Opportunities Are Found

Opportunities are discovered through a **LangGraph pipeline** (`opportunity.graph.ts`) that runs in two contexts:

### Background Discovery (intent-triggered)

1. User creates an intent via chat (`create_intent` tool)
2. Intent is persisted; a background job is enqueued
3. **HyDE Generator** creates *Hypothetical Document Embeddings* — synthetic descriptions of an ideal match, from multiple angles (mirror, reciprocal, mentor, collaborator, etc.)
4. HyDE embeddings are stored in `hyde_documents` table
5. An opportunity discovery job is enqueued
6. The Opportunity Graph runs: `Prep → Scope → Discovery → Evaluation → Ranking → Persist`

### On-Demand Discovery (chat query)

1. User asks the agent to "find me opportunities" or similar
2. The `create_opportunities` tool triggers `runDiscoverFromQuery()`
3. HyDE is generated on-the-fly from the query text
4. The same Opportunity Graph pipeline runs synchronously
5. Results are returned to the chat for the user to act on

### The Opportunity Graph Pipeline

```
Prep       Load user's active, indexed intents and HyDE documents
  │
Scope      Determine which indexes to search (one or all user indexes)
  │
Discovery  Vector similarity search using HyDE embeddings within the index
  │        (both source and candidate must have HyDE documents)
  │
Evaluation OpportunityEvaluator (LLM) scores each candidate pair:
  │        - Assigns actor roles (agent / patient / peer)
  │        - Writes reasoning from a third-party perspective
  │        - Gives a confidence score 0–100
  │        - Filters out scores below the minimum threshold
  │
Ranking    Sort by score, deduplicate by (source, candidate, index)
  │
Persist    Create opportunity records with status: 'latent'
           Enricher deduplicates against existing opportunities:
           - Finds overlapping opportunities (same actors)
           - Merges reasoning if semantically similar (cosine > 0.7)
           - Expires old records; creates one enriched record
```

### HyDE Strategies

HyDE (Hypothetical Document Embeddings) generates multiple synthetic "ideal match" descriptions per user, then embeds them. Each strategy targets a different type of connection:

| Strategy | What it generates |
|----------|------------------|
| `mirror` | "Who could help me?" — matches profiles to my intent |
| `reciprocal` | "Who needs what I offer?" — matches intents to my profile |
| `mentor` | Mentorship-specific framing |
| `investor` | Funding / investment framing |
| `collaborator` | Peer / partnership framing |
| `hiree` | Hiring / employment framing |

Using multiple strategies gives the vector search richer coverage than a single embedding of the raw intent text.

---

## Enrichment and Deduplication

When the pipeline discovers a new opportunity that overlaps with an existing one (same set of non-introducer actors), the **OpportunityEnricher** merges them:

1. Finds existing opportunities with the same actor set
2. Computes semantic similarity between the new reasoning and each existing one
3. If similarity exceeds the threshold (cosine distance < 0.3), merges into a single enriched record:
   - Combined reasoning
   - Merged signals
   - Status priority: `accepted > pending > rejected > latent`
4. Expires the old opportunity; creates the merged record

This prevents users from seeing many near-duplicate opportunities about the same pairing.

---

## Presentation

Opportunities are presented differently depending on the **viewer's role**. The `OpportunityPresenter` agent generates role-aware copy:

| Viewer role | Title pattern | Call to action |
|-------------|--------------|----------------|
| `patient` | *"[Name] might help you with..."* | "Send a message" |
| `agent` | *"You can help [Name] with..."* | "Check their message" |
| `peer` | *"Potential collaboration with [Name]"* | "Start a conversation" |
| `introducer` | *"[You] → [Name A] meets [Name B]"* | "Share this introduction" |

The `OpportunityCard` component in the frontend (`frontend/src/components/`) renders the card with:
- Participant avatar and name
- The presenter-generated summary text
- A "Narrator chip" (Index name or introducer name)
- Accept / Skip buttons (visible while status is `latent`, `draft`, `pending`, or `viewed`)
- Status badge once terminal (`accepted`, `rejected`, `expired`)

---

## Key Invariants

- **Index-scoped**: Opportunities only form between users who share at least one Index. Non-indexed intents cannot participate in discovery.
- **Agent creates, user sends**: All discovered opportunities start as `latent`. The user explicitly promotes them to `pending` (which triggers the notification to the other party).
- **Role drives everything**: Visibility, notification targets, and presentation copy are all derived from `actors[].role` — never hardcoded to "sender" or "receiver".
- **Dual perspective**: Each opportunity stores reasoning from a neutral third-party perspective. The presenter generates role-specific copy at render time from this stored reasoning.
- **No direct user creation**: Users cannot create opportunities themselves. They can only act on ones the system discovers, or have an `introducer` create one manually via the chat.

---

## Further Reading

- [Latent Opportunity Lifecycle](./Latent%20Opportunity%20Lifecycle.md) — Status transitions, role–visibility matrix, and the Send node in detail
- [The Semantic Intersection of Profile, Intent and Opportunity](./The%20Semantic%20Intersection%20of%20Profile%2C%20Intent%20and%20Opportunity.md) — Theoretical foundation (speech act theory, felicity conditions)
- [HyDE Strategies for Explicit Intent Matching and Retrieval](./HyDE%20Strategies%20for%20Explicit%20Intent%20Matching%20and%20Retrieval.md) — How HyDE embeddings are generated
- [Linguistic Architectures for Multi-Agent Opportunity Detection](./Linguistic%20Architectures%20for%20Multi-Agent%20Opportunity%20Detection.md) — Multi-agent detection using semantic intersection
