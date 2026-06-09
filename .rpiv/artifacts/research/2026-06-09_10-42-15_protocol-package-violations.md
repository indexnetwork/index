---
date: 2026-06-09T10:42:15+0300
author: Yankı Ekin Yüksel
commit: c43ab654f
branch: dev
repository: index
topic: "protocol package. Detect violations."
tags: [research, codebase, protocol, boundaries, interfaces, mcp, tools]
status: complete
last_updated: 2026-06-09T10:42:15+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: protocol package. Detect violations.

## Research Question
Detect boundary and architecture violations in the `packages/protocol` package, especially around protocol purity, shared interfaces, tool composition, MCP transport/auth, runtime configuration, and public exports.

## Summary
The protocol package has no direct imports from backend/frontend/adapters in the investigated paths, so the primary violations are not hard app-layer imports. The strongest violations are shared contract files depending on domain implementation/state modules, especially `ProfileDocument` from `profile.generator.ts` and negotiation state types from `negotiation.state.ts`. The persistence/tool seam remains adapter-free through injection, but `ChatGraphCompositeDatabase` is broad, deprecated raw DB access is still required, and premise tooling uses unsafe casts to methods not promised by the declared composite type. MCP auth is intentionally confined to the MCP HTTP transport, but `McpAuthResolver.resolveIdentity(request: Request)` couples a shared interface to a platform request object and should eventually be narrowed to a plain auth DTO. Public exports mix stable contracts, tolerated host composition seams, and internal runtime/registry/database surfaces, making boundary violations harder to detect downstream.

## Detailed Findings

### Shared interface dependencies leak domain implementation modules
- `packages/protocol/src/shared/interfaces/database.interface.ts:1` imports `ProfileDocument` from `packages/protocol/src/profile/profile.generator.ts:37`, but `profile.generator.ts` also imports LangChain/Zod runtime code and constructs an LLM model at `packages/protocol/src/profile/profile.generator.ts:1-7` and `packages/protocol/src/profile/profile.generator.ts:39-45`.
- The generator-derived `ProfileDocument` is exposed through shared persistence methods: `Database.getProfile()` and `saveProfile()` at `packages/protocol/src/shared/interfaces/database.interface.ts:530-537`.
- `packages/protocol/src/shared/agent/tool.helpers.ts:3` imports the same profile type, aliases it as `ProfileContext` at `packages/protocol/src/shared/agent/tool.helpers.ts:36`, and places it on `ResolvedToolContext.userProfile` at `packages/protocol/src/shared/agent/tool.helpers.ts:75`.
- `packages/protocol/src/shared/interfaces/agent-dispatcher.interface.ts:9` imports `NegotiationTurn`, `UserNegotiationContext`, and `SeedAssessment` from `packages/protocol/src/negotiation/negotiation.state.ts`, which contains LangGraph/Zod graph-state implementation at `packages/protocol/src/negotiation/negotiation.state.ts:1-2` and `packages/protocol/src/negotiation/negotiation.state.ts:104`.
- `packages/protocol/src/shared/interfaces/question-generator.interface.ts:10` imports `DiscoveryQuestionInput` from `packages/protocol/src/opportunity/question.prompt.ts`; this is milder because the file is pure/no-I/O, but it still mixes DTOs with prompt text and rendering at `packages/protocol/src/opportunity/question.prompt.ts:92` and `packages/protocol/src/opportunity/question.prompt.ts:129`.
- Classification: strong violation for `ProfileDocument` and negotiation state imports; medium violation for discovery question input location.

### Persistence port is adapter-free but over-broad and partially unsafe
- The canonical `Database` interface starts at `packages/protocol/src/shared/interfaces/database.interface.ts:520` and spans profiles, intents, opportunities, premises, user contexts, search, and more through `packages/protocol/src/shared/interfaces/database.interface.ts:1566`.
- The file documents `Pick<>`-based graph aliases as interface segregation at `packages/protocol/src/shared/interfaces/database.interface.ts:1933-1948`, so some centralization is intentional.
- `ChatGraphCompositeDatabase` begins at `packages/protocol/src/shared/interfaces/database.interface.ts:1982` and includes methods across many subgraphs through `packages/protocol/src/shared/interfaces/database.interface.ts:2065`; this is a composite host contract, not a narrow graph port.
- `ToolContext.database` remains required but deprecated at `packages/protocol/src/shared/agent/tool.helpers.ts:124-125`, and `ToolDeps.database` keeps raw DB access available at `packages/protocol/src/shared/agent/tool.helpers.ts:421-422`.
- `PremiseGraphDatabase` requires lifecycle methods at `packages/protocol/src/shared/interfaces/database.interface.ts:1968-1970`, but `ChatGraphCompositeDatabase` only includes premise aggregate/discovery methods at `packages/protocol/src/shared/interfaces/database.interface.ts:2053-2058`.
- `packages/protocol/src/shared/agent/tool.factory.ts:130` casts the composite DB to `PremiseGraphDatabase`, and `packages/protocol/src/premise/premise.tools.ts:12` repeats the cast. This is a concrete type-contract violation hidden by `as unknown as`.
- `OpportunityControllerDatabase` at `packages/protocol/src/shared/interfaces/database.interface.ts:2245-2276` is explicitly service/controller-shaped, including DM/conversation operations kept there because services cannot import other services.

### Tool dependency injection remains adapter-free, but protocol owns a hidden composition root
- `createChatTools()` receives injected dependencies rather than importing concrete adapters, as documented at `packages/protocol/src/shared/agent/tool.factory.ts:54-58`.
- It still compiles all major subgraphs internally at `packages/protocol/src/shared/agent/tool.factory.ts:129-162`, creates scoped `userDb`/`systemDb` from host-provided callbacks at `packages/protocol/src/shared/agent/tool.factory.ts:175-176`, and assembles a large `ToolDeps` object at `packages/protocol/src/shared/agent/tool.factory.ts:181-218`.
- `ToolContext` comments say `userDb` and `systemDb` may be created internally from a singleton path at `packages/protocol/src/shared/agent/tool.helpers.ts:115-120`, preserving a legacy raw-DB seam.
- Backend wiring confirms concrete adapters are injected from the composition root: `backend/src/controllers/mcp.controller.ts:92-110` supplies `database`, `createUserDatabase`, and `createSystemDatabase`.
- Classification: not an app-layer import violation, but a composition-boundary risk because broad raw DB access and factory callbacks make protocol responsible for orchestration that is duplicated elsewhere.

### Tool registry split is intentional, with runtime and tool-set divergence risk
- `packages/protocol/src/shared/agent/tool.factory.ts:57` implements the LangChain/chat path and wraps handlers in `invokeToolRuntime()` at `packages/protocol/src/shared/agent/tool.factory.ts:99-105`.
- `packages/protocol/src/shared/agent/tool.registry.ts:30` implements the raw registry path; it registers raw handlers and explicitly documents that they are not LangChain wrappers at `packages/protocol/src/shared/agent/tool.registry.ts:21-24`.
- MCP correctly wraps raw registry execution in `invokeToolRuntime()` at `packages/protocol/src/mcp/mcp.server.ts:595-601`, and the backend direct tool service does the same at `backend/src/services/tool.service.ts:130-134`.
- The registry handler catches ordinary errors internally at `packages/protocol/src/shared/agent/tool.registry.ts:49-59`, while chat catches outside the runtime wrapper at `packages/protocol/src/shared/agent/tool.factory.ts:99-112`, so reporting and thrown-error behavior can differ.
- Chat explicitly excludes `confirm_opportunity_delivery` at `packages/protocol/src/shared/agent/tool.factory.ts:237-245`, while the raw registry exposes the opportunity tool set returned by `packages/protocol/src/opportunity/opportunity.tools.ts:2088-2095`.
- Backend raw callers duplicate graph assembly in `backend/src/controllers/mcp.controller.ts:160-184` and `backend/src/services/tool.service.ts:224-256`, creating drift from canonical chat graph assembly.
- Classification: intentional transport split, not a package-boundary violation, but runtime/tool availability divergence is a real consistency risk.

### MCP auth boundary is HTTP-coupled but confined
- `McpAuthResolver` is defined in `packages/protocol/src/shared/interfaces/auth.interface.ts:6`, and `resolveIdentity(request: Request)` accepts a platform `Request` at `packages/protocol/src/shared/interfaces/auth.interface.ts:29`.
- `createMcpServer()` extracts `ctx.http?.req` at `packages/protocol/src/mcp/mcp.server.ts:450` and passes it to the resolver at `packages/protocol/src/mcp/mcp.server.ts:459`.
- The resolver returns plain identity fields (`userId`, optional `agentId`, session/scoped identity, client surface) at `packages/protocol/src/shared/interfaces/auth.interface.ts:30-35`; HTTP responses remain in backend controller code at `backend/src/controllers/mcp.controller.ts:751-788` and `backend/src/controllers/mcp.controller.ts:812-840`.
- Scope handling after auth is plain context manipulation: `ScopedDepsFactory` is defined at `packages/protocol/src/mcp/mcp.server.ts:198-200`, `computeAgentIndexScope()` at `packages/protocol/src/mcp/mcp.server.ts:209-219`, and `applyNetworkScopeToContext()` at `packages/protocol/src/mcp/mcp.server.ts:235-262`.
- Classification: tolerated MCP transport exception today, but the shared auth port is not transport-agnostic. The future direction is to replace the `Request` parameter with a small plain auth input extracted at the transport edge.

### Runtime config is intentionally env-backed, while checkpoint Postgres dependency is adapter-specific
- `ModelConfig` is defined at `packages/protocol/src/shared/agent/model.config.ts:19-27` and explicitly falls back to env according to `packages/protocol/src/shared/agent/model.config.ts:17`.
- `createModel()` reads `OPENROUTER_API_KEY`, `OPENROUTER_REQUEST_TIMEOUT_MS`, `OPENROUTER_MAX_RETRIES`, and `OPENROUTER_BASE_URL` at `packages/protocol/src/shared/agent/model.config.ts:82`, `packages/protocol/src/shared/agent/model.config.ts:91`, `packages/protocol/src/shared/agent/model.config.ts:98`, and `packages/protocol/src/shared/agent/model.config.ts:103`.
- `createModel()` directly constructs `ChatOpenAI` at `packages/protocol/src/shared/agent/model.config.ts:100-110`, so model provider construction is owned by protocol runtime rather than the host.
- Chat can receive `ToolContext.modelConfig` at `packages/protocol/src/shared/agent/tool.helpers.ts:194`, and `ChatAgent` passes it to `createModel("chat", modelConfig)` at `packages/protocol/src/chat/chat.agent.ts:229-234`.
- Non-chat agents commonly call `createModel()` without config, such as HyDE generator at `packages/protocol/src/shared/hyde/hyde.generator.ts:32`, opportunity evaluator at `packages/protocol/src/opportunity/opportunity.evaluator.ts:15`, and intent verifier at `packages/protocol/src/intent/intent.verifier.ts:21`.
- Checkpointing is source-level injected through `BaseCheckpointSaver`: `packages/protocol/src/chat/chat.graph.ts:81-86` and `packages/protocol/src/chat/chat.streamer.ts:156-161` accept/checkpoint via abstraction.
- `packages/protocol/package.json:25` still depends on `@langchain/langgraph-checkpoint-postgres`, while actual Postgres usage is in backend at `backend/src/adapters/checkpointer.adapter.ts:18`. This package dependency is an adapter-specific purity violation.

### Public API mixes stable contracts, host seams, and internals
- The package export map exposes only root `.` at `packages/protocol/package.json:7-10`, so everything in `packages/protocol/src/index.ts` is canonical public API.
- `packages/protocol/src/index.ts:8-16` exports internal tool orchestration types such as `ToolDeps`, `DefineTool`, `RawToolDefinition`, `CompiledGraph`, and `ToolRegistry`.
- `packages/protocol/src/index.ts:19-25` exports raw runtime/control-plane utilities such as `requestContext` and `invokeToolRuntime`.
- `packages/protocol/src/index.ts:47` broadly re-exports all types from `database.interface.ts`, including the full `Database`, graph DB slices, storage-shaped records, and domain lifecycle types.
- `packages/protocol/src/index.ts:103-119` exports graph factories. Per developer checkpoint, these should be classified with split severity: tolerated host composition seams, not the primary violation.
- Downstream backend code uses the root exports for manual orchestration and casts: `backend/src/services/tool.service.ts:17`, `backend/src/services/tool.service.ts:87`, `backend/src/services/tool.service.ts:227`, `backend/src/services/tool.service.ts:241`, and `backend/src/services/tool.service.ts:256`.
- Classification: graph factories are tolerated host seams, but raw runtime/registry types and broad DB exports are public-surface violations or high-risk leaks.

## Code References
- `packages/protocol/src/profile/profile.generator.ts:1-7` — Profile generator imports runtime LangChain/Zod/model helpers.
- `packages/protocol/src/profile/profile.generator.ts:37` — Canonical `ProfileDocument` type is inferred from generator response schema.
- `packages/protocol/src/shared/interfaces/database.interface.ts:1` — Shared DB interface imports `ProfileDocument` from domain generator.
- `packages/protocol/src/shared/interfaces/database.interface.ts:520-537` — Canonical broad `Database` interface exposes profile persistence using `ProfileDocument`.
- `packages/protocol/src/shared/interfaces/database.interface.ts:1933-1948` — Comments document `Pick<>`-based graph alias strategy.
- `packages/protocol/src/shared/interfaces/database.interface.ts:1968-1970` — `PremiseGraphDatabase` requires premise lifecycle methods.
- `packages/protocol/src/shared/interfaces/database.interface.ts:1982-2065` — `ChatGraphCompositeDatabase` broad composite methods.
- `packages/protocol/src/shared/interfaces/database.interface.ts:2245-2276` — `OpportunityControllerDatabase` service/controller-shaped contract.
- `packages/protocol/src/shared/agent/tool.helpers.ts:115-125` — Tool context comments and deprecated raw `database` field.
- `packages/protocol/src/shared/agent/tool.helpers.ts:190-194` — Factory callbacks and optional model config in `ToolContext`.
- `packages/protocol/src/shared/agent/tool.factory.ts:129-176` — `createChatTools()` compiles subgraphs and creates scoped DBs internally.
- `packages/protocol/src/shared/agent/tool.factory.ts:181-218` — Large `ToolDeps` assembly.
- `packages/protocol/src/shared/agent/tool.registry.ts:21-30` — Raw registry path documentation and entry point.
- `packages/protocol/src/shared/agent/tool.registry.ts:49-59` — Raw registry catches handler exceptions internally.
- `packages/protocol/src/mcp/mcp.server.ts:450-459` — MCP handler extracts HTTP request and resolves identity.
- `packages/protocol/src/mcp/mcp.server.ts:565-572` — MCP creates scoped deps and rebuilds registry per request.
- `packages/protocol/src/shared/interfaces/auth.interface.ts:29-35` — Auth interface accepts `Request` but returns plain identity.
- `packages/protocol/src/shared/agent/model.config.ts:82-110` — Env-backed OpenRouter/ChatOpenAI construction.
- `packages/protocol/src/chat/chat.graph.ts:81-86` — Chat graph accepts injected `BaseCheckpointSaver`.
- `packages/protocol/package.json:25` — Protocol package depends on Postgres checkpoint adapter.
- `packages/protocol/src/index.ts:8-25` — Root exports tool/runtime internals.
- `packages/protocol/src/index.ts:47` — Root exports all database interface types.
- `packages/protocol/src/index.ts:103-119` — Root exports graph factories, classified as tolerated host seams.
- `backend/src/controllers/mcp.controller.ts:92-110` — Backend injects concrete protocol deps and scoped DB factories.
- `backend/src/controllers/mcp.controller.ts:160-184` — Backend MCP path manually compiles protocol graphs.
- `backend/src/services/tool.service.ts:224-256` — Backend direct tool service manually compiles protocol graphs.

## Integration Points

### Inbound References
- `backend/src/controllers/mcp.controller.ts:54-55` — Backend MCP composition root imports protocol graph/tool types from package root.
- `backend/src/controllers/mcp.controller.ts:92-110` — Backend provides `ProtocolDeps`, raw DB, and scoped DB factory callbacks.
- `backend/src/controllers/mcp.controller.ts:425-426` — Backend implements `McpAuthResolver.resolveIdentity(request: Request)`.
- `backend/src/controllers/mcp.controller.ts:648-657` — Backend provides `ScopedDepsFactory` to protocol MCP server.
- `backend/src/services/tool.service.ts:17` — Backend direct tool service imports graph factories, registry, context resolver, and runtime utilities from root API.
- `backend/src/services/agent-dispatcher.service.ts:1-5` — Backend imports `AgentDispatcher`, `AgentDispatchResult`, and `NegotiationTurnPayload` from protocol root.
- `backend/src/adapters/database.adapter.ts:872-883` — Backend structurally implements profile reads with local profile row shapes.
- `backend/src/adapters/database.adapter.ts:6636` — Backend creates user-scoped database wrapper.
- `backend/src/adapters/database.adapter.ts:6795` — Backend creates system-scoped database wrapper.
- `backend/src/adapters/checkpointer.adapter.ts:18` — Backend owns actual Postgres checkpoint adapter usage.

### Outbound Dependencies
- `packages/protocol/src/profile/profile.generator.ts:1-7` — Profile generator depends on LangChain/Zod/model runtime.
- `packages/protocol/src/negotiation/negotiation.state.ts:1-2` — Negotiation state depends on LangGraph `Annotation` and Zod.
- `packages/protocol/src/shared/agent/model.config.ts:1` — Protocol model config depends directly on `@langchain/openai`.
- `packages/protocol/src/mcp/mcp.server.ts:10` — MCP server depends on MCP SDK `ServerContext`.
- `packages/protocol/src/chat/chat.graph.ts:1` — Chat graph depends on LangGraph `BaseCheckpointSaver` abstraction.

### Infrastructure Wiring
- `packages/protocol/src/shared/agent/tool.factory.ts:57-58` — Chat tool factory is the main LangChain tool composition entry point.
- `packages/protocol/src/shared/agent/tool.registry.ts:30` — Raw registry entry point for MCP/direct HTTP invocation.
- `packages/protocol/src/mcp/mcp.server.ts:416` — MCP server factory composes auth, context, registry, runtime, and scoped DBs.
- `packages/protocol/src/index.ts:3-119` — Package root exports public tool, interface, runtime, and graph surfaces.
- `packages/protocol/package.json:7-10` — Package export map exposes only the root entry point.

## Architecture Insights
- Shared interfaces can reference stable protocol DTOs, but those DTOs should live in shared schema/interface modules, not in generator, prompt, or LangGraph state modules.
- The protocol package is adapter-free in the strict import sense, but broad structural interfaces plus `as unknown as` casts can defeat compile-time boundary guarantees.
- `createChatTools()` is an internal protocol composition root; this is manageable only if raw DB access continues to shrink and backend graph assembly does not drift.
- The raw registry/LangChain factory split is a valid transport separation, but callers must consistently wrap raw handlers with `invokeToolRuntime()`.
- MCP auth currently returns plain values and keeps HTTP response creation in backend, but accepting `Request` in a shared interface is a transport-coupling exception. A plain auth DTO would preserve the same behavior with less platform coupling.
- `BaseCheckpointSaver` injection is the positive pattern for adapter-specific infrastructure; `@langchain/langgraph-checkpoint-postgres` in protocol package dependencies violates that pattern at package metadata level.
- Per developer checkpoint, graph factory root exports are tolerated as host composition seams, while raw runtime/registry and broad DB exports remain violations or high-risk public surface.

## Precedents & Lessons
7 similar past change clusters analyzed.

### Precedent: Removed protocol global config and public `configureProtocol`
**Commit(s)**: `8699e86c2` — "refactor(protocol): remove _activeConfig global state and configureProtocol" (2026-06-08); `4416cffb0` — "refactor(protocol): remove configureProtocol side-effect from createChatTools" (2026-06-08); `deda68764` — "refactor(protocol): thread ModelConfig through ChatAgent constructor" (2026-06-08); `ea401abd9` — "feat(protocol)!: remove configureProtocol from public API" (2026-06-08)
**Blast radius**: 4 files across 3 layers
  protocol shared/agent — removed global model config state and factory side effect
  protocol chat/domain — threaded `ModelConfig` explicitly into `ChatAgent`
  public API — changed `packages/protocol/src/index.ts` exports

**Follow-up fixes**:
- `32985bc92` — "docs: update stale configureProtocol references after removal" (2026-06-08) — stale public guidance remained
- `28499709b` — "docs(protocol): clarify ModelConfig scope — only ChatAgent honors ToolContext.modelConfig" (2026-06-08) — config ownership was ambiguous
- `c28b99c74` — "docs(protocol): fix OPENROUTER_API_KEY requirement wording in README and createModel error" (2026-06-08) — env requirement wording was corrected

**Lessons from docs**:
- No relevant `.rpiv/artifacts/` documents found; directory is absent.

**Takeaway**: Public API/config changes easily leave stale docs and hidden import-time assumptions.

### Precedent: Added async MCP tool runs and shared runtime timeouts
**Commit(s)**: `56317354d` — "fix(protocol): add shared MCP tool runtime timeouts" (2026-06-01); `0da6ce383` — "feat(protocol): queue async MCP discovery runs" (2026-06-01); `d4f9f6ba0` — "feat(protocol): queue async MCP profile runs" (2026-06-03)
**Blast radius**: 39 files across 12 layers
  protocol MCP — server response and polling behavior changed
  protocol shared/agent — tool runtime, helpers, factory exports changed
  protocol domain — opportunity/profile tools moved to async run lifecycle
  backend database/queues/controllers/adapters — persisted and processed run records

**Follow-up fixes**:
- `6d83cdd10` — "fix(protocol): preserve typed MCP cancellation errors" (2026-06-01) — cancellation typing was lost
- `c55bbf326` — "fix(protocol): propagate MCP cancellation to model calls" (2026-06-01) — abort signal did not reach model calls
- `0c62370c2` — "fix(protocol,backend): coalesce MCP discovery runs and throttle the MCP transport" (2026-06-08) — repeated MCP calls caused duplicate work/rate pressure
- `55fb54f5c` — "fix(protocol): scope discovery polling hint to discover_opportunities rate-limit errors" (2026-06-08) — generic polling hint leaked into wrong errors

**Lessons from docs**:
- No relevant `.rpiv/artifacts/` documents found; directory is absent.

**Takeaway**: Async MCP paths need cancellation, coalescing, throttling, and scoped error messages from the start.

### Precedent: Introduced agent registry/auth transport cutover
**Commit(s)**: `ee6fc7aab` — "feat(agent): agent registry with transport cutover" (2026-04-09)
**Blast radius**: 38 files across 11 layers
  protocol shared/agent — registered agent tools and deps
  protocol MCP/auth — MCP server and auth identity contract changed
  public API — exported agent tooling
  backend database/controllers/services/adapters — agent storage, auth, delivery services
  renderer/docs — agent management UI and specs

**Follow-up fixes**:
- `6e312398f` — "fix(protocol/mcp): correct tool name read_indexes → read_networks" (2026-04-10) — MCP instruction/tool naming drifted
- `0f1201e5b` — "fix(protocol): redact sensitive fields from tool registry logs" (2026-04-11) — registry logging exposed sensitive inputs
- `7da939c2e` — "fix(mcp): OAuth sessions bypass agent-registration gate; wire chatSession in MCP handler" (2026-04-14) — auth gate handled the wrong identity class
- `787240afd` — "fix(mcp): strip debugSteps from MCP responses to prevent data leaks" (2026-04-20) — debug internals leaked through MCP responses

**Lessons from docs**:
- No relevant `.rpiv/artifacts/` documents found; directory is absent.

**Takeaway**: Auth/tool-registry changes repeatedly risk wrong gate semantics, stale tool names, and data leaks.

### Precedent: Added Questioner/Premise ToolDeps and tool registrations
**Commit(s)**: `03ca1300c` — "feat(protocol): add QuestionGeneratorReader interface + ToolContext slot" (2026-05-15); `262bc51d8` — "feat: migrate discovery question generation to async QuestionerQueue path" (2026-05-25); `edaeef0b0` — "feat: wire premise lifecycle events through ToolDeps callbacks" (2026-05-25); `02e0fe65f` — "feat: register premise tools and wire PremiseGraphFactory into all graph assembly points" (2026-05-24)
**Blast radius**: 11 files across 6 layers
  protocol shared/agent — `ToolDeps`/`ToolContext` callbacks expanded
  protocol registry/factory — new tools registered and wired
  protocol domain — questioner/premise tools consumed callbacks
  backend controllers/services — host deps passed into protocol

**Follow-up fixes**:
- `b085e5a12` — "fix(tool-factory): forward chatSummary + questionGenerator into toolDeps" (2026-05-15) — new deps were not forwarded
- `400e2d431` — "fix(protocol): address review feedback on premise tools" (2026-05-25) — premise tool behavior needed review cleanup
- `6bf468832` — "fix(protocol): pass questionerEnqueue to IntentGraphFactory in tool.factory" (2026-05-25) — factory wiring missed a consumer
- `9215fcad3` — "fix: pass sessionAwareEnqueue to NegotiationGraphFactory and toolDeps" (2026-05-26) — enqueue dependency was not consistently threaded

**Lessons from docs**:
- No relevant `.rpiv/artifacts/` documents found; directory is absent.

**Takeaway**: Every new `ToolDeps` field must be threaded through all factories, graph constructors, tests, and backend composition roots.

### Precedent: Expanded discovery/database contracts for context search
**Commit(s)**: `1c9a3470d` — "feat: add searchIntentsByContextEmbedding and context CRUD to database interface" (2026-05-27); `52a026008` — "feat: add context-to-intent discovery strategy to opportunity graph" (2026-05-27); `44577b3ee` — "feat: add HyDE generation for user contexts to achieve discovery parity" (2026-05-27)
**Blast radius**: 10 files across 6 layers
  protocol interfaces — `database.interface.ts` contract expanded
  protocol domain — opportunity graph/state added context discovery
  backend adapter/database — host implementation updated
  backend CLI/main — generation/backfill paths wired

**Follow-up fixes**:
- `1abbeff91` — "fix: address code review findings from Copilot" (2026-05-27) — export/review cleanup followed immediately
- `829c0d213` — "fix: address second round of Copilot review findings" (2026-05-27) — context generator/opportunity graph cleanup
- `f13a88aef` — "fix(protocol): cap premise discovery fan-out (#888)" (2026-06-03) — discovery contract enabled excessive fan-out

**Lessons from docs**:
- No relevant `.rpiv/artifacts/` documents found; directory is absent.

**Takeaway**: Database-interface expansion must include backend adapter limits and fan-out guardrails.

### Precedent: Added network/index scope propagation into MCP and ToolContext
**Commit(s)**: `8fe10eae9` — "feat(protocol): add indexScope to ResolvedToolContext" (2026-05-19); `423ec825a` — "feat(protocol): populate context.indexScope from network scope" (2026-05-19); `302a8054c` — "feat(db): add getActiveIntentsAcrossIndexes for scope-aware reads" (2026-05-19); `561602989` — "feat(mcp): clamp indexScope for network-scoped agents" (2026-05-07)
**Blast radius**: 12 files across 5 layers
  protocol shared/agent — context resolution added scope
  protocol MCP/auth — scoped agent identity affected context
  protocol interfaces — scope-aware database reads added
  backend adapter/guards — scope enforcement implemented

**Follow-up fixes**:
- `96d4853c0` — "fix(mcp): propagate network-scoped agent into context.networkId" (2026-05-07) — scoped agent did not reach tool context
- `d2113c2bd` — "fix: clamp indexScope in resolveChatContext when networkId is set" (2026-05-20) — context resolution allowed scope override violation
- `071a9fa23` — "fix(protocol): add indexScope to ToolContext and ResolvedToolContext" (2026-05-20) — type contract was incomplete
- `3067713ea` — "docs(protocol): clarify ToolContext.indexScope override flow" (2026-05-20) — override semantics were unclear

**Lessons from docs**:
- No relevant `.rpiv/artifacts/` documents found; directory is absent.

**Takeaway**: Scope/auth changes must fail closed and clamp context in both MCP identity handling and shared helper resolution.

### Composite Lessons
- Most recurring violation pattern: new protocol contracts are added but not threaded through every factory, graph, backend adapter, and test stub.
- MCP/auth changes repeatedly risk data leaks or gate mistakes: redact logs, strip debug internals, and test OAuth/API-key/scoped-agent paths.
- Async MCP tools need cancellation propagation, coalescing, throttling, and precise polling/error messaging.
- Database-interface expansions need bounded fan-out and backend adapter implementation in the same change set.
- Public API/model-config changes require immediate docs/export cleanup because stale guidance appears quickly.

## Historical Context (from `.rpiv/artifacts/`)
- No prior `.rpiv/artifacts/` research/design/plan/review documents were present in this working tree.

## Developer Context
**Q (`packages/protocol/src/index.ts:103-119`, `backend/src/services/tool.service.ts:17`): Should graph factory root exports used by backend host composition be classified as sanctioned seams or public-surface violations?**
A: Split severity. Treat graph factories as tolerated host seams, but flag raw runtime/registry and broad database exports as violations or risks.

**Q (`packages/protocol/src/shared/interfaces/auth.interface.ts:29`, `packages/protocol/src/mcp/mcp.server.ts:450-459`): Should `Request` in `McpAuthResolver` be treated as an allowed MCP transport exception or protocol port violation?**
A: Developer asked, "How to fix it?" Classification used here: tolerated today but needs refactor note. Fix direction is to replace the `Request` parameter with a small plain auth input DTO extracted at the MCP transport edge.

**Q (`scan complete`): Write the doc, add an area, or correct a finding?**
A: Write the doc.

## Related Research
- None found.

## Open Questions
- None for violation classification. Implementation priority and exact refactor sequencing should be decided in a follow-up design or blueprint.
