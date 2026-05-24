---
title: "Architecture Overview"
type: design
tags: [architecture, layering, agents, data-flow, protocol, langgraph]
created: 2026-03-26
updated: 2026-04-11
---

# Architecture Overview

This document provides a comprehensive overview of the Index Network architecture for new contributors, stakeholders, and anyone seeking to understand how the system is structured. It covers the monorepo layout, protocol layering, agent system, data flow, and supporting infrastructure.

For domain-specific deep dives, see the design papers in `packages/protocol/src/docs/` and the protocol README at `packages/protocol/src/README.md`.

---

## 1. Monorepo Structure

The repository is organized as a Bun-managed monorepo with two primary workspaces.

```
index/
  backend/           Backend API and Agent Engine (Bun, TypeScript)
  frontend/          Vite + React Router v7 SPA (React 19, Tailwind CSS 4)
  packages/
    protocol/        @indexnetwork/protocol NPM package (agent graphs, interfaces, tools)
    cli/             CLI client (@indexnetwork/cli, Bun, TypeScript)
```

**Protocol** is the backend: a native Bun HTTP server (`Bun.serve`) running on port 3001. It hosts the API, LangGraph-based agent system, database layer, job queues, and event infrastructure.

**Frontend** is a single-page application built with Vite and React Router v7. In development, Vite proxies `/api/*` requests to the protocol backend. In production, a reverse proxy handles routing.

**CLI** is a standalone command-line client (`@indexnetwork/cli`) that wraps the Tool HTTP API. It provides authentication, command parsing, formatted terminal output, and `--json` mode for machine-readable output. Published to npm with platform-specific native binaries.

Both protocol and frontend workspaces share the same repository and are installed together via `bun install` at the root. Development uses git worktrees (`.worktrees/`) to isolate feature and fix branches from the stable `dev` branch.

---

## 2. Protocol Layering

The protocol backend enforces strict layering to maintain separation of concerns and testability. Dependencies always point inward, from the HTTP boundary toward infrastructure.

```
+------------------------------------------------------------------+
|                                                                  |
|   Controllers                                                    |
|   HTTP handlers, input validation, response formatting           |
|   Imports: services, guards, decorators                          |
|                                                                  |
+------------------------------------------------------------------+
        |
        | delegates to
        v
+------------------------------------------------------------------+
|                                                                  |
|   Services                                                       |
|   Business logic, DB transactions, event emission                |
|   Imports: adapters, lib/protocol (graphs, agents)               |
|                                                                  |
+------------------------------------------------------------------+
        |
        | uses
        v
+------------------------------------------------------------------+
|                                                                  |
|   Adapters                                                       |
|   Own types that align with protocol interfaces                   |
|   (database, embedder, cache, queue, scraper, storage)           |
|   Named by concept, not technology                               |
|                                                                  |
+------------------------------------------------------------------+
        |
        | talks to
        v
+------------------------------------------------------------------+
|                                                                  |
|   Infrastructure                                                 |
|   PostgreSQL + pgvector, Redis (BullMQ), OpenRouter (LLM),      |
|   S3 (storage), external APIs                                    |
|                                                                  |
+------------------------------------------------------------------+
```

The **protocol layer** (`packages/protocol/src/`) sits alongside services. It contains LangGraph graphs, AI agents, tools, state definitions, and interfaces. It is fully self-contained — zero imports from parent directories (adapters, services, queues, schemas). All infrastructure dependencies are received via constructor injection through interfaces defined in `packages/protocol/src/interfaces/`. The **composition root** (`src/controllers/mcp.controller.ts`) assembles `ProtocolDeps` inline and injects `ChatGraphFactory` into `ChatSessionService` at startup.

### Layer Responsibilities

| Layer | Responsibility | Can Import |
|-------|---------------|------------|
| **Controllers** | HTTP handling, input validation via Zod, response formatting | Services, guards, decorators |
| **Services** | Business logic, DB transactions, event emission, typed results | Adapters, lib/protocol |
| **Adapters** | Define own types aligned with protocol interfaces, wrap infrastructure | Infrastructure libraries (not lib/protocol/) |
| **Protocol** | Graphs, agents, tools, state machines | Nothing external (all deps injected) |
| **Infrastructure** | PostgreSQL, Redis, OpenRouter, S3 | N/A (external systems) |

---

## 3. Dependency Rules

Layering is enforced through strict import rules. Violations cause tight coupling and make testing difficult.

### What Each Layer Can and Cannot Import

**Controllers**
- CAN import: services, decorators (`@Controller`, `@Get`, `@Post`), guards (`AuthGuard`)
- CANNOT import: adapters, database, schema, Drizzle operators

**Services**
- CAN import: adapters from `src/adapters/`, protocol graphs and agents from `@indexnetwork/protocol`
- CANNOT import: other services (use events, queues, or shared lib for cross-service orchestration)

**Adapters**
- CAN import: infrastructure libraries (must not import from `@indexnetwork/protocol` interfaces — define own aligned types)
- CANNOT import: services, controllers

**Protocol layer (graphs, agents, tools)**
- CAN import: only its own submodules and types
- CANNOT import: adapters or infrastructure directly (everything is injected)

### Interface Narrowing with Pick

Graph factories do not depend on the full `Database` interface. Instead, each factory declares a narrowed type using TypeScript's `Pick<>` utility. This documents exactly which database methods a graph needs and prevents accidental coupling.

```typescript
// Full interface has 80+ methods
export interface Database {
  getUser(id: string): Promise<UserRecord | null>;
  getIntent(id: string): Promise<IntentRecord | null>;
  assignIntentToIndex(intentId: string, indexId: string, score: number): Promise<void>;
  // ... many more
}

// Each graph picks only what it needs
export type IntentNetworkGraphDatabase = Pick<
  Database,
  | 'getIntentForIndexing'
  | 'getNetworkMemberContext'
  | 'isIntentAssignedToIndex'
  | 'assignIntentToNetwork'
  | 'unassignIntentFromIndex'
  | 'getIntent'
  | 'isNetworkMember'
  | 'isIndexOwner'
  | 'getNetworkIdsForIntent'
  | 'getNetworkIntentsForMember'
  | 'getIntentsInIndexForMember'
>;

// Factory constructor accepts the narrow type
export class IntentNetworkGraphFactory {
  constructor(private database: IntentNetworkGraphDatabase) {}
}
```

This pattern is applied to all graph factories: `ProfileGraphDatabase`, `OpportunityGraphDatabase`, `IntentGraphDatabase`, `NetworkGraphDatabase`, `IntentNetworkGraphDatabase`, `NetworkMembershipGraphDatabase`, `HydeGraphDatabase`, and `HomeGraphDatabase`.

### Adapter Naming Convention

Adapters are named by **concept**, not by implementation technology.

| Correct | Incorrect |
|---------|-----------|
| `database.adapter.ts` | `drizzle.adapter.ts` |
| `cache.adapter.ts` | `redis.adapter.ts` |
| `queue.adapter.ts` | `bullmq.adapter.ts` |
| `storage.adapter.ts` | `s3.adapter.ts` |

This allows swapping infrastructure without renaming files or updating imports across the codebase.

---

## 4. Agent System

The agent system is built on LangGraph (from the LangChain ecosystem) and follows a consistent architecture: **graphs** orchestrate workflows, **agents** perform LLM reasoning, **tools** expose capabilities to the chat agent, and **state** carries data through the pipeline.

### Component Types

```
packages/protocol/src/
  graphs/           LangGraph state machines (*.graph.ts)
  states/           Graph state definitions (*.state.ts)
  agents/           AI agents with Zod-validated I/O
  tools/            Chat tool definitions by domain
  streamers/        SSE streaming for chat responses
  support/          Infrastructure utilities
  interfaces/       Adapter contracts
```

### Graphs

Graphs are LangGraph state machines. Each graph is created by a factory class that accepts dependencies via constructor injection.

| Graph (factory) | Purpose |
|-----------------|---------|
| Chat | ReAct agent loop with tool calling |
| Intent | Extract, verify, reconcile, and persist intents |
| Profile | Generate/update user profiles with scraping and embedding |
| Opportunity | HyDE-based discovery: search, evaluate, rank, persist |
| HyDE | Generate hypothetical document embeddings (cache-aware) |
| Network | Manage index (network) CRUD |
| NetworkMembership | Manage index member join/leave |
| IntentNetwork | Evaluate and assign/unassign intents to indexes |
| Home | Categorize and curate home feed content |
| Maintenance | Periodic maintenance tasks |
| Negotiation | Multi-turn negotiation flows |

**Graph invariants**: Every graph must have at least one conditional edge. All graphs use `Annotation.Root` with reducers for state management. Nodes are async functions that accept state and return partial state updates. Nodes catch errors internally rather than throwing.

### Agents

Agents are pure LLM reasoning units. They accept structured input (Zod schemas), call the LLM via `createModel()` from `model.config.ts`, and return structured output. Agents have no direct database access and no side effects. Services handle persistence after agent execution.

| Agent | Purpose |
|-------|---------|
| ChatAgent | Orchestrates tool calls in the ReAct loop |
| Intent Inferrer | Extracts intents from uploaded content |
| Intent Reconciler | Decides create/update/expire actions for intents |
| Intent Verifier | Validates felicity conditions on intents |
| Intent Indexer | Scores intent-to-index fit (relevancy 0.0-1.0) |
| Opportunity Evaluator | Scores and synthesizes opportunity matches |
| Profile Generator | Generates user profiles from identity signals |
| HyDE Generator | Creates hypothetical document embeddings |

### Tools

Tools are the capabilities exposed to the chat agent. They bridge the agent loop and the subgraph layer. When the chat agent decides to call a tool, the tool function invokes the appropriate subgraph.

| Tool File | Capabilities |
|-----------|-------------|
| `profile.tools.ts` | read/create/update user profiles |
| `intent.tools.ts` | CRUD intents, manage intent-index assignments |
| `network.tools.ts` | CRUD indexes (networks), manage memberships |
| `contact.tools.ts` | import, add, remove, and list contacts |
| `opportunity.tools.ts` | Discover and send opportunities |
| `agent.tools.ts` | register, list, update, delete agents and manage agent permissions |
| `integration.tools.ts` | Connect and manage third-party integrations |
| `negotiation.tools.ts` | Respond to negotiation turns |
| `chat.tools.ts` | Chat session and conversation tools |
| `utility.tools.ts` | URL scraping, action confirmation/cancellation |

### Agent Registry

The protocol includes an agent registry that sits beside the chat tool stack and the negotiation system. It gives every actor in the system — system agents like `Index Chat Orchestrator` and `Index Negotiator`, as well as user-owned personal agents connected from OpenClaw, Claude Code, Codex, or any MCP-capable runtime — a first-class database identity that can be authenticated, authorized, and dispatched against.

#### Tables

- `agents` stores personal and system agent identities (`type: 'system' | 'personal'`, `ownerId`, `status`).
- `agent_transports` stores delivery channels. The only channel is `mcp` — the agent authenticates with an API key bound to its identity, connects to the MCP server for tool work, and polls `POST /api/agents/:id/negotiations/pickup` for negotiation turns.
- `agent_permissions` stores the actions an agent may perform for a user (e.g. `manage:intents`, `manage:negotiations`), optionally scoped to a network or node.

System agents are seeded with fixed UUIDs and granted their default permissions during onboarding. Personal agents are user-owned records exposed through the `/api/agents` controller family (see `docs/specs/api-reference.md`).

#### MCP auth resolver

MCP requests authenticate via an `x-api-key` header. The resolver reads the Better Auth `metadata.agentId` stored on the token and hands back `{ userId, agentId }` to the MCP server factory. Tool handlers receive both on the `ResolvedToolContext`, so every tool call is attributable to a concrete agent identity — not just a user. MCP callers without a resolved `agentId` are blocked from all tools except `register_agent`, `read_docs`, and `scrape_url` by the agent-registration gate inside `createMcpServer`.

#### Permission-gated tool access

Every tool and negotiation endpoint checks the caller's `agent_permissions` for the relevant action (e.g. the negotiation pickup/respond endpoints and the `respond_to_negotiation` MCP tool require `manage:negotiations`). MCP auth resolves the `(userId, agentId)` pair from the API key, so every permission check is attributable to a concrete agent identity — not just a user.

#### Network-scoped agents

`agent_permissions.scope` accepts `'global' | 'node' | 'network'`. A network-scoped permission row — `scope='network', scopeId=<networkId>` — restricts the agent to a single network. Two enforcement layers:

- **HTTP**: `backend/src/guards/agent-scope.guard.ts` exposes `resolveAgentNetworkScope(req)`, `assertAgentNetworkScope(req, networkId)`, and `withAgentScope(req, user)`. Network/intent/opportunity controllers assert on writes that take a path-param networkId, and filter list endpoints via `withAgentScope`. Mismatches throw `ScopeViolationError`, mapped to HTTP 403 in `main.ts`.
- **MCP**: the auth resolver also returns `networkScopeId`. `applyNetworkScopeToContext` (in `packages/protocol/src/mcp/mcp.server.ts`) clamps `ResolvedToolContext.indexScope` to `[networkScopeId, personalIndex]`, and the per-request `systemDb` is constructed from that same set, so every downstream tool call is bounded at both the prompt-visible scope and the DB-level scope check.
- **Chat tools (shared)**: the same `[scopedNetwork, personalIndex]` clamp applies on the web-chat path via `resolveChatContext({ networkId })` — so an MCP-scoped agent and a web-scoped chat see the same data perimeter. `createChatTools` constructs `systemDb` from `resolvedContext.indexScope`, keeping the prompt-advertised reach and the DB-level clamp consistent.
- **DB (opportunity reads)**: `OpportunityDatabaseAdapter.getOpportunitiesForUser` requires the requesting user's *own* actor entry to be anchored on the bound network — `EXISTS actor WHERE userId=$1 AND networkId=$2`, not two independent `actors @>` checks. `update_opportunity` mirrors the rule. `actors[].networkId` is the source of truth for scope; the `opportunity.context.networkId` denormalization is no longer consulted by security-relevant filters.

The primary use case is bulk experiment-network onboarding: `networkInvitationService.invite({ networkId, email })` provisions user + network-scoped agent + API key + invitation email. Possession of the email account *is* the user's verification — there is no separate `users.experimentNetworkId` column anymore.

#### Personal agent dispatch (negotiation)

Negotiation turns that cannot be resolved synchronously by an in-process system agent are **parked for polling**: the graph writes a `tasks` row in `waiting_for_agent` with the full turn context in metadata and suspends.

1. The user's personal agent polls `POST /api/agents/:id/negotiations/pickup` with its API key. The backend atomically CAS's the oldest pending task for the caller's user from `waiting_for_agent` to `claimed`, enqueues a 6-hour claim timeout, and returns the turn context.
2. The agent deliberates and submits its decision via `POST /api/agents/:id/negotiations/:negotiationId/respond`. The backend persists the turn and either finalizes the negotiation (on `accept`, `reject`, or turn cap) or returns the task to `waiting_for_agent` for the counterparty.
3. If no agent claims a parked turn within 24 hours, the in-process system `Index Negotiator` takes over.

Personal agents poll `POST /api/agents/:id/negotiations/pickup` with their API key. On a successful pickup the agent reads the turn context, deliberates, and submits the response via `POST /api/agents/:id/negotiations/:negotiationId/respond`. See `docs/domain/negotiation.md` for the full turn protocol.

### How They Compose

```
Chat Tools  ----invoke---->  SubGraphs  ----call---->  Agents
   |                            |                        |
   |                            |                        | (LLM reasoning)
   |                            |                        v
   |                            |                    Structured output
   |                            |                        |
   |                            v                        |
   |                      State machine              returned to
   |                      (nodes + edges)            graph node
   |                            |
   v                            v
Tool result               Persisted to DB
returned to               (via injected database)
ChatAgent
```

---

## 5. Data Flow

### Request Flow: HTTP to Database

A typical user request flows through the following layers.

```
User (Browser/Client)
  |
  |  HTTP request (POST /api/chat/message)
  v
Bun.serve (main.ts, port 3001)
  |
  |  Route matching via RouteRegistry
  v
Guard (AuthGuard)
  |
  |  Validates session, resolves user
  v
Controller (ChatController)
  |
  |  Input validation (Zod), delegates to service
  v
Service (ChatService / Graph invocation)
  |
  |  Business logic, invokes graph factory
  v
Graph (ChatGraphFactory.createGraph())
  |
  |  State machine execution: nodes, conditional edges
  v
Agent (ChatAgent / specialized agents)
  |
  |  LLM call via OpenRouter, structured output
  v
Database (via injected adapter)
  |
  |  Drizzle ORM, PostgreSQL + pgvector
  v
Response (JSON / SSE stream back to client)
```

### Chat Message Flow (Detailed)

The chat system is the primary entry point for user interaction. When a user sends a message:

1. **HTTP layer**: The request hits `ChatController`, which validates input and delegates to the chat service.

2. **Graph initialization**: The chat graph loads session context (conversation history, user profile, index memberships) and truncates to fit the context window.

3. **ReAct loop**: The `ChatAgent` enters a loop (up to 12 iterations). Each iteration, the LLM sees the full conversation and decides to either call tools or produce a final response.

4. **Tool execution**: When the agent calls tools (e.g., `create_intent`), each tool invokes the appropriate subgraph. For example, `create_intent` invokes the Intent Graph, which runs the inferrer, verifier, and reconciler agents in sequence.

5. **Subgraph execution**: The subgraph runs its own state machine. Nodes perform database operations through the injected adapter. Agents make LLM calls for reasoning.

6. **Result propagation**: Tool results flow back to the chat agent as `ToolMessage` objects. The agent incorporates these results and either calls more tools or produces a final response.

7. **Streaming**: The response is streamed back to the client via SSE (Server-Sent Events).

### Intent Creation Flow

When a user says "I'm looking for a React co-founder":

1. The chat agent calls `create_intent` with the extracted content
2. The Intent Graph runs:
   - **Prep node**: Loads user context
   - **Inference node**: `IntentInferrer` extracts structured intent from natural language
   - **Verification node**: `IntentVerifier` checks felicity conditions (semantic entropy, referential anchors, sincerity)
   - **Reconciliation node**: `IntentReconciler` decides whether to create, update, or expire existing intents
   - **Execution node**: Persists the intent to the database with embedding
3. `IntentEvents.onCreated` fires, which enqueues an opportunity discovery job
4. The opportunity queue picks up the job asynchronously

---

## 6. Event System

The event system provides async decoupling between services. Events are lightweight hooks defined in `src/events/` and wired up in `main.ts`.

### Intent Events

Defined in `src/events/intent.event.ts`:

```typescript
export const IntentEvents = {
  onCreated: (_intentId: string, _userId: string): void => {},
  onUpdated: (_intentId: string, _userId: string): void => {},
  onArchived: (_intentId: string, _userId: string): void => {},
};
```

These are assigned concrete handlers in `main.ts`. For example, `onCreated` enqueues an opportunity discovery job so that newly created intents trigger matching:

```typescript
IntentEvents.onCreated = (intentId: string, userId: string) => {
  fromIntentQueue.addJob(
    { intentId, userId },
    { priority: 10, jobId: `rediscovery-${userId}-${intentId}-...` },
  );
};
```

### Network Membership Events

Defined in `src/events/network_membership.event.ts`:

```typescript
export const NetworkMembershipEvents = {
  onMemberAdded: (_userId: string, _networkId: string): void => {},
};
```

When a user joins an index, this event triggers a profile HyDE generation job so the new member becomes discoverable via vector search within that index.

### Design Rationale

- **Services emit events after DB transactions**, ensuring data consistency before side effects
- **Events decouple services**: the intent service does not need to know about opportunity discovery
- **Queue-based handlers**: event handlers enqueue jobs rather than executing work inline, keeping the request path fast
- **Events and queues are the only mechanism for cross-service communication** (services must not import other services)

---

## 7. Queue System

BullMQ (backed by Redis) handles all asynchronous processing. Queue definitions live in `src/queues/`, and workers are started in `main.ts`.

### Queue Types

| Queue | Purpose |
|-------|---------|
| `intent.queue` | Intent indexing and generation jobs |
| `opportunity/from-intent` | BullMQ queue: intent-triggered opportunity discovery |
| `opportunity/from-introducer` | BullMQ queue: introducer-triggered opportunity discovery |
| `opportunity/expiration` | **node-cron task** (not a BullMQ queue — does not appear in Bull-Board): scans and expires stale opportunities on a schedule |
| `negotiations/run-existing` | BullMQ queue: enqueue bilateral negotiation for an existing opportunity (e.g. after introducer approval) |
| `negotiations/timeout` | BullMQ queue: AI fallback when personal agent lacks heartbeat |
| `negotiations/claim-timeout` | BullMQ queue: expire stale claims stuck in `claimed` state |
| `profile.queue` | User profile generation and HyDE document creation |
| `hyde.queue` | HyDE document generation and cron-based refresh |
| `email.queue` | Email delivery via Resend |
| `notification.queue` | Notification delivery |
| `integration-sync-queue` | Periodic Google Calendar sync for event networks |

### Job Patterns

- **Retries**: 3 attempts with exponential backoff (1-second base delay)
- **Cleanup**: Completed jobs removed after 24 hours, failed jobs after 7 days
- **Concurrency**: Default is 1 (sequential processing) to avoid race conditions
- **Naming**: Snake_case job names (e.g., `generate_hyde`, `discover_opportunities`)
- **Deduplication**: Jobs use deterministic IDs where appropriate (e.g., time-bucketed rediscovery jobs) to prevent duplicate processing

### Queue Orchestration Rule

Queues orchestrate by calling services, graphs, or adapters. They contain no business logic themselves. A queue handler might:

1. Load context from the database adapter
2. Invoke a graph factory to run a pipeline
3. Persist results via the adapter
4. Emit events if further processing is needed

### Monitoring

Bull Board UI is served at `http://localhost:3001/dev/queues/` when the protocol server is running. It provides job status visibility, retry controls, and queue metrics.

---

## 8. Database Layer

### Technology Stack

- **ORM**: Drizzle ORM with full TypeScript type inference from schema
- **Database**: PostgreSQL with the pgvector extension for vector similarity search
- **Embeddings**: 2000-dimensional vectors from `text-embedding-3-large` via OpenRouter
- **Indexes**: HNSW indexes for fast approximate nearest-neighbor search

### Schema Organization

The canonical schema lives in `backend/src/schemas/database.schema.ts`. All table definitions, relations, and types are defined here. Drizzle generates TypeScript types from the schema, eliminating manual type maintenance.

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts (Better Auth integration) |
| `user_profiles` | User identity with 2000-dim vector embeddings |
| `intents` | User intents with embeddings, confidence scores, semantic governance fields |
| `networks` | Communities/collections (indexes); personal networks have `isPersonal=true` |
| `network_members` | Membership with permissions, custom prompts, auto-assignment settings |
| `intent_networks` | Many-to-many junction with optional `relevancyScore` (0.0-1.0) |
| `personal_networks` | Maps each user to their personal network (one row per user) |
| `opportunities` | Match records with detection, actors, interpretation, context, status |
| `hyde_documents` | Stored HyDE documents for retrieval |
| `conversations` | Conversation containers (A2A context) |
| `messages` | A2A-compatible messages with parts (JSONB), role, senderId |
| `tasks` | A2A task lifecycle (submitted, working, completed, failed) |
| `artifacts` | Structured outputs from tasks (opportunity cards, etc.) |

### Key Patterns

**Polymorphic source tracking**: Intents track their origin via `sourceType` (file, integration, link, discovery_form, enrichment) and `sourceId`, enabling filtering and bulk re-processing by source.

**Confidence and inference tracking**: Every intent carries a `confidence` score (0-1) and `inferenceType` (explicit or implicit), plus semantic governance fields from the verifier (semantic entropy, referential anchor, felicity scores).

**Soft deletes**: Records use `deletedAt` timestamps rather than hard deletes, preserving audit trails and enabling recovery.

**Vector similarity search**: Intents and profiles have vector embeddings. Queries use pgvector's cosine similarity with HNSW indexes for sub-millisecond approximate nearest-neighbor lookups. This powers opportunity discovery, finding similar intents across index members.

### Migration Workflow

Drizzle generates migrations from schema diffs. Migrations are renamed to descriptive names following the pattern `{NNNN}_{action}_{target}.sql` (e.g., `0005_add_opportunities_table.sql`). The `_journal.json` file tracks applied migrations and must stay in sync with `.sql` filenames.

---

## 9. Key Diagrams

### Layering Diagram

```
+========================+
|      Controllers       |   HTTP boundary
|  (Bun.serve + decorators)|   Input validation, routing
+========================+
          |
          v
+========================+
|       Services         |   Business logic
|  (pure TypeScript)     |   DB transactions, events
+========================+
          |
     +----+----+
     |         |
     v         v
+==========+  +========================+
| Adapters |  |    Protocol Layer       |
| (infra   |  | (graphs, agents, tools) |
|  wrappers)|  | Deps injected via       |
|          |  | constructor             |
+==========+  +========================+
     |              |
     v              v
+========================+
|    Infrastructure      |
| PostgreSQL, Redis,     |
| OpenRouter, S3         |
+========================+
```

### Request Flow

```
Browser --HTTP--> Bun.serve --route--> Guard --auth--> Controller
    |                                                      |
    |                                              delegates to
    |                                                      |
    |                                                      v
    |                                                  Service
    |                                                      |
    |                                              invokes graph
    |                                                      |
    |                                                      v
    |                                              Graph (state machine)
    |                                                      |
    |                                              calls agents
    |                                                      |
    |                                                      v
    |                                              Agent (LLM call)
    |                                                      |
    |                                              structured output
    |                                                      |
    |                                                      v
    |                                              Database (adapter)
    |                                                      |
    <-------------------SSE stream / JSON------------------+
```

### Agent Loop (Chat Graph)

```
                    +------------------+
                    |  User message    |
                    +--------+---------+
                             |
                             v
                    +------------------+
                    | Load context     |
                    | (history, profile|
                    |  memberships)    |
                    +--------+---------+
                             |
                             v
                +------------------------+
          +---->|  LLM Iteration         |
          |     |  (see full conversation|
          |     |   + tool results)      |
          |     +-----------+------------+
          |                 |
          |         +-------+-------+
          |         |               |
          |    Tool calls      Final response
          |         |               |
          |         v               v
          |  +-------------+  +------------------+
          |  | Execute      |  | Stream to user   |
          |  | tools in     |  | via SSE          |
          |  | parallel     |  +------------------+
          |  +------+------+
          |         |
          |    Tool results
          |    (ToolMessage)
          |         |
          +---------+
        (up to 12 iterations)
```

### Event and Queue Flow

```
Service
  |
  |  1. Persist to DB
  |  2. Emit event
  |
  v
IntentEvents.onCreated(intentId, userId)
  |
  |  Enqueues job
  v
fromIntentQueue.addJob({intentId, userId})
  |
  |  Worker picks up job
  v
OpportunityGraphFactory.createGraph().invoke(...)
  |
  |  HyDE generation -> vector search -> evaluation -> persist
  v
New opportunities (status: latent)
```

---

## Further Reading

- **Protocol package README**: `packages/protocol/src/README.md` — graph, agent, and tool documentation
- **Design papers**: `packages/protocol/src/docs/` — deep dives on HyDE strategies, opportunity lifecycle, semantic governance, and more
- **Template files**: `protocol/src/controllers/controller.template.md`, `protocol/src/services/service.template.md`, `protocol/src/queues/queue.template.md`, `packages/protocol/src/agents/agent.template.md`
