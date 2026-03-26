---
title: "Protocol Deep Dive"
type: design
tags: [protocol, langgraph, agents, graphs, tools, hyde, opportunity, intent, profile, negotiation]
created: 2026-03-26
updated: 2026-03-26
---

# Protocol Deep Dive

This document is a standalone, implementation-focused guide to the AI/agent system that powers Index Network's intent-driven discovery protocol. It covers how LangGraph state machines, LLM agents, and chat tools compose into pipelines for intent processing, opportunity discovery, profile generation, and bilateral negotiation.

## 1. Overview

The protocol layer lives at `protocol/src/lib/protocol/` and is the engine behind every AI-driven operation in the system. It sits between the service/controller HTTP layer above and the database/queue infrastructure below:

```
Controllers (HTTP)
    |
Services (business logic)
    |
Protocol Layer (graphs, agents, tools, streamers)
    |
Adapters (database, embedder, cache, queue, scraper)
    |
Infrastructure (PostgreSQL + pgvector, Redis, OpenRouter LLMs)
```

The protocol layer never imports adapters directly. All infrastructure dependencies are injected through interfaces defined in `src/lib/protocol/interfaces/` (database, embedder, cache, queue, scraper, storage). This makes every graph and agent testable with mocks.

### Directory structure

```
protocol/src/lib/protocol/
  graphs/           11 LangGraph state machines ({domain}.graph.ts)
  states/           11 graph state definitions ({domain}.state.ts)
  agents/           Flat, domain-prefixed AI agents
  tools/            Chat tool definitions by domain
  streamers/        SSE streaming for chat (chat.streamer.ts, response.streamer.ts)
  support/          Infrastructure utilities (opportunity helpers, chat utils, protocol logger)
  interfaces/       Adapter contracts (database, embedder, cache, queue, scraper)
  docs/             Design papers
```

## 2. LangGraph Fundamentals

Every workflow in the protocol layer is a LangGraph `StateGraph` -- a directed graph where nodes are async functions that read and write shared state, and edges define execution order.

### Core concepts

**State annotations.** Each graph defines its state shape using `Annotation.Root` (or a plain object annotation). State fields can have reducers that control how partial updates from nodes merge into the running state. For example, an array field with an `append` reducer accumulates values across nodes instead of overwriting.

**Nodes.** Async functions that accept the current state and return a partial state update. They catch errors internally (never throw) and use the `{action}Node` naming convention. Example: `prepNode`, `inferenceNode`, `executorNode`.

**Edges.** Define the flow between nodes. Linear edges (`addEdge`) always route to a fixed next node. Conditional edges (`addConditionalEdges`) use a routing function that inspects state and returns a string key mapped to the next node name (or `END`).

**Conditional routing.** Every graph has at least one conditional edge. This is enforced by convention. The routing function must map all possible return values to valid node names or `END`.

**Factory pattern.** Each graph is built by a factory class that accepts dependencies via constructor:

```typescript
export class IntentGraphFactory {
  constructor(
    private database: IntentGraphDatabase,
    private embedder?: EmbeddingGenerator,
    private intentQueue?: IntentGraphQueue,
  ) {}

  public createGraph() {
    // define nodes, build StateGraph, compile
    return workflow.compile();
  }
}
```

The factory pattern ensures no hardcoded infrastructure dependencies. Database interfaces use `Pick<Database, ...>` for narrow contracts so each graph only depends on the methods it needs.

### Graph lifecycle

1. Factory is instantiated with injected adapters
2. `createGraph()` builds the `StateGraph`, adds nodes and edges, calls `.compile()`
3. Callers invoke the compiled graph with an input state object
4. LangGraph executes nodes in topological order, following conditional edges
5. The final state is returned to the caller

## 3. Graph Catalog

### 3.1 Chat Graph

**File:** `chat.graph.ts`
**Purpose:** ReAct-style agent loop -- the entry point for all user interactions via chat.
**Nodes:** `agent_loop`
**State:** `ChatGraphState` (userId, messages, sessionId, indexId, responseText, iterationCount, shouldContinue, error, debugMeta)
**Flow:** `START -> agent_loop -> END`

The chat graph is architecturally simple: a single node that delegates all complexity to the `ChatAgent`. The agent loop runs up to 12 iterations where the LLM decides to either call tools or produce a final response. After iteration 8, a nudge message is injected asking the agent to wrap up.

The graph supports streaming via `config.writer()` so text tokens and tool-activity events are pushed to the client in real-time rather than batched at the end. Error handling includes one retry for retriable errors (5xx, connection resets).

**Dependencies:** `ChatGraphCompositeDatabase`, `Embedder`, `Scraper`

### 3.2 Intent Graph

**File:** `intent.graph.ts`
**Purpose:** Extract, verify, reconcile, and persist user intents.
**Nodes:** `prep`, `query`, `inference`, `verification`, `reconciler`, `executor`
**State:** `IntentGraphState` (userId, inputContent, operationMode, targetIntentIds, indexId, inferredIntents, verifiedIntents, actions, executionResults, etc.)
**Conditional edges:**
- After `prep`: routes to `query` (read mode), `inference` (create/update), `reconciler` (delete), or `END` (error)
- After `inference`: routes to `verification`, `reconciler` (no intents), or `END` (propose mode with nothing)
- After `verification`: routes to `reconciler` or `END` (propose mode)

**Flow paths:**
| Mode | Path |
|------|------|
| READ | prep -> query -> END |
| CREATE | prep -> inference -> verification -> reconciler -> executor -> END |
| UPDATE | prep -> inference -> verification -> reconciler -> executor -> END |
| DELETE | prep -> reconciler -> executor -> END |
| PROPOSE | prep -> inference -> verification -> END |

The propose mode is a dry-run that extracts and verifies intents without persisting, used when the chat agent wants to preview what intents would be created.

**Dependencies:** `IntentGraphDatabase`, `EmbeddingGenerator`, `IntentGraphQueue`

### 3.3 Profile Graph

**File:** `profile.graph.ts`
**Purpose:** Generate, embed, and maintain user profiles with optional web scraping and HyDE generation.
**Nodes:** `check_state`, `scrape`, `auto_generate`, `use_prepopulated_profile`, `generate_profile`, `embed_save_profile`, `generate_hyde`, `embed_save_hyde`
**State:** `ProfileGraphState` (userId, operationMode, input, forceUpdate, profile, hydeDescription, needs* flags, etc.)
**Conditional edges:**
- After `check_state`: routes based on operation mode and what components are missing (profile, embedding, HyDE)
- After `auto_generate`: routes to `use_prepopulated_profile` (enrichment succeeded) or `generate_profile` (fallback)
- After `embed_save_profile`: routes to `generate_hyde` or `END`
- After `generate_hyde`: routes to `embed_save_hyde`

**Key behaviors:**
- Query mode returns immediately (fast path) without any LLM calls
- Write mode detects what needs generation and only runs necessary steps
- If input is a confirmation phrase ("yes", "go ahead"), it is treated as no input so scraping runs
- Profile updates merge new information with existing profile data

**Dependencies:** `ProfileGraphDatabase`, `Embedder`, `Scraper`

### 3.4 Opportunity Graph

**File:** `opportunity.graph.ts`
**Purpose:** End-to-end opportunity discovery: scoping, HyDE generation, vector search, evaluation, ranking, deduplication, negotiation, and persistence.
**Nodes:** `prep`, `scope`, `resolve`, `discovery`, `evaluation`, `ranking`, `persist`
**State:** `OpportunityGraphState` (userId, searchQuery, indexId, triggerIntentId, targetUserId, candidates, evaluatedOpportunities, etc.)
**Conditional edges:**
- After `prep`: routes to `scope` or `END` (no index memberships)
- After `discovery`: routes to `evaluation` or `END` (no candidates)
- After `evaluation`: routes to `ranking` or `END` (no evaluated opportunities)

**Flow:** `START -> prep -> scope -> resolve -> discovery -> evaluation -> ranking -> persist -> END`

The graph supports three discovery paths:
- **Intent-based (Path A):** Trigger intent is assigned to an index -- use its HyDE documents for search
- **Profile-based (Path B/C):** Use profile embedding or query-generated HyDE documents for search
- **Direct connection:** When `targetUserId` is set (user @-mentioned someone), bypass vector search and construct candidates from shared indexes

**Dependencies:** `OpportunityGraphDatabase`, `Embedder`, compiled HyDE graph, optional `OpportunityEvaluator`, optional `NegotiationGraph`

### 3.5 HyDE Graph

**File:** `hyde.graph.ts`
**Purpose:** Cache-aware hypothetical document generation with dynamic lens inference.
**Nodes:** `infer_lenses`, `check_cache`, `generate_missing`, `embed`, `cache_results`
**State:** `HydeGraphState` (sourceType, sourceId, sourceText, profileContext, lenses, hydeDocuments, hydeEmbeddings, etc.)
**Conditional edges:**
- After `check_cache`: routes to `generate_missing` (cache misses) or `embed` (all cached)

**Flow:** `START -> infer_lenses -> check_cache -> [generate_missing if needed] -> embed -> cache_results -> END`

The graph is designed for efficiency: it checks both Redis cache and PostgreSQL before generating any HyDE documents, and only generates documents for lenses that had cache misses.

**Dependencies:** `HydeGraphDatabase`, `EmbeddingGenerator`, `HydeCache`, `LensInferrer`, `HydeGenerator`

### 3.6 Index Graph

**File:** `index.graph.ts`
**Purpose:** CRUD operations for indexes (communities).
**Nodes:** `read`, `create`, `update`, `delete_idx`
**State:** `IndexGraphState` (userId, operationMode, indexId, createInput, updateInput, readResult, mutationResult)
**Conditional edges:**
- From `START`: routes by `operationMode` to the matching CRUD node

**Flow:** `START -> {read | create | update | delete_idx} -> END`

All operations are database-only -- no LLM calls. Create sets the caller as owner; update and delete are owner-only. Delete requires the owner to be the sole member.

**Dependencies:** `IndexGraphDatabase`

### 3.7 Index Membership Graph

**File:** `index_membership.graph.ts`
**Purpose:** Manage member join/leave/invite for indexes.
**Nodes:** `add_member`, `list_members`, `remove_member`
**State:** `IndexMembershipGraphState` (userId, operationMode, indexId, targetUserId, readResult, mutationResult)
**Conditional edges:**
- From `START`: routes by `operationMode` to the matching node

**Flow:** `START -> {add_member | list_members | remove_member} -> END`

Self-join is only allowed for public indexes (`joinPolicy: 'anyone'`). Inviting others requires membership; for invite-only indexes, only the owner can add members.

**Dependencies:** `IndexMembershipGraphDatabase`

### 3.8 Intent Index Graph

**File:** `intent_index.graph.ts`
**Purpose:** Manage the many-to-many relationship between intents and indexes (the `intent_indexes` junction table).
**Nodes:** `assign`, `read`, `unassign`
**State:** `IntentIndexGraphState` (userId, operationMode, intentId, indexId, skipEvaluation, evaluation, assignmentResult, etc.)
**Conditional edges:**
- From `START`: routes by `operationMode`

The `assign` node has two sub-paths:
- **Direct assignment** (`skipEvaluation=true`): assigns immediately with score 1.0
- **Evaluated assignment**: loads intent + index context, runs IntentIndexer agent to score relevancy, only assigns if score exceeds 0.7 threshold

**Dependencies:** `IntentIndexGraphDatabase`

### 3.9 Home Graph

**File:** `home.graph.ts`
**Purpose:** Build the opportunity home feed view with dynamic sections.
**Nodes:** `loadOpportunities`, `checkPresenterCache`, `generateCardText`, `cachePresenterResults`, `checkCategorizerCache`, `categorizeDynamically`, `cacheCategorizerResults`, `normalizeAndSort`
**State:** `HomeGraphState` (userId, indexId, limit, opportunities, cards, sections, cachedCards, sectionProposals, etc.)
**Conditional edges:**
- After `checkPresenterCache`: routes to `generateCardText` (cache misses) or `cachePresenterResults` (all cached)
- After `checkCategorizerCache`: routes to `categorizeDynamically` (cache miss) or `normalizeAndSort` (cached)

This is a read-only graph (separate from the write-path maintenance graph). It uses `OpportunityPresenter` for card text and `HomeCategorizerAgent` for dynamic section grouping, with full cache support for both layers. Cache TTL is 24 hours.

**Dependencies:** `HomeGraphDatabase`, `OpportunityCache`

### 3.10 Maintenance Graph

**File:** `maintenance.graph.ts`
**Purpose:** Evaluate feed health and trigger rediscovery when unhealthy.
**Nodes:** `loadCurrentFeed`, `scoreFeedHealth`, `rediscover`, `logMaintenance`
**State:** `MaintenanceGraphState` (userId, currentOpportunities, activeIntents, healthResult, etc.)
**Conditional edges:**
- After `loadCurrentFeed`: routes to `scoreFeedHealth` or `END` (error)
- After `scoreFeedHealth`: routes to `rediscover` (unhealthy feed) or `END` (healthy)

The health scorer considers connection count, connector flow count, expired count, total actionable opportunities, and freshness (time since last rediscovery). When rediscovery is triggered, it enqueues one job per active intent to the opportunity queue.

**Dependencies:** `MaintenanceGraphDatabase`, `MaintenanceGraphCache`, `MaintenanceGraphQueue`

### 3.11 Negotiation Graph

**File:** `negotiation.graph.ts`
**Purpose:** Bilateral agent-to-agent negotiation to validate opportunity quality before persistence.
**Nodes:** `init`, `turn`, `finalize`
**State:** `NegotiationGraphState` (sourceUser, candidateUser, indexContext, seedAssessment, conversationId, taskId, messages, turnCount, currentSpeaker, lastTurn, outcome, maxTurns)
**Conditional edges:**
- After `init`: routes to `turn` or `finalize` (error)
- After `turn`: routes to `turn` (counter -- continue negotiating), or `finalize` (accept, reject, or turn cap reached)

The graph creates an A2A conversation, alternates between proposer and responder agents, and records each turn as a message with structured data parts. The finalize node determines whether an opportunity was produced, computes agreed roles and average fit score, then persists the outcome as an artifact.

**Dependencies:** `NegotiationDatabase`, proposer agent, responder agent

## 4. Agent Catalog

All agents live in `protocol/src/lib/protocol/agents/`. They are pure (no direct DB access) and use `createModel()` from `model.config.ts` for LLM configuration.

### 4.1 ChatAgent

**File:** `chat.agent.ts`
**Role:** ReAct-style orchestrator that drives the chat loop. Receives messages, decides to call tools or respond.
**Model:** `google/gemini-3-pro-preview` (configurable via `CHAT_MODEL` env), maxTokens 8192, reasoning effort `low`
**Used by:** Chat Graph (agent_loop node)

The agent is created per-invocation via `ChatAgent.create()` which resolves user/index context from the database, builds the system prompt (via `chat.prompt.ts`), compiles all subgraphs, and binds ~22 tools to the LLM. It supports streaming via `streamRun()` which emits `AgentStreamEvent` objects through a writer callback.

### 4.2 Intent Inferrer (ExplicitIntentInferrer)

**File:** `intent.inferrer.ts`
**Role:** Extracts structured intents from raw user content (text, file content, conversation context).
**Model:** `google/gemini-2.5-flash`
**Input:** Raw content string, user profile, options (operation mode, conversation context)
**Output:** Array of inferred intents with description, type, confidence, reasoning
**Used by:** Intent Graph (inference node)

### 4.3 Intent Verifier (SemanticVerifier)

**File:** `intent.verifier.ts`
**Role:** Validates intent quality using speech act theory and felicity conditions.
**Model:** `google/gemini-2.5-flash`
**Input:** Intent description, user profile
**Output:** Classification (COMMISSIVE, DIRECTIVE, DECLARATION, etc.), felicity scores (authority, sincerity, clarity), semantic entropy, referential anchor, flags
**Used by:** Intent Graph (verification node)

Intents must pass verification to be persisted. Invalid types (ASSERTIVE, EXPRESSIVE) are dropped. Vague intents (high entropy or low clarity) trigger profile-based enrichment before a second verification pass.

### 4.4 Intent Reconciler

**File:** `intent.reconciler.ts`
**Role:** Decides final actions (create, update, expire) by comparing verified intents against existing active intents.
**Model:** `google/gemini-2.5-flash`
**Input:** Formatted candidates, active intents
**Output:** Array of actions with type, payload/id, score, reasoning
**Used by:** Intent Graph (reconciliation node)

### 4.5 Intent Indexer

**File:** `intent.indexer.ts`
**Role:** Scores how well an intent fits within an index based on the index prompt and member prompt.
**Model:** `google/gemini-2.5-flash`
**Input:** Intent payload, index prompt, member prompt, source name
**Output:** Index score, member score (0-1 each)
**Used by:** Intent Index Graph (assign node), Opportunity Graph (scope node for query-based scoring)

The qualification threshold is 0.7. When both prompts are present, the final score is weighted: `indexScore * 0.6 + memberScore * 0.4`.

### 4.6 Opportunity Evaluator

**File:** `opportunity.evaluator.ts`
**Role:** Scores and synthesizes opportunity matches between source and candidate users.
**Model:** `google/gemini-2.5-flash`
**Input:** Source profile context, candidate profiles, minimum score threshold
**Output:** Array of evaluated opportunities with score (0-100), reasoning, valency roles (Agent/Patient/Peer), actor assignments
**Used by:** Opportunity Graph (evaluation node)

Scoring bands:
- 90-100: "Must Meet" (perfect alignment)
- 70-89: "Should Meet" (strong overlaps)
- Below 70: No opportunity (filtered out)

### 4.7 Opportunity Presenter

**File:** `opportunity.presenter.ts`
**Role:** Generates human-readable presentation for opportunity cards (personalized summary, suggested action, narrator remark, headline).
**Model:** `google/gemini-2.5-flash`
**Used by:** Home Graph (generateCardText node)

### 4.8 Negotiation Proposer

**File:** `negotiation.proposer.ts`
**Role:** Acts as the source user's agent in bilateral negotiation, generating proposals and counter-proposals.
**Model:** `google/gemini-2.5-flash`
**Input:** Own user context, other user context, index context, seed assessment, history
**Output:** Negotiation turn with action (propose/counter/accept/reject), assessment (fitScore, reasoning, suggestedRoles)
**Used by:** Negotiation Graph (turn node, when `currentSpeaker === "source"`)

### 4.9 Negotiation Responder

**File:** `negotiation.responder.ts`
**Role:** Acts as the candidate user's agent in bilateral negotiation, evaluating proposals and responding.
**Model:** `google/gemini-2.5-flash`
**Input:** Same shape as proposer
**Output:** Same shape as proposer
**Used by:** Negotiation Graph (turn node, when `currentSpeaker === "candidate"`)

### 4.10 Profile Generator

**File:** `profile.generator.ts`
**Role:** Generates structured user profiles from identity data (scraped web content, user-provided text, or existing profile for updates).
**Model:** `google/gemini-2.5-flash`
**Output:** ProfileDocument with identity (name, bio, location), narrative (context), attributes (skills, interests)
**Used by:** Profile Graph (generate_profile node)

### 4.11 Profile HyDE Generator

**File:** `profile.hyde.generator.ts`
**Role:** Creates hypothetical document embeddings specifically for profile matching.
**Model:** `google/gemini-2.5-flash`
**Used by:** Profile Graph (generate_hyde node)

### 4.12 HyDE Generator

**File:** `hyde.generator.ts`
**Role:** Generates hypothetical documents in a target corpus voice for semantic search. Takes a source text and a lens label, produces text that would match the ideal counterpart.
**Model:** `google/gemini-2.5-flash`
**Input:** `HydeGenerateInput` (sourceText, lens label, target corpus)
**Output:** `HydeGeneratorOutput` (text)
**Used by:** HyDE Graph (generate_missing node)

### 4.13 Lens Inferrer

**File:** `lens.inferrer.ts`
**Role:** Analyzes source text with optional profile context and infers 1-5 search lenses, each tagged with a target corpus (profiles or intents).
**Model:** `google/gemini-2.5-flash`
**Input:** Source text, optional profile context, optional max lenses
**Output:** Array of lenses with label, corpus, reasoning
**Used by:** HyDE Graph (infer_lenses node)

Replaces the old hardcoded strategy enum (mirror, reciprocal, mentor, etc.) with dynamic, LLM-inferred lenses. This allows the system to generate contextually appropriate search perspectives for any domain.

### 4.14 Home Categorizer

**File:** `home.categorizer.ts`
**Role:** Groups opportunity cards into themed sections with titles, subtitles, and Lucide icon names.
**Model:** `google/gemini-2.5-flash`
**Used by:** Home Graph (categorizeDynamically node)

### 4.15 Suggestion Generator

**File:** `suggestion.generator.ts`
**Role:** Generates contextual suggestions for users.
**Model:** `google/gemini-2.5-flash`, temperature 0.4, maxTokens 512

### 4.16 Chat Title Generator

**File:** `chat.title.generator.ts`
**Role:** Generates concise titles for chat sessions.
**Model:** `google/gemini-2.5-flash`, temperature 0.3, maxTokens 32

### 4.17 Invite Generator

**File:** `invite.generator.ts`
**Role:** Generates contextual invite messages for ghost user outreach.
**Model:** `google/gemini-2.5-flash`, temperature 0.3, maxTokens 512

## 5. Chat Tool System

Tools bridge the ChatAgent to subgraphs. Each tool file defines LangChain tool functions that the LLM can invoke during the ReAct loop. Tools handle input validation, call the appropriate subgraph, and return a formatted string result.

### Tool files and their graph mappings

| Tool File | Tools | Subgraph(s) Invoked |
|-----------|-------|---------------------|
| `profile.tools.ts` | read_user_profiles, create_user_profile, update_user_profile | Profile Graph |
| `intent.tools.ts` | read_intents, create_intent, update_intent, delete_intent, create_intent_index, read_intent_indexes, delete_intent_index | Intent Graph, Intent Index Graph, Opportunity Graph (auto-discovery on create) |
| `index.tools.ts` | read_indexes, read_users, create_index, update_index, delete_index, create_index_membership | Index Graph, Index Membership Graph |
| `opportunity.tools.ts` | create_opportunities, list_my_opportunities, send_opportunity | Opportunity Graph |
| `contact.tools.ts` | add_contact, list_contacts | (direct service calls) |
| `utility.tools.ts` | scrape_url, confirm_action, cancel_action | (direct scraper call, pending action state) |
| `integration.tools.ts` | list_integrations, sync_integration | (service calls) |

### How tools are bound to the ChatAgent

During `ChatAgent.create()`:
1. All subgraphs are compiled (Intent, Profile, Opportunity, etc.) using the injected database, embedder, and scraper adapters
2. `createChatTools()` creates LangChain tool definitions that close over these compiled graphs
3. The tools are bound to the LLM via `.bind_tools()` so the model can call them by name
4. Each tool receives a `ToolDeps` context containing the userId, compiled graphs, and adapters

### Destructive action confirmation

Tools that modify or delete data (update_intent, delete_intent, update_index, delete_index) use a pending confirmation pattern:
1. The tool stores the action in a pending state and returns a confirmation prompt
2. The ChatAgent relays the confirmation request to the user
3. The user confirms or cancels
4. `confirm_action` or `cancel_action` (in utility.tools.ts) executes or discards the pending action

### Auto-discovery on intent creation

When `create_intent` successfully creates an intent, it automatically triggers opportunity discovery by calling `create_opportunities` with the new intent context. This ensures fresh intents immediately produce relevant matches.

## 6. HyDE System

HyDE (Hypothetical Document Embeddings) is the core semantic search technique. Instead of searching directly with a user's intent text, the system generates hypothetical documents that describe what an ideal match would look like, then embeds those documents for vector similarity search.

### How it works

1. **Lens inference:** The `LensInferrer` agent analyzes the source text (intent or query) and user profile context, producing 1-5 search lenses. Each lens is a specific search perspective (e.g., "early-stage crypto infrastructure VC") tagged with a target corpus (`profiles` or `intents`).

2. **Cache check:** For each lens, the system checks Redis cache and PostgreSQL `hyde_documents` table. Only lenses with cache misses proceed to generation.

3. **HyDE generation:** The `HydeGenerator` agent takes each uncached lens and generates a hypothetical document in the target corpus voice:
   - **Profiles corpus:** Generates a professional biography of the ideal matching person
   - **Intents corpus:** Generates a goal/aspiration statement from the complementary perspective

4. **Embedding:** Generated texts are embedded using the same embedding model (text-embedding-3-large, 2000 dimensions) as the stored profiles and intents.

5. **Caching:** Results are cached in Redis (1-hour TTL) and persisted to PostgreSQL for entity sources (intents, profiles).

### Dynamic lenses vs. hardcoded strategies

The system previously used hardcoded strategy names (mirror, reciprocal, mentor, investor, collaborator, hiree). These have been replaced by LLM-inferred lenses that adapt to any domain. The `LensInferrer` is location-aware and domain-specific -- a DePIN founder searching for "investors" gets "SF-based early-stage crypto infra VC" rather than generic "investor".

### Corpus-specific prompt templates

The `HYDE_CORPUS_PROMPTS` in `hyde.strategies.ts` define how source text and lens labels are combined into prompts:

- **Profiles:** "Write a professional biography for someone who could fulfill this need: [source]. Focus on the specific expertise described by: [lens]."
- **Intents:** "Write a goal or aspiration statement for someone who is: [lens]. This person's needs would complement: [source]."

## 7. Opportunity Pipeline

The opportunity discovery pipeline is the most complex workflow in the system. It transforms a user's intent or search query into ranked, evaluated connection opportunities.

### End-to-end flow

```
User intent/query
    |
    v
[Prep] Load user's index memberships, active intents, profile
    |
    v
[Scope] Determine which indexes to search; score query relevancy per index
    |
    v
[Resolve] Match trigger intent to indexed intents; determine discovery source
    |
    v
[Discovery] Generate HyDE embeddings -> vector search within scoped indexes
    |
    v
[Evaluation] OpportunityEvaluator scores each (source, candidate) pair
    |
    v
[Ranking] Sort by score, deduplicate by (source, candidate, index)
    |
    v
[Negotiation] Optional bilateral agent negotiation for high-scoring candidates
    |
    v
[Persist] Create opportunity records with status 'latent'
```

### Discovery paths

**Intent-based discovery (Path A):** When a trigger intent is identified and it belongs to a target index, the system uses the intent's existing HyDE documents for vector search. This is the most common path for background discovery jobs.

**Query-based discovery:** When the user provides a search query (e.g., "find me investors"), the system:
1. Runs the full HyDE graph to infer lenses and generate hypothetical documents
2. Embeds the generated documents
3. Searches both the profiles and intents vector indexes per lens
4. Merges candidates from all lenses with deduplication

**Direct connection:** When a `targetUserId` is specified (user @-mentioned someone), vector search is bypassed entirely. The system constructs candidates directly from shared index memberships and the target user's active intents.

### Evaluation

The `OpportunityEvaluator` receives source profile context and candidate profiles (including their intents and profile data). It performs valency analysis to determine semantic roles:
- **Agent:** Candidate can do something for the source
- **Patient:** Candidate needs something from the source
- **Peer:** Symmetric collaboration

Each match gets a score (0-100), reasoning (written from a third-party analytical perspective), and actor assignments with roles.

### Deduplication and ranking

Candidates are deduplicated by `(sourceUserId, candidateUserId, indexId)` with the highest-scoring entry winning. When a candidate appears across multiple shared indexes, the index with the highest relevancy score (from `intent_indexes.relevancyScore`) is preferred as the tiebreaker.

### Negotiation (optional)

When enabled, high-scoring candidates enter bilateral negotiation via the Negotiation Graph. Two agents (proposer for the source, responder for the candidate) negotiate over multiple turns, assessing fit and agreeing on roles. Only candidates that produce an opportunity proceed to persistence.

### Persistence

Surviving opportunities are persisted with status `latent`. They become visible to users but require explicit action ("send") to promote to `pending` status. The full status lifecycle is: `latent -> pending -> viewed -> accepted | rejected | expired`.

## 8. Intent Lifecycle

Intents represent what users are seeking or offering. They go through a multi-stage pipeline before persistence.

### Creation flow

```
User input ("I'm looking for a React co-founder")
    |
    v
[Prep] Load user's profile and all active intents
    |
    v
[Inference] ExplicitIntentInferrer extracts structured intents
    |  - description, type (offering/seeking), confidence, reasoning
    |
    v
[Verification] SemanticVerifier validates each intent in parallel
    |  - Speech act classification (COMMISSIVE, DIRECTIVE, DECLARATION)
    |  - Felicity scores (authority, sincerity, clarity)
    |  - Semantic entropy measurement
    |  - Vague intent enrichment from profile context
    |
    v
[Reconciliation] IntentReconciler compares against existing intents
    |  - Decides: create new, update existing, or expire stale
    |
    v
[Execution] Persists to database with embedding
    |  - Enqueues HyDE generation job
    |  - Triggers opportunity discovery
```

### Verification details

The SemanticVerifier uses speech act theory to classify intents:
- **COMMISSIVE** (offering): "I can help with React development" -- kept
- **DIRECTIVE** (seeking): "Looking for a co-founder" -- kept
- **DECLARATION:** Establishing facts -- kept
- **ASSERTIVE/EXPRESSIVE:** Statements of belief or emotion -- dropped

Felicity conditions are scored 0-100:
- **Authority:** Does the speaker have standing to make this claim?
- **Sincerity:** Is the intent genuine?
- **Clarity:** Is the intent specific enough to be actionable?

Intents with high semantic entropy (>0.75) or low clarity (<40) are considered vague. The system attempts profile-based enrichment: if a user says "find me a job" and their profile shows React/TypeScript skills, the intent is enriched to "find me a React/TypeScript software engineering role" and re-verified.

### Update and delete flows

**Update:** Same pipeline as create, but in `update` mode. The reconciler receives target intent IDs and decides whether to update in-place or expire and recreate.

**Delete:** Skips inference and verification entirely. The reconciler generates `expire` actions for the target intent IDs, and the executor archives them (soft delete). Associated HyDE documents are cleaned up via a queued job.

### Intent-index assignment

Intent-to-index assignment is handled separately by the Intent Index Graph. When an intent is created and the user is in an index-scoped chat, the `create_intent_index` tool assigns the intent with either:
- Direct assignment (score 1.0) when `skipEvaluation` is true
- Evaluated assignment via `IntentIndexer` agent when the index has prompts defining its purpose

## 9. Profile Pipeline

Profile generation combines web scraping, external API enrichment, LLM generation, and vector embedding.

### Generation modes

**Write mode (with meaningful input):** User provides text about themselves -> `generate_profile` node -> ProfileGenerator agent structures it into identity/narrative/attributes -> embed -> save.

**Write mode (scraping):** User has social links or full name but no text input -> `scrape` node uses the Scraper adapter to gather web data -> `generate_profile` node processes scraped content -> embed -> save.

**Generate mode:** Uses external enrichment API (Parallel Chat API) via `auto_generate` node. If enrichment returns confident results, the pre-populated profile skips LLM generation and goes directly to embedding. If enrichment fails, falls back to basic user info and LLM generation.

**Query mode:** Fast path that returns the existing profile without any LLM calls.

### Embedding and HyDE

After profile generation:
1. The profile text is concatenated (identity + narrative + attributes) and embedded via the Embedder adapter (text-embedding-3-large, 2000 dimensions)
2. The profile embedding is stored in `user_profiles.embedding` for direct similarity search
3. A HyDE document is generated for the profile (`mirror` strategy) describing what kind of person would be a good match
4. The HyDE document is embedded and stored in `hyde_documents` for enhanced retrieval

### State detection

The `check_state` node performs intelligent detection of what components are missing:
- Profile missing -> needs generation
- Profile exists but embedding invalid -> needs re-embedding
- HyDE document missing -> needs HyDE generation
- Everything exists and up to date -> returns immediately

This ensures the profile graph only performs expensive operations when necessary.

## 10. Trace Event System

The protocol layer emits real-time trace events during graph and agent execution. These events stream to the frontend TRACE panel via SSE, giving users visibility into what the system is doing.

### Event types

```typescript
{ type: "graph_start", name: "opportunity" }
{ type: "graph_end", name: "opportunity", durationMs: 2341 }
{ type: "agent_start", name: "intent-inferrer" }
{ type: "agent_end", name: "intent-inferrer", durationMs: 1205, summary: "Extracted 2 intent(s)" }
```

### How events flow

1. **Request context:** Each incoming request gets a `requestContext` (via Node.js `AsyncLocalStorage`) that optionally carries a `traceEmitter` callback
2. **Tool files:** Emit `graph_start`/`graph_end` around every `graphs.X.invoke()` call
3. **Graph nodes:** Emit `agent_start`/`agent_end` around every agent invocation inside nodes
4. **ChatAgent:** The `streamRun()` method emits iteration-level events (`iteration_start`, `llm_start`, `text_chunk`, `llm_end`, `tool_activity`) via the writer callback
5. **ChatStreamer:** Translates `AgentStreamEvent` objects into `ChatStreamEvent` objects that are sent as SSE to the client

### Naming convention

Agent names in trace events use kebab-case: `intent-inferrer`, `profile-generator`, `hyde-generator`, `opportunity-evaluator`, `lens-inferrer`, `home-categorizer`, `intent-verifier`, `intent-reconciler`, `intent-indexer`.

### Agent timing tracking

Each graph node accumulates `agentTimings` (array of `{ name, durationMs }`) in its return state. These timings are aggregated by the ChatStreamer and included in the `debug_meta` event at the end of the response, providing per-agent performance visibility.

## 11. Model Configuration

All LLM model settings are centralized in `protocol/src/lib/protocol/agents/model.config.ts`.

### MODEL_CONFIG registry

```typescript
export const MODEL_CONFIG = {
  intentInferrer:       { model: "google/gemini-2.5-flash" },
  intentIndexer:        { model: "google/gemini-2.5-flash" },
  intentVerifier:       { model: "google/gemini-2.5-flash" },
  intentReconciler:     { model: "google/gemini-2.5-flash" },
  intentClarifier:      { model: "google/gemini-2.5-flash" },
  profileGenerator:     { model: "google/gemini-2.5-flash" },
  profileHydeGenerator: { model: "google/gemini-2.5-flash" },
  hydeGenerator:        { model: "google/gemini-2.5-flash" },
  lensInferrer:         { model: "google/gemini-2.5-flash" },
  opportunityEvaluator: { model: "google/gemini-2.5-flash" },
  opportunityPresenter: { model: "google/gemini-2.5-flash" },
  negotiationProposer:  { model: "google/gemini-2.5-flash" },
  negotiationResponder: { model: "google/gemini-2.5-flash" },
  homeCategorizer:      { model: "google/gemini-2.5-flash" },
  suggestionGenerator:  { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 512 },
  chatTitleGenerator:   { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 32 },
  inviteGenerator:      { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 512 },
  chat:                 { model: "google/gemini-3-pro-preview", maxTokens: 8192, reasoning: { effort: "low", exclude: true } },
};
```

### Key patterns

**createModel(agent):** Factory function that creates a `ChatOpenAI` instance configured for OpenRouter with the agent's settings. All agents must use this function -- never hardcode model names.

**ModelSettings interface:** Each entry supports `model`, optional `temperature`, optional `maxTokens`, and optional `reasoning` (effort level and whether to exclude reasoning from output).

**Environment overrides:**
- `CHAT_MODEL` overrides the chat agent model (defaults to `google/gemini-3-pro-preview`)
- `CHAT_REASONING_EFFORT` overrides the chat reasoning budget (`minimal|low|medium|high|xhigh`)
- `OPENROUTER_API_KEY` is required for all LLM calls
- `OPENROUTER_BASE_URL` optionally overrides the API endpoint

### Model selection rationale

- **Chat agent** uses the more capable `gemini-3-pro-preview` because it orchestrates complex multi-tool interactions and needs strong reasoning
- **All other agents** use `gemini-2.5-flash` for speed and cost efficiency -- they perform focused, single-purpose tasks with structured output
- **Creative agents** (suggestion generator, invite generator, chat title generator) have lower temperatures (0.3-0.4) and capped token limits for concise, deterministic output
