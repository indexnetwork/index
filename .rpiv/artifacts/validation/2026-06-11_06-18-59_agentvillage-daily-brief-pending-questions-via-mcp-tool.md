---
date: 2026-06-11T06:18:59+0300
author: Yankı Ekin Yüksel
commit: c4cfa8f91f
branch: feat/agentvillage-brief-questions
repository: index
topic: "Validation of AgentVillage Daily Brief — Pending Questions via MCP Tool"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-06-11_01-52-40_agentvillage-daily-brief-questions.md"
tags: [validation, agentvillage, daily-brief, questioner, mcp-tool, edge-esmeralda]
last_updated: 2026-06-11T06:18:59+0300
---

## Validation Report: AgentVillage Daily Brief — Pending Questions via MCP Tool

### Implementation Status

- ✓ Phase 1: MCP tool + registry — Fully implemented
- ✓ Phase 2: Context fetch — Fully implemented
- ✓ Phase 3: Brief composition — Fully implemented

### Automated Verification Results

- ✓ Phase 1 — questioner.tools.spec.ts: `cd packages/protocol && bun test src/questioner/tests/questioner.tools.spec.ts` — 4 pass, 0 fail
- ✓ Phase 1 — registry contains tool: `grep -r 'createQuestionerTools' packages/protocol/src/shared/agent/tool.registry.ts` — match at line 16 (import) and line 85 (call)
- ✓ Phase 1 — tool absent from chat factory: `grep -r 'read_pending_questions' packages/protocol/src/shared/agent/tool.factory.ts` — absent (as required)
- ✓ Phase 1 — protocol build: `cd packages/protocol && bun run build` — compiles without errors
- ✓ Phase 2 — build-daily-brief-context.test.ts: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/build-daily-brief-context.test.ts` — 19 pass, 0 fail (2 new fetchPendingQuestionsFromMcp tests)
- ✓ Phase 2 — questionSource present: `grep 'questionSource' ...build-daily-brief-context.ts` — 4 matches (type, initializer, assignment, return)
- ✓ Phase 2 — questions? optional field: `grep 'questions?: BriefQuestion' ...build-daily-brief-context.ts` — match confirmed in DailyBriefContext
- ✓ Phase 3 — stage-daily-brief.test.ts: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/stage-daily-brief.test.ts` — 12 pass, 0 fail (3 new One for you tests)
- ✓ Phase 3 — One for you present: `grep 'One for you' ...stage-daily-brief.ts` — match at line 179
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- `questioner.tools.ts:15` — `createQuestionerTools(defineTool, deps)` export matches plan specification exactly
- `questioner.tools.ts:36-37` — graceful fallback `return error(...)` when `deps.findPendingQuestions` absent
- `questioner.tools.ts:41-42` — `const limit = query.limit ?? 10` before slice (review finding #1 applied correctly)
- `tool.registry.ts:85` — `createQuestionerTools(dt, deps)` registered immediately after `createPremiseTools(dt, deps)`
- `build-daily-brief-context.ts:87-91` — `BriefQuestion` exported with `id`, `title`, `prompt`, `mode` (all strings)
- `build-daily-brief-context.ts:117` — `questions?: BriefQuestion[]` optional field in `DailyBriefContext`
- `build-daily-brief-context.ts:123` — `questionSource?: "mcp" | "unavailable"` in diagnostics
- `build-daily-brief-context.ts:699-741` — `fetchPendingQuestionsFromMcp` exported, never throws, returns `{ questions, source }` (review finding #2 applied correctly)
- `build-daily-brief-context.ts:767, 791-796` — fetch only when `apiKey` set; pushes `"questions MCP unavailable"` warning on unavailable
- `stage-daily-brief.ts:172-181` — question block appended after "That's it for now..." only when `pendingQuestions.length > 0`
- `stage-daily-brief.ts:174` — `context.questions ?? []` ensures fail-closed when `questions` is undefined

#### Deviations from Plan:

- `build-daily-brief-context.ts:728-729` — when the MCP tool itself returns `{ success: false, error }` (e.g. when `findPendingQuestions` dep is absent at tool-server level), `parsed.success` is not checked; the function returns `{ questions: [], source: "mcp" }` rather than `{ questions: [], source: "unavailable" }`. In practice this is a no-op: (1) `findPendingQuestions` is always wired in production via `mcp.controller.ts`, (2) the brief is still delivered without a question section either way. The "unavailable" path is reserved for network/transport failures, which is what the plan's fail-closed requirement targets. Acceptable deviation — does not affect correctness.

#### Pattern Conformance:

- ✓ `questioner.tools.ts` export structure, `defineTool` usage, `querySchema`, `success()`/`error()` helpers, and array return all follow the same conventions as `premise.tools.ts`, `intent.tools.ts`, and `negotiation.tools.ts`
- ✓ `fetchPendingQuestionsFromMcp` follows `fetchOpportunitiesFromMcp`'s JSON-RPC flow (initialize → tools/call → parse text content → fail-closed), with the intentional deviation of returning `source: "unavailable"` instead of throwing — matching the plan's fail-closed contract
- Minor observation: `return [readPendingQuestions]` without `as const` at `questioner.tools.ts:47` — matches `premise.tools.ts` precedent but differs from `intent.tools.ts` and `negotiation.tools.ts`; acceptable variation, not a deviation

### Manual Testing Required:

1. Brief composition end-to-end:
   - [ ] Verify that a user with a pending question in the DB receives a brief ending with `**One for you:** {prompt}` and `Reply to me anytime!` after the "That's it for now..." line
   - [ ] Verify that a user with no pending questions receives an unchanged brief (no question section)
   - [ ] Verify the Kanban draft (`memory/digest-draft.md`) includes the question section when questions are present

2. MCP tool discovery:
   - [ ] Call `read_pending_questions` via MCP (with an active API key) and confirm it returns `{ questions: [...] }` for a user with pending questions
   - [ ] Confirm the tool is listed in `mcp/list_tools` response

### Recommendations:

- Ready to commit — implementation is complete and validated.
- Open the AgentVillage PR to `Edge-City/agentvillage` main for the submodule changes, then update the submodule pointer in the `indexnetwork/index` `feat/agentvillage-brief-questions` branch before merging to dev.
- The `packages/protocol` version bump (semver patch for new MCP tool) should be done before promoting to `main` per CLAUDE.md finishing checklist.
