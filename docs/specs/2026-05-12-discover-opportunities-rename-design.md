---
title: Rename MCP tool `create_opportunities` → `discover_opportunities`
type: spec
tags: [mcp, tools, opportunity, refactor, naming]
created: 2026-05-12
updated: 2026-05-12
linear: IND-270
---

## Summary

The MCP tool currently named `create_opportunities` performs **discovery** — semantic search via HyDE embeddings, LLM evaluation, and pair scoring. The verb `create_` mismatches the actual semantic and contradicts the rest of the stack:

- BullMQ job: `discover_opportunities` ✅
- Service method: `discoverOpportunities` ✅
- MCP tool: `create_opportunities` ❌ (the outlier)

This spec aligns the MCP tool with the rest of the codebase by renaming it to `discover_opportunities`. Mechanical find-and-replace across ~38 files. No logic, behavior, or schema changes.

## Motivation

The misnamed tool reads as "make me some opportunities," when the actual semantic is "find people who match this query (and surface them as draft opportunities)." This:

1. Misleads LLM callers about side-effect cost vs. read-only semantics.
2. Conflicts with project voice (`directives.triage` / Index MCP voice prefers "discover" for exploration).
3. Diverges from the queue/service naming already in place.

## Scope

### What is renamed

- `"create_opportunities"` (snake_case string literal) → `"discover_opportunities"` everywhere it appears as:
  - MCP tool `name` field (canonical definition in `packages/protocol/src/opportunity/opportunity.tools.ts`)
  - Tool-call assertions in tests (`hasToolCall(..., "create_opportunities")`, `t.name === "create_opportunities"`)
  - Prompt module triggers (`triggers: ["create_opportunities", ...]`)
  - Cross-tool references in description strings (`contact.tools.ts`, `intent.tools.ts`, `network.tools.ts`, `utility.tools.ts`)
  - Self-references inside the tool's own description and presentation messages
  - CLI `client.callTool("create_opportunities", ...)` invocations
  - CLI output label map
  - Frontend `ToolCallsDisplay` switch entry
  - Skill / template / docs markdown references
- `createOpportunities` / `createOpportunitiesTool` (camelCase variables) → `discoverOpportunities` / `discoverOpportunitiesTool` where they hold the tool binding (e.g. `chat.agent.ts` `const createOpportunitiesTool = this.toolsByName.get(...)`)
- `handleCreateIntentCallback` invocation comments that reference the renamed tool (string references inside comments)

### What is NOT renamed

- `createOpportunitiesService` in frontend — service factory (`createXService` pattern), unrelated to the MCP tool
- `createOpportunityTools` function — factory that constructs all opportunity-related tool definitions (singular `Opportunity`)
- BullMQ `discover_opportunities` job name — already correct
- `OpportunityQueue.handleDiscoverOpportunities` method — already correct
- `discoverOpportunitiesService` in `OpportunityService` / `OpportunityGraph` — already correct

### Naming collision (queue job ↔ MCP tool)

After the rename, the MCP tool and the BullMQ job will share the string `"discover_opportunities"`. They live at different layers (HTTP/MCP tool definition vs. Redis job name in `opportunity.queue.ts`). Runtime collision is impossible — the queue uses BullMQ's `queue.add(name, …)`, the MCP layer uses tool-name dispatch. Decision: **accept the collision**. The semantic match is the point; layer separation makes ambiguity low-risk for readers.

## Affected files

See IND-270 for the full inventory. High-level groups:

- **Protocol tool layer**: `opportunity/opportunity.tools.ts`, `chat/chat.agent.ts`, `chat/chat.prompt.ts`, `chat/chat.prompt.modules.ts`, `contact/contact.tools.ts`, `intent/intent.tools.ts`, `network/network.tools.ts`, `shared/agent/utility.tools.ts`, `opportunity/opportunity.discover.ts`, `opportunity/opportunity.graph.ts`, `opportunity/opportunity.state.ts`
- **Protocol tests**: `chat/tests/chat.prompt.modules.spec.ts`, `chat/tests/chat.prompt.spec.ts`, `chat/tests/chat.agent.spec.ts`, `chat/tests/chat.graph.mocks.ts`, `opportunity/tests/opportunity.state.dedupAlreadyAccepted.spec.ts`, `shared/agent/tests/tool.factory.spec.ts`
- **Backend tests**: `backend/src/controllers/tests/tool.controller.spec.ts`, `backend/tests/mcp.spec.ts`
- **CLI**: `packages/cli/src/opportunity.command.ts`, `packages/cli/src/output/base.ts`, `packages/cli/tests/opportunity.command.spec.ts`, `packages/cli/tests/tool-calls.spec.ts`
- **Frontend**: `frontend/src/components/chat/ToolCallsDisplay.tsx`
- **Plugins**: `packages/openclaw-plugin/skills/index-orchestrator/SKILL.md`, `packages/openclaw-plugin/src/polling/onboarding/onboarding.prompt.ts`, `packages/claude-plugin/skills/index-orchestrator/SKILL.md`
- **Skill templates** (sources of truth for SKILL.md generation): `packages/protocol/skills/openclaw/index-orchestrator.template.md`, `packages/protocol/skills/claude-plugin/index-orchestrator.template.md`
- **Edgeclaw**: `packages/edgeclaw/workspace/AGENTS.md`, `BOOTSTRAP.md`, `SOUL.md`, `TOOLS.md`
- **Docs**: `docs/specs/api-reference.md`, `docs/specs/cli-reference.md`, `docs/design/protocol-deep-dive.md`, `docs/specs/2026-05-06-welcome-message-design.md`, `packages/protocol/src/README.md`, `packages/protocol/src/docs/Latent Opportunity Lifecycle.md`

## Out of scope

- No DB migration, no API path change, no schema change.
- No change to opportunity status, role, or visibility logic.
- No queue rename.

## Verification

- `bun run tsc` clean for backend, `packages/protocol`, `packages/cli`, `frontend`
- Targeted suites pass:
  - `bun test src/shared/agent/tests/tool.factory.spec.ts`
  - `bun test src/chat/tests/chat.prompt.modules.spec.ts`
  - `bun test src/chat/tests/chat.prompt.spec.ts`
  - `bun test src/chat/tests/chat.agent.spec.ts`
  - `bun test src/controllers/tests/tool.controller.spec.ts` (in backend)
  - `bun test tests/mcp.spec.ts` (in backend)
  - `bun test tests/opportunity.command.spec.ts` (in packages/cli)
  - `bun test tests/tool-calls.spec.ts` (in packages/cli)
- `bun run lint` clean
- Manual: `mcp/tools/list` response includes `discover_opportunities`; no `create_opportunities` entry remains
- After rebuild of skills (`scripts/build-skills.ts`), generated SKILL.md files match templates

## Risks

- **External callers**: Any external MCP client calling `create_opportunities` by name will break. Mitigation: this is an internal rename pre-1.0; no public deprecation window required. Edge city release notes should call out the rename if shipping concurrently.
- **Snapshot tests**: Any snapshot containing the literal string `create_opportunities` will need regeneration. Caught by failing test runs.

## Rollout

Single PR. Merge to `dev`, push to upstream — subtree workflow propagates to `indexnetwork/cli`, `indexnetwork/protocol`, `indexnetwork/claude-plugin`, `indexnetwork/openclaw-plugin`. Plugin version bumps required (see CLAUDE.md "Finishing a Branch" — both `package.json` AND `openclaw.plugin.json` for openclaw-plugin).
