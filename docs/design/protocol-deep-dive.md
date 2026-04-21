---

## title: "Protocol Deep Dive"

type: design
tags: [protocol, langgraph, agents, graphs, tools, hyde, opportunity, intent, profile, negotiation, mcp]
created: 2026-03-26
updated: 2026-04-11

# Protocol Deep Dive

This document is a standalone, implementation-focused guide to the AI/agent system that powers Index Network's intent-driven discovery protocol. It covers how LangGraph state machines, LLM agents, and chat tools compose into pipelines for intent processing, opportunity discovery, profile generation, and bilateral negotiation.

## 1. Overview

The protocol layer lives at `packages/protocol/src/` (the `@indexnetwork/protocol` package) and is the engine behind every AI-driven operation in the system. It sits between the service/controller HTTP layer above and the database/queue infrastructure below:

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

The protocol layer never imports adapters directly. All infrastructure dependencies are injected through interfaces defined in `packages/protocol/src/shared/interfaces/` (database, embedder, cache, queue, scraper, storage). This makes every graph and agent testable with mocks.

### Directory structure

Graphs, state, agents, and tools are co-located in domain directories rather than flat `graphs/` / `states/` / `agents/` folders. Each domain owns its `{domain}.graph.ts`, `{domain}.state.ts`, `{domain}.agent.ts`, and `{domain}.tools.ts` siblings.

```
packages/protocol/src/
  agent/            Agent registry tools
  chat/             Chat graph, state, tools, streamers
  contact/          Contact tools
  integration/      Integration tools
  intent/           Intent graph, state, inferrer, reconciler, verifier, tools
  maintenance/      Maintenance graph and helpers
  mcp/              MCP session helpers
  negotiation/      Negotiation graph, agent, insights, tools
  network/          Network (index) graph
    indexer/          Intent↔network indexer graph
    membership/       Network membership graph
  opportunity/      Opportunity graph, evaluator, introducer, presenter
    feed/             Home feed graph and health scoring
  profile/          Profile graph, generator, tools
  shared/
    agent/            model.config.ts, utility tools
    hyde/             HyDE graph, generator, strategies
    interfaces/       Adapter contracts (Database, Embedder, Cache, Queue, Scraper, Storage)
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

**File:** `chat/chat.graph.ts`
**Purpose:** ReAct-style agent loop -- the entry point for all user interactions via chat.
**Nodes:** `agent_loop`
**State:** `ChatGraphState` (userId, messages, sessionId, networkId, responseText, iterationCount, shouldContinue, error, debugMeta)
**Flow:** `START -> agent_loop -> END`

The chat graph is architecturally simple: a single node that delegates all complexity to the `ChatAgent`. The agent loop runs up to 12 iterations where the LLM decides to either call tools or produce a final response. After iteration 8, a nudge message is injected asking the agent to wrap up.

The graph supports streaming via `config.writer()` so text tokens and tool-activity events are pushed to the client in real-time rather than batched at the end. Error handling includes one retry for retriable errors (5xx, connection resets).

**Dependencies:** `ChatGraphCompositeDatabase`, `Embedder`, `Scraper`

### 3.2 Intent Graph

**File:** `intent/intent.graph.ts`
**Purpose:** Extract, verify, reconcile, and persist user intents.
**Nodes:** `prep`, `query`, `inference`, `verification`, `reconciler`, `executor`
**State:** `IntentGraphState` (userId, inputContent, operationMode, targetIntentIds, networkId, inferredIntents, verifiedIntents, actions, executionResults, etc.)
**Conditional edges:**

- After `prep`: routes to `query` (read mode), `inference` (create/update), `reconciler` (delete), or `END` (error)
- After `inference`: routes to `verification`, `reconciler` (no intents), or `END` (propose mode with nothing)
- After `verification`: routes to `reconciler` or `END` (propose mode)

**Flow paths:**


| Mode    | Path                                                               |
| ------- | ------------------------------------------------------------------ |
| READ    | prep -> query -> END                                               |
| CREATE  | prep -> inference -> verification -> reconciler -> executor -> END |
| UPDATE  | prep -> inference -> verification -> reconciler -> executor -> END |
| DELETE  | prep -> reconciler -> executor -> END                              |
| PROPOSE | prep -> inference -> verification -> END                           |


The propose mode is a dry-run that extracts and verifies intents without persisting, used when the chat agent wants to preview what intents would be created.

**Dependencies:** `IntentGraphDatabase`, `EmbeddingGenerator`, `IntentGraphQueue`

### 3.3 Profile Graph

**File:** `profile/profile.graph.ts`
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

**File:** `opportunity/opportunity.graph.ts`
**Purpose:** End-to-end opportunity discovery and lifecycle management: scoping, HyDE generation, vector search, evaluation, ranking, deduplication, negotiation, persistence, plus CRUD read/update/delete and `send` operations, and introducer-path validation/evaluation for contact-driven introductions.
**Nodes:** `prep`, `scope`, `resolve`, `discovery`, `evaluation`, `ranking`, `intro_validation`, `intro_evaluation`, `persist`, `negotiate`, `read`, `update`, `delete_opp`, `send`
**State:** `OpportunityGraphState` (userId, searchQuery, networkId, triggerIntentId, targetUserId, candidates, evaluatedOpportunities, trigger, dedupAlreadyAccepted, etc.)
**Conditional edges:**

- After `prep`: routes to `scope` or `END` (no index memberships)
- After `discovery`: routes to `evaluation` or `END` (no candidates)
- After `evaluation`: routes to `ranking` or `END` (no evaluated opportunities)

**Flow:** `START -> prep -> scope -> resolve -> discovery -> evaluation -> ranking -> persist -> negotiate -> END`

The graph supports three discovery paths:

- **Intent-based (Path A):** Trigger intent is assigned to an index -- use its HyDE documents for search
- **Profile-based (Path B/C):** Use profile embedding or query-generated HyDE documents for search
- **Direct connection:** When `targetUserId` is set (user @-mentioned someone), bypass vector search and construct candidates from shared indexes

**Unified trigger model:** `OpportunityGraphState.trigger` (`'ambient' | 'orchestrator'`, default `'ambient'`) drives branches in the `persist` and `negotiate` nodes so the same graph serves both the queue-driven ambient flow and the chat-driven orchestrator flow. The tool layer passes `trigger: 'orchestrator'` whenever `context.sessionId` is set (i.e. the call comes from a chat session); all other callers inherit the ambient default.


| Node        | Ambient trigger                                                                                                            | Orchestrator trigger                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `persist`   | Initial status = `options.initialStatus ?? 'pending'`.                                                                     | Initial status = `options.initialStatus ?? 'negotiating'`. Also collects `dedupAlreadyAccepted` — accepted opps between the discoverer and each unique candidate — so the tool can tell the LLM to steer users toward the existing chat instead of creating a duplicate draft.                                                                                                                                                                    |
| `negotiate` | 5-min park window (`AMBIENT_PARK_WINDOW_MS`) with heartbeat-aware dispatcher. Results aggregate at the end of the fan-out. | 60-second park window (orchestrator cannot afford the ambient budget). Per-candidate `onCandidateResolved` hook flips each accepted opp to `draft` and emits an `opportunity_draft_ready` event via the requestContext `traceEmitter`, so the chat UI renders cards progressively. Honors `requestContext.abortSignal` — after the chat session closes, in-flight negotiations still finish via their park window but their cards are suppressed. |


**Dependencies:** `OpportunityGraphDatabase`, `Embedder`, compiled HyDE graph, optional `OpportunityEvaluator`, optional `NegotiationGraph`, optional `AgentDispatcher`

### 3.5 HyDE Graph

**File:** `shared/hyde/hyde.graph.ts`
**Purpose:** Cache-aware hypothetical document generation with dynamic lens inference.
**Nodes:** `infer_lenses`, `check_cache`, `generate_missing`, `embed`, `cache_results`
**State:** `HydeGraphState` (sourceType, sourceId, sourceText, profileContext, lenses, hydeDocuments, hydeEmbeddings, etc.)
**Conditional edges:**

- After `check_cache`: routes to `generate_missing` (cache misses) or `embed` (all cached)

**Flow:** `START -> infer_lenses -> check_cache -> [generate_missing if needed] -> embed -> cache_results -> END`

The graph is designed for efficiency: it checks both Redis cache and PostgreSQL before generating any HyDE documents, and only generates documents for lenses that had cache misses.

**Dependencies:** `HydeGraphDatabase`, `EmbeddingGenerator`, `HydeCache`, `LensInferrer`, `HydeGenerator`

### 3.6 Network Graph

**File:** `network/network.graph.ts`
**Purpose:** CRUD operations for indexes (networks/communities).
**Nodes:** `read`, `create`, `update`, `delete_idx`
**State:** `NetworkGraphState` (userId, operationMode, networkId, createInput, updateInput, readResult, mutationResult)
**Conditional edges:**

- From `START`: routes by `operationMode` to the matching CRUD node

**Flow:** `START -> {read | create | update | delete_idx} -> END`

All operations are database-only -- no LLM calls. Create sets the caller as owner; update and delete are owner-only. Delete requires the owner to be the sole member.

**Dependencies:** `NetworkGraphDatabase`

### 3.7 Network Membership Graph

**File:** `network/membership/membership.graph.ts`
**Purpose:** Manage member join/leave/invite for indexes.
**Nodes:** `add_member`, `list_members`, `remove_member`
**State:** `NetworkMembershipGraphState` (userId, operationMode, networkId, targetUserId, readResult, mutationResult)
**Conditional edges:**

- From `START`: routes by `operationMode` to the matching node

**Flow:** `START -> {add_member | list_members | remove_member} -> END`

Self-join is only allowed for public indexes (`joinPolicy: 'anyone'`). Inviting others requires membership; for invite-only indexes, only the owner can add members.

**Dependencies:** `NetworkMembershipGraphDatabase`

### 3.8 Intent Network (Indexer) Graph

**File:** `network/indexer/indexer.graph.ts`
**Purpose:** Manage the many-to-many relationship between intents and indexes (the `intent_networks` junction table).
**Nodes:** `assign`, `read`, `unassign`
**State:** `IntentNetworkGraphState` (userId, operationMode, intentId, networkId, skipEvaluation, evaluation, assignmentResult, etc.)
**Conditional edges:**

- From `START`: routes by `operationMode`

The `assign` node has two sub-paths:

- **Direct assignment** (`skipEvaluation=true`): assigns immediately with score 1.0
- **Evaluated assignment**: loads intent + index context, runs IntentIndexer agent to score relevancy, only assigns if score exceeds 0.7 threshold

**Dependencies:** `IntentNetworkGraphDatabase`

### 3.9 Home (Feed) Graph

**File:** `opportunity/feed/feed.graph.ts`
**Purpose:** Build the opportunity home feed view with dynamic sections.
**Nodes:** `loadOpportunities`, `checkPresenterCache`, `generateCardText`, `cachePresenterResults`, `checkCategorizerCache`, `categorizeDynamically`, `cacheCategorizerResults`, `normalizeAndSort`
**State:** `HomeGraphState` (userId, networkId, limit, opportunities, cards, sections, cachedCards, sectionProposals, etc.)
**Conditional edges:**

- After `checkPresenterCache`: routes to `generateCardText` (cache misses) or `cachePresenterResults` (all cached)
- After `checkCategorizerCache`: routes to `categorizeDynamically` (cache miss) or `normalizeAndSort` (cached)

This is a read-only graph (separate from the write-path maintenance graph). It uses `OpportunityPresenter` for card text and `HomeCategorizerAgent` for dynamic section grouping, with full cache support for both layers. Cache TTL is 24 hours.

**Dependencies:** `HomeGraphDatabase`, `OpportunityCache`

### 3.10 Maintenance Graph

**File:** `maintenance/maintenance.graph.ts`
**Purpose:** Evaluate feed health and trigger rediscovery (plus contact-based introducer discovery) when unhealthy.
**Nodes:** `loadCurrentFeed`, `scoreFeedHealth`, `rediscover`, `introducerDiscovery`, `logMaintenance`
**State:** `MaintenanceGraphState` (userId, currentOpportunities, activeIntents, healthResult, etc.)
**Conditional edges:**

- After `loadCurrentFeed`: routes to `scoreFeedHealth` or `END` (error)
- After `scoreFeedHealth`: routes to `rediscover` (unhealthy feed) or `END` (healthy)

The health scorer considers connection count, connector flow count, expired count, total actionable opportunities, and freshness (time since last rediscovery). When rediscovery is triggered, it enqueues one job per active intent to the opportunity queue.

**Dependencies:** `MaintenanceGraphDatabase`, `MaintenanceGraphCache`, `MaintenanceGraphQueue`

### 3.11 Negotiation Graph

**File:** `negotiation/negotiation.graph.ts`
**Purpose:** Bilateral agent-to-agent negotiation to validate opportunity quality before persistence.
**Nodes:** `init`, `turn`, `finalize`
**State:** `NegotiationGraphState` (sourceUser, candidateUser, networkContext, seedAssessment, conversationId, taskId, messages, turnCount, currentSpeaker, lastTurn, outcome, maxTurns)
**Conditional edges:**

- After `init`: routes to `turn` or `finalize` (error)
- After `turn`: routes to `turn` (counter -- continue negotiating), or `finalize` (accept, reject, or turn cap reached)

The graph creates an A2A conversation, alternates between proposer and responder agents, and records each turn as a message with structured data parts. The finalize node determines whether an opportunity was produced, computes agreed roles and average fit score, then persists the outcome as an artifact.

**Dependencies:** `NegotiationDatabase`, proposer agent, responder agent

## 4. Agent Catalog

All agents live in `packages/protocol/src/agents/`. They are pure (no direct DB access) and use `createModel()` from `model.config.ts` for LLM configuration.

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

### 4.8 Index Negotiator

**File:** `negotiation/negotiation.agent.ts`
**Role:** Unified system negotiation agent that advocates for whichever user is speaking in the current turn. The same agent class handles both the proposer (source) and responder (candidate) positions — behavior adapts from turn position (first turn proposes; subsequent turns counter/accept/reject) and from whose context is passed as `ownUser`.
**Model:** `createModel("negotiator")` (configured via `model.config.ts`, defaults to `google/gemini-2.5-flash`).
**Input:** `ownUser`, `otherUser`, `indexContext`, `seedAssessment`, `history`, `isFinalTurn?`, `isDiscoverer?`, `discoveryQuery?`
**Output:** Negotiation turn with action (`propose`/`counter`/`accept`/`reject`), plus assessment (`fitScore`, `reasoning`, `suggestedRoles`)
**Used by:** Negotiation Graph (`turn` node — the graph flips `currentSpeaker` each turn and invokes the same agent with the appropriate user's context).

### 4.9 Negotiation Insights Generator

**File:** `negotiation/negotiation.insights.generator.ts`
**Role:** Post-negotiation generator that synthesizes the full transcript into a short, presenter-ready summary of what was agreed, what was objected to, and where the match landed. Used by the opportunity presenter for post-negotiation cards (accepted/rejected/stalled).
**Model:** `createModel("negotiationInsights")`.

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


| Tool File              | Tools                                                                                                                                         | Subgraph(s) Invoked                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `profile.tools.ts`     | read_user_profiles, create_user_profile, update_user_profile                                                                                  | Profile Graph                                                                  |
| `intent.tools.ts`      | read_intents, create_intent, update_intent, delete_intent, search_intents, create_intent_network, read_intent_networks, delete_intent_network | Intent Graph, Intent Index Graph, Opportunity Graph (auto-discovery on create) |
| `network.tools.ts`     | read_indexes, read_users, create_index, update_index, delete_index, create_index_membership                                                   | Index Graph, Index Membership Graph                                            |
| `opportunity.tools.ts` | create_opportunities, list_my_opportunities, send_opportunity                                                                                 | Opportunity Graph                                                              |
| `contact.tools.ts`     | add_contact, list_contacts, search_contacts                                                                                                   | (direct service calls)                                                         |
| `chat.tools.ts`        | list_conversations, get_conversation                                                                                                          | (direct `ChatSessionReader` calls)                                             |
| `utility.tools.ts`     | scrape_url, confirm_action, cancel_action                                                                                                     | (direct scraper call, pending action state)                                    |
| `integration.tools.ts` | list_integrations, sync_integration                                                                                                           | (service calls)                                                                |


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

## 5a. MCP Server

The protocol exposes every registered chat tool over the Model Context Protocol via `createMcpServer` in `packages/protocol/src/mcp/mcp.server.ts`. This is the surface that external runtimes — OpenClaw, Claude Code, Codex, Cursor — speak to when they act on behalf of a user.

### Factory signature

```typescript
createMcpServer(
  deps: ToolDeps,
  authResolver: McpAuthResolver,
  scopedDepsFactory: ScopedDepsFactory,
): McpServer
```

- `deps` — the same shared tool dependencies used by the chat agent (database, embedder, scraper, graphs, …).
- `authResolver` — reads the HTTP request and returns `{ userId, agentId }`. Callers pass an `x-api-key` header; the resolver looks up the key via Better Auth and reads `metadata.agentId` off the stored token. Requests without an `agentId` are rejected at the gate below.
- `scopedDepsFactory` — creates per-request `userDb` and `systemDb` scoped to the caller's index memberships, so every tool call runs against the caller's actual data perimeter.

### Tool loop

Every registered tool goes through the same lifecycle on every call:

1. Extract the HTTP request from `ServerContext.http.req`.
2. Resolve `{ userId, agentId }` via the auth resolver.
3. Build the `ResolvedToolContext`, set `isMcp = true` and attach `agentId`.
4. Run the agent-registration gate: unless the tool is on the exempt list (`register_agent`, `read_docs`, `scrape_url`), a missing `agentId` produces an `Agent not registered` error that tells the caller to register first.
5. Build per-request scoped databases via `scopedDepsFactory` and rebuild the tool registry with them.
6. Validate arguments against the tool's original Zod schema.
7. Invoke the raw tool handler with `{ context, query: validatedArgs }`.
8. Return the handler's formatted string as an MCP text content block.

Errors are trapped and returned as MCP error responses so a single failing tool never breaks the server session.

### MCP_INSTRUCTIONS — the canonical behavioral contract

`MCP_INSTRUCTIONS` is a template string passed into the `McpServer` constructor as `instructions`. Every MCP client that connects receives it automatically and is expected to follow it for the session. It carries the **global** contract: voice, banned vocabulary, the entity model, output rules, and pointers to tool descriptions for per-pattern behavior. Per-tool guidance (discovery-first, personal-index scoping, intent specificity, silent-subagent negotiation stance) lives in each tool's own description so it surfaces alongside the tool in MCP tool listings. Plugin skill files, CLI wrappers, and marketplace manifests do not redefine this guidance; they defer to what ships with the MCP server.

When `MCP_INSTRUCTIONS` changes, every connected runtime picks up the new guidance on its next session — no plugin or skill release is needed.

### Negotiation turn mode

One section of `MCP_INSTRUCTIONS` ("Negotiation turn mode") switches the caller into a background-subagent stance when the caller's session key is prefixed `index:negotiation:`. A subagent in this mode is told to:

- Fetch the full negotiation via `get_negotiation`.
- Read the user's profile and intents via `read_user_profiles` and `read_intents`.
- Submit its response via `respond_to_negotiation` — never produce user-facing output, never ask clarifying questions, prefer conservative actions when ambiguous.

This is how personal agents participate in bilateral negotiation. The openclaw-plugin's background poller pulls pending turns from `POST /api/agents/:id/negotiations/pickup` and launches subagents with an `index:negotiation:`-prefixed session key; the MCP_INSTRUCTIONS contract does the rest — the plugin itself has no negotiation-specific prompt of its own.

The key negotiation-facing MCP tools are:


| Tool                     | Purpose                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_negotiation`        | Returns the full turn history and assessment seed for a negotiation                                                                                                  |
| `list_negotiations`      | Lists negotiations awaiting a response from this agent's user                                                                                                        |
| `respond_to_negotiation` | Submits a turn (propose / counter / accept / reject / question) with reasoning and suggested roles. Wraps `POST /api/agents/:id/negotiations/:negotiationId/respond` |


Agents claim turns via the HTTP pickup endpoint rather than an MCP tool — the turn payload is too large and the CAS semantics are easier to express over HTTP than via the streaming MCP transport. Once a turn is claimed, the response path goes through `respond_to_negotiation` so the subagent can submit from inside its MCP session.

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

Candidates are deduplicated by `(sourceUserId, candidateUserId, networkId)` with the highest-scoring entry winning. When a candidate appears across multiple shared indexes, the index with the highest relevancy score (from `intent_networks.relevancyScore`) is preferred as the tiebreaker.

### Negotiation (optional)

When enabled, high-scoring candidates enter bilateral negotiation via the Negotiation Graph. Two agents (proposer for the source, responder for the candidate) negotiate over multiple turns, assessing fit and agreeing on roles. Only candidates that produce an opportunity proceed to persistence.

### Persistence

Surviving opportunities are persisted with status `latent`. They become visible to users but require explicit action ("send") to promote to `pending` status. The full status lifecycle is: `latent -> draft -> pending -> accepted | rejected | expired`.

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

Intent-to-network assignment is handled separately by the Intent Index Graph. When an intent is created and the user is in a network-scoped chat, the `create_intent_network` tool assigns the intent with either:

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

**Negotiation events** (added 2026-04-17):

- `negotiation_session_start` / `negotiation_session_end` — emitted by `negotiateCandidates` in `negotiation.graph.ts`, wrapping each per-candidate run. Carries `opportunityId`, `negotiationConversationId`, source/candidate user ids, `trigger` (`'orchestrator' | 'ambient'`), `startedAt`, and `durationMs` (on end).
- `negotiation_turn` — emitted by the negotiation graph's `turnNode` after each successful turn. Carries `opportunityId`, `turnIndex`, `actor` (`'source' | 'candidate'`), `action` (`propose | accept | reject | counter | question`), `reasoning`, `message`, `suggestedRoles`, `durationMs`.
- `negotiation_outcome` — emitted from `finalizeNode` on every terminal path (`accepted`, `rejected_stalled`, `waiting_for_agent`, `timed_out`, `turn_cap`). Carries `opportunityId`, `outcome`, `turnCount`, `reasoning`, `agreedRoles`.

Consumers: the live TRACE panel uses these to render per-candidate negotiation nodes. `/debug/chat/:id` uses `debugMeta.orchestratorNegotiations.opportunityIds` (persisted from `negotiation_session_start` during the turn) to hydrate full negotiation history from `tasks` + `messages` + `opportunities`. Existing `agent_start/end` emissions in `negotiation.graph.ts` are retained for backward compatibility with the rolled-up `debugMeta.tools[].graphs[].agents[]` render path.

## 11. Model Configuration

All LLM model settings are centralized in `packages/protocol/src/agents/model.config.ts`.

### MODEL_CONFIG registry

```typescript
// Excerpted from packages/protocol/src/shared/agent/model.config.ts
const MODEL_CONFIG = {
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
  negotiator:           { model: "google/gemini-2.5-flash" },
  negotiationInsights:  { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 512 },
  homeCategorizer:      { model: "google/gemini-2.5-flash" },
  suggestionGenerator:  { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 512 },
  chatTitleGenerator:   { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 32 },
  inviteGenerator:      { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 512 },
  chat: {
    model: /* CHAT_MODEL env override, defaults to */ "google/gemini-3-pro-preview",
    maxTokens: 8192,
    reasoning: { effort: /* CHAT_REASONING_EFFORT env, defaults to */ "low", exclude: true },
  },
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

