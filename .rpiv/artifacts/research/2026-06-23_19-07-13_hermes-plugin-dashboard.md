---
date: 2026-06-23T19:07:13+0300
author: Yanek Yuk
commit: 4150d08484
branch: dev
repository: index
topic: "the dashboard of the hermes plugin (closely following the idea behind protocol and hermes documentations)"
tags: [research, codebase, hermes-plugin, dashboard, protocol, mcp, negotiation]
status: ready
last_updated: 2026-06-23T19:07:13+0300
last_updated_by: Yanek Yuk
---

# Research: the dashboard of the hermes plugin (closely following the idea behind protocol and hermes documentations)

## Research Question

How should the future dashboard of the Index Network Hermes plugin be understood and designed, closely following the current Index protocol and Hermes plugin documentation/contracts?

## Summary

The Hermes plugin dashboard is currently only a reserved extension slot: `packages/hermes-plugin/dashboard/README.md:1-14` lists the expected future files, `packages/hermes-plugin/README.md:201-209` repeats the same contract, and `packages/hermes-plugin/package.json:12-19` already includes `dashboard/` in the published package. The live plugin contract today is not dashboard code; it is the manifest/schema/handler/registration surface in `plugin.yaml`, `schemas.py`, `tools.py`, and `__init__.py`, with smoke tests enforcing parity.

A plugin-local dashboard should be additive under `packages/hermes-plugin/dashboard/*`, not an AgentVillage admin/control-plane feature. Its first version should use a balanced overview: scoped signals/protocol guidance through `index_read_intents` and `index_read_docs`, plus autonomous negotiator status through `index_pickup_negotiation`, `index_respond_negotiation`, and `index_agent_me`. The dashboard should inherit protocol presentation rules from `read_docs(topic='mcp_agent_guide')` and `MCP_INSTRUCTIONS`: synthesize state in natural language, use product vocabulary like “signals” and “communities,” avoid raw JSON/cards/tool envelopes/internal IDs, and preserve scoped MCP visibility.

AgentVillage provides useful hosting/action precedents — session tokens, proxying to the private Hermes dashboard port, and button-triggered Hermes-side actions — but those are integration precedents only. The implementation boundary chosen for this research is plugin-local dashboard code, with AgentVillage patterns noted for later deployment or hosting.

## Detailed Findings

### Current Dashboard Boundary

- `packages/hermes-plugin/dashboard/README.md:1-3` declares the dashboard directory a placeholder reserved for a future Index Network Hermes dashboard view.
- `packages/hermes-plugin/dashboard/README.md:8-11` lists the expected future files: `dashboard/manifest.json`, `dashboard/dist/index.js`, `dashboard/dist/style.css`, and `dashboard/plugin_api.py`.
- `packages/hermes-plugin/dashboard/README.md:14` explicitly says to keep the plugin empty until those files are intentionally implemented.
- `packages/hermes-plugin/README.md:22-28` describes the plugin as already shipping native tools, generated skills, a hook, a slash command, and a dashboard placeholder.
- `packages/hermes-plugin/README.md:201-209` repeats the dashboard file list in the user-facing README.
- `packages/hermes-plugin/package.json:12-19` includes `dashboard/` in the package `files` list, so the directory is already reserved for publishing.
- `packages/hermes-plugin/plugin.yaml:1-4` defines the plugin identity and tool manifest; it does not yet declare any dashboard-specific capability.

The dashboard should therefore be treated as an unimplemented extension slot. The live system is the native tool and skill surface, and dashboard work should not imply existing dashboard behavior.

### Registration, Manifest, Schema, and Handler Contract

- `packages/hermes-plugin/__init__.py:82-123` is the plugin registration root.
- `packages/hermes-plugin/__init__.py:84-89` registers the dedicated `index_read_intents` wrapper with `schemas.INDEX_READ_INTENTS` and `tools.index_read_intents`.
- `packages/hermes-plugin/__init__.py:90-96` registers every `index_<mcp_tool_name>` wrapper from `schemas.FORWARDED_MCP_TOOLS` via `schemas.forwarded_mcp_schema()` and `tools.make_mcp_tool_handler()`.
- `packages/hermes-plugin/__init__.py:97-114` registers `index_agent_me`, `index_pickup_negotiation`, and `index_respond_negotiation`.
- `packages/hermes-plugin/__init__.py:115-123` registers the `pre_llm_call` hook, `/index` command, and bundled generated skills.
- `packages/hermes-plugin/schemas.py:7-46` defines the dedicated `INDEX_READ_INTENTS` LLM-facing schema.
- `packages/hermes-plugin/schemas.py:50-104` defines the forwarded MCP tool allowlist.
- `packages/hermes-plugin/schemas.py:107-121` generates schemas for generic `index_<mcp_tool_name>` wrappers.
- `packages/hermes-plugin/tools.py:23-79` mirrors the schema-side forwarded MCP allowlist in `_FORWARDED_MCP_TOOLS`.
- `packages/hermes-plugin/tools.py:360-379` rejects unsupported forwarded tool names and creates named handlers.
- `packages/hermes-plugin/tests/smoke.py:103-135` verifies schema/tool allowlist parity, registered tool order, handler bindings, and manifest parity.

Any `dashboard/plugin_api.py` should avoid creating a parallel divergent contract. If it exposes dashboard-backed actions, they should call or mirror the same registered tools and remain testable against the manifest/schema/handler contract.

### Protocol Documentation and Presentation Model

- `packages/protocol/src/shared/agent/utility.tools.ts:54-68` defines `read_docs` as the primary way for external agents to bootstrap protocol understanding.
- `packages/protocol/src/shared/agent/utility.tools.ts:59-66` instructs MCP agents to call `read_docs(topic='mcp_agent_guide')` and lists `mcp_agent_guide` among available topics.
- `packages/protocol/src/shared/agent/utility.tools.ts:260-283` defines `mcp_agent_guide` output rules: do not dump raw JSON, ignore web UI card markup, present intents/opportunities as bullets or short prose, and avoid visual UI references when operating through tools.
- `packages/protocol/src/mcp/mcp.server.ts:366-397` defines canonical MCP instructions for voice, vocabulary, output rules, and `x-api-key` authentication.
- `packages/protocol/src/mcp/mcp.server.ts:384-393` says not to expose internal IDs/tool names/field names unless actionable, to say “signal” not “intent” and “community” not “index,” to synthesize instead of dumping raw JSON, and to avoid fabrication.
- `packages/hermes-plugin/schemas.py:107-114` tells Hermes callers to use `index_read_docs(topic='mcp_agent_guide')` when unsure about arguments or workflow.
- `packages/hermes-plugin/README.md:85-96` documents `index_read_docs` as one of the forwarded wrappers and explains the `index_` prefix pass-through model.

The dashboard copy and interaction model should follow the protocol documentation path. It should present tool state in product language, not expose raw JSON, raw card markup, or implementation vocabulary.

### Scoped Signals / Intents Dashboard Data Path

- `packages/hermes-plugin/schemas.py:7-46` defines `index_read_intents` as a dedicated validated wrapper for reading what the user or a scoped community is looking for.
- `packages/hermes-plugin/schemas.py:13-15` documents no-argument self reads, `networkId` community browsing, and scoped `userId` filtering.
- `packages/hermes-plugin/schemas.py:34-43` constrains `limit` to 1–100 and `page` to a positive 1-based number.
- `packages/hermes-plugin/README.md:70-84` documents the same payload and says no arguments return the authenticated caller’s active intents as seen through the scoped Index MCP server.
- `packages/hermes-plugin/tools.py:383-411` implements `index_read_intents`: rejects non-object args, cleans `networkId`/`userId`, validates pagination, and calls `_call_index_mcp('read_intents', arguments)`.
- `packages/hermes-plugin/tools.py:228-260` sends a JSON-RPC `tools/call` request to the Index MCP server and decodes the MCP result.
- `packages/hermes-plugin/tools.py:130-146` derives `INDEX_MCP_URL`, `INDEX_API_URL`, and request headers, including `x-api-key`, `x-index-surface: hermes-plugin`, and optional `x-index-telegram-username`.
- `packages/protocol/src/intent/intent.tools.ts:75-94` defines the canonical `read_intents` tool semantics and usage modes.
- `packages/protocol/src/intent/intent.tools.ts:96-138` enforces scoped membership, scoped network restrictions, cross-user restrictions, and explicit network membership checks.
- `packages/protocol/src/intent/intent.tools.ts:153-170` maps explicit network reads, scoped user reads, unscoped self reads, implicit scoped reads, and implicit unscoped reads into graph input.
- `packages/protocol/src/intent/intent.tools.ts:182-194` applies pagination and returns count metadata.

A dashboard “signals” section should call the same `index_read_intents` path rather than using an unscoped REST shortcut. This preserves the exact scoping behavior expected for Hermes agent-bound keys.

### Autonomous Negotiator Dashboard Data Path

- `packages/hermes-plugin/schemas.py:139-158` defines `INDEX_PICKUP_NEGOTIATION`, with optional `agentId` and a description that says `pending=false` means no work and the run should stay silent.
- `packages/hermes-plugin/tools.py:428-453` implements pickup: resolve agent id, call `POST /agents/{agentId}/negotiations/pickup`, normalize HTTP 204 to `{ success: true, pending: false }`, and normalize successful non-empty payloads to `pending=true`.
- `packages/hermes-plugin/tools.py:335-344` resolves `agentId` either from args or by calling `/agents/me`.
- `packages/hermes-plugin/schemas.py:162-222` defines `INDEX_RESPOND_NEGOTIATION`, requiring `negotiationId`, `action`, `reasoning`, and `suggestedRoles`.
- `packages/hermes-plugin/tools.py:456-496` validates respond input, requires `message` for `counter` and `question`, nests reasoning/roles under `assessment`, and posts to `/agents/{agentId}/negotiations/{negotiationId}/respond`.
- `packages/hermes-plugin/README.md:154-179` defines the scheduled autonomous run setup and warns that slow or stopped cron may cause fallback to the system negotiator.
- `packages/hermes-plugin/skills/index-negotiator/SKILL.md:57-61` lists native negotiator tools and says the pickup tool keeps heartbeat fresh.
- `packages/hermes-plugin/skills/index-negotiator/SKILL.md:70-91` defines the exact autonomous loop: pickup, `[SILENT]` on no pending turn, inspect context, choose one action, respond, and report only tool-confirmed submission.
- `packages/protocol/src/mcp/mcp.server.ts:399-407` defines human-review opportunity lifecycle rules and forbids accepting received opportunities without explicit user approval in the current conversation.
- `packages/protocol/src/mcp/mcp.server.ts:409-431` defines decision questions after discovery as a separate human clarification path.

A dashboard negotiator section should distinguish autonomous personal-agent turns from human-review opportunity lifecycle state. “Pending turn” should mean `index_pickup_negotiation` returned `pending=true`; “last response” should mean the backend confirmed `index_respond_negotiation`; “heartbeat freshness” is inferred from scheduled pickup polling, not a separate endpoint in the plugin code.

### Generated Skill and Documentation Pipeline

- `scripts/build-skills.ts:59-66` maps Hermes skill outputs to `packages/hermes-plugin/skills/index-orchestrator/SKILL.md` and `packages/hermes-plugin/skills/index-negotiator/SKILL.md`.
- `scripts/build-skills.ts:69-92` injects partials, validates no template tokens remain, creates output directories, and writes generated files.
- `scripts/build-skills.ts:96-106` builds both Claude and Hermes plugin skill outputs from protocol templates.
- `packages/protocol/skills/hermes-plugin/index-orchestrator.template.md:10-19` defines Hermes tool availability and tells callers to use `index_read_docs(topic="mcp_agent_guide")` when unsure.
- `packages/protocol/skills/hermes-plugin/index-negotiator.template.md:10-53` defines the autonomous negotiator scope and scheduled run loop.
- `packages/hermes-plugin/README.md:187-199` documents that Hermes plugin skills are generated from templates and should not be edited directly.
- `packages/hermes-plugin/__init__.py:27-45` registers generated skill directories as namespaced plugin skills.

Dashboard labels, help text, and activation affordances should stay aligned with protocol skill templates and generated plugin skills. If dashboard text repeats skill guidance, the source of truth should be the templates under `packages/protocol/skills/hermes-plugin/`, with regenerated outputs.

### AgentVillage Dashboard Proxy and Action Precedents

- `packages/edge-city/agentvillage-controlplane/control-plane/src/hermes.js:1-6` configures the private Hermes dashboard port, session header, and token cache TTL.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/hermes.js:17-50` fetches private dashboard paths, sends `X-Hermes-Session-Token`, parses JSON, and marks 401s for retry.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/hermes.js:54-86` scrapes `window.__HERMES_SESSION_TOKEN__`, caches tokens, invalidates stale tokens, and retries once on unauthorized responses.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:59-77` extracts external dashboard tokens from bearer auth, query params, or cookies.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:110-122` resolves tenant ids from URL path or tenant cookie.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:178-202` maps a live tenant to `private_host`/`api_server_key` and authorizes either deployment API key or EdgeOS identity.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:231-249` converts query-token access into clean URL plus secure cookies.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:261-293` strips browser `cookie`/`authorization` and proxies requests to the private Hermes dashboard port.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:644-680` fetches Kanban board state from `/api/plugins/kanban/board` through `hermesDashFetch`.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:757-780` validates and patches Kanban tasks through `/api/plugins/kanban/tasks/:taskId`.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:845-902` implements “button triggers Hermes-side action” by listing dashboard cron jobs, optionally resuming paused jobs, and triggering selected jobs.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:283-295` routes Kanban fetch/generate/send, signals run, and task patch operations.

These are not the target boundary for the first plugin-local dashboard, but they are strong precedents for later hosting, authentication, session-token use, and Hermes-side action buttons.

### Privacy and Presentation Boundary

- `packages/edge-city/agentvillage-controlplane/control-plane/src/response-analytics.js:363-388` redacts session exports into derived metadata rather than raw messages.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/response-analytics.js:404-477` fetches tenant analytics from Hermes dashboard session summaries and only fetches/export details when requested.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/response-analytics.js:553-565` returns explicit privacy metadata: redacted identifiers, no raw tenant/session ids, and excluded message content, previews, titles, message ids, Telegram identifiers, emails, reasoning, dashboard tokens, and admin tokens.
- `packages/edge-city/agentvillage-controlplane/docs/dashboards/agent-village-edge-esmeralda-analytics.html:302-303` repeats the privacy boundary in static dashboard copy.
- `packages/protocol/src/mcp/mcp.server.ts:384-393` and `packages/protocol/src/shared/agent/utility.tools.ts:260-283` align with this boundary by forbidding raw JSON, internal IDs, field names, and unprocessed card markup.

A protocol-aligned Hermes plugin dashboard should use synthesized, scoped, and redacted state. It should avoid raw messages, dashboard tokens, tool envelopes, internal ids, and assistant reasoning.

## Code References

- `packages/hermes-plugin/dashboard/README.md:1-14` — Placeholder boundary and expected future dashboard file list.
- `packages/hermes-plugin/README.md:13-28` — Current plugin status and live tool/skill/hook/command surfaces.
- `packages/hermes-plugin/README.md:70-84` — `index_read_intents` argument contract.
- `packages/hermes-plugin/README.md:85-96` — Forwarded `index_<mcp_tool_name>` wrapper contract.
- `packages/hermes-plugin/README.md:154-179` — Autonomous negotiation setup and heartbeat warning.
- `packages/hermes-plugin/README.md:187-209` — Generated skill warning and dashboard view placeholder.
- `packages/hermes-plugin/package.json:12-19` — Published package files include `dashboard/`.
- `packages/hermes-plugin/plugin.yaml:1-68` — Plugin manifest identity, tools, hook, and required `INDEX_API_KEY`.
- `packages/hermes-plugin/__init__.py:27-45` — Generated skill registration.
- `packages/hermes-plugin/__init__.py:82-123` — Tool, hook, command, and skill registration root.
- `packages/hermes-plugin/schemas.py:7-46` — Dedicated `index_read_intents` schema.
- `packages/hermes-plugin/schemas.py:50-121` — Forwarded MCP tool allowlist and schema generator.
- `packages/hermes-plugin/schemas.py:139-222` — Negotiation pickup/respond schemas.
- `packages/hermes-plugin/tools.py:130-146` — MCP/API URL and header construction.
- `packages/hermes-plugin/tools.py:228-260` — JSON-RPC MCP forwarding call.
- `packages/hermes-plugin/tools.py:335-357` — Agent-id and suggested-role validation helpers.
- `packages/hermes-plugin/tools.py:360-411` — Forwarded MCP handler factory and dedicated read-intents wrapper.
- `packages/hermes-plugin/tools.py:428-496` — Negotiation pickup/respond handlers.
- `packages/hermes-plugin/tests/smoke.py:103-135` — Registration, manifest, schema, handler parity assertions.
- `packages/hermes-plugin/skills/index-negotiator/SKILL.md:57-91` — Generated autonomous negotiator contract.
- `packages/protocol/src/shared/agent/utility.tools.ts:54-68` — Canonical `read_docs` tool definition.
- `packages/protocol/src/shared/agent/utility.tools.ts:260-283` — `mcp_agent_guide` presentation rules.
- `packages/protocol/src/intent/intent.tools.ts:75-194` — Canonical `read_intents` semantics, scoping, and pagination.
- `packages/protocol/src/mcp/mcp.server.ts:366-397` — Canonical MCP instructions and output rules.
- `packages/protocol/src/mcp/mcp.server.ts:399-431` — Human-review opportunity lifecycle and decision question rules.
- `scripts/build-skills.ts:59-106` — Hermes generated skill output pipeline.
- `packages/protocol/skills/hermes-plugin/index-orchestrator.template.md:10-19` — Hermes orchestrator tool availability source template.
- `packages/protocol/skills/hermes-plugin/index-negotiator.template.md:10-53` — Hermes negotiator source template and run loop.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/hermes.js:1-86` — Private Hermes dashboard client/session token pattern.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:59-77` — External dashboard token extraction.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:110-122` — Tenant id extraction.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:178-202` — Deployment lookup and tenant authorization.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:231-293` — Query token cookie handoff and proxying to private dashboard.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:644-680` — Kanban board fetch through private Hermes dashboard API.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:757-780` — Kanban task patch action model.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:845-902` — Cron-trigger action model.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/response-analytics.js:363-388` — Redacted session export shape.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/response-analytics.js:404-477` — Tenant analytics fetch path.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/response-analytics.js:553-565` — Analytics privacy metadata.

## Integration Points

### Inbound References

- `packages/hermes-plugin/README.md:201-209` — Human-facing docs point future work to `dashboard/`.
- `packages/hermes-plugin/package.json:12-19` — Package publishing includes `dashboard/`, so added files are published with the plugin.
- `packages/hermes-plugin/__init__.py:82-123` — Existing plugin registration remains the runtime source for dashboard-backed tool actions if `plugin_api.py` calls into native handlers.
- `packages/hermes-plugin/tests/smoke.py:103-135` — Existing smoke test will catch drift if dashboard work changes tool names, registration, or manifest declarations.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:261-293` — Future hosted dashboards may be reached through a private Hermes dashboard proxy path.

### Outbound Dependencies

- `packages/hermes-plugin/tools.py:130-146` — Dashboard-facing tool calls depend on `INDEX_MCP_URL`, `INDEX_API_URL`, `INDEX_API_KEY`, timeout config, and optional Telegram username forwarding.
- `packages/hermes-plugin/tools.py:228-260` — Scoped protocol reads depend on MCP JSON-RPC `tools/call` and MCP envelope decoding.
- `packages/hermes-plugin/tools.py:277-323` — Personal-agent negotiation and identity actions depend on Index API requests and JSON response parsing.
- `packages/protocol/src/intent/intent.tools.ts:96-138` — Signals reads depend on protocol-side membership and scope checks.
- `packages/protocol/src/mcp/mcp.server.ts:366-397` — Dashboard copy depends on protocol output/vocabulary/auth guidance.
- `packages/protocol/src/shared/agent/utility.tools.ts:54-68` — Dashboard help and protocol bootstrap depend on `read_docs`/`index_read_docs`.

### Infrastructure Wiring

- `packages/hermes-plugin/plugin.yaml:4-68` — Declares tools, hook, and required environment; any new native capability must keep manifest parity.
- `packages/hermes-plugin/__init__.py:84-123` — Wires schemas and handlers into Hermes.
- `scripts/build-skills.ts:59-106` — Wires protocol skill templates to generated Hermes skill outputs.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/hermes.js:1-86` — Wires control-plane calls to private Hermes dashboard APIs via `X-Hermes-Session-Token`.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:231-293` — Wires browser access to private Hermes dashboard port with cookie handoff and auth stripping.

## Architecture Insights

- The plugin-local dashboard should be additive under the reserved `dashboard/` directory. The source files named by the placeholder are the expected implementation surface.
- Dashboard state should be derived from the same native `index_*` plugin tools that Hermes agents use. This avoids a second, divergent data model.
- A balanced dashboard overview is the right initial shape: one section for scoped signals/protocol guidance and one section for autonomous negotiator status.
- `index_read_intents` is the canonical dashboard entry point for “what am I / this community looking for?” because it preserves MCP scoping and pagination.
- `index_read_docs(topic='mcp_agent_guide')` is the canonical source for dashboard help/empty-state copy when users need protocol guidance.
- `index_pickup_negotiation`/`index_respond_negotiation` are the canonical source for autonomous negotiation status. Human opportunity lifecycle rules in MCP instructions are adjacent but not the same flow.
- Dashboard presentation should be synthesized and redacted. Protocol instructions and AgentVillage analytics both reject raw JSON, internal ids, raw messages, tokens, and assistant reasoning.
- Generated skill templates are source of truth for Hermes skill copy. Dashboard affordances should match namespaced skills like `index-network:index-orchestrator` and `index-network:index-negotiator`.
- AgentVillage dashboard proxy/action code is a precedent for hosting and auth, not the primary product boundary for this research.

## Precedents & Lessons

5 similar past changes analyzed.

### Precedent: Hermes plugin starter + native Index tools

**Commit(s)**: `79d72fb103` — "feat(hermes-plugin): scaffold basic Hermes plugin package (#1043)" (2026-06-22); `d727b711e0` — "fix(hermes-plugin): make package an empty plugin starter (#1044)" (2026-06-22); `5f56d75096` — "feat(hermes-plugin): add MCP-backed read intents tool (#1048)" (2026-06-23); `c31443dec0` — "feat(hermes-plugin): add autonomous negotiator tools (#1053)" (2026-06-23); `4150d08484` — "feat(hermes-plugin): forward Index MCP tools (#1054)" (2026-06-23)

**Blast radius**: 20 files across 5 layers
  plugin/ — root manifest, registration, schemas, handlers
  dashboard/ — placeholder only
  skills/ — bundled orchestrator/negotiator skills
  tests/ — smoke coverage for tool registration/request shapes
  docs/ — README and generated skill templates

**Follow-up fixes**:
- `d727b711e0` — "fix(hermes-plugin): make package an empty plugin starter (#1044)" (2026-06-22) — first scaffold chose generator/templates; corrected to root-level Hermes plugin shape.

**Lessons from docs**:
- `.rpiv/artifacts/plans/2026-06-22_18-06-59_hermes-plugin-package.md` — direct Hermes plugin starter shape; dashboard intentionally TODO.
- `.rpiv/artifacts/plans/2026-06-23_hermes-autonomous-negotiator.md` — native `index_*` tools were the scoped deliverable; full dashboard was out of scope.

**Takeaway**: Keep dashboard work additive and explicit; do not reintroduce generator structure or silently expand into unrelated UI behavior.

### Precedent: AgentVillage control-plane dashboard proxy + Hermes helper

**Commit(s)**: `1f575aa` — "Add dashboard-proxy service and CI/bootstrap" (2026-05-25); `3ef8623` — "Add tenant dashboard endpoints and hermes helper" (2026-05-29); `6408b47` — "Cache dashboard session tokens; add deliveries" (2026-05-29)

**Blast radius**: 14 files across 5 layers
  dashboard-proxy/ — proxy server, Dockerfile, Railway config
  control-plane/ — tenant dashboard endpoints and `hermes.js`
  config/ — env examples and package scripts
  CI/ — deploy workflow
  docs/ — Railway/bootstrap docs

**Follow-up fixes**:
- `f6d0c42` — "Clear cookies only if token came from cookie" (2026-05-26) — cookie/session clearing semantics were wrong.
- `e66e567` — "Fix tenant prefix detection in proxyPath" (2026-05-28) — tenant route prefix parsing broke.
- `b544357` — "Always remove token query param from URL" (2026-06-04) — token leakage/URL hygiene needed hardening.

**Lessons from docs**:
- `.rpiv/artifacts/reviews/2026-06-12_00-20-55_landing-feat-admin-announcements-board.md` — dashboard/admin features repeatedly break around auth/session/env handling and need paired deploy awareness.

**Takeaway**: Dashboard proxy work is auth-sensitive; tokens, tenant prefixes, cookies, and deployment pairing need first-class tests.

### Precedent: Hermes response analytics dashboard

**Commit(s)**: `fd74478` — "Add Hermes response analytics dashboard" (2026-06-13); `77d8b9f` — "Add Edge Esmeralda analytics dashboard docs" (2026-06-14)

**Blast radius**: 8 files across 4 layers
  control-plane/ — analytics endpoint and dashboard HTML
  tests/ — response analytics tests
  docs/ — analytics reference docs and static HTML
  README/ — operator entry points

**Follow-up fixes**:
- `f731b61` — "Keep analytics endpoint patch minimal" (2026-06-13) — dashboard endpoint/docs footprint was reduced same day.
- `1feac62` — "Add redacted turn packets to response analytics" (2026-06-14) — detail view needed redaction model.
- `cbefa00` — "Harden response analytics turn detail redaction" (2026-06-14) — redaction needed additional hardening.

**Lessons from docs**:
- No relevant `.rpiv/artifacts` documents found.

**Takeaway**: Any Hermes dashboard that exposes conversation/tool data needs redaction and minimal endpoint scope from the first slice.

### Precedent: Protocol MCP instructions and tool descriptions

**Commit(s)**: `2ed90644d5` — "feat(protocol): enrich tool descriptions for MCP agent consumption" (2026-04-08); `804fe70b02` — "feat(protocol/mcp): expand MCP_INSTRUCTIONS with canonical behavioral guidance" (2026-04-10); `30a457a1f0` — "feat: canonical user-context/enrichment MCP tools, profile-vocab docs sweep, discoverySource rename (IND-372, IND-371, IND-374) (#1001)" (2026-06-19)

**Blast radius**: 42 files across 6 layers
  protocol/ — utility docs, MCP tool descriptions, aliases
  mcp/ — server instructions and registration
  docs/ — protocol deep-dive/domain docs
  skills/ — orchestrator skill docs/templates
  tests/ — prompt/tool registry snapshots
  backend/ — enrichment adapter naming alignment

**Follow-up fixes**:
- `a5deb3a692` — "fix(mcp): document x-api-key header format in MCP instructions" (2026-04-10) — auth docs were incomplete.
- `6e312398f4` — "fix(protocol/mcp): correct tool name read_indexes → read_networks" (2026-04-10) — stale tool name in instructions.
- `bc9a51add4` — "refactor(protocol): trim MCP_INSTRUCTIONS to global-only content; per-pattern guidance now lives in tool descriptions" (2026-04-14) — central instructions became too broad/stale.
- `787240afdc` — "fix(mcp): strip debugSteps from MCP responses to prevent data leaks" (2026-04-20) — response content leaked internals.

**Lessons from docs**:
- `.rpiv/artifacts/reviews/2026-06-11_22-39-39_agentvillage-pr-84.md` — MCP consumers broke on JSON/SSE/tool-level error shapes; test malformed, empty, and `{success:false}` responses.
- `.rpiv/artifacts/plans/2026-06-19_19-57-03_intent-count-consistency.md` — use MCP scoped views for Hermes-facing data; REST can disagree with scoped agent visibility.

**Takeaway**: Dashboard copy and data flows must track exact tool names, auth headers, scoped semantics, and sanitized response shapes.

### Precedent: Intent count consistency across `/library`, MCP, networks, and Hermes

**Commit(s)**: `2463b36a65` — "fix: intent count consistency across surfaces (EDG-53) (#1017)" (2026-06-20); `693b726` — "feat: report tenant Hermes intent count via MCP read_intents (EDG-53) (#28)" (2026-06-20); `072254c4ca` — "chore(edge-city): bump agentvillage + controlplane submodules to merged Hermes intent-count fixes (EDG-53) (#1020)" (2026-06-20)

**Blast radius**: 16 files across 6 layers
  backend/ — canonical intent predicates and network overview endpoint
  frontend/ — library/network overview rendering
  protocol/ — MCP `read_intents` count semantics
  control-plane/ — scoped MCP count client
  docs/ — FRD/research/plan/validation artifacts
  submodule/ — Edge-City pointer bump

**Follow-up fixes**:
- None found within current history after 2026-06-20.

**Lessons from docs**:
- `.rpiv/artifacts/plans/2026-06-19_19-57-03_intent-count-consistency.md` — Hermes count must come from MCP `read_intents.data.totalCount`, not REST `/intents/list`, because scoped keys see a bounded view.
- `.rpiv/artifacts/validation/2026-06-20_01-02-16_intent-count-consistency.md` — Edge-City changes are out-of-tree and require PR plus monorepo submodule pointer bump.

**Takeaway**: Dashboard protocol/Hermes data should be sourced through the same scoped MCP path the agent uses.

### Composite Lessons

- Dashboard work around Hermes repeatedly fails at auth/session/scoping boundaries: tokens, cookies, API-key provenance, tenant prefixing, and MCP scoped visibility.
- Protocol-aligned dashboard docs must use exact current tool names and response shapes; stale names and `{success:false}` handling caused follow-up fixes before.
- Treat the Hermes plugin dashboard as additive to the root plugin shape; do not reintroduce generator/templates or ship a full unrelated UI surface without explicit scope and tests.
- Redaction and natural-language synthesis should be part of the first implementation slice, not a follow-up hardening pass.

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/research/2026-06-22_18-02-08_hermes-native-plugin-package.md` — research for the native Hermes plugin package.
- `.rpiv/artifacts/plans/2026-06-22_18-06-59_hermes-plugin-package.md` — implementation plan for the Hermes plugin package.
- `.rpiv/artifacts/plans/2026-06-23_hermes-autonomous-negotiator.md` — implementation plan for autonomous Hermes negotiator tools.
- `.rpiv/artifacts/research/2026-06-19_19-16-39_intent-count-consistency.md` — research on intent count consistency across surfaces.
- `.rpiv/artifacts/plans/2026-06-19_19-57-03_intent-count-consistency.md` — plan for scoped intent count consistency.
- `.rpiv/artifacts/validation/2026-06-20_01-02-16_intent-count-consistency.md` — validation for intent count consistency.
- `.rpiv/artifacts/reviews/2026-06-11_22-39-39_agentvillage-pr-84.md` — review covering AgentVillage MCP/dashboard response shape risks.
- `.rpiv/artifacts/designs/2026-06-11_22-53-13_agentvillage-pr84-review-fixes.md` — design for AgentVillage PR review fixes.

## Developer Context

**Q (`packages/hermes-plugin/dashboard/README.md:1-14`, `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:261-293`, `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:845-902`): Which boundary should this research optimize for — plugin-local dashboard, AgentVillage admin, or both staged?**
A: Plugin-local dashboard.

**Q (`packages/hermes-plugin/tools.py:383-411`, `packages/protocol/src/intent/intent.tools.ts:75-104`, `packages/hermes-plugin/tools.py:428-496`, `packages/hermes-plugin/skills/index-negotiator/SKILL.md:70-91`): Which first-use workflow should be load-bearing — signals guide, negotiator status, or balanced overview?**
A: Balanced overview.

**Q (scan checkpoint): Scan complete — write the doc, add an area, or correct a finding?**
A: Write the doc.

## Related Research

- `.rpiv/artifacts/research/2026-06-22_18-02-08_hermes-native-plugin-package.md`
- `.rpiv/artifacts/research/2026-06-19_19-16-39_intent-count-consistency.md`
- `.rpiv/artifacts/research/2026-06-11_01-20-31_agentvillage-daily-brief-questions.md`

## Open Questions

- What exact Hermes dashboard extension manifest/API contract should `dashboard/manifest.json` and `dashboard/plugin_api.py` follow? The repository only reserves file names; no local Hermes dashboard extension example is present in this codebase.
- Should the first implementation include active dashboard controls, or read-only status first? AgentVillage has action precedents, but plugin-local dashboard controls would need a Hermes dashboard API contract and tests.
- How should heartbeat freshness be displayed if the pickup endpoint remains the only heartbeat mechanism and does not return an explicit freshness timestamp in current plugin code?
