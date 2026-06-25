---
template_version: 1
date: 2026-06-25T12:26:08+0300
author: Yanek Yuk
commit: 8304e875a0
branch: dev
repository: index
topic: "Validation of split-chat-scope-semantics"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-06-25_10-10-04_split-chat-scope-semantics.md"
tags: [validation, protocol, chat, scope, opportunities, questions]
last_updated: 2026-06-25T12:42:56+0300
---

## Validation Report: split-chat-scope-semantics

### Implementation Status

- ✓ Phase 1: Scope envelope foundation — Fully implemented
- ✓ Phase 2: Context and DB clamp wiring — Fully implemented
- ✓ Phase 3: Assignment writes — Fully implemented
- ✓ Phase 4: Opportunity visibility — Fully implemented
- ✓ Phase 5: Question visibility — Fully implemented
- ✓ Phase 6: Regression tests — Fully implemented

### Automated Verification Results

- ✓ Protocol build: `cd packages/protocol && bun run build` — TypeScript build completed successfully.
- ✓ Protocol scoped context tests: `cd packages/protocol && bun test src/shared/agent/tests/tool.helpers.spec.ts src/mcp/tests/apply-network-scope-to-context.spec.ts` — 27 pass, 0 fail.
- ✓ Protocol opportunity/question/premise tests: `cd packages/protocol && bun test src/opportunity/tests/opportunity.tools.spec.ts src/questioner/tests/questioner.tools.spec.ts src/premise/tests/premise.graph.spec.ts` — 62 pass, 0 fail.
- ✓ API queue tests: `cd services/api && bun test src/queues/tests/intent.queue.spec.ts src/queues/tests/questioner.queue.spec.ts src/queues/tests/from-intent.queue.spec.ts` — 42 pass, 0 fail.
- ✓ Chat prompt snapshot tests: `cd packages/protocol && bun test src/chat/tests/chat.prompt.modules.spec.ts` — 40 pass, 0 fail.
- ✓ Removed prompt/symbol grep: `! rg "computeAgentIndexScope|discover_opportunities with no networkId arg uses the full reach" packages/protocol services/api` — no matches.
- ✓ No regressions detected.
- ✓ Post-lint intent queue rerun: `cd services/api && bun test src/queues/tests/intent.queue.spec.ts` — 28 pass, 0 fail.
- ✓ Package metadata/lock consistency: `bun install --frozen-lockfile` — completed with no changes.

### Code Review Findings

#### Matches Plan:

- `packages/protocol/src/shared/agent/tool.scope.ts` defines the scope envelope helpers and separates allowed network IDs from discovery network IDs.
- `packages/protocol/src/shared/agent/tool.helpers.ts` and `packages/protocol/src/shared/agent/tool.factory.ts` resolve scoped contexts into `scopeType`/`scopeId` and derive DB clamp reach at the boundary.
- `packages/protocol/src/mcp/mcp.server.ts` replaces `computeAgentIndexScope` with allowed-network derivation for scoped MCP agents.
- `packages/protocol/src/shared/assignment/network-assignment.policy.ts`, `services/api/src/queues/intent.queue.ts`, and `packages/protocol/src/premise/premise.graph.ts` preserve scoped write assignment to focused plus personal networks.
- `packages/protocol/src/opportunity/opportunity.tools.ts` limits scoped opportunity discovery to focused network IDs only and fails closed when the scope envelope does not match a membership.
- `packages/protocol/src/chat/chat.prompt.ts` and its snapshot now describe scoped `discover_opportunities` as focused-community only.
- `packages/protocol/src/intent/intent.graph.ts` threads scope into intent question enqueue payloads.
- `services/api/src/queues/questioner.queue.ts`, `services/api/src/adapters/questioner.adapter.ts`, and `packages/protocol/src/questioner/questioner.tools.ts` persist and enforce scoped actor `networkId` for pending-question reads.
- `services/api/src/queues/opportunity/from-intent.queue.ts` skips empty scoped network arrays fail-closed instead of broadening to unscoped discovery.
- `packages/protocol/src/premise/premise.graph.ts` now supports analyzer injection; `packages/protocol/src/premise/tests/premise.graph.spec.ts` uses a deterministic analyzer so premise graph tests no longer depend on live LLM JSON output.

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan, with the grep criterion clarified to exclude unrelated low-level vector/DB `indexScope` terminology that remains intentionally internal.

#### Pattern Conformance:

- ✓ Scope derivation follows the existing context-bound DB pattern: resolve context once, derive concrete clamps at the boundary, then inject `userDb`/`systemDb`.
- ✓ Queue compatibility follows the existing migration style by accepting `scopeType`/`scopeId` while retaining deprecated `networkScopeId` for legacy payloads.
- ✓ Question actor filtering follows the existing JSON actor containment pattern and adds a tool-side fail-closed defense.
- ✓ Premise graph test stabilization follows dependency-injection conventions already used for the premise indexer.

### Manual Testing Required:

1. Scoped community chat:
   - [ ] Ask for discovery without passing `networkId`; confirm opportunities are only from the focused community and not from the user’s personal index.
   - [ ] Ask to create a new intent/premise; confirm assignment writes include the focused community and the personal index.
   - [ ] Ask for pending questions; confirm only questions whose actor includes `{ userId, networkId: scopeId }` are visible.
2. MCP scoped API key:
   - [ ] Call discovery and pending-question tools with a network-scoped agent key; confirm focused-only opportunity visibility and network-filtered pending questions.

### Recommendations:

- Ready to commit — implementation is complete and validated.
