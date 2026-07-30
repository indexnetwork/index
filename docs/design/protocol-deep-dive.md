---
title: "Protocol Deep Dive"
type: design
tags: [protocol, langgraph, agents, graphs, tools, hyde, opportunity, intent, profile, negotiation, mcp]
created: 2026-03-26
updated: 2026-04-11
---

# Protocol Deep Dive

This document is a standalone, implementation-focused guide to the AI/agent system that powers Index Network's intent-driven discovery protocol. It covers how LangGraph state machines, LLM agents, and chat tools compose into pipelines for intent processing, opportunity discovery, user enrichment, and bilateral negotiation.

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
  context/          User-context generation
  enrichment/       Enrichment graph, identity generation, tools
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
  premise/          Premise graph, analysis, indexing, tools
  questioner/       Mode-driven decision-question generation
  shared/
    agent/            model config, tool runtime, response streaming
    hyde/             HyDE graph, generator, lens inference, validation
    interfaces/       Adapter contracts (Database, Embedder, Cache, Queue, Scraper, Storage)
    schemas/          Shared Zod contracts
    observability/    Logging, timing, tracing, debug-meta sanitization
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
**State:** `ChatGraphState` (userId, messages, sessionId, indexId, responseText, iterationCount, shouldContinue, error, debugMeta)
**Flow:** `START -> agent_loop -> END`

The chat graph is architecturally simple: a single node that delegates all complexity to the `ChatAgent`. The agent loop runs up to 12 iterations where the LLM decides to either call tools or produce a final response. After iteration 8, a nudge message is injected asking the agent to wrap up.

The graph supports streaming via `config.writer()` so text tokens and tool-activity events are pushed to the client in real-time rather than batched at the end. Error handling includes one retry for retriable errors (5xx, connection resets).

The runtime is persona-neutral: `ChatGraphFactory.withPersona()` reuses the same graph and injected dependencies while selecting a persona-owned prompt, toolset, and loop behaviors. Persisted `conversations.persona` is authoritative for follow-up turns. The main-web Signal Agent persona (`signal`) uses a positive allowlist limited to intent/signal management, intent-to-existing-community assignment, profile context and premise knowledge, read-only network/membership context, pasted-URL scraping, and chat clarification. Its wrappers live-recheck membership, clamp intent/network-focused reads to owned active intents and current memberships, prohibit other-user membership enumeration, and keep creation proposal-only. Before a proposal card is emitted, the protocol persists an owner-scoped 24-hour record through the injected `IntentProposalStore`; it binds the normalized description, optional network, and complete verifier output. Confirmation treats card fields only as exact-match assertions, locks that record and current membership, maps the verifier output directly to the intent analysis columns, and atomically inserts the intent/assignment plus consumes the proposal. The transaction winner obtains observable indexing-queue admission before question/event effects; a later exact consumed-proposal retry can repair failed admission idempotently, while concurrent losers never duplicate those downstream effects. It has no opportunity/discovery-run, negotiation, contact/import, agent-administration, network-administration, or membership-mutation tools. Its discovery-coupled create-intent callback is disabled while proposal hallucination recovery remains enabled. Session-authenticated compatibility chat routes are classified as web from authenticated provenance, while API-key and other non-web consumers retain the default `orchestrator` runtime.

Under the same `WEB_SIGNAL_AGENT_ENABLED` cutover, the session-only incomplete-user route persists a separate `onboarding` persona. Its exact allowlist is consent recording, self context read/preview/confirmation, blocking guided questions, proposal-only intent creation with Signal's live-membership narrowing, and validated onboarding completion. It cannot import Gmail/contacts, discover or mutate opportunities, negotiate, select or join communities, mutate memberships, administer agents/networks, scrape arbitrary URLs, or receive newly registered shared tools automatically. `confirm_user_context` writes the durable `profileConfirmedAt`/`currentStep='first_signal'` marker while preserving privacy JSON. `complete_onboarding({ intentId })` requires a valid marker plus an exact active owned first signal created at or after profile confirmation, then durably records `firstSignalIntentId`, `currentStep='complete'`, and `completedAt`. Flag-off onboarding continues to use the legacy orchestrator prompt/tool flow; API-key and other non-web consumers are unchanged. Compatibility histories remain orchestrator-only, and the session-only web history returns readable legacy orchestrator plus Signal sessions.

**Dependencies:** `ChatGraphCompositeDatabase`, `Embedder`, `Scraper`

### 3.2 Intent Graph

**File:** `intent/intent.graph.ts`
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

The propose mode is a dry-run that extracts and verifies intents without persisting, used when the chat agent wants to preview what intents would be created. Broad actionable candidates retain specificity-warning metadata and may be approved by the user. Explicit update mode uses the same breadth validity semantics, then deterministically binds its single verified candidate to the single supplied active owned intent ID; it does not delegate create-versus-update selection to the general reconciler. Non-actionable or vague candidates, ambiguous inference, and target/ownership boundary failures remain fail-closed and are returned as distinct failure categories.

**Dependencies:** `IntentGraphDatabase`, `EmbeddingGenerator`, `IntentGraphQueue`

### 3.3 Enrichment Graph

**File:** `enrichment/enrichment.graph.ts`
**Purpose:** Enrich a user from identity data (optional web scraping) and decompose it into premises that drive semantic discovery. The user's presentation identity (name/bio/location) lives on the `users` table and the synthesized representation lives in `user_contexts` — no separate profile document is persisted, and no profile embeddings/HyDE are generated. All semantic discovery uses premises and user contexts.
**Nodes:** `check_state`, `scrape`, `decompose_premises`, `auto_generate`
**State:** `EnrichmentGraphState` (userId, operationMode, input, forceUpdate, profile, needsProfileGeneration, activeSocialIds, etc.)
**Conditional edges:**
- After `check_state`: routes to `scrape`, `decompose_premises`, `auto_generate`, or `END` based on operation mode and what (if anything) still needs enrichment
- After `scrape`: routes to `decompose_premises` (decompose the scraped content into premises) or `END`
- After `auto_generate`: routes to `decompose_premises` or `END`
- `decompose_premises` is terminal (→ END): premise creation is the final effect, and the user's representation is the regenerated `user_contexts` — no profile document is persisted

**Key behaviors:**
- Query mode returns immediately (fast path) without any LLM calls
- Write mode detects what needs generation and only runs necessary steps
- If input is a confirmation phrase ("yes", "go ahead"), it is treated as no input so scraping runs
- Identity updates merge new information with the user's existing identity (name/bio/location on `users`)
- Onboarding-safe profile tools split consent/draft/confirmation: `record_onboarding_privacy_consent` writes `users.onboarding.privacy`, `preview_user_context` generates a non-persisted draft from allowed sources, and `confirm_user_context` saves only approved content and stamps the durable profile-phase marker.
- Automatic public enrichment is gated by `networks.permissions.profileEnrichment`: missing/`auto` preserves legacy behavior, `consent_required` requires `privacy.publicProfileLookup.granted === true` and never allows ghosts, and `disabled` blocks public enrichment.
- `EnrichmentQueue` is the execution-time backstop. It carries `networkId` and `reason`, re-reads network policy/user onboarding, skips `enrich.user` when disallowed, and lets `ensure_profile_hyde` proceed under consent-required only when the user already has ACTIVE premises.
- When `premiseGraph` is injected, chat input and scraped content are routed through `PremiseDecomposer`. Extracted premises are persisted via the premise graph; premise changes then drive regeneration of the user's `user_contexts` representation. This ensures atomic facts are captured as premises and the synthesized representation is derived from them.
- The `decompose_premises` node also handles direct chat input (not just scraped content) — any free-text describing the user is decomposed into premises first.

**Dependencies:** `EnrichmentGraphDatabase`, `Scraper`, optional `Enricher`, optional `questionerEnqueue`, optional compiled `PremiseGraph`

### 3.4 Opportunity Graph

**File:** `opportunity/opportunity.graph.ts`
**Purpose:** End-to-end opportunity discovery and lifecycle management: scoping, HyDE generation, vector search, evaluation, ranking, deduplication, negotiation, persistence, plus CRUD read/update/delete and `send` operations, and introducer-path validation/evaluation for contact-driven introductions.
**See also:** [`opportunity-status-lifecycle.md`](./opportunity-status-lifecycle.md) — the authoritative status state machine (8 statuses, 7 flows, exhaustive transition/write-site table).
**Nodes:** `prep`, `scope`, `resolve`, `discovery`, `evaluation`, `ranking`, `intro_validation`, `intro_evaluation`, `persist`, `negotiate`, `read`, `update`, `delete_opp`, `send`
**State:** `OpportunityGraphState` (userId, searchQuery, indexId, triggerIntentId, targetUserId, candidates, evaluatedOpportunities, trigger, dedupAlreadyAccepted, etc.)
**Conditional edges:**
- After `prep`: routes to `scope` or `END` (no network memberships)
- After `discovery`: routes to `evaluation` or `END` (no candidates)
- After `evaluation`: routes to `ranking` or `END` (no evaluated opportunities)

**Flow:** `START -> prep -> scope -> resolve -> discovery -> evaluation -> ranking -> persist -> negotiate -> END`

The graph supports background discovery across intents and premises corpora:
- **Intent-based:** An assigned, active trigger intent supplies HyDE documents and the authoritative network scope.
- **Enrichment/context-to-intent:** User contexts (network-scoped paragraph representations from the premise graph) are embedded and used to find matching intents via `searchIntentsByContextEmbedding()`. Candidates carry `discoverySource: 'context-to-intent'`.
- **Introducer-driven:** The introducer queue validates an explicit introduction and constructs candidates from the participants' shared networks.

All discovery strategies are merged via `mergeStrategyCandidates()`, which deduplicates by `userId:networkId:entityId` and applies a multi-strategy boost (+0.05 per additional strategy, capped at 0.15).

**Trigger-intent network admission:** `FromIntentQueue` recomputes the authoritative target set for every run as the trigger intent's current assignments intersected with the owner's active memberships and any explicit queue scope. Omitted scope means all still-valid assigned networks—not all owner memberships—and an empty result ends the job before graph invocation or pool mining. Multi-network results use `indexScope` without collapsing to the first assignment.

**Candidate membership invariants:** intent-HyDE, intent-vector, premise-HyDE/vector, and context-to-intent queries require an active candidate membership on the exact returned network and a non-deleted network. The check is permission-agnostic so contacts in a personal network remain eligible. The graph batch-rechecks the discoverer and candidate before profile loading/evaluation and rechecks every evaluated participant before dedup; final creation and reactivation run behind transaction-held active-membership and trigger-intent-assignment locks, with the current active owned intent row locked too, so concurrent member removal, pause/archive, or unassignment cannot race the write. Lookup failure is fail-closed. Selected-intent Radar independently derives valid networks from the viewer-owned intent's assignments plus active viewer memberships and requires every participant to retain an active anchor in that set, including for paused-intent history.

Premise-based candidates carry `candidatePremiseId` in the persist node for actor tracking, regardless of discovery source.

**Affiliation/presence claim safety:** network/event metadata is retrieval context, never evidence that a person attended, joined, resided, met someone, or shared a place/session. Evaluator and presenter prompts prohibit these inferences, evaluator post-validation rejects affected opportunities before persistence, and one deterministic sentence guard strips them from presenter output, raw-reasoning fallbacks, REST lists, MCP cards, notifications, persisted delivery cards, and invite generation. Because typed support provenance does not exist yet, the guard deliberately fails closed even for genuinely supported phrasing. Home, category, delivery, and chat presentation caches use a versioned namespace and never persist presenter fallback output; unsafe categorizer titles/subtitles fall back before the category cache write.

**Background-only execution:** opportunity discovery is admitted by background queues. Intent, enrichment, introducer, and maintenance paths supply the persisted source context and explicit initial status; current discovery queues create latent opportunities. There is no direct-chat trigger or live draft-card contract. The graph persists candidates, then ambient negotiation advances them to `pending`, `rejected`, or `stalled`. Persisted cards are subsequently available through feed, home, and chat-history presentation.

**Dependencies:** `OpportunityGraphDatabase`, `Embedder`, compiled HyDE graph, optional `OpportunityEvaluator`, optional `NegotiationGraph`, optional `AgentDispatcher`

### 3.5 HyDE Graph

**File:** `shared/hyde/hyde.graph.ts`
**Purpose:** Cache-aware hypothetical document generation with dynamic lens inference and an opt-in source-grounded validation path.
**Nodes:** legacy uses `infer_lenses`, `check_cache`, `generate_missing`, `embed`, `cache_results`; frame-v1 inserts `validate_generated` between generation and embedding.
**State:** `HydeGraphState` (sourceType, sourceId, sourceText, profileContext, lenses, optional sourceFrame/frameFingerprint, hydeDocuments, hydeEmbeddings, etc.)
**Conditional edges:**
- After `check_cache`: routes to `generate_missing` (cache misses) or `embed` (all cached).
- In frame-v1, generated documents route through one batch validator; cache/DB hits already marked valid skip validation.

**Legacy flow:** `START -> infer_lenses -> check_cache -> [generate_missing] -> embed -> cache_results -> END`

**Frame-v1 flow:** `START -> infer_lenses+frame -> check_versioned_cache -> [generate_missing -> validate_generated] -> embed -> cache_results -> END`

`HYDE_FRAME_CONSTRAINTS_ENABLED=true` selects frame-v1; every other value preserves the default legacy path. Frame extraction uses only `sourceText`. Optional `profileContext` remains lens-selection context and is never frame evidence or validator input. A partial rejection removes only invalid siblings. If every generated document is rejected, the graph returns no HyDE embeddings. Validator errors and malformed/missing/contradictory verdicts fail open per document: those documents are embedded and returned ephemerally, but `cache_results` never writes them.

Legacy Redis keys and DB strategy hashes remain untouched. Frame-v1 Redis keys include the version plus a fingerprint of exact source text and sanitized frame; frame-v1 DB strategies are stable versioned lens/corpus hashes so revisions upsert rather than append. Persisted context carries source/frame fingerprints, a generation marker, and `validationStatus: valid`. Bulk context discovery filters to the active mode, current source-text hash, and newest generation-marker group, so changed content cannot reuse stale frame documents and disabling the flag returns to legacy rows only.

**Dependencies:** `HydeGraphDatabase`, `EmbeddingGenerator`, `HydeCache`, `LensInferrer`, `HydeGenerator`, and frame-v1 `HydeValidator`

### 3.6 Network Graph

**File:** `network/network.graph.ts`
**Purpose:** CRUD operations for indexes (networks/communities).
**Nodes:** `read`, `create`, `update`, `delete_idx`
**State:** `NetworkGraphState` (userId, operationMode, indexId, createInput, updateInput, readResult, mutationResult)
**Conditional edges:**
- From `START`: routes by `operationMode` to the matching CRUD node

**Flow:** `START -> {read | create | update | delete_idx} -> END`

All operations are database-only -- no LLM calls. Create sets the caller as owner; update and delete are owner-only. Delete requires the owner to be the sole member.

**Dependencies:** `NetworkGraphDatabase`

### 3.7 Network Membership Graph

**File:** `network/membership/membership.graph.ts`
**Purpose:** Manage member join/leave/invite for indexes.
**Nodes:** `add_member`, `list_members`, `remove_member`
**State:** `NetworkMembershipGraphState` (userId, operationMode, indexId, targetUserId, readResult, mutationResult)
**Conditional edges:**
- From `START`: routes by `operationMode` to the matching node

**Flow:** `START -> {add_member | list_members | remove_member} -> END`

Self-join is only allowed for public networks (`joinPolicy: 'anyone'`). Inviting others requires membership; for invite-only indexes, only the owner can add members.

**Dependencies:** `NetworkMembershipGraphDatabase`

### 3.8 Intent Network (Indexer) Graph

**File:** `network/indexer/indexer.graph.ts`
**Purpose:** Manage the many-to-many relationship between intents and indexes (the `intent_networks` junction table).
**Nodes:** `assign`, `read`, `unassign`
**State:** `IntentNetworkGraphState` (userId, operationMode, intentId, indexId, skipEvaluation, evaluation, assignmentResult, etc.)
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
**State:** `HomeGraphState` (userId, indexId, limit, opportunities, cards, sections, cachedCards, sectionProposals, etc.)
**Conditional edges:**
- After `checkPresenterCache`: routes to `generateCardText` (cache misses) or `cachePresenterResults` (all cached)
- After `checkCategorizerCache`: routes to `categorizeDynamically` (cache miss) or `normalizeAndSort` (cached)

This is a read-only graph (separate from the write-path maintenance graph). It uses `OpportunityPresenter` for card text and `HomeCategorizerAgent` for dynamic section grouping, with versioned cache support for both layers. Cache TTL is 24 hours; claim-safety or presenter fallback cards are returned only for the current request and are not cached. Pool adjustments affect ordering and deprioritization copy only when their `recipientUserId + intentId` provenance exactly matches the graph's viewer and selected intent; global Home, other viewers/intents, and legacy unscoped entries ignore them.

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
**State:** `NegotiationGraphState` (sourceUser, candidateUser, indexContext, seedAssessment, conversationId, taskId, messages, turnCount, currentSpeaker, lastTurn, outcome, maxTurns)
**Conditional edges:**
- After `init`: routes to `turn` or `finalize` (error)
- After `turn`: routes to `turn` (counter -- continue negotiating), or `finalize` (accept, reject, or turn cap reached)

The graph creates an A2A conversation, alternates between proposer and responder agents, and records each turn as a message with structured data parts. The finalize node determines whether an opportunity was produced, computes agreed roles and average fit score, then persists the outcome as an artifact.

Autonomous opportunity negotiation builds each participant context from the
opportunity's exact actor-intent binding. `NEGOTIATION_INCLUDE_OTHER_INTENTS`
defaults to `true`, preserving the exact-first bounded fallback of up to five
active intents per participant. With the strict value `false`, only an owned
exact bound intent is admitted; an actor without an exact binding receives no
unrelated fallback. This pruning happens before the outreach screen,
negotiator, dispatcher/polling context, persisted `turnContext`, and intent
snapshot derivation. Personal negotiator chat keeps its explicit authenticated
`read_intents` capability unchanged.

**Dependencies:** `NegotiationGraphDatabase`, proposer agent, responder agent

### 3.12 Premise Graph

**File:** `premise/premise.graph.ts`
**Purpose:** Lifecycle graph for premises (composable self-descriptions). Supports create, update, and query modes.
**Nodes:** `query`, `analyze`, `embed`, `persist`, `index`
**State:** `PremiseGraphState` (userId, assertionText, tier, validFrom, validUntil, volatile, operationMode, targetPremiseId, analysis, embedding, premise, networkAssignments, error, readResult, agentTimings)
**Conditional edges:**
- From START: routes to `query` (read-only), `analyze` (create/update), or END (error)
- Create/update path: `analyze` → `embed` → `persist` → `index` → END

The analyze node classifies the premise using speech act theory and scores felicity conditions. The embed node generates a vector embedding. The persist node creates or updates the database record. The index node scores the premise against the user's networks and assigns it where relevant (score ≥ 0.5). Each node guards against upstream errors.

**Dependencies:** `PremiseGraphDatabase`, `Embedder`

## 4. Agent Catalog

Agents live alongside their feature graphs (for example `chat/`, `intent/`, `opportunity/`, and `negotiation/`) or in `shared/`. They are pure (no direct DB access) and use `createModel()` from `shared/agent/model.config.ts` for LLM configuration.

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
**Role:** Scores how well an intent fits within an index based on the network prompt and member prompt.
**Model:** `google/gemini-2.5-flash`
**Input:** Intent payload, network prompt, member prompt, source name
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

**File:** `negotiation/insight.generator.ts`
**Role:** Post-negotiation generator that synthesizes the full transcript into a short, presenter-ready summary of what was agreed, what was objected to, and where the match landed. Used by the opportunity presenter for post-negotiation cards (accepted/rejected/stalled).
**Model:** `createModel("negotiationInsights")`.

### 4.10 Enrichment Generator

**File:** `enrichment.generator.ts`
**Role:** Generates a structured identity draft from identity data (scraped web content, user-provided text, or existing identity for updates) for the onboarding draft-approval tools.
**Model:** `google/gemini-2.5-flash`
**Output:** A `UserIdentity` draft (name, bio, location); discrete skills/interests are no longer persisted — that content lives in premises and the user context.
**Used by:** Onboarding draft tools (`preview_/confirm_/create_user_profile`)

### 4.11 HyDE Generator

**File:** `hyde.generator.ts`
**Role:** Generates hypothetical documents in a target corpus voice for semantic search. Legacy takes source text plus a lens. Frame-v1 also takes the sanitized source frame, allows generic reciprocal-role/domain elaboration, and forbids new named entities or hard location/time/numeric/credential/organization/exclusivity constraints.
**Model:** configured `hydeGenerator` model
**Input:** `HydeGenerateInput` (sourceText, lens label, target corpus, optional sourceFrame)
**Output:** `HydeGeneratorOutput` (text)
**Used by:** HyDE Graph (`generate_missing` node)

### 4.12 Lens Inferrer

**File:** `lens.inferrer.ts`
**Role:** Analyzes source text with optional profile context and infers 1-5 search lenses tagged `profiles`, `intents`, or `premises`. In frame-v1 it also extracts a source-grounded frame whose evidence spans must come only from `sourceText`; `profileContext` can shape lens selection but cannot supply frame facts.
**Model:** configured `lensInferrer` model
**Input:** Source text, optional profile context, optional max lenses, frame-constrained mode
**Output:** Lenses with label/corpus/reasoning plus an optional sanitized source frame
**Used by:** HyDE Graph (`infer_lenses` node)

Replaces the old hardcoded strategy enum (mirror, reciprocal, mentor, etc.) with dynamic, LLM-inferred lenses. The `profiles` value is now a preference hint: the API remaps it to premise retrieval because profile-vector discovery was retired.

**Post-generation validator:** `shared/hyde/hyde.validator.ts` performs one structured frame-v1 batch check after generation. It rejects only unsupported named entities or hard constraints; generic elaboration and reciprocal/target voice are valid. The graph owns partial/all-rejection and fail-open persistence behavior rather than the agent.

### 4.13 Home Categorizer

**File:** `home.categorizer.ts`
**Role:** Groups opportunity cards into themed sections with titles, subtitles, and Lucide icon names.
**Model:** `google/gemini-2.5-flash`
**Used by:** Home Graph (categorizeDynamically node)

### 4.14 Suggestion Generator

**File:** `suggestion.generator.ts`
**Role:** Generates contextual suggestions for users.
**Model:** `google/gemini-2.5-flash`, temperature 0.4, maxTokens 512

### 4.15 Chat Title Generator

**File:** `chat.title.generator.ts`
**Role:** Generates concise titles for chat sessions.
**Model:** `google/gemini-2.5-flash`, temperature 0.3, maxTokens 32

### 4.16 Invite Generator

**File:** `invite.generator.ts`
**Role:** Generates contextual invite messages for ghost user outreach.
**Model:** `google/gemini-2.5-flash`, temperature 0.3, maxTokens 512

### 4.17 Premise Decomposer

**File:** `premise/premise.decomposer.ts`
**Role:** Decomposes free-text input (chat messages, scraped bios, LinkedIn content) into individual atomic premises. Converts third-person text to first-person, classifies each premise as `assertive` (stable identity facts) or `contextual` (temporal/situational), and filters out intents/desires.
**Model:** `google/gemini-2.5-flash`
**Input:** Free-text string (chat input, scraped content, or bio text)
**Output:** Array of `{ text, tier }` premises plus reasoning; empty array for non-descriptive input (confirmations, greetings)
**Used by:** Enrichment Graph (decompose_premises node)

### 4.18 Premise Analyzer

**File:** `premise/premise.analyzer.ts`
**Role:** Classifies a premise using adapted speech act theory (DECLARATIVE vs ASSERTIVE) and scores felicity conditions (authority, sincerity, clarity) plus semantic entropy.
**Model:** `google/gemini-2.5-flash`
**Input:** Premise text (string), optional profile context
**Output:** speechActType, felicityAuthority (0-100), felicitySincerity (0-100), felicityClarity (0-100), semanticEntropy (0.0-1.0)
**Used by:** Premise Graph (analyze node)

### 4.19 Premise Indexer

**File:** `premise/premise.indexer.ts`
**Role:** Scores a premise's relevancy to a network based on the network prompt and member preferences.
**Model:** `google/gemini-2.5-flash`
**Input:** premiseText, indexPrompt, optional memberPrompt and networkContext
**Output:** indexScore (0.0-1.0), memberScore (0.0-1.0), reasoning
**Used by:** Premise Graph (index node)

### 4.20 QuestionerAgent

**File:** `questioner/questioner.agent.ts`
**Role:** Generates structured questions to elicit missing information from users. Uses mode-specific presets (system prompt + builder) to produce up to 3 questions per invocation.
**Model:** `google/gemini-2.5-flash`
**Input:** `QuestionerInput` envelope with mode (`discovery` | `intent` | `enrichment` | `negotiation` | `negotiation_inflight` | `chat` | `pool_discovery`), userId, sourceType/sourceId, optional private purpose (`uptake` | `recovery` | `stalled_followup` | `inflight_consultation`), and mode-specific context
**Output:** Array of `QuestionWithStrategy` (title, prompt, options, multiSelect, strategy)
**Used by:** QuestionerQueue worker (async, behind `QUESTIONER_ENABLED` flag) and the `ask_user_question` chat tool (synchronous, inline)
**Presets:** `discovery`, creation-time `intent`, recovery-purpose `intent`, `enrichment`, `negotiation`, `negotiation_inflight`, `chat`, and deterministic `pool_discovery`. The `chat` preset refines orchestrator-authored drafts grounded in the user's own context. Negotiation queue inputs are runtime-discriminated by mode+purpose. Inflight accepts only deterministically validated structured `askUser` fields (never turn/reasoning fallbacks), uptake uses a neutral fixed activity prompt, and every visible generated field passes a final fail-closed safety gate before persistence. Raw counterparty profile/identity/intent, private transcript, evaluator reasoning, match reason, event/community inference, evidence, and internal IDs never enter negotiation Questioner context or public copy.
**Attachment points:** Intent graph (after creation), enrichment graph (when gaps detected), negotiation graph (after stall/turn-cap or mid-turn `ask_user`), the pending-opportunity uptake guard, and the post-discovery no-opportunity recovery hook. IND-508's centralized `NEGOTIATION_CONSULTATION_POLICY_MODE` is default-off; `shadow` evaluates a pure action/role/history eligibility policy and emits only stable category telemetry, while `on` also requires `NEGOTIATION_ASK_USER_ENABLED` and replaces an eligible draft with a fixed source-safe `ask_user` input before the ordinary question safety/binding/timer/persistence path. The policy cannot read free-form private material and a consultation remains exactly recipient-seat/task scoped. All queued producers use `questionerEnqueue`; trigger frequency is unchanged and purpose-specific cardinality remains ≤2 ordinary/inflight, ≤1 uptake, and ≤1 recovery per fingerprint. OpportunityGraph threads explicit source/candidate opportunity actor intent IDs into NegotiationGraph and task metadata instead of relying on intent-array ordering. The enrichment attachment point fetches active premises via `getPremisesForUser` and passes their texts as `existingPremises` in the `ProfileContext`, so the LLM skips domains already covered by a premise. The direct REST `OpportunityService` graph intentionally remains without a negotiation graph, exactly as on the IND-507 base; widening that pre-existing route is out of scope.

**Blocking chat questions (`ask_user_question`).** The chat orchestrator carries a chat-only `ask_user_question` tool (`questioner/questioner.ask.tool.ts`, registered by `createChatTools` only when the host injects a `ChatQuestionsHost` bridge — never in the MCP registry). Mirroring the AskUserQuestion human-in-the-loop pattern: the model states a `purpose` plus optional draft questions; the QuestionerAgent's `chat` preset polishes them synchronously; the tool persists them (mode `chat`, `conversationId = sessionId`), streams a `user_question` SSE event carrying the persisted ids, and then **blocks the turn** on the host's `awaitAnswers` (in-memory per-question wait bus, `services/api/src/lib/chat-question.events.ts` — same single-instance semantics as the steer/queue interrupt emitter). Answers submitted through `POST /api/questions/:id/answer` resolve the bus via `QuestionEvents.onAnswered` (mode `chat` handler); dismissals resolve via the new `QuestionEvents.onDismissed`. The answer endpoint reports `resumed: true` when a waiter consumed the answer. On timeout (`QUESTIONER_CHAT_WAIT_TIMEOUT_MS`, default 4 min — kept under the tool runtime's `interactive` class timeout `MCP_TOOL_TIMEOUT_INTERACTIVE_MS`, default 5 min) the questions stay `pending`, render via the conversation-linked inline fetch, and a later answer re-enters the chat as a new user turn (frontend behavior, gated on `resumed === false`). While blocked, the tool emits `status` heartbeats every 15 s so SSE transports (Bun `idleTimeout: 60`) do not idle out.

**Question delivery pipeline.** Generated questions are persisted with `expiresAt` (default 7 days). Negotiation-family rows additionally carry internal `detection.negotiation` provenance (version, purpose, exact recipient+intent+opportunity+network, exact task when applicable, canonical intent fingerprint, and capture-time opportunity/task markers). `QuestionerAdapter` admits the candidate before generation and revalidates under one canonical lock order: exact-task advisory lock → complete question cohort ordered by ID → intent/assignment/membership/network/opportunity/task. `questions_negotiation_provenance_uniq` makes retries idempotent across statuses without reducing cardinality. Public REST/MCP serialization strips the envelope, purpose, server session binding, lifecycle markers, fingerprints, and actor network IDs.

Pending negotiation rows are freshness-validated on scoped and unscoped reads and counts; legacy/stale/unsafe rows fail closed, so the global pending-ID revision changes on lifecycle drift. Answered inflight history uses a separate validator: current exact recipient ownership/fingerprint/network/opportunity actor binding remains mandatory, while the exact canceled task and its own answer/dismiss settlement may tolerate the expected continuation-driven opportunity transition.

Answer, dismiss, and timeout use the same exact-task settlement protocol. The task metadata is the durable outbox (`questionSettlement`): it records a deterministic settlement ID and `requested|completed` continuation status in the settlement transaction. The original timeout remains armed as recovery even if no question row was generated/persisted or the first Redis enqueue fails. `negotiation-run-existing` uses a deterministic job ID, validates the exact settled task, passes the task+settlement correlation through OpportunityGraph/NegotiationGraph, and idempotently creates or reuses only that settlement's successor under an advisory lock—never a latest task. Bull/process retries resume a submitted/working successor and terminal successors make redelivery a no-op. Uptake answers remain private; ordinary follow-up retains the established shared metadata channel.

MCP/chat/direct `answer_pending_question` composition now injects the same canonical validated answer boundary as REST. The authenticated principal is server-derived; intent visibility is clamped and network-scoped keys are rejected before the host bridge. Internal provenance is never projected.

The application-wide 30-second no-conversation/non-pool poll remains the only permanent poller. Its stable pending-ID revision is an invalidation signal; a mounted intent workspace performs one passive exact-intent pending+answered refetch when it changes. `passive=true` cannot trigger visit-time pool mining. Exact server-proven Personal Agent message/session scope is required for an anchor; otherwise pending and answered cards use deterministic trailing placement. The single mounted `IntentNegotiatorChat` and responsive drawer/region behavior are unchanged.

**Proactive pool-question delivery (IND-421).** Both initial and answer-chained `pool_discovery` producers pass through `persistPoolQuestion` and its injected post-persist enqueue. `PoolQuestionPushQueue` is a dedicated retryable BullMQ worker with settled-job removal and a colon-free deterministic job ID. With `POOL_QUESTIONS_PUSH=on`, pool-question mode on, negotiator chat enabled, and a personal negotiator available, `QuestionerAdapter.claimPoolQuestionPush` takes a per-recipient advisory transaction lock plus question/intent row locks, then enforces lifecycle, strict VoI decay, pool ≥8, explicit `intents.lastVisitedAt`, cycle uniqueness, and the two-claims-per-UTC-day cap. Claim metadata is internal; only successful delivery stamps `detection.pushedAt`.

Delivery resolves `ChatSessionService.resolveNegotiatorSession(userId, 'Personal Agent')`, never an intent-pinned session. `ConversationDatabaseAdapter.deliverClaimedPoolQuestionPush` locks/rechecks the question and, in one transaction, inserts or verifies the question ID as the deterministic assistant message ID, advances `conversations.lastMessageAt` only on a fresh insert, and stamps delivered metadata plus `pushedAt`. A concurrent answer/dismiss wins by suppressing delivery without a message. The global Questions list and unscoped injection remain pool-free; the canonical count split is `globalPending`, delivered `pushedPoolPending`, and their `personalAgentPending` sum. Public REST/MCP payloads strip pool and push internals.

**Pool drift lifecycle (IND-422).** The queued/chained final persist gate re-reads the exact recipient+intent pool and normalized payload+summary fingerprint. Persistence proceeds only when the fingerprint is unchanged and pool Jaccard is at least the shared inclusive `0.7` threshold; otherwise no question row, push enqueue, or dismissal is produced. Discovery completion uses the same comparison to system-void pending drifted rows with `detection.voidedReason='pool_drift'`. Voided rows are excluded from rendering, push admission, counts, dismissal decay, and novelty suppression. MODE-on mining also skips when the latest durable non-voided snapshot has the same fingerprint and sufficient pool overlap; independently gated shadow-only mining has no durable cadence anchor. The same `0.7` threshold governs P3 retained-assignment admission.

Material normalized payload/summary edits void stale pending questions, allow a previously answered axis once under the new fingerprint, and mark exact recipient+intent `poolAdjustments` as `stale: true`. Stale adjustments remain for audit but are excluded from ranking and demotion; legacy unscoped or malformed entries are preserved. `POOL_QUESTIONS_MINING`, `POOL_QUESTIONS_MODE`, `POOL_QUESTIONS_PUSH`, `POOL_QUESTIONS_STAMP_NEWBORN`, and `POOL_QUESTIONS_RANKING` remain independent gates, and the seven-day question TTL is unchanged.

**Post-discovery intent recovery (IND-506).** Successful authoritative from-intent discovery and succeeded exact-intent asynchronous runs call one failure-isolated completion hook, which enqueues a privacy-minimal job on the existing Questioner worker under the existing master gate. `IntentRecoveryRefinementService` requires an exact active owned intent, rejects any canonical recipient-visible actionable exact-trigger opportunity, and invokes the recovery-purpose intent preset with only payload/summary, stored global owner context, and an optional bounded aggregate rejected-negotiation count. The aggregate is admitted only after bilateral participants, capture-time intent fingerprint, completed task, task/actor network provenance, and one `hasOpportunity=false` outcome artifact validate; raw opportunity/task/artifact text and IDs never reach generation or persistence.

Recovery rows remain ordinary `mode='intent'` questions. `detection.purpose='recovery'` and the versioned fingerprint/completion snapshot are private and stripped from REST. Final recovery persistence, owned exact-trigger opportunity creation, and exact-trigger reactivation take the same recipient+intent advisory lock. Reactivation additionally takes the negotiation-attempt lock, row-locks and re-reads the opportunity, and applies the same canonical fresh/active task predicate used by negotiation claims immediately before mutation, so either a committed task suppresses reactivation or the later old-version claim fails. Recovery then rechecks lifecycle/fingerprint/exact-trigger actionability and relies on migration `0105`'s recipient+intent+fingerprint expression unique index across all statuses and expiry states. Every generated visible string (title, prompt, option labels, and descriptions) is rejected on process/evidence narration after Unicode quote normalization. Material edits void stale pending rows. Recovery answers use advisory→intent-row→question-row ordering, atomically recheck owner/lifecycle/fingerprint before pending→answered, emit no reaction when voided, and carry the expected fingerprint plus owner through the answer-only graph to a final locked intent update that also requires active/non-archived lifecycle; valid answers use the unchanged intent-update/HyDE/rediscovery path. Recovery rows are excluded from pool pending budgets, so pool questions retain independent cadence and novelty.

## 5. Chat Tool System

Tools bridge the ChatAgent to subgraphs. Each tool file defines LangChain tool functions that the LLM can invoke during the ReAct loop. Tools handle input validation, call the appropriate subgraph, and return a formatted string result.

### Tool files and their graph mappings

| Tool File | Tools | Subgraph(s) Invoked |
|-----------|-------|---------------------|
| `enrichment.tools.ts` | read_user_profiles, create_user_profile, update_user_profile | Enrichment Graph |
| `intent.tools.ts` | read_intents, create_intent, update_intent, delete_intent, search_intents, create_intent_index, read_intent_indexes, delete_intent_index | Intent Graph, Intent Index Graph, Opportunity Graph (auto-discovery on create) |
| `network.tools.ts` | read_indexes, read_users, create_index, update_index, delete_index, create_index_membership | Network Graph, Network Membership Graph |
| `contact.tools.ts` | add_contact, list_contacts, search_contacts | (direct service calls) |
| `chat.tools.ts` | list_conversations, get_conversation | (direct `ChatSessionReader` calls) |
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



**Per-turn negotiator timeout.** Independent of the phase budget, every `IndexNegotiator.invoke()` call wraps its underlying `model.invoke` in `AbortSignal.timeout(turnTimeoutMs)` (default 15 s, env-overridable via `NEGOTIATOR_TURN_TIMEOUT_MS`). When a single LLM round-trip exceeds the cap the call rejects with a `TimeoutError`; the graph's `turnNode` catch path and the `respond_to_negotiation` inline fallback both convert that rejection into a `reject`-shaped turn so one slow upstream tail can't monopolize the 20 s phase budget across 4 parallel candidates × up to 6 turns each. The resolver clamps to `(0, Number.MAX_SAFE_INTEGER]` — bad values fall back to the default.


1. Always appends a JSON content block to the tool result prefixed with `Decision questions (structured): {...}`. LLM-driven clients without elicitation support can parse this and resurface the questions in prose.
2. If the client declared the `elicitation` capability, sequentially dispatches one `elicitation/create` per question (`dispatchElicitations` in `packages/protocol/src/mcp/elicitation.dispatcher.ts`). On `accept`, the flattened choice is posted as a user message into the user's most-recent index.network chat session via `ChatMessageWriter` (`packages/protocol/src/shared/interfaces/chat-message-writer.interface.ts`, implemented by `services/api/src/adapters/chat-message-writer.adapter.ts`). `decline` is a no-op; `cancel` breaks the loop; transport errors break the loop with a warn; write errors log and continue. Users with no chat session are logged as `chat_message_write_skipped_no_session` and the answer is dropped on this path — the JSON envelope only carries the questions, not accepted choices.

The relevant public exports from `@indexnetwork/protocol` for runtime authors building on top of this: `ChatMessageWriter`, `buildElicitationCreate`, `flattenChoice`, `dispatchElicitations`, `ElicitInputFn`, `ElicitResultLike`, `DispatchElicitationsParams`.

## 5a. MCP Server

The protocol exposes every registered chat tool over the Model Context Protocol via `createMcpServer` in `packages/protocol/src/mcp/mcp.server.ts`. This is the surface that external runtimes — OpenClaw, Claude Code, Codex, Cursor — speak to when they act on behalf of a user.

### HTTP hot-path lifecycle

The HTTP entrypoint for MCP is `services/api/src/controllers/mcp.controller.ts`, dispatched directly from `services/api/src/main.ts` before the decorated `/api/*` router. Because that bypasses controller guards, the controller applies a cheap HTTP-level limiter before expensive work: `checkMcpHttpRateLimit` uses the shared limiter storage and buckets by verified JWT user or client IP under the `mcp_http` class (`MCP_HTTP_LIMIT_PER_MIN`, default 240). Raw API keys are deliberately not bucket keys at this pre-auth layer, matching the normal `RateLimit` guard's credential-rotation defense. The HTTP limiter honors `LIMITER_DISABLE` and fails open on limiter storage/identity errors so Redis incidents do not take down MCP.


Each accepted MCP HTTP request still gets a fresh `McpServer` and `WebStandardStreamableHTTPServerTransport`. This is intentional: the Streamable HTTP transport tracks response-routing state by JSON-RPC message id, and clients commonly reuse ids such as `2` across independent connections. Pooling a server or transport can route responses or client-capability state across callers, so the controller preserves per-request isolation. The request `finally` path closes both SDK lifecycle objects. Do not hand-write cached MCP/JSON-RPC responses for static-looking methods such as `initialize` or `tools/list`; the SDK owns response envelopes and capability negotiation.

To reduce allocation without changing protocol semantics, `packages/protocol/src/mcp/mcp.server.ts` caches only static tool registration metadata: tool name, description, Zod schema, JSON Schema, and the SDK `fromJsonSchema` input schema wrapper. Request-scoped tool execution still rebuilds the registry after auth with scoped `userDb`/`systemDb`, because tool handlers capture those dependencies when the registry is created.

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
- `scopedDepsFactory` — creates per-request `userDb` and `systemDb` scoped to the caller's network memberships, so every tool call runs against the caller's actual data perimeter.

### Tool loop

Every registered tool goes through the same lifecycle on every call:

1. Extract the HTTP request from `ServerContext.http.req`.
2. Resolve `{ userId, agentId }` via the auth resolver.
3. Build the `ResolvedToolContext`, set `isMcp = true` and attach `agentId`.
4. Run the agent-registration gate: unless the tool is on the exempt list (`register_agent`, `read_docs`), a missing `agentId` produces an `Agent not registered` error that tells the caller to register first. (`scrape_url`, contact/Gmail tools, and the deprecated profile/profile-run aliases are omitted from the MCP surface entirely; they remain on the direct HTTP Tool API and chat.)
5. Build per-request scoped databases via `scopedDepsFactory` and rebuild the tool registry with them.
6. Validate arguments against the tool's original Zod schema.
7. Invoke the raw tool handler through `ToolInvocationRuntime`, which attaches a shared `AbortSignal`, wall-clock deadline, trace/progress bridge, and output-size cap.
8. Return the handler's formatted string as an MCP text content block.

Errors are trapped and returned as MCP error responses so a single failing tool never breaks the server session. Runtime failures use JSON envelopes with stable codes: `TOOL_TIMEOUT`, `TOOL_CANCELLED`, and `TOOL_OUTPUT_TOO_LARGE`.

### Runtime deadlines, cancellation, and output caps

Every MCP tool call is bounded by `packages/protocol/src/shared/agent/tool.runtime.ts` instead of per-tool ad hoc timers. The runtime classifies tools into three timeout classes:

| Class | Default | Intended tools |
|---|---:|---|
| `fast` | 10 s | Metadata reads, lightweight CRUD, onboarding, delivery confirmation, docs |
| `bounded_slow` | 45 s | Normal multi-step calls that may touch storage or a small graph path |
| `async_candidate` | 50 s | Calls that are currently synchronous but are candidates for future job/status/result/cancel flows, such as imports and discovery |

Timeouts can be tuned globally by class or per tool:

- `MCP_TOOL_TIMEOUT_FAST_MS`
- `MCP_TOOL_TIMEOUT_BOUNDED_SLOW_MS`
- `MCP_TOOL_TIMEOUT_ASYNC_CANDIDATE_MS`
- `MCP_TOOL_TIMEOUT_<TOOL_NAME>_MS`, where the tool name is uppercased and non-alphanumeric characters become `_` (for example, `MCP_TOOL_TIMEOUT_DISCOVER_OPPORTUNITIES_MS`).

The runtime also enforces response size limits before a tool result is returned to MCP or the REST-safe tool path:

- `MCP_TOOL_MAX_OUTPUT_BYTES` defaults to `1000000`.
- `MCP_TOOL_MAX_OUTPUT_<TOOL_NAME>_BYTES` overrides a single tool.

The MCP HTTP controller rejects oversized inbound JSON-RPC bodies before they reach the transport via `MCP_MAX_REQUEST_BYTES`, also defaulting to `1000000`.

Cancellation propagates through the same signal. MCP `notifications/cancelled`, client-side HTTP aborts exposed by the SDK, and runtime timeouts abort the active request context. Graph invocations, LangChain model calls, scraper calls, and embedding generation read that signal via the shared helpers so downstream work stops as close to the provider boundary as possible. Trace events emitted during a tool call are bridged to MCP `notifications/progress`, so capable clients can surface long-running graph/agent progress before either a result or cancellation.


Runtime error envelopes are JSON text payloads shaped as:

```json
{
  "success": false,
  "code": "TOOL_TIMEOUT",
  "data": {
    "timeoutClass": "async_candidate",
    "timeoutMs": 50000,
    "maxOutputBytes": 1000000
  }
}
```

Use `TOOL_TIMEOUT` when the server deadline fired, `TOOL_CANCELLED` when the client cancelled first, and `TOOL_OUTPUT_TOO_LARGE` when the handler returned more than its configured output budget.

### MCP_INSTRUCTIONS — the canonical behavioral contract

`MCP_INSTRUCTIONS` is a template string passed into the `McpServer` constructor as `instructions`. Every MCP client that connects receives it automatically and is expected to follow it for the session. It carries the **global** contract: voice, banned vocabulary, the entity model, output rules, and pointers to tool descriptions for per-pattern behavior. Per-tool guidance (discovery-first, personal-index scoping, intent specificity, silent-subagent negotiation stance) lives in each tool's own description so it surfaces alongside the tool in MCP tool listings. Plugin skill files, CLI wrappers, and marketplace manifests do not redefine this guidance; they defer to what ships with the MCP server.

When `MCP_INSTRUCTIONS` changes, every connected runtime picks up the new guidance on its next session — no plugin or skill release is needed.

### Negotiation turn mode

One section of `MCP_INSTRUCTIONS` ("Negotiation turn mode") switches the caller into a background-subagent stance when the caller's session key is prefixed `index:negotiation:`. A subagent in this mode is told to:

- Fetch the full negotiation via `get_negotiation`.
- Read the user's profile and intents via `read_user_profiles` and `read_intents`.
- Submit its response via `respond_to_negotiation` — never produce user-facing output, never ask clarifying questions, prefer conservative actions when ambiguous.

This is how personal agents participate in bilateral negotiation. A polling agent pulls pending turns from `POST /api/agents/:id/negotiations/pickup` and launches subagents with an `index:negotiation:`-prefixed session key; the MCP_INSTRUCTIONS contract does the rest — the polling agent itself has no negotiation-specific prompt of its own.

The key negotiation-facing MCP tools are:

| Tool | Purpose |
|------|---------|
| `get_negotiation` | Returns the full turn history and assessment seed for a negotiation |
| `list_negotiations` | Lists current and concluded agent negotiations with lifecycle-explicit opportunity/owner-action narration; task completion never implies an owner-accepted connection or H2H thread |
| `respond_to_negotiation` | Submits a turn (propose / counter / accept / reject / question) with reasoning and suggested roles. Wraps `POST /api/agents/:id/negotiations/:negotiationId/respond` |

Agents claim turns via the HTTP pickup endpoint rather than an MCP tool — the turn payload is too large and the CAS semantics are easier to express over HTTP than via the streaming MCP transport. Once a turn is claimed, the response path goes through `respond_to_negotiation` so the subagent can submit from inside its MCP session.

## 6. HyDE System

HyDE (Hypothetical Document Embeddings) bridges source-side wording and counterpart-side documents before vector search. Source types are `intent`, `query`, and `context`; there is no profile source. Presentation identity lives on `users`, and the retired profile-vector corpus is not read. A lens tagged `profiles` is treated by the API as a preference for premise retrieval.

### Legacy and frame-v1

1. **Lens inference:** Both modes infer 1-5 dynamic lenses from `sourceText` and optional `profileContext`. Frame-v1 additionally extracts roles, hard constraints, named entities, and domain vocabulary. Every frame value must have exact evidence in `sourceText`; profile context can specialize lenses but is never frame evidence.
2. **Version-aware cache check:** Legacy reads its unchanged Redis/DB identities. Frame-v1 reads only validated entries carrying `frame-v1`, the lens, matching source/frame fingerprints, and a valid generation marker; its stable DB lens identities are overwritten on source revisions rather than accumulated.
3. **Generation:** Legacy uses the existing corpus-specific source+lens prompt. Frame-v1 generates from the sanitized frame with slot discipline: target voice and generic reciprocal/domain elaboration are allowed; unsupported named entities and hard constraints are forbidden.
4. **Validation (frame-v1 only):** One batch validator checks newly generated documents before embedding. Partial rejection preserves valid siblings; all rejection returns no HyDE embeddings. Provider/shape failures fail open per document for the current run, but failed-open documents are not cached or persisted.
5. **Embedding and retrieval:** Returned texts use the configured OpenRouter embedding model (default `openai/text-embedding-3-large`, 2000 dimensions). Every lens searches intents and premises within scope, preferring its hinted corpus, and candidate results are merged before `OpportunityEvaluator` runs.
6. **Caching:** Legacy output follows existing cache behavior. Frame-v1 persists only `valid` documents under versioned Redis keys and DB strategies/context, preventing cross-mode or changed-frame reuse.

`HYDE_FRAME_CONSTRAINTS_ENABLED` is strict and default-off: only the literal `true` enables frame-v1. IND-426's evidence-v2 `eval/hyde` study runs the unchanged production agents/graph with empty cache/database ports over 90 frozen background cases and 900 candidates. The primary 75 cases model stored intents processed asynchronously; the secondary 15 model premise-derived, network-scoped user contexts matching other users' active intents. There is no synchronous direct-search cohort. All five existing drift strata retain at least 15 cases, and every case has two authored graded positives, four linked minimal-pair hard negatives, and four distractors. Authored grades only construct/fingerprint the corpus; canonical truth comes from resolved blinded judgments by two independent humans. Candidate embeddings are shared across four paired legacy/frame-v1 runs, counterbalanced by fixed case/run hash, with the live background cutoff `0.30`, lens bonus `0.1`, and maximum three lenses. Every saved-intent case receives production-shaped discoverer context containing the trigger under `Active intents:` and, where authored, a global `Context:` paragraph. Failures remain explicit without retries or success-only selection.

For current production fidelity, the private runner maps `saved-intent` to graph `sourceType: 'query'` and `user-context` to `sourceType: 'context'`, using stable synthetic source IDs. In this study `query` is an internal background-graph branch fed a stored intent, not a user-facing direct query. Collection provenance and paired blocks record the mapping; the staged evidence boundary exports a public batch without background source, graph source, mode/run, production-validator, or return-status leakage and a private 0600 mapping key. Removing or refactoring the direct-search product must preserve this background branch or intentionally migrate its mapping and the eval contract. `sourceText` alone supports generated facts; `profileContext` does not. Production `HydeValidator` results are a noncanonical diagnostic appendix, and optional LLM triage cannot satisfy canonicality. Analysis reports tie-fractional Precision@5, graded nDCG@5, linked-hard-negative FPR@5, raw-cosine positive-to-nearest-linked-negative margin, unsupported-generation and returned exposure/grounding-error, all-rejected, failed-open, incomplete-pair, timing, and resources. Deterministic fixed-seed 10,000-replicate hierarchical paired bootstrapping resamples cases within each stratum and paired runs within case, then equally weights run -> case -> stratum in a five-stratum macro average. Its eight versioned gates all become `INSUFFICIENT` for incomplete/noncanonical evidence.

This remains a frozen local, provider-variable in-memory component approximation. It does not execute BullMQ, network scoping, database persistence or reuse, raw-context fallback, candidate merging, negotiation, or delivery. It also omits SQL limits, cross-row grouping, production opportunity precision/fairness/external validity, and canonical token/cost accounting. Non-gating coverage and point estimates split saved-intent from user-context behavior; the unchanged eight gates still use all 90 cases with equal-stratum weighting. Model/embedding pins identify configured primary IDs; production retry/fallback identity per call and separate frame-extraction resources are unavailable. Eval scoring intentionally preserves production cross-corpus search (both intents and premises for every lens; target corpus is a preference/limit-allocation hint). Human adjudication is deliberately expensive. Report generation recomputes analysis from all supplied parents, retained per-lens cosines allow score/ranking revalidation, and outputs cannot collide with inputs even under `--force`. Artifacts remain unsigned, embeddings are not retained, reviewer identity/independence attestations require external verification, and the atomically replaced public/private/template files are not a transactional set, so external custody/fingerprint review is required; `--force` regenerates opaque IDs. Artifacts/baselines are not committed, and `eval/matching` remains only a secondary evaluator-only check.

See [`../domain/hyde.md`](../domain/hyde.md) for cache identities, rejection semantics, source/profile boundaries, and eval limitations.

## 7. Opportunity Pipeline

The opportunity discovery pipeline is the most complex workflow in the system. Background queues transform persisted intent and enrichment context into ranked, evaluated connection opportunities.

### End-to-end flow

```
Persisted intent or enrichment context (background queue)
    |
    v
[Prep] Load user's network memberships, active intents, profile
    |
    v
[Scope] Determine eligible assigned indexes
    |
    v
[Resolve] Validate the queued trigger intent and discovery source
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

**Enrichment/context discovery:** Enrichment queues regenerate user-context and premise representations, which can be evaluated against active intents. The graph merges eligible candidates from the intent and premise representations with deduplication.

**Introducer discovery:** An introducer queue validates the requested participants and evaluates the explicit introduction within their shared-network scope.

**Maintenance rediscovery:** The maintenance graph assesses persisted feed health and enqueues one background intent run per active intent when rediscovery is needed.

### Evaluation

The `OpportunityEvaluator` receives source profile context and candidate profiles (including their intents and profile data). It performs valency analysis to determine semantic roles:
- **Agent:** Candidate can do something for the source
- **Patient:** Candidate needs something from the source
- **Peer:** Symmetric collaboration

Each match gets a score (0-100), reasoning (written from a third-party analytical perspective), and actor assignments with roles.

### Deduplication and ranking

Candidates are deduplicated by `(sourceUserId, candidateUserId, indexId)` with the highest-scoring entry winning. When a candidate appears across multiple shared networks, the index with the highest relevancy score (from `intent_networks.relevancyScore`) is preferred as the tiebreaker.

### Negotiation (optional)

When enabled, high-scoring candidates enter bilateral negotiation via the Negotiation Graph. Two agents (proposer for the source, responder for the candidate) negotiate over multiple turns, assessing fit and agreeing on roles. Only candidates that produce an opportunity proceed to persistence.

### Persistence

Surviving background opportunities are persisted with status `latent`; ambient negotiation and explicit lifecycle actions determine later states. Persisted opportunities are presented through the home feed and can be reviewed from a later chat turn or chat history. The full lifecycle, including retained `draft` compatibility and introducer reactivation, is documented in [Opportunity Status Lifecycle](./opportunity-status-lifecycle.md).

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

### Intent-network assignment

Intent-to-network assignment is handled separately by the Intent Index Graph. When an intent is created and the user is in a network-scoped chat, the `create_intent_index` tool assigns the intent with either:
- Direct assignment (score 1.0) when `skipEvaluation` is true
- Evaluated assignment via `IntentIndexer` agent when the index has prompts defining its purpose

Friendly ownership/membership prechecks and LLM evaluation are not write authority. Every direct, no-prompts, and evaluated success path finishes through `IntentDatabaseAdapter.assignIntentToNetworkIfMember`, which locks the exact intent, network, and membership rows in one transaction, rechecks that the intent is owned and unarchived, the network is undeleted, and the membership is current with `owner`, `member`, or `admin` permission, then inserts the scored assignment and `NetworkAssignmentMetadata` before releasing those locks. Concurrent membership revocation therefore wins before a waiting final write and prevents assignment; existing queue/backfill assignment APIs retain their previous behavior.

## 9. Enrichment Pipeline

Enrichment combines web scraping, external API enrichment, premise decomposition, and vector embedding to build a user's representation. There is no persisted profile document: identity (name/bio/location) lives on the `users` table, and the synthesized prose+embedding projection lives in `user_contexts` (a global `networkId = null` row plus per-network rows), regenerated from the user's premises.

### Operation modes

**Write mode (with meaningful input):** User provides text about themselves -> `decompose_premises` node runs `PremiseDecomposer` to split it into atomic premises -> premise changes drive `user_contexts` regeneration.

**Write mode (scraping):** User has social links or full name but no text input -> `scrape` node uses the Scraper adapter to gather public web data -> `decompose_premises` processes the scraped content.

**Generate mode:** Uses the external enrichment API (Parallel Chat API) via the `auto_generate` node to enrich the user's identity (and dedupe/update ghost display names + socials on `users`), then decomposes into premises.

**Query mode:** Fast path that returns the user's existing identity/context without any LLM calls.

### Premises and HyDE

The enrichment input is decomposed into premises (composable identity assertions). Premises carry their own vector embeddings and serve as the person-level search corpus for HyDE discovery, replacing the earlier approach of embedding an entire profile into a single vector. Premise changes enqueue `UserContextQueue`, which regenerates the global and per-network `user_contexts` paragraphs, their embeddings, and per-network HyDE documents.

### State detection

The `check_state` node detects what (if anything) the user still needs, keyed on the presence of **ACTIVE premises**:
- No active premises -> needs decomposition/enrichment
- Premises present and up to date -> returns immediately

This ensures the enrichment graph only performs expensive operations when necessary.

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

Agent names in trace events use kebab-case: `intent-inferrer`, `profile-generator`, `hyde-generator`, `opportunity-evaluator`, `lens-inferrer`, `home-categorizer`, `intent-verifier`, `intent-reconciler`, `intent-networker`.

### Agent timing tracking

Each graph node accumulates `agentTimings` (array of `{ name, durationMs }`) in its return state. These timings are aggregated by the ChatStreamer and included in the `debug_meta` event at the end of the response, providing per-agent performance visibility.

**Negotiation events** (added 2026-04-17):

- `negotiation_session_start` / `negotiation_session_end` — emitted by `negotiateCandidates` in `negotiation.graph.ts`, wrapping each per-candidate ambient run. They carry the opportunity/conversation identifiers, participants, start time, and duration.
- `negotiation_turn` — emitted by the negotiation graph's `turnNode` after each successful turn. Carries `opportunityId`, `turnIndex`, `actor` (`'source' | 'candidate'`), `action` (`propose | accept | reject | counter | question`), `reasoning`, `message`, `suggestedRoles`, `durationMs`.
- `negotiation_outcome` — emitted from `finalizeNode` on every terminal path (`accepted`, `rejected_stalled`, `waiting_for_agent`, `timed_out`, `turn_cap`). Carries `opportunityId`, `outcome`, `turnCount`, `reasoning`, `agreedRoles`.

Consumers use these generic observability events to render negotiation progress and hydrate recorded negotiation history from `tasks`, `messages`, and `opportunities`. Existing `agent_start/end` emissions in `negotiation.graph.ts` remain available to the rolled-up debug render path.

## 11. Model Configuration

All LLM model settings are centralized in `packages/protocol/src/shared/agent/model.config.ts`.

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
