---
trigger: "Rename MCP tool create_opportunities to discover_opportunities — the tool performs discovery, not creation, and the rest of the stack (queue job, service method) already uses the correct verb."
type: refactor
branch: refactor/discover-opportunities-rename
base-branch: dev
created: 2026-05-12
version-bump: patch
linear-issue: IND-270
---

## Related Files

### Protocol tool layer
- packages/protocol/src/opportunity/opportunity.tools.ts (canonical tool definition)
- packages/protocol/src/chat/chat.agent.ts (auto-invoke logic, createOpportunitiesTool variable)
- packages/protocol/src/chat/chat.prompt.ts
- packages/protocol/src/chat/chat.prompt.modules.ts
- packages/protocol/src/contact/contact.tools.ts
- packages/protocol/src/intent/intent.tools.ts
- packages/protocol/src/network/network.tools.ts
- packages/protocol/src/shared/agent/utility.tools.ts
- packages/protocol/src/opportunity/opportunity.discover.ts
- packages/protocol/src/opportunity/opportunity.graph.ts
- packages/protocol/src/opportunity/opportunity.state.ts

### Protocol tests
- packages/protocol/src/shared/agent/tests/tool.factory.spec.ts
- packages/protocol/src/chat/tests/chat.prompt.modules.spec.ts
- packages/protocol/src/chat/tests/chat.prompt.spec.ts
- packages/protocol/src/chat/tests/chat.agent.spec.ts
- packages/protocol/src/chat/tests/chat.graph.mocks.ts
- packages/protocol/src/opportunity/tests/opportunity.state.dedupAlreadyAccepted.spec.ts

### Backend tests
- backend/src/controllers/tests/tool.controller.spec.ts
- backend/tests/mcp.spec.ts

### CLI
- packages/cli/src/opportunity.command.ts
- packages/cli/src/output/base.ts
- packages/cli/tests/opportunity.command.spec.ts
- packages/cli/tests/tool-calls.spec.ts

### Frontend
- frontend/src/components/chat/ToolCallsDisplay.tsx

### Plugins + skill templates
- packages/claude-plugin/skills/index-orchestrator/SKILL.md
- packages/protocol/skills/claude-plugin/index-orchestrator.template.md

### Edgeclaw workspace
- packages/edgeclaw/workspace/AGENTS.md
- packages/edgeclaw/workspace/BOOTSTRAP.md
- packages/edgeclaw/workspace/SOUL.md
- packages/edgeclaw/workspace/TOOLS.md

### Docs
- docs/specs/api-reference.md
- docs/specs/cli-reference.md
- docs/design/protocol-deep-dive.md
- docs/specs/2026-05-06-welcome-message-design.md
- packages/protocol/src/README.md
- packages/protocol/src/docs/Latent Opportunity Lifecycle.md

## Relevant Docs
- docs/specs/2026-05-12-discover-opportunities-rename-design.md (the design spec for this work)
- docs/design/protocol-deep-dive.md (references the tool by name)
- docs/specs/api-reference.md (lists the tool in the MCP tool reference)

## Related Issues
- IND-270 Rename MCP tool `create_opportunities` to `discover_opportunities` (Triage) — primary issue
- Follow-up to be filed: queue job naming conventions (separate small issue per user direction)

## Scope

See `docs/specs/2026-05-12-discover-opportunities-rename-design.md` for the full design.

Mechanical find-and-replace across ~38 files. No logic, behavior, schema, or queue changes.

**Renames:**
- `"create_opportunities"` (snake_case string) → `"discover_opportunities"` everywhere it appears as a tool name, prompt trigger, doc reference, CLI invocation, frontend display key, or test assertion.
- `createOpportunities` / `createOpportunitiesTool` (camelCase variables holding the tool binding) → `discoverOpportunities` / `discoverOpportunitiesTool`.

**Explicitly NOT renamed:**
- `createOpportunitiesService` (frontend service factory, unrelated)
- `createOpportunityTools` (factory function for the opportunity tool group, singular `Opportunity`)
- BullMQ `discover_opportunities` job name (confirmed by user — keep queue name the same; a separate Linear issue will track queue naming conventions for the future)
- `OpportunityQueue.handleDiscoverOpportunities` method
- Service methods using `discoverOpportunities` (already correct)

**Naming collision decision:** The MCP tool and the BullMQ job will share the string `"discover_opportunities"`. They sit at different layers (HTTP/MCP tool dispatch vs. Redis job dispatch). Runtime collision is impossible. Confirmed acceptable.

**Verification gate:**
- `bun run tsc` clean across backend, packages/protocol, packages/cli, frontend
- Affected test suites pass (tool.factory.spec.ts, chat.prompt.modules.spec.ts, chat.prompt.spec.ts, chat.agent.spec.ts, tool.controller.spec.ts, mcp.spec.ts, opportunity.command.spec.ts, tool-calls.spec.ts)
- `bun run lint` clean
- MCP `tools/list` exposes `discover_opportunities`; no `create_opportunities` remains
- Regenerated SKILL.md files match updated templates

**Version bumps (per CLAUDE.md finishing-a-branch):**
- backend/package.json
- packages/protocol/package.json
- packages/cli/package.json
- packages/claude-plugin/package.json
- frontend/package.json
