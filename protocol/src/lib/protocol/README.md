# Index Network Protocol

This is the protocol layer: LangGraph workflows, AI agents, chat tools, and supporting infrastructure that power intent-driven discovery.

## Directory Structure

```
protocol/src/lib/protocol/
  graphs/           8 LangGraph state machines (NAME.graph.ts)
  states/           8 graph state definitions (NAME.state.ts)
  tools/            Chat tool definitions by domain
  agents/           Flat, domain-prefixed AI agents
  streamers/        SSE streaming for chat
  support/          Infrastructure & utilities
  interfaces/       Adapter contracts (database, embedder, cache, queue, scraper)
  docs/             Design papers and templates
```

## Graphs

| Graph | File | Purpose |
|-------|------|---------|
| Chat | `chat.graph.ts` | ReAct agent loop — LLM calls tools, responds to user |
| Intent | `intent.graph.ts` | Extract, verify, reconcile, and persist intents |
| Profile | `profile.graph.ts` | Generate/update user profiles with scraping and embedding |
| Opportunity | `opportunity.graph.ts` | HyDE-based discovery: search, evaluate, rank, persist |
| HyDE | `hyde.graph.ts` | Generate hypothetical documents and embed them (cache-aware) |
| Index | `index.graph.ts` | Manage index CRUD |
| Index Membership | `index_membership.graph.ts` | Manage index member join/leave |
| Intent Index | `intent_index.graph.ts` | Evaluate and assign/unassign intents to indexes |

## Agents

| Agent | File | Used By |
|-------|------|---------|
| ChatAgent | `chat.agent.ts` | Chat graph — orchestrates tool calls |
| Chat Prompt | `chat.prompt.ts` | Chat graph — system prompt and context builder |
| Title Generator | `chat.title.generator.ts` | Chat service — generates conversation titles |
| Intent Inferrer | `intent.inferrer.ts` | Intent graph — extracts intents from content |
| Intent Reconciler | `intent.reconciler.ts` | Intent graph — decides create/update/expire actions |
| Intent Verifier | `intent.verifier.ts` | Intent graph — validates felicity conditions |
| Intent Indexer | `intent.indexer.ts` | Intent Index graph — scores intent-index fit |
| Profile Generator | `profile.generator.ts` | Profile graph — generates profiles from identity data |
| Profile HyDE Gen | `profile.hyde.generator.ts` | Profile graph — generates HyDE docs for profiles |
| HyDE Generator | `hyde.generator.ts` | HyDE graph — generates hypothetical match documents |
| HyDE Strategies | `hyde.strategies.ts` | HyDE graph — strategy registry (mirror, reciprocal, etc.) |
| Opp. Evaluator | `opportunity.evaluator.ts` | Opportunity graph — scores and synthesizes matches |

## Tools (Chat)

| File | Tools |
|------|-------|
| `profile.tools.ts` | read_user_profiles, create_user_profile, update_user_profile |
| `intent.tools.ts` | read_intents, create_intent, update_intent, delete_intent, create_intent_index, read_intent_indexes, delete_intent_index |
| `index.tools.ts` | read_indexes, read_users, create_index, update_index, delete_index, create_index_membership |
| `opportunity.tools.ts` | create_opportunities, list_my_opportunities, send_opportunity |
| `utility.tools.ts` | scrape_url, confirm_action, cancel_action |

## Core Concepts

| Concept | Description |
|---------|-------------|
| **User** | Identity (session auth). Has one profile and many intents. Member of indexes. |
| **Intent** | What someone is seeking or offering. Has payload, embedding, status, semantic governance fields. Lives in indexes via intent_indexes. |
| **Index** | A community/context. Has members with roles, optional prompt for LLM evaluation, join policy. Discovery is index-scoped. |
| **Profile** | User's identity, narrative, skills, interests. Has vector embedding and optional HyDE embedding. Used for verification and search. |
| **Opportunity** | A suggested connection between two parties in an index. Status: latent -> pending -> accepted/rejected/expired. |
| **HyDE** | Hypothetical Document Embeddings. Generated "ideal match" text per strategy, then embedded for richer semantic search. |

## How a User Message Flows Through the System

When a user sends a message, everything starts at the Chat Graph. The agent decides which tools to call, and those tools invoke subgraphs.

### High-Level Flow

```mermaid
sequenceDiagram
    participant User
    participant ChatGraph as Chat Graph
    participant Agent as ChatAgent
    participant Tools as Chat Tools
    participant SubGraphs as SubGraphs

    User->>ChatGraph: message + userId + indexId?
    ChatGraph->>ChatGraph: Load session context + truncate tokens
    ChatGraph->>Agent: ChatAgent.create(context)
    Note over Agent: Resolve user name/email, index name from DB
    Note over Agent: Build system prompt with session context
    loop ReAct Loop (max 12 iterations)
        Agent->>Agent: LLM decides: call tools or respond?
        alt Tool calls
            Agent->>Tools: Execute tool(s)
            Tools->>SubGraphs: Invoke subgraph if needed
            SubGraphs-->>Tools: Result
            Tools-->>Agent: Tool result string
        else Final response
            Agent-->>ChatGraph: responseText + messages
        end
    end
    ChatGraph-->>User: Stream response via SSE
```

### What Happens Inside the Agent Loop

The ChatAgent is a ReAct-style loop. Each iteration, the LLM sees the full conversation (system prompt + messages + tool results) and either makes tool calls or produces a final response.

```mermaid
flowchart TD
    Start([User message arrives]) --> Init[ChatAgent.create]
    Init --> |"Resolve user/index from DB\nBuild system prompt\nCompile all subgraphs\nBind 22 tools to LLM"| Loop

    Loop[LLM Iteration] --> Decision{Tool calls\nor response?}
    Decision --> |Tool calls| Execute[Execute tools in parallel]
    Execute --> |Add ToolMessage results| Loop
    Decision --> |Response text| Done([Return to user])

    Loop --> |Iteration 8+| Nudge[Inject nudge: wrap up soon]
    Nudge --> Decision
    Loop --> |Iteration 12| ForceExit([Force exit])
```

### Example: "Create a profile for me"

```mermaid
sequenceDiagram
    participant User
    participant Agent as ChatAgent
    participant PT as create_user_profile
    participant PG as Profile Graph

    User->>Agent: "Create a profile for me"
    Agent->>PT: create_user_profile({})
    PT->>PT: Check user fields (name, email, URLs)
    alt Missing name/email
        PT-->>Agent: "Need name and LinkedIn URL"
        Agent-->>User: "What's your full name and LinkedIn?"
        User->>Agent: "John Doe, linkedin.com/in/johndoe"
        Agent->>PT: create_user_profile({name, linkedinUrl})
    end
    PT->>PG: invoke(userId, mode: write, forceUpdate: true)
    Note over PG: scrape web for identity
    Note over PG: ProfileGenerator builds profile
    Note over PG: embed profile (pgvector)
    Note over PG: HydeGenerator creates HyDE doc
    Note over PG: embed HyDE doc
    PG-->>PT: profile created
    PT-->>Agent: "Profile created successfully"
    Agent-->>User: "Your profile has been created with..."
```

### Example: "I'm looking for a React co-founder"

```mermaid
sequenceDiagram
    participant User
    participant Agent as ChatAgent
    participant RI as read_intents
    participant CI as create_intent
    participant IG as Intent Graph
    participant CO as create_opportunities
    participant OG as Opportunity Graph
    participant HG as HyDE Graph

    User->>Agent: "I'm looking for a React co-founder"
    Agent->>RI: read_intents({allUserIntents: true})
    RI-->>Agent: existing intents list

    Agent->>CI: create_intent({content: "Looking for React co-founder", indexId})
    CI->>IG: invoke(userId, inputContent, mode: create)
    Note over IG: IntentInferrer extracts intent
    Note over IG: SemanticVerifier checks quality
    Note over IG: IntentReconciler decides: create
    Note over IG: Executor persists to DB
    IG-->>CI: intent created
    CI->>CO: Auto-runs discovery for new intent
    CO->>OG: invoke(userId, sourceText, indexId)
    OG->>HG: Generate HyDE embeddings
    Note over HG: mirror + reciprocal strategies
    HG-->>OG: embeddings
    Note over OG: Vector search in index
    Note over OG: OpportunityEvaluator scores matches
    Note over OG: Dedupe + rank
    Note over OG: Persist as latent opportunities
    OG-->>CO: opportunities found
    CO-->>Agent: "Created intent + found 3 opportunities"
    Agent-->>User: "Intent created. I found 3 potential matches..."
```

### Example: "Find me opportunities" (ad-hoc discovery)

```mermaid
sequenceDiagram
    participant User
    participant Agent as ChatAgent
    participant CO as create_opportunities
    participant OD as opportunity.discover
    participant OG as Opportunity Graph
    participant HG as HyDE Graph
    participant DB as Database

    User->>Agent: "Find me opportunities in my AI network"
    Agent->>CO: create_opportunities({query, indexId})
    CO->>OD: runDiscoverFromQuery(query, userId, indexId)
    OD->>OD: selectStrategiesFromQuery(query)
    OD->>OG: invoke(userId, query as sourceText, strategies)
    OG->>HG: Generate HyDE embeddings per strategy
    HG-->>OG: strategy embeddings
    OG->>DB: Vector search (pgvector similarity)
    OG->>OG: OpportunityEvaluator scores candidates
    OG->>OG: Rank + dedupe
    OG->>DB: Persist opportunities (status: latent)
    OG-->>OD: opportunities
    OD->>DB: Enrich with profile names/bios
    OD-->>CO: formatted candidates
    CO-->>Agent: opportunity summaries
    Agent-->>User: "Here are 4 potential connections..."
```

### Example: Destructive action with confirmation

```mermaid
sequenceDiagram
    participant User
    participant Agent as ChatAgent
    participant DI as delete_intent
    participant CA as confirm_action

    User->>Agent: "Delete my React co-founder intent"
    Agent->>DI: delete_intent({id: "abc-123"})
    DI->>DI: Store pending confirmation in state
    DI-->>Agent: "needsConfirmation: delete intent 'React co-founder'"
    Agent-->>User: "Are you sure you want to delete this intent?"
    User->>Agent: "Yes"
    Agent->>CA: confirm_action({})
    CA->>CA: Execute stored pending action
    Note over CA: Intent Graph runs delete pipeline
    CA-->>Agent: "Intent deleted successfully"
    Agent-->>User: "Done, your intent has been deleted."
```

### Tool-to-Subgraph Mapping

```mermaid
flowchart LR
    subgraph tools [Chat Tools]
        PT[profile.tools]
        IT[intent.tools]
        IdxT[index.tools]
        OT[opportunity.tools]
        UT[utility.tools]
    end

    subgraph graphs [SubGraphs]
        PG[Profile Graph]
        IG[Intent Graph]
        IxG[Index Graph]
        IMG[Index Membership Graph]
        IIG[Intent Index Graph]
        OG[Opportunity Graph]
        HG[HyDE Graph]
    end

    PT --> PG
    IT --> IG
    IT --> IIG
    IT --> OG
    IdxT --> IxG
    IdxT --> IMG
    OT --> OG
    OG --> HG
```

## Business Logic Flows

### Intent Lifecycle

Handled by the **Intent Graph**:
- **Create**: prep -> inference (ExplicitIntentInferrer) -> verification (SemanticVerifier) -> reconciler (create/update/expire) -> executor (DB persist)
- **Update**: same pipeline with `update` mode and optional target intent IDs
- **Delete**: prep -> reconciler -> executor (no inference/verification)

Intent-index assignment is separate, handled by the **Intent Index Graph** when the user acts in chat.

### Profile Lifecycle

Handled by the **Profile Graph** in two modes:
- **Query**: load existing profile only
- **Write**: check_state -> scrape (if needed) -> generate_profile -> embed_save_profile -> generate_hyde -> embed_save_hyde

### Opportunity Discovery

Handled by the **Opportunity Graph**:
1. **Prep**: load user's index memberships and active intents
2. **Scope**: determine which indexes to search
3. **Discovery**: HyDE generation -> vector search within target indexes
4. **Evaluation**: OpportunityEvaluator scores and synthesizes dual interpretations
5. **Ranking**: sort by score, dedupe by (source, candidate, index)
6. **Persist**: create opportunity records in `latent` status

Opportunities are created when users ask ("find me opportunities") or when intents are created. Users explicitly "send" to promote latent -> pending.

### Chat as Orchestration

The **Chat Graph** is a ReAct loop: one agent_loop node where the LLM decides to call tools or respond. All protocol operations are accessible through tools. Destructive actions (update/delete) require user confirmation via confirm_action/cancel_action.

## Key Invariants

- **Index-scoped discovery**: opportunities only between intents sharing an index
- **Dual synthesis**: each opportunity has interpretations for both parties
- **Agent creates, user sends**: opportunities start as latent drafts
- **Destructive actions require confirmation**: update/delete go through pending confirmation flow
- **Intent quality gates**: SemanticVerifier checks felicity conditions before persistence

## Support Files

| File | Purpose |
|------|---------|
| `protocol.logger.ts` | Protocol-layer logging with call-scoped tracing |
| `chat.checkpointer.ts` | PostgresSaver singleton for LangGraph state persistence |
| `chat.utils.ts` | Token counting and context window management |
| `opportunity.discover.ts` | Ad-hoc discovery from chat queries |
| `opportunity.presentation.ts` | Pure presentation layer for opportunity cards |
| `opportunity.utils.ts` | HyDE strategy selection and actor role derivation |

## Data Model

Full schema: `protocol/src/schemas/database.schema.ts`

Core tables: `users`, `user_profiles`, `intents`, `indexes`, `index_members`, `intent_indexes`, `opportunities`, `hyde_documents`, `chat_sessions`, `chat_messages`.
