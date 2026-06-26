---
template_version: 1
date: 2026-06-26T20:36:11+0300
author: Yanek Yuk
commit: d0e5ad8199
branch: dev
repository: index
topic: "Validation of Backend/protocol selected-intent scoping for opportunities, questions, and scoped mutations"
status: ready
verdict: fail
parent: ".rpiv/artifacts/plans/2026-06-26_20-06-06_intent-scoping-backend-protocol.md"
tags: [validation, backend, protocol, intent-scoping, opportunities, questions, negotiations]
last_updated: 2026-06-26T20:36:11+0300
---

## Validation Report: Backend/protocol selected-intent scoping for opportunities, questions, and scoped mutations

### Implementation Status

- ⚠️ Phase 1: Canonical intent scope envelope and opportunity predicate — Not implemented
- ⚠️ Phase 2: Read surface threading — Not implemented
- ⚠️ Phase 3: Selected-intent pending questions — Not implemented
- ⚠️ Phase 4: Scoped row-only mutations — Not implemented
- ⚠️ Phase 5: Consumer contract and API docs — Not implemented

### Automated Verification Results

- ✗ Protocol scope primitives expose intent scope: `grep -n "ToolScopeType = 'network' | 'intent'\|focusedIntentId\|scopeFromIntentId" packages/protocol/src/shared/agent/tool.scope.ts` — no matches; `ToolScopeType` remains network-only.
- ✗ Chat streaming/state boundaries accept selected-intent scope: `grep -n "ToolScopeType\|scopeType.*intent" packages/protocol/src/chat/chat.state.ts packages/protocol/src/chat/chat.streamer.ts` — no selected-intent matches.
- ✓ Protocol build: `cd packages/protocol && bun run build` — passed (`tsc`).
- ✓ Existing opportunity service status-filter tests: `cd services/api && bun test src/services/tests/opportunity.service.listStatusFilter.spec.ts` — passed, but current test only covers `networkId` preservation, not intent scope.
- ✗ Adapter selected-intent predicate is SQL-side: `grep -n "scopeType === 'intent'\|actor->>'intent'" services/api/src/adapters/opportunity.database.adapter.ts` — no matches in `getOpportunitiesForUser`.
- ✗ REST opportunity list/home controller normalizes selected-intent scope: `grep -n "parseIntentScopeFromUrl\|scopeTypeQuerySchema\|scopeId" services/api/src/controllers/opportunity.controller.ts` — no matches.
- ✓ Existing HomeGraph status-filter tests: `cd packages/protocol && bun test src/opportunity/tests/feed.graph.status-filter.spec.ts` — passed, but current test only covers status filters, not intent scope.
- ✗ Protocol `list_opportunities` consumes intent scope: `grep -n "focusedIntentId\|scopeType\|scopeId" packages/protocol/src/opportunity/opportunity.tools.ts` — only network-oriented scope references exist; no `focusedIntentId`.
- ✗ Digest accepted-counterpart suppression remains selected-intent scoped: `grep -n "statuses: \[\"accepted\"\].*effectiveIntentScope\|effectiveIntentScope.*statuses: \[\"accepted\"]" packages/protocol/src/opportunity/opportunity.tools.ts` — no matches.
- ✗ Question controller normalizes selected-intent scope: `grep -n "parseIntentScopeFromUrl\|scopeTypeQuerySchema\|scopeId" services/api/src/controllers/question.controller.ts` — no matches.
- ✓ Existing question adapter tests: `cd services/api && bun test tests/questioner.adapter.spec.ts` — passed, but selected-intent scope coverage is absent.
- ✗ Question filter contract includes selected-intent scope: `grep -n "scopeType\|scopeId" packages/protocol/src/shared/interfaces/questioner.interface.ts services/api/src/adapters/questioner.adapter.ts` — no matches.
- ✗ Protocol `read_pending_questions` threads selected-intent scope: `grep -n "focusedIntentId\|scopeType: 'intent'" packages/protocol/src/questioner/questioner.tools.ts packages/protocol/src/shared/agent/tool.helpers.ts` — no matches.
- ✓ Existing start-chat tests: `cd services/api && bun test src/services/tests/opportunity.service.startChat.spec.ts` — passed, but selected-intent scoped row-only behavior is absent.
- ✓ Existing self-accept guard tests: `cd services/api && bun test tests/opportunity-service.self-accept-guard.spec.ts` — passed, but selected-intent scoped update behavior is absent.
- ✗ REST mutation surfaces normalize scope body: `grep -n "parseIntentScopeFromBody\|scopeType\|scopeId" services/api/src/controllers/opportunity.controller.ts` — no selected-intent mutation parser exists.
- ✓ REST mutation body parsing hardening partial evidence: `grep -n "function isRecord\|let body: unknown" services/api/src/controllers/opportunity.controller.ts` — found `let body: unknown`, but not the planned selected-intent scope parsing.
- ✗ Protocol `update_opportunity` selected-intent guard: `grep -n "focusedIntentId\|scopeType\|scopeId\|matchesSelectedIntentScope" packages/protocol/src/opportunity/opportunity.tools.ts` — no selected-intent guard exists.
- ✓ Existing Mac API client tests: `cd apps/mac && bun test api/client.spec.mjs` — passed, but selected-intent helper coverage is absent.
- ✗ API docs mention selected-intent scope and alias: `grep -n "scopeType\|scopeId\|intentId" docs/specs/api-reference.md` — docs still omit selected-intent scope for the planned opportunity/question surfaces.
- ✓ Generated Mac bundles untouched: `git diff --name-only -- apps/mac | grep -v '^apps/mac/api/'` — no output; grep returned 1 because no non-API mac paths were changed.

### Code Review Findings

#### Matches Plan:

- None — the selected-intent scoping implementation described by the plan is not present in the current working tree.

#### Deviations from Plan:

- `packages/protocol/src/shared/agent/tool.scope.ts:8` — `ToolScopeType` is still `network` only; no `intent` union member or `scopeFromIntentId`/`focusedIntentId` helpers exist.
- `packages/protocol/src/chat/chat.state.ts` and `packages/protocol/src/chat/chat.streamer.ts` — chat boundaries remain network-scope-only, so selected-intent context cannot flow through the graph boundary.
- `packages/protocol/src/shared/interfaces/database.interface.ts` and `services/api/src/adapters/opportunity.database.adapter.ts` — opportunity query contracts and SQL predicates lack `scopeType/scopeId`; reads cannot be narrowed by `detection.triggeredBy` or viewer actor `intent`.
- `services/api/src/services/opportunity.service.ts` — list/home/update/start-chat methods do not accept selected-intent scope options; scoped accept/start-chat cannot skip sibling acceptance.
- `services/api/src/controllers/opportunity.controller.ts` — list/home/status/start-chat endpoints do not parse canonical `scopeType/scopeId` or `intentId` alias.
- `packages/protocol/src/opportunity/feed/feed.graph.ts` and `packages/protocol/src/opportunity/feed/feed.state.ts` — HomeGraph input/state/load options have no selected-intent scope, so narrowing cannot occur before visibility filtering/dedupe.
- `packages/protocol/src/opportunity/opportunity.tools.ts` — `list_opportunities` and `update_opportunity` remain network-only; schemas and guards do not support selected-intent scope.
- `packages/protocol/src/shared/interfaces/questioner.interface.ts`, `services/api/src/adapters/questioner.adapter.ts`, and `packages/protocol/src/questioner/questioner.tools.ts` — pending-question filters do not support selected-intent direct intent questions or negotiation-question joins through opportunities.
- `services/api/src/controllers/question.controller.ts` — `/questions` does not parse selected-intent scope or alias.
- `apps/mac/api/client.mjs` and `apps/mac/api/client.spec.mjs` — selected-intent convenience helpers and tests are absent; mutation helpers still send unscoped bodies.
- `docs/specs/api-reference.md` — public API docs do not describe canonical `scopeType/scopeId`, `intentId` alias, or scoped row-only mutation behavior.

#### Pattern Conformance:

- ✓ Existing network-scope code follows the current codebase pattern of SQL-side adapter scoping and controller → service → adapter threading.
- Minor observation: Existing generic Mac query helpers can pass arbitrary query keys, but the planned explicit selected-intent helpers and scoped mutation bodies are still missing; this is a gap, not a pattern violation.

#### Potential Issues:

- The plan appears marked complete for Phase 1 automated/manual criteria, but validation against the working tree shows the implementation is absent. Before committing, run the implementation step or ensure the intended implementation branch/worktree is checked out.
- Passing existing tests is not sufficient for this plan: several required tests named in the plan have not been updated to assert selected-intent behavior, so current green tests are mostly pre-existing coverage.

### Manual Testing Required:

1. Selected-intent opportunity reads:
   - [ ] After implementation, call `/api/opportunities?scopeType=intent&scopeId=<intentId>` and verify only opportunities with `detection.triggeredBy=<intentId>` or the viewer actor's `intent=<intentId>` are returned.
   - [ ] Verify `networkId` still composes with intent scope and never broadens network visibility.
2. Home feed:
   - [ ] Verify `/api/opportunities/home?intentId=<intentId>` narrows before visibility filtering, sorting, and counterpart dedupe.
3. Pending questions:
   - [ ] Verify `/api/questions?intentId=<intentId>` returns direct intent questions plus negotiation questions whose source opportunities match the selected-intent predicate.
4. Scoped mutations:
   - [ ] Verify scoped accept/start-chat returns not-found semantics for a non-matching intent.
   - [ ] Verify scoped accept/start-chat does not call `acceptSiblingOpportunities`, while unscoped behavior still does.
5. Consumer/docs scope:
   - [ ] Verify Mac changes are limited to `apps/mac/api/*` and generated HaloApp bundles remain untouched.
   - [ ] Verify API docs describe `scopeType/scopeId` as canonical and `intentId` as an alias.

### Recommendations:

- Do not commit as validated. The implementation is not present in the current working tree.
- Check out the implementation branch/worktree or run `/skill:implement .rpiv/artifacts/plans/2026-06-26_20-06-06_intent-scoping-backend-protocol.md`, then re-run `/skill:validate`.
- When implementing, add/confirm the selected-intent-specific tests named in the plan; current passing tests do not prove the new contract.
