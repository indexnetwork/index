# @indexnetwork/protocol Implementation Guide

This guide covers the technical package surface for implementers embedding the canonical Index Network Protocol implementation. For the public protocol overview, see [README.md](./README.md).


## Stability & versioning

This package follows [Semantic Versioning](https://semver.org/). The **only**
supported entry point is the package root (`import { ... } from "@indexnetwork/protocol"`);
deep imports are not part of the contract. Every symbol is re-exported explicitly from
`src/index.ts` and tagged with a stability tier:

- **Stable** — interfaces, graph factories, agents, `createMcpServer`, the
  tool/runtime helpers, and shared schemas. Breaking changes require a major bump.
- **Experimental** (`@experimental`) — advanced graph-state types and internal
  helpers; may change in a minor release.

See [STABILITY.md](./STABILITY.md) for the full policy and the deprecation path,
and [CHANGELOG.md](./CHANGELOG.md) for release history.

Private source under `src/internal/` is domain-first: `signals`, `communities`, `questions`,
`participant-agents`, `contacts`, and `integrations`; opportunity and negotiation
place state/contracts in `domain/` and workflows/tools in `application/`. The
`intents` capability is instead organized by function behind a single exported
class, `Intents`: files sit flat and named for what they do, with `graph/` and
`intake/` the two multi-file stages that keep a directory.

## Boundary model

The package is migrating incrementally to a protocol kernel. `protocol/`
contains portable, framework-free contracts; `platform/` contains host-facing
ports and supported runtime hooks; and `capabilities/` exposes small named
behavior surfaces. Graphs, prompts, retrieval, and agent helpers remain
private implementation. These are source boundaries only: import supported
symbols from `@indexnetwork/protocol`, not source subpaths. See
[docs/protocol-kernel.md](./docs/protocol-kernel.md) for migration status.


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
| `CompositeToolDatabase` | Core data access (users, intents, indexes/networks, opportunities) |
| `UserDatabase` / `SystemDatabase` | Context-bound databases built by `createUserDatabase` / `createSystemDatabase` |
| `Embedder` | Vector embeddings for semantic search |
| `Scraper` | Web content extraction |
| `Cache` / `HydeCache` | Result caching (HyDE may share the general cache) |
| `IntegrationAdapter` | OAuth and external tool actions |
| `IntentFollowUp` | Post-persist intent follow-up (HyDE, resume discovery) |
| `ProfileEnricher` | Enrich profiles from external sources |
| `NegotiationGraphDatabase` | Negotiation and conversation persistence |

**Optional** (enable specific capabilities; omit to run without that feature):

| Interface | Responsibility |
|---|---|
| `AgentDatabase` | Agent registry CRUD (agents, transports, permissions) |
| `McpAuthResolver` | Resolves `{ userId, agentId }` from an incoming MCP HTTP request (MCP server only) |

All interfaces are exported from the package root — import them with `import type { ... } from "@indexnetwork/protocol"`.

### 3. Create tools

Two entry points are supported, both taking a single dependency object built
from the adapters above.

`createMcpServer` is the complete integration: it composes every capability's
tools internally, applies the authorization policy, and returns a ready MCP
server.

```typescript
import { createMcpServer, CANONICAL_MCP_CAPABILITY_POLICY_OPTIONS } from "@indexnetwork/protocol";

const server = createMcpServer(
  deps,                // ToolDeps + the opportunity owner-approval port
  authResolver,        // McpAuthResolver
  scopedDepsFactory,   // ScopedDepsFactory — builds per-user scoped userDb/systemDb
  CANONICAL_MCP_CAPABILITY_POLICY_OPTIONS,
  authorizationObserver, // optional McpAuthorizationObserver
);
```

`createToolRegistry` is the lower-level surface for hosts running their own
runtime. It returns a `Map` of tool name to `RawToolDefinition` — raw async
handlers taking `{ context, query }` — which you invoke through
`invokeToolRuntime`:

```typescript
import { createToolRegistry, invokeToolRuntime, resolveChatContext } from "@indexnetwork/protocol";

const registry = createToolRegistry(deps, { surface: "mcp" }); // omit `surface` for the full REST set

const context = await resolveChatContext({
  database,                 // the CompositeToolDatabase reads listed above
  userId: "user-uuid",
  networkId,                // optional — scopes tools to one network
  sessionId,                // optional — enables draft opportunities
});

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

The per-capability tool factories behind these entry points
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
| `OpportunityGraphFactory` | Background matching: search, evaluate (valency), rank, emit candidates. Creates no opportunities — the host database must implement `upsertDiscoveryMatchCandidates` and `listPendingCandidatesForIntent`; candidates become opportunities only through the host's own REST/MCP writes. |
| `HydeGraphFactory` | Generate hypothetical documents and embed them (cache-aware) |
| `RadarGraphFactory` | Build the radar view: flat presenter-card list, optionally intent-scoped |

## Intents

Signals are the protocol's base unit, and the whole capability ships as one
class. `Intents` covers the lifecycle graph, semantic verification, network
indexing, the guided intake interview, and the agent-facing intent tools.

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
| `indexIntent(intent, indexPrompt, memberPrompt, sourceName?, networkContext?)` | Score one signal against one network; `null` when the model call fails |
| `generateIntakePack(input)` | The participant's intake brief and round-1 question |
| `generateIntakeFollowUps(input)` | Plan and write the next follow-up questions |
| `synthesizeIntake(input)` | Turn answered rounds into a description and card summary |
| `Intents.createTools(defineTool, deps)` | Register the agent-facing intent tools |
| `Intents.normalizeDescription(description)` | Normalize a description to its persisted form |
| `Intents.FALLBACK_INTAKE_QUESTION` | The static round-1 question used when generation is unavailable |

## Networks

Communities ship the same way: one class covering the community lifecycle graph,
the membership graph, signal↔community assignment, and the agent-facing
community tools.

```typescript
import { Networks } from "@indexnetwork/protocol";

const networks = new Networks({
  database,          // community, roster, and assignment persistence
  indexer: intents,  // an `Intents` instance — scores a signal against a community
});
```

Both dependencies are optional; each method names what it requires, so a host
that only registers tools can construct `new Networks()` with nothing.

| Method | Purpose |
|---|---|
| `createGraph()` | Compile the community lifecycle graph — create, read, update, delete. Requires `database` |
| `createMembershipGraph()` | Compile the roster graph — add, list, remove members. Requires `database` |
| `createAssignmentGraph()` | Compile signal↔community assignment, direct or model-evaluated. Requires `database` and `indexer` |
| `Networks.createTools(defineTool, deps)` | Register the agent-facing community tools |

Assignment takes an `Intents` instance as its evaluator — the `indexer`
dependency is narrowed to the single `indexIntent` method it calls.

## MCP server

The package exports a factory that registers every chat tool over the Model Context Protocol and attaches a canonical `instructions` block (`MCP_INSTRUCTIONS`) that every connecting runtime follows. The factory takes three arguments:

```typescript
import { createMcpServer, type McpAuthResolver } from "@indexnetwork/protocol";

const authResolver: McpAuthResolver = {
  async resolveIdentity(req) {
    // Look up the API key in `x-api-key` and return { userId, agentId? }.
    // `agentId` should come from Better Auth token metadata so downstream
    // tool handlers can attribute every call to a concrete agent identity.
    return resolveFromApiKey(req);
  },
};

const server = createMcpServer(
  deps,
  authResolver,
  {
    // Per-request factory for scoped user/system databases.
    create: (userId, indexScope) => createScopedDeps(userId, indexScope),
  },
);
```

On every tool call the server:

1. Extracts the HTTP request from the MCP `ServerContext`.
2. Calls `authResolver.resolveIdentity(req)` to get `{ userId, agentId }`.
3. Gates access through the canonical capability policy (`mcp/mcp.authorization-policy.ts`), decided per resolved principal BEFORE any context read or scoped-deps creation:
   - **Enrollment-capable unregistered API keys** may see and call only `register_agent` — single-purpose across the entire registry.
   - **Plain unregistered API keys** fail closed on every tool.
   - **Registered active agents** retain their canonical permission- and network-scope-authorized domain tools and `read_docs`; within the agent-administration family (`MCP_AGENT_ADMIN_TOOLS`) they may see and call only `read_own_agent`, which returns the caller's own sanitized record and accepts no target.
   - **Session humans** administer their owned agents (`register_agent`, `list_agents`, `update_agent`, `delete_agent`, `grant_agent_permission`, `revoke_agent_permission`) but are never offered the agent-only `read_own_agent`.
   - Contact/Gmail-import tools, `scrape_url`, and the deprecated `*_user_profile`/`*_profile_run` aliases are not registered on the MCP surface at all (IND-596/597/598).
4. Builds per-request scoped databases via `scopedDepsFactory` and invokes the tool handler through the shared runtime.

### Runtime controls

MCP tools are bounded by `ToolInvocationRuntime`:

| Class | Default | Class override |
|---|---:|---|
| `fast` | 10 s | `MCP_TOOL_TIMEOUT_FAST_MS` |
| `bounded_slow` | 45 s | `MCP_TOOL_TIMEOUT_BOUNDED_SLOW_MS` |
| `async_candidate` | 50 s | `MCP_TOOL_TIMEOUT_ASYNC_CANDIDATE_MS` |

Per-tool timeout overrides use `MCP_TOOL_TIMEOUT_<TOOL_NAME>_MS`. Tool outputs are capped by `MCP_TOOL_MAX_OUTPUT_BYTES` (default `1000000`) or `MCP_TOOL_MAX_OUTPUT_<TOOL_NAME>_BYTES`; inbound MCP request bodies are capped by the backend with `MCP_MAX_REQUEST_BYTES` (default `1000000`). Runtime failures return JSON text envelopes with stable `code` values: `TOOL_TIMEOUT`, `TOOL_CANCELLED`, or `TOOL_OUTPUT_TOO_LARGE`.


### `MCP_INSTRUCTIONS`

The instructions string is the single canonical behavioral contract for every runtime that connects to Index Network — voice, entity model, discovery-first rule, and output rules. Plugin skills and bootstrap scripts do **not** redefine this guidance; they defer to whatever ships in `MCP_INSTRUCTIONS`.

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
