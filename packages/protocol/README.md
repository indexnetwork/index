# @indexnetwork/protocol

The agent orchestration layer for Index Network. Implements LangGraph-based workflows for intent processing, opportunity discovery, and chat — decoupled from any specific infrastructure via adapter injection.

## Install

```bash
npm install @indexnetwork/protocol
```

## Setup

### 1. Configure the LLM

The package reads `OPENROUTER_API_KEY` (required), `CHAT_MODEL`, and `CHAT_REASONING_EFFORT` from environment variables. No startup call is needed.

To override the chat model or reasoning effort per request, set `modelConfig` on `ToolContext`:

```typescript
import { createChatTools } from "@indexnetwork/protocol";

const tools = await createChatTools({
  // ... other deps ...
  modelConfig: {
    chatModel: "google/gemini-2.5-flash",       // optional — has a default
    chatReasoningEffort: "low",                  // optional: minimal | low | medium | high | xhigh
  },
});
```

`apiKey` and `baseURL` can also be overridden. Note: `modelConfig` is only honored by `ChatAgent` — it reads all `ModelConfig` fields (`apiKey`, `baseURL`, `chatModel`, `chatReasoningEffort`) from `ToolContext` when the chat graph runs. All other protocol agents (evaluators, generators, etc.) rely on `OPENROUTER_API_KEY` set in the environment.

### 2. Implement the adapters

The package defines interfaces — your application provides the concrete implementations:

| Interface | Responsibility |
|---|---|
| `ChatGraphCompositeDatabase` | Core data access (users, intents, indexes, opportunities) |
| `Embedder` | Vector embeddings for semantic search |
| `Scraper` | Web content extraction |
| `Cache` / `HydeCache` | Result caching |
| `IntegrationAdapter` | OAuth and external tool actions |
| `ContactServiceAdapter` | Contact management |
| `IntentGraphQueue` | Background intent processing queue |
| `ChatSessionReader` | Load conversation history |
| `ProfileEnricher` | Enrich profiles from external sources |
| `NegotiationGraphDatabase` | Negotiation state persistence |
| `AgentDatabase` | Agent registry CRUD (agents, transports, permissions) |
| `AgentDispatcher` | Resolves and invokes agents during negotiation turns |
| `McpAuthResolver` | Resolves `{ userId, agentId }` from an incoming MCP HTTP request |

All interfaces are exported from the package root — import them with `import type { ... } from "@indexnetwork/protocol"`.

### 3. Create tools

Pass your adapter implementations to `createChatTools` to get a set of LangChain-compatible tools bound to a user session:

```typescript
import { createChatTools } from "@indexnetwork/protocol";

const tools = await createChatTools({
  userId: "user-uuid",
  sessionId: "chat-session-id",
  indexId: "optional-index-uuid",   // scope tools to a specific index
  database,
  embedder,
  scraper,
  cache,
  hydeCache,
  integration,
  intentQueue,
  contactService,
  chatSession,
  enricher,
  negotiationDatabase,
  integrationImporter,
  createUserDatabase,
  createSystemDatabase,
});

// tools is an array of LangChain Tool objects ready to bind to an agent
```

## Graphs

For direct graph invocation (bypassing the tool layer), factory classes are exported for each workflow:

```typescript
import { ChatGraphFactory, IntentGraphFactory, OpportunityGraphFactory } from "@indexnetwork/protocol";
```

Each factory exposes a `.createGraph()` method that returns a compiled LangGraph ready for `.invoke()`.

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
3. Gates access: MCP callers without a resolved `agentId` are blocked from every tool except `register_agent`, `read_docs`, and `scrape_url` until they register.
4. Builds per-request scoped databases via `scopedDepsFactory` and invokes the tool handler through the shared runtime.

### Runtime controls

MCP tools are bounded by `ToolInvocationRuntime`:

| Class | Default | Class override |
|---|---:|---|
| `fast` | 10 s | `MCP_TOOL_TIMEOUT_FAST_MS` |
| `bounded_slow` | 45 s | `MCP_TOOL_TIMEOUT_BOUNDED_SLOW_MS` |
| `async_candidate` | 50 s | `MCP_TOOL_TIMEOUT_ASYNC_CANDIDATE_MS` |

Per-tool timeout overrides use `MCP_TOOL_TIMEOUT_<TOOL_NAME>_MS`, such as `MCP_TOOL_TIMEOUT_DISCOVER_OPPORTUNITIES_MS`. Tool outputs are capped by `MCP_TOOL_MAX_OUTPUT_BYTES` (default `1000000`) or `MCP_TOOL_MAX_OUTPUT_<TOOL_NAME>_BYTES`; inbound MCP request bodies are capped by the backend with `MCP_MAX_REQUEST_BYTES` (default `1000000`). Runtime failures return JSON text envelopes with stable `code` values: `TOOL_TIMEOUT`, `TOOL_CANCELLED`, or `TOOL_OUTPUT_TOO_LARGE`.

For MCP callers, `discover_opportunities` is async: it returns a `discoveryRunId` immediately, and clients poll `get_discovery_run` or request cancellation with `cancel_discovery_run`. Non-MCP chat/web paths stay synchronous.

### `MCP_INSTRUCTIONS`

The instructions string is the single canonical behavioral contract for every runtime that connects to Index Network — voice, entity model, discovery-first rule, output rules, and the **Negotiation turn mode** block that tells a silent subagent how to handle a live negotiation turn when its session key is prefixed `index:negotiation:`. Plugin skills and bootstrap scripts do **not** redefine this guidance; they defer to whatever ships in `MCP_INSTRUCTIONS`.

### Negotiation-facing tools

Personal agents participate in bilateral negotiation via a small set of MCP tools:

| Tool | Purpose |
|---|---|
| `get_negotiation` | Fetch the full turn history and assessment seed for a negotiation |
| `list_negotiations` | List negotiations awaiting a response from this agent's user |
| `respond_to_negotiation` | Submit a turn (propose / counter / accept / reject / question) |

## Publishing

Publishing is handled via CI:

```bash
# dev pushes publish an rc prerelease
git push <remote> dev

# main pushes publish the stable release if the package version is new
git push <remote> main
```

`dev` publishes prerelease versions derived from `package.json` using npm's `rc` tag, for example `0.4.0-rc.123.1`. `main` publishes the base version from `package.json` to `latest`.

Or publish manually from `packages/protocol/`:

```bash
npm publish --access public
```
