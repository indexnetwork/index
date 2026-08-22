# Index Network Protocol

This package implements the Index Network protocol. Its supported consumer
import is the package root; source directories below are package-private.

`protocol/` contains portable contracts, `platform/` contains host ports only,
`capabilities/` contains named executable behavior, and `internal/` contains all
graphs, prompts, agents, retrieval, and implementation helpers. See
[`../docs/protocol-kernel.md`](../docs/protocol-kernel.md).

## Directory Structure

```
packages/protocol/src/
  protocol/         Stable, framework-free protocol concepts and deterministic rules
  capabilities/     Small host-facing entry points for supported behaviors
  platform/         Host-supplied port contracts, grouped by concern
  internal/         Graphs, prompts, agents, retrieval, tests, and implementation helpers
  index.ts           Curated package API only
```

The existing domain-first implementation tree now lives under `internal/`.
`Intents`, `Networks`, `Contexts`, `Contacts`, `Opportunities`, `Negotiations`,
`Agents`, and `Discovery` are executable capability modules; consumers continue
to import only from the package root. `platform/`
defines TypeScript ports for a host to implement; it contains no adapter,
controller, web, database, queue, cache, or dependency-wiring implementation.
Those belong in the consuming host.

Hosts provide request-context storage with `setRequestContextStore()` and log
output with `setLoggerFactory()`. The package does not implement
`AsyncLocalStorage`, console logging, or any other host runtime adapter.


## Graphs

| Graph | File | Purpose |
|-------|------|---------|
| Chat | `internal/chat/chat.graph.ts` | ReAct agent loop — LLM calls tools, responds to user |
| Intent | `internal/intents/graph/intent.graph.ts` | Clarify, infer, verify felicity conditions, reconcile, and persist intents |
| Enrichment | `internal/enrichment/enrichment.graph.ts` | Generate/update user identity with scraping and embedding (decomposes into premises) |
| Premise | `internal/premises/premise.graph.ts` | Decompose self-descriptive input into atomic premises, classify/score felicity, index + assign to networks |
| Opportunity | `internal/opportunities/opportunity.graph.ts` | HyDE-based discovery: search, evaluate (valency), rank, persist |
| HyDE | `internal/discovery/hyde.graph.ts` | Infer search lenses, generate hypothetical documents per lens/corpus, and embed them (cache-aware) |
| Network | `internal/networks/network.graph.ts` | Manage network CRUD |
| Network Membership | `internal/networks/membership.graph.ts` | Manage network member join/leave |
| Intent Indexer | `internal/networks/indexer.graph.ts` | Evaluate and assign/unassign intents to indexes |
| Radar | `internal/opportunities/radar/radar.graph.ts` | Build the radar view: flat presenter-card list, optionally intent-scoped |
| Maintenance | `internal/maintenance/maintenance.graph.ts` | Periodic maintenance tasks (radar health, opportunity expiration) |
| Negotiation | `internal/negotiations/negotiation.graph.ts` | Multi-turn bilateral negotiation flows |

## Agents

| Agent | File | Used By |
|-------|------|---------|
| ChatAgent | `internal/chat/chat.agent.ts` | Chat graph — orchestrates ReAct loop and tool calls |
| Chat Prompt | `internal/chat/chat.prompt.ts` | Chat graph — system prompt and context builder |
| Chat Prompt Modules | `internal/chat/chat.prompt.modules.ts` | Chat graph — composable prompt modules |
| Title Generator | `internal/chat/chat.title.generator.ts` | Chat service — generates conversation titles |
| Chat Suggester | `internal/chat/chat.suggester.ts` | Chat — generates proactive reply suggestions |
| Chat Summarizer | `internal/chat/chat.summarizer.ts` | Chat — produces a read-through digest of a chat session |
| Chat Interrupt Classifier | `internal/chat/chat.interrupt.classifier.ts` | Chat — classifies whether a new message interrupts an in-flight turn |
| Intent Clarifier | `internal/intents/verification/intent.clarifier.ts` | Intent tools — checks specificity (entropy threshold) before persisting |
| Intent Inferrer | `internal/intents/inference/intent.inferrer.ts` | Intent graph — extracts structured intents from free text |
| Intent Reconciler | `internal/intents/inference/intent.reconciler.ts` | Intent graph — determines create/update/expire action (Donnellan's distinction) |
| Intent Verifier | `internal/intents/verification/intent.verifier.ts` | Intent graph — classifies speech act type; scores felicity conditions and semantic entropy |
| Intent Indexer | `internal/intents/indexing/intent.indexer.ts` | Intent Network graph — scores intent-network fit as relevancy score |
| Enrichment Generator | `internal/enrichment/enrichment.generator.ts` | Enrichment graph — generates structured identity from raw data |
| Enrichment Enricher | `internal/enrichment/enrichment.enricher.ts` | Identity enrichment — display name and metadata enrichment |
| Premise Decomposer | `internal/premises/premise.decomposer.ts` | Premise graph — decomposes free text into atomic, first-person self-descriptive premises |
| Premise Analyzer | `internal/premises/premise.analyzer.ts` | Premise graph — classifies the premise speech act (declarative/assertive) and scores felicity |
| Premise Indexer | `internal/premises/premise.indexer.ts` | Premise graph — embeds premises and scores network fit for assignment |
| User Context Generator | `internal/contexts/context.generator.ts` | Enrichment / UserContextQueue — synthesizes network-scoped context paragraphs from a user's premises |
| Questioner Agent | `internal/questions/question.agent.ts` | Questioner queue — mode-driven structured decision-question generation (enrichment/intent/negotiation/discovery) |
| Network Recommender | `internal/networks/network.recommender.ts` | Network flows — ranks networks against a user's synthesized context |
| HyDE Generator | `internal/discovery/hyde.generator.ts` | HyDE graph — generates a hypothetical match document per lens, in the target corpus voice |
| HyDE Strategies | `internal/discovery/hyde.strategies.ts` | HyDE graph — lens type re-exports and per-corpus prompt templates |
| Lens Inferrer | `internal/discovery/lens.inferrer.ts` | HyDE graph — infers 1–N free-text search lenses; the `profiles` compatibility hint resolves to premise retrieval, alongside intent and premise targets |
| Opportunity Evaluator | `internal/opportunities/opportunity.evaluator.ts` | Opportunity graph — scores matches; assigns valency role (Agent/Patient/Peer) |
| Opportunity Presenter | `internal/opportunities/opportunity.presenter.ts` | Home graph, opportunity tools — generates role-appropriate descriptions (Grice's Maxim of Relation) |
| Opportunity Introducer | `internal/opportunities/opportunity.introducer.ts` | Introducer-driven contact-pair discovery |
| Questioner Agent | `internal/questions/question.agent.ts` | Mode-driven decision-question generation (discovery, intent, enrichment, negotiation, chat) |
| Contact Inviter | `internal/contacts/contact.inviter.ts` | Invite flow — generates personalized invite messages |
| Index Negotiator | `internal/negotiations/negotiation.agent.ts` | Negotiation graph — system AI that drafts/evaluates a turn when no personal agent responds |
| Negotiation Insights Generator | `internal/negotiations/insight.generator.ts` | Negotiation graph — synthesizes negotiation session insights |
| Negotiation Summarizer | `internal/negotiations/negotiation.summarizer.ts` | Negotiation — builds the discovery negotiation digest (deterministic fallback when LLM unavailable) |

## Tools (Chat)

Tools are registered in `internal/shared/agent/tool.registry.ts` and assembled per session by `internal/shared/agent/tool.factory.ts`.

| File | Tools |
|------|-------|
| `internal/enrichment/enrichment.tools.ts` | `read_user_contexts`, `preview_user_context`, `confirm_user_context`, `create_user_context`, `update_user_context`, `complete_onboarding`³, `get_enrichment_run`, `cancel_enrichment_run` |
| `internal/premises/premise.tools.ts` | `create_premise`, `read_premises`, `update_premise`, `retract_premise` |
| `internal/intents/intent.tools.ts` | `read_intents`, `create_intent`, `update_intent`, `delete_intent`, `search_intents`, `create_intent_index`, `read_intent_indexes`, `delete_intent_index` |
| `internal/networks/network.tools.ts` | `read_networks`, `create_network`, `update_network`, `delete_network`, `read_network_memberships`, `create_network_membership`, `delete_network_membership` |
| `internal/opportunities/opportunity.tools.ts` | `list_opportunities`, `update_opportunity`, `confirm_opportunity_delivery`¹ |
| `internal/contacts/contact.tools.ts`³ | `list_contacts`, `remove_contact`, `search_contacts` |
| `internal/agents/agent.tools.ts` | `read_own_agent`, `register_agent`, `list_agents`, `update_agent`, `delete_agent`, `grant_agent_permission`, `revoke_agent_permission` |
| `internal/negotiations/negotiation.tools.ts`² | `list_negotiations`, `get_negotiation`, `respond_to_negotiation` |
| `internal/questions/question.tools.ts` | `read_pending_questions` |
| `internal/shared/agent/utility.tools.ts` | `scrape_url`³, `read_docs` |

¹ `confirm_opportunity_delivery` is an OpenClaw delivery-ledger write — it is filtered out of regular chat sessions and only reachable over MCP.
² Negotiation tools are only registered when an `agentDispatcher` is provided.
³ Chat/REST-only: the contact and Gmail-import tools, `scrape_url`, and
  `complete_onboarding` are omitted from the MCP registry entirely
  (IND-596/597), as are the deprecated `*_user_profile`/`*_profile_run`
  aliases (IND-598) — none of these are MCP tools. MCP does not gate on
  web/CLI onboarding. On the MCP surface, agent administration follows the IND-599 split:
  registered agents get `read_own_agent` only; session humans get the owned
  admin tools but never `read_own_agent`; enrollment-capable keys are
  `register_agent`-only; unregistered keys fail closed.

## Core Concepts

The system models human collaboration through a linguistic and information-theoretic framework. Terminology follows Speech Act Theory (Searle), Hypothetical Document Embeddings (Gao et al.), Valency theory (Hanks), and Gricean pragmatics.

| Concept | Description |
|---------|-------------|
| **User** | Session-authenticated identity with many intents and network memberships. Presentation identity lives on `users`; semantic discovery uses premises and user contexts. |
| **Premise** | A **declarative or assertive speech act** about the self — an atomic, first-person proposition a user asserts about who they are ("I am a climate-tech founder", "I hold a PhD in computational biology"). Premises are *conditions of possibility*: facts that ground discovery, as opposed to intents, which are desires/requests. They are decomposed from enrichment input or free text, classified and felicity-scored by the Premise Analyzer, embedded, and assigned to networks. The premise graph (`internal/premises/premise.graph.ts`) owns their create/update/query lifecycle, and premise changes regenerate user contexts. |
| **User Context** | A network-scoped synthetic paragraph synthesized from a user's premises by the `UserContextGenerator`, stored with its embedding. The opportunity graph uses contexts for **context-to-intent discovery** — it loads a user's contexts and searches for matching intents, running alongside premise-to-premise discovery as a complementary strategy. Regenerated whenever the user's premises change. |
| **Intent** | A **commissive** or **directive speech act** — what the user is seeking or offering. Modelled as a Specific Indefinite: a future state uniquely satisfiable by a matching candidate. Each intent carries a **semantic entropy** score (constraint density), a **referential anchor** (Donnellan referential/attributive mode), and **felicity condition** scores (preparatory/authority and sincerity). |
| **Index** | A community scoped to a purpose. Has members with roles, an optional prompt for LLM-based evaluation, and a join policy. Discovery is network-scoped — opportunities only arise between intents that share an index. |
| **Opportunity** | A **semantic intersection**: the point where a candidate's premises, user context, or intent satisfy the propositional content of a source intent. Scored by the Opportunity Evaluator using **valency** (argument-role fit) and **constraint satisfaction**. Presented with dual descriptions per **Grice's Maxim of Relation** — one framed for the source, one for the candidate. |
| **HyDE** | Hypothetical Document Embeddings. Lens-based: the `LensInferrer` derives 1–N free-text **lenses** (search perspectives, e.g. "SF-based early-stage investor"). The live search corpora are intents and premises; a `profiles` lens remains a compatibility preference that resolves to premise retrieval because profile-vector discovery is retired. The encoder acts as a dense bottleneck filtering hallucinated specifics and retaining the semantic signal. |
| **Felicity Conditions** | Scores evaluating whether an intent is valid: **preparatory condition** (does the user have the authority/skills for this act?) and **sincerity condition** (is the commitment genuine?). Intents that fail these are classified as *misfired* or *void*. |
| **Semantic Entropy** | Constraint density of an intent (0.0 = maximally constrained, 1.0 = trivially satisfiable). High-entropy intents ("I want a job") trigger an **elaboration loop** — a request for missing constraints before persistence. |
| **Semantic Governance** | The full pipeline that ensures only actionable, felicitous, sufficiently clear intents enter the graph. Referential breadth is retained as warning metadata for user-confirmed proposal approvals and explicit updates rather than acting as a universal write prohibition. Web proposal cards are emitted only after the host's injected `IntentProposalStore` durably binds their normalized text, optional network, and complete verifier output to the owner. Implemented by the Intent Verifier and Intent Clarifier agents. |
| **Valency Roles** | Derived from the argument structure of the source intent's goal verb (Hanks). The Opportunity Evaluator assigns: **Agent** (the one who can offer/do), **Patient** (the one who needs/seeks), or **Peer** (symmetric collaboration). These roles govern opportunity visibility and the notification cascade. |

## Opportunity Lifecycle and Role-Based Visibility

The authoritative lifecycle, actor-state rules, and code citations live in [`docs/design/opportunity-status-lifecycle.md`](../../../docs/design/opportunity-status-lifecycle.md). The package predicates are `canUserSeeOpportunity` and `isActionableForViewer` in `internal/opportunities/opportunity.utils.ts`; keep their source comments aligned with that reference when either changes.

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
    Init --> |"Resolve user/index from DB\nBuild system prompt\nCompile all subgraphs\nBind tools to LLM"| Loop

    Loop[LLM Iteration] --> Decision{Tool calls\nor response?}
    Decision --> |Tool calls| Execute[Execute tools in parallel]
    Execute --> |Add ToolMessage results| Loop
    Decision --> |Response text| Done([Return to user])

    Loop --> |Iteration 8+| Nudge[Inject nudge: wrap up soon]
    Nudge --> Decision
    Loop --> |Iteration 12| ForceExit([Force exit])
```

### Example: "Set up my context"

```mermaid
sequenceDiagram
    participant User
    participant Agent as ChatAgent
    participant PT as create_user_context
    participant PG as Enrichment Graph

    User->>Agent: "Set up my context"
    Agent->>PT: create_user_context({})
    PT->>PT: Check user fields (name, email, URLs)
    alt Missing name/email
        PT-->>Agent: "Need name and LinkedIn URL"
        Agent-->>User: "What's your full name and LinkedIn?"
        User->>Agent: "John Doe, linkedin.com/in/johndoe"
        Agent->>PT: create_user_context({name, linkedinUrl})
    end
    PT->>PG: invoke(userId, mode: write, forceUpdate: true)
    Note over PG: scrape web for identity (constitutive context)
    Note over PG: EnrichmentGenerator builds structured identity
    Note over PG: create premises and regenerate user context
    Note over PG: LensInferrer infers search lenses; HyDE Generator creates per-lens docs
    Note over PG: embed HyDE docs
    PG-->>PT: context created
    PT-->>Agent: "Your context is ready"
    Agent-->>User: "Your context is ready..."
```

### Example: "I'm looking for a React co-founder"

```mermaid
sequenceDiagram
    participant User
    participant Agent as ChatAgent
    participant CI as create_intent
    participant IC as IntentClarifier
    participant IG as Intent Graph
    participant CO as background_matcher
    participant OG as Opportunity Graph
    participant HG as HyDE Graph

    User->>Agent: "I'm looking for a React co-founder"
    Agent->>CI: create_intent({content: "Looking for React co-founder", indexId})

    CI->>IC: Check semantic entropy
    Note over IC: Entropy acceptable — commissive act, specific enough
    IC-->>CI: proceed

    CI->>IG: invoke(userId, inputContent, mode: create)
    Note over IG: IntentInferrer extracts propositional content
    Note over IG: IntentVerifier scores felicity conditions (authority + sincerity)
    Note over IG: IntentReconciler: attributive mode → create (not update)
    Note over IG: Executor persists with semantic entropy + referential anchor

    IG-->>CI: intent created (felicitous)
    CI->>CO: Auto-triggers discovery
    CO->>OG: invoke(userId, sourceText, indexId)

    OG->>HG: Generate HyDE docs
    Note over HG: Profile-preference lens resolves to premise retrieval
    Note over HG: Lens → intents: complementary goal ("join as co-founder on React project")
    HG-->>OG: HyDE embeddings (dense bottleneck applied)

    Note over OG: Vector search within network scope
    Note over OG: OpportunityEvaluator: scores via valency + constraint satisfaction
    Note over OG: Assigns Patient (user) / Agent (candidate) roles
    Note over OG: OpportunityPresenter: dual descriptions (Grice's Maxim of Relation)
    Note over OG: Persist as latent — patient (user) sees draft

    OG-->>CO: opportunities found
    CO-->>Agent: "Created intent + found 3 draft opportunities"
    Agent-->>User: "Intent created. I found 3 potential matches..."
```

### Tool-to-Subgraph Mapping

```mermaid
flowchart LR
    subgraph tools [Chat Tools]
        PT[enrichment.tools]
        IT[intent.tools]
        IdxT[network.tools]
        OT[opportunity.tools]
        CT[contact.tools]
        IntT[integration.tools]
        UT[utility.tools]
    end

    subgraph graphs [SubGraphs]
        PG[Enrichment Graph]
        IG[Intent Graph]
        IxG[Network Graph]
        IMG[Membership Graph]
        IIG[Indexer Graph]
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
1. **Clarification** (pre-graph): `IntentClarifier` checks semantic entropy — if the utterance is underspecified (high entropy, trivially satisfiable), it returns an elaboration request rather than persisting.
2. **Inference**: `IntentInferrer` extracts structured intents (propositional content) from free text. Can produce multiple intents from a single input.
3. **Semantic Verification**: `IntentVerifier` classifies the speech act type (commissive, directive, assertive) and scores felicity conditions — preparatory (authority) and sincerity. Assigns `felicitous`, `misfired`, or `void` status.
4. **Reconciliation**: For creation, `IntentReconciler` applies Donnellan's distinction — referential intents (user has a specific target in mind) update an existing record; attributive intents (any member of a class) create a new one if sufficiently different. Explicit updates bypass that create-versus-update choice and bind the single verified candidate to the supplied active owned intent ID.
5. **Persistence**: Executor writes the intent with `semanticEntropy`, `referentialAnchor`, `speechActType`, and `felicityScores` fields.

### Premise & Context Lifecycle

Handled by the **Premise Graph**, **Enrichment Graph**, and **User Context Generator**:
1. **Decomposition**: `PremiseDecomposer` splits enrichment input or free text into atomic, first-person, non-redundant premises.
2. **Analysis**: `PremiseAnalyzer` classifies each premise's speech act (declarative vs. assertive) and scores its felicity conditions — premises are the *constitutive* facts that establish what a user has the authority to do.
3. **Indexing & assignment**: `PremiseIndexer` embeds each premise and scores network fit; the shared network-assignment policy (`internal/shared/assignment/network-assignment.policy.ts`) decides which networks the premise is assigned to.
4. **Context synthesis**: premise changes cascade into the `UserContextGenerator`, which regenerates the user's network-scoped context paragraph (plus embedding and HyDE docs). Cold-start mode synthesizes from all premises; incremental mode applies a single add/update/retract/expire to the existing context.
5. **Discovery feed**: stored context embeddings power **context-to-intent discovery** in the opportunity graph, complementing premise-to-premise matching.

### HyDE Pipeline

Handled by the **HyDE Graph** and **Enrichment Graph**. The pipeline is **lens-based**: instead of hardcoded strategy names, the `LensInferrer` derives 1–N free-text lenses from the source text (and optional user context), each tagged with a target corpus that selects the generation template:
- **`profiles` preference**: A compatibility hint that resolves to premise retrieval; profile-vector discovery is retired.
- **intents corpus**: Generates a complementary goal statement via meaning postulates — "If user A wants to invest, infer B wants funding" (the former *Reciprocal* strategy).
- **premises corpus**: Generates an identity/values self-description for someone whose worldview aligns with the source text.
- The former *Neighborhood* (discourse-frame) strategy was retired with the move to lenses; lens labels carry the contextual specificity instead (including location awareness).
- The encoder acts as a **dense bottleneck** — hallucinated specifics (fake names, invented details) are filtered out; only the semantic relevance signal is preserved in the embedding.

### Opportunity Discovery

Handled by the **Opportunity Graph**:
1. **Prep**: Load user's indexed intents and HyDE documents.
2. **Scope**: Determine target indexes (single or all).
3. **Discovery**: Vector similarity search within network scope. Two complementary strategies run and merge: **premise-to-premise** matching (the user's premise embeddings are searched against candidate premises) and **context-to-intent** matching (a user's network-scoped context embeddings are searched against candidate intents). (Profile-HyDE discovery was retired in WS10.)
4. **Evaluation**: `OpportunityEvaluator` scores each candidate pair via **valency** (does the candidate fill the argument slot of the source's goal verb?) and **constraint satisfaction** (does the candidate's constitutive context match all extracted constraints?). Assigns role: Agent, Patient, or Peer.
5. **Presentation**: `OpportunityPresenter` generates two descriptions per Grice's Maxim of Relation — one from the source's frame, one from the candidate's frame.
6. **Persist**: Opportunities created as `latent` with actor roles. Role determines tier-0 visibility (see Opportunity Lifecycle above).

### Chat as Orchestration

The **Chat Graph** is a ReAct loop: one `agent_loop` node where the LLM decides to call tools or respond. All protocol operations are accessible through tools. Destructive actions (update/delete) go through the intent/opportunity graph's reconciler rather than direct mutation, preserving semantic governance invariants.

## Key Invariants

- **Network-scoped discovery**: Opportunities only arise between intents sharing an index
- **Specific Indefinites only**: Underspecified (high-entropy) intents do not enter the graph — they trigger elaboration
- **Felicity-gated persistence**: Only intents classified as `felicitous` are persisted as active
- **Dual synthesis**: Each opportunity has descriptions framed for both actors (Grice's Maxim of Relation)
- **Role-based visibility**: Opportunity reveal follows a tiered cascade; agent visibility is deferred when a patient or introducer is present
- **Encoding bottleneck**: HyDE hallucinations are never stored or shown — only their embeddings are used

## Shared Infrastructure

| File | Purpose |
|------|---------|
| `internal/shared/observability/protocol.logger.ts` | Protocol-layer logging with call-scoped tracing |
| `internal/shared/agent/model.config.ts` | Centralized model and OpenRouter configuration |
| `internal/shared/agent/model-signal.ts` | Abort-signal-aware model invocation helper |
| `internal/shared/agent/tool.runtime.ts` | Per-tool timeout/output-budget runtime and stable error envelopes |
| `internal/chat/chat.streamer.ts` | Streams chat responses |
| `internal/shared/assignment/network-assignment.policy.ts` | Threshold-based network-assignment scoring and scope resolution |
| `internal/shared/network/metadata.renderer.ts` | Renders network metadata into prompt context |
| `internal/chat/chat.utils.ts` | Token counting and context window management |
| `internal/opportunities/opportunity.presentation.ts` | Pure card text generation for opportunity display |
| `internal/opportunities/opportunity.enricher.ts` | Enrich opportunity records with presentation identity data |
| `internal/opportunities/opportunity.utils.ts` | Lens-corpus → actor-role derivation, opportunity visibility, radar composition helpers |
| `internal/opportunities/opportunity.introducer.ts` | Introducer-driven contact-pair discovery |
| `internal/opportunities/opportunity.evidence.ts` | Builds and merges per-candidate opportunity evidence |
| `internal/opportunities/delivery-card.cache.ts` | Cached delivery-card batch builder for opportunity delivery |
| `internal/opportunities/radar/radar.health.ts` | Radar health metrics computation |
| `internal/opportunities/opportunity.labels.ts` | Opportunity status and role label constants |

## Data Model

This package is adapter-free and owns **no** schema — it accesses data only through the
interfaces in `internal/shared/interfaces/`. The canonical Drizzle schema lives in the backend at
`services/api/src/schemas/database.schema.ts`.

Core tables the protocol interfaces read/write:

- **Identity, premises, and context**: `users` (name/bio/location), `user_socials`, `premises`, `premise_networks`, `user_contexts`
- **Intents & networks**: `intents`, `networks`, `network_members`, `intent_networks`, `personal_networks`
- **Opportunities & discovery**: `opportunities`, `hyde_documents`, `opportunity_discovery_runs`, `enrichment_tool_runs`, `questions`
- **Agents**: `agents`, `agent_transports`, `agent_permissions`, `apikey`

> Terminology note: "index" and "network" refer to the same concept. The product
> surface says *index*; the current schema and most tool names use **network**
> (`networks`, `network_members`, `intent_networks`).
