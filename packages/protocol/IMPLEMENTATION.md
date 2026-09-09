# @indexnetwork/protocol Implementation Guide

This guide covers the technical package surface for implementers embedding the canonical Index Network Protocol implementation. For the public protocol overview, see [README.md](./README.md).


## Stability & versioning

This package follows [Semantic Versioning](https://semver.org/). The **only**
supported entry point is the package root (`import { ... } from "@indexnetwork/protocol"`);
deep imports are not part of the contract. Every symbol is re-exported explicitly from
`src/index.ts` and tagged with a stability tier:

- **Stable** — interfaces, graph factories, agents, the
  tool/runtime helpers, and shared schemas. Breaking changes require a major bump.
- **Experimental** (`@experimental`) — advanced graph-state types and internal
  helpers; may change in a minor release.

See [STABILITY.md](./STABILITY.md) for the full policy and the deprecation path,
and [CHANGELOG.md](./CHANGELOG.md) for release history.

Private source under `src/internal/` is domain-first: `agents`, `networks`,
`contexts`, `enrichment`, `discovery`, `opportunities`, with `shared`
for cross-cutting model and tool-runtime helpers. The `intents` capability is
organized by function behind a single exported class, `Intents`: files sit flat
and named for what they do, with `graph/` the one multi-file stage
that keep a directory.

`Negotiations` is the autonomous participation capability. It observes current
state and returns protocol guidance, available actions, and block reasons. Its
execute path passes a pure protocol decision function into the host's transaction:
the host locks current membership, intent, and negotiation state, evaluates the
function, and atomically applies the turn and opportunity transition.
`openCounterparties` likewise receives the protocol's opening decision callback.
The protocol enforces 12 total turns, leaving exhausted matches undecided, and
A2A agreement only advances to pending owner review. `NegotiationContextDatabase`
continues to provide scoped turn logs for opportunity presentation.

Personal-agent reasoning and H2A communication live in the independent
`@indexnetwork/agent` package. The API imports both libraries and supplies
persistence, principal context, models, and events. The scenario TUI uses the same
protocol capability with memory storage. Neither library imports the other.

## Boundary model

The package is migrating incrementally to a protocol kernel. `protocol/`
contains portable, framework-free contracts and shared protocol instructions; `platform/` contains host-facing
ports and supported runtime hooks; and `capabilities/` exposes small named
behavior surfaces. Graphs, internal model prompts, retrieval, and agent helpers remain
private implementation. These are source boundaries only: import supported
symbols from `@indexnetwork/protocol`, not source subpaths. See
[docs/protocol-kernel.md](./docs/protocol-kernel.md) for migration status.

## Shared protocol instructions

[`src/protocol/protocol.prompt.ts`](./src/protocol/protocol.prompt.ts) owns shared
protocol instruction text in named constants. The module depends only
on the negotiation limits, with no models, hosts, environment variables, or
transport implementations.

| Prompt or content | Consumer |
|---|---|
| `NEGOTIATION_GUIDANCE` | `protocol/negotiation.rules.ts`: `observeNegotiation` returns it to negotiation hosts; also the canonical `negotiations` topic |
| `CANONICAL_GUIDANCE_SUMMARY`, `CANONICAL_GUIDANCE_TOPICS`, `CANONICAL_GUIDANCE_TOPICS_CONTENT` | `internal/shared/agent/utility.tools.ts`: `read_docs` summary, topic metadata, and canonical sections |

`utility.tools.ts` keeps canonical topic selection and response envelopes.
`negotiation.rules.ts` keeps validation and transitions. Guidance and enforcement
share limits from
[`src/protocol/negotiation.constants.ts`](./src/protocol/negotiation.constants.ts).
Internal model prompts and personal-agent prompt composition stay with their
existing owners.

These paths describe internal ownership, not new public APIs. The package root
continues to export `NEGOTIATION_GUIDANCE`, `NEGOTIATION_MAX_TURNS`, and
`NEGOTIATION_MESSAGE_LIMIT` directly from their owning modules.


## Install

```bash
npm install @indexnetwork/protocol
```

## Setup

### 1. Configure the LLM

The package reads `OPENROUTER_API_KEY` (required), `CHAT_MODEL`, and `CHAT_REASONING_EFFORT` from environment variables. No startup call is needed.

Environment variables are the supported way to configure models. `CHAT_MODEL` and `CHAT_REASONING_EFFORT` (`minimal | low | medium | high | xhigh`) drive the default model; every protocol agent — evaluators, generators, miners — reads `OPENROUTER_API_KEY` from the environment.

Programmatic model override is not part of the public contract — use the environment variables. If you need a typed override path, open an issue rather than reaching through a deep import.

### 2. Implement the adapters

The package defines interfaces — your application provides the concrete implementations.

**Required** (always needed by the tool registry):

| Interface | Responsibility |
|---|---|
| `CompositeToolDatabase` | Core data access (users, intents, networks, opportunities) |
| `UserDatabase` / `SystemDatabase` | Context-bound databases built by `createUserDatabase` / `createSystemDatabase` |
| `Embedder` | Vector embeddings for semantic search |
| `Scraper` | Web content extraction |
| `Cache` / `HydeCache` | Result caching (HyDE may share the general cache) |
| `IntegrationAdapter` | OAuth and external tool actions |
| `IntentFollowUp` | Post-persist intent follow-up (HyDE, resume discovery) |
| `ProfileEnricher` | Enrich profiles from external sources |
| `NegotiationDatabase` | Current negotiation state and atomic commit with the supplied protocol decision function |
| `NegotiationContextDatabase` | Read-only negotiation turn log, for opportunity presentation (folded into `CompositeToolDatabase`) |

**Optional** (enable specific capabilities; omit to run without that feature):

| Interface | Responsibility |
|---|---|
| `AgentDatabase` | Agent registry CRUD (agents, permissions) |

All interfaces are exported from the package root — import them with `import type { ... } from "@indexnetwork/protocol"`.

### 3. Create tools

`createToolRegistry` takes the dependency object built from the adapters above.
It returns a `Map` of tool name to `RawToolDefinition`: async handlers taking
`{ context, query }`, invoked through the shared `invokeToolRuntime`.

```typescript
import { createToolRegistry, invokeToolRuntime, resolveChatContext } from "@indexnetwork/protocol";

const context = await resolveChatContext({
  database,                 // the CompositeToolDatabase reads listed above
  userId: "user-uuid",
  networkId,                // optional — scopes tools to one network
  sessionId,                // optional — enables draft opportunities
});

const registry = createToolRegistry(deps, { scope: context });
const tool = registry.get("search_intents")!;
const result = await invokeToolRuntime({
  toolName: tool.name,
  tool,
  context,
  query: { /* validated against tool.schema */ },
});
```

The dependency object carries the required adapters listed above; optional
capabilities default to a degraded-but-functional mode when omitted (for
example, without `agentDatabase` the agent registry tools are not registered).

The per-capability tool factories behind this entry point
(`createIntentTools`, `createOpportunityTools`, …) are package-internal and are
not part of the supported surface. `createEnrichmentTools` remains exported for
hosts that run enrichment on its own worker.

## Graphs

For direct graph invocation (bypassing the tool layer), a `*GraphFactory` class is exported for each workflow:

```typescript
import {
  OpportunityGraphFactory,
  HydeGraphFactory,
  RadarGraphFactory,
} from "@indexnetwork/protocol";
```

Each factory takes its typed dependencies in the constructor and exposes a
`.createGraph()` method that returns a compiled LangGraph ready for `.invoke()`.

The intent and community graphs are the exceptions: they are reached through the
`Intents` and `Networks` module classes rather than factories of their own (see
[Intents](#intents) and [Networks](#networks) below).

| Factory | Workflow |
|---|---|
| `OpportunityGraphFactory` | Background matching: search, evaluate (valency), rank, open counterparties. The host database must implement `openCounterparties`, which turns each scored pair into an opportunity and its negotiation record, keyed on `pairKey` so both principals' runs converge on one. |
| `HydeGraphFactory` | Generate hypothetical documents and embed them (cache-aware) |
| `RadarGraphFactory` | Build the radar view: flat presenter-card list, optionally intent-scoped |

## Intents

Signals are the protocol's base unit, and the whole capability ships as one
class. `Intents` covers the lifecycle graph, semantic verification, payload
clarification, and the agent-facing intent tools.

```typescript
import { Intents } from "@indexnetwork/protocol";

const intents = new Intents({
  database,           // IntentGraphDatabase — required only by createGraph()
  embedder,           // EmbeddingGenerator
  followUp,           // IntentFollowUp
});
```

Every dependency is optional, so a host that only wants the model-backed
helpers can construct `new Intents()` with nothing. Collaborators are built on
first use, so an unused method costs nothing.

| Method | Purpose |
|---|---|
| `createGraph()` | Compile the lifecycle graph — prep, infer, verify, reconcile, execute. Requires `database` |
| `verifyIntent(content, profileContext)` | Felicity conditions, speech-act classification, semantic entropy, specificity |
| `clarify({ payload, answers? })` | One stateless round: the payload, rewritten to state any answers, plus the questions still worth asking |
| `Intents.createTools(defineTool, deps)` | Register the agent-facing intent tools |
| `Intents.normalizeDescription(description)` | Normalize a description to its persisted form |

## Networks

Communities ship the same way: one class covering the community lifecycle graph,
the membership graph, signal↔community assignment, and the agent-facing
community tools.

```typescript
import { Networks } from "@indexnetwork/protocol";

const networks = new Networks({
  database, // community, roster, and assignment persistence
});
```

The dependency is optional; each method names what it requires, so a host
that only registers tools can construct `new Networks()` with nothing.

| Method | Purpose |
|---|---|
| `createGraph()` | Compile the community lifecycle graph — create, read, update, delete. Requires `database` |
| `createMembershipGraph()` | Compile the roster graph — add, list, remove members. Requires `database` |
| `createAssignmentGraph()` | Compile signal↔community assignment — link and unlink. Requires `database` |
| `Networks.createTools(defineTool, deps)` | Register the agent-facing community tools |

Assignment applies no scoring policy: a link exists because the signal's owner
asked for it, so the row is written at score 1 with `mode: manual_override`.

## HTTP tools and the CLI

External agents use `@indexnetwork/cli`. The API host exposes `GET /api/tools`
for tool names, descriptions, and JSON schemas, and `POST /api/tools/:toolName`
with `{ "query": { ... } }` for invocation. It resolves the authenticated principal,
builds scoped dependencies, and calls the shared runtime. Ownership and network
membership checks remain in the handlers. Agent management uses session-authenticated
REST endpoints. Owner approval is a separate explicit HTTP action after negotiation.

```bash
index --api-url https://protocol.index.network tool list --json
index --api-url https://protocol.index.network tool call read_docs --query '{}' --json
index --api-url https://protocol.index.network tool call read_docs --query '{"topic":"workflows"}' --json
```

`read_docs` serves canonical protocol guidance, including HTTP/CLI workflows and
negotiation rules. Integrations read that guidance and discover current schemas
before calling tools. Negotiation observation and turns use `/api/negotiations`;
personal-agent conversations require an intent scope and the current question ID
when answering a pending question. The CLI delegates these decisions to the host.

### Runtime controls

`invokeToolRuntime` retains the shared timeout classes: `fast` (10 s),
`bounded_slow` (45 s), and `async_candidate` (50 s), with a default output limit
of 1,000,000 bytes. Hosts may pass `timeoutMs`, `maxOutputBytes`, and an abort
`signal` to an invocation. Runtime failures preserve the codes `TOOL_TIMEOUT`,
`TOOL_CANCELLED`, and `TOOL_OUTPUT_TOO_LARGE`.

## Publishing

Publishing is handled via CI:

```bash
# dev pushes publish an rc prerelease
git push <remote> dev

# main pushes publish the stable release if the package version is new
git push <remote> main
```

`dev` publishes prerelease versions derived from `package.json` using npm's `rc` tag, for example `3.6.3-rc.123.1`. `main` publishes the base version from `package.json` to `latest` only when that version is not already on npm.

Or publish manually from `packages/protocol/`:

```bash
npm publish --access public
```
