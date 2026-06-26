---
template_version: 1
date: 2026-06-26T21:28:24+0300
author: Yanek Yuk
commit: d0e5ad8199
branch: feat/intent-scoping-phase-one
repository: feat-intent-scoping-phase-one
topic: "Validation of Backend/protocol selected-intent scoping for opportunities, questions, and scoped mutations"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-06-26_20-06-06_intent-scoping-backend-protocol.md"
tags: [validation, plan, backend, protocol, intent-scoping, opportunities, questions, negotiations]
last_updated: 2026-06-26T21:28:24+0300
---

## Validation Report: Backend/protocol selected-intent scoping for opportunities, questions, and scoped mutations

### Implementation Status

- ✓ Phase 1: Canonical intent scope envelope and opportunity predicate — Fully implemented
- ✓ Phase 2: Read surface threading — Fully implemented
- ✓ Phase 3: Selected-intent pending questions — Fully implemented
- ✓ Phase 4: Scoped row-only mutations — Fully implemented
- ✓ Phase 5: Consumer contract and API docs — Fully implemented

### Automated Verification Results

- ✓ Protocol scope primitives: `grep -n "ToolScopeType = 'network' | 'intent'\|focusedIntentId\|scopeFromIntentId" packages/protocol/src/shared/agent/tool.scope.ts` — matched intent scope type and helpers.
- ✓ Chat streaming/state boundaries: `grep -n "ToolScopeType\|scopeType.*intent" packages/protocol/src/chat/chat.state.ts packages/protocol/src/chat/chat.streamer.ts` — matched widened ToolScopeType usage.
- ✓ Protocol build: `cd packages/protocol && bun run build` — passed (`tsc`).
- ✓ Opportunity service default status pass-through: `cd services/api && bun test src/services/tests/opportunity.service.listStatusFilter.spec.ts` — 7 pass, 0 fail.
- ✓ Adapter selected-intent SQL predicate: `grep -n "scopeType === 'intent'\|actor->>'intent'" services/api/src/adapters/opportunity.database.adapter.ts` — matched SQL-side predicate inside `getOpportunitiesForUser`.
- ✓ REST list/home scope parsing: `grep -n "parseIntentScopeFromUrl\|scopeTypeQuerySchema\|scopeId" services/api/src/controllers/opportunity.controller.ts` — matched parser and service threading.
- ✓ HomeGraph intent scope forwarding: `cd packages/protocol && bun test src/opportunity/tests/feed.graph.status-filter.spec.ts` — 5 pass, 0 fail.
- ✓ Protocol opportunity tools selected-intent support: `grep -n "focusedIntentId\|scopeType\|scopeId" packages/protocol/src/opportunity/opportunity.tools.ts` — matched list/update scope handling.
- ✓ Digest suppression stays scoped: `grep -n "statuses: \[\"accepted\"\].*effectiveIntentScope\|effectiveIntentScope.*statuses: \[\"accepted\"\]" packages/protocol/src/opportunity/opportunity.tools.ts` — matched accepted-suppression scope evidence.
- ✓ Question controller selected-intent parsing: `grep -n "parseIntentScopeFromUrl\|scopeTypeQuerySchema\|scopeId" services/api/src/controllers/question.controller.ts` — matched parser and filter threading.
- ✓ Questioner adapter selected-intent join: `cd services/api && bun test tests/questioner.adapter.spec.ts` — 12 pass, 0 fail.
- ✓ Question filter contracts: `grep -n "scopeType\|scopeId" packages/protocol/src/shared/interfaces/questioner.interface.ts services/api/src/adapters/questioner.adapter.ts` — matched protocol and backend filter contracts.
- ✓ Protocol pending-question selected-intent threading: `grep -n "focusedIntentId\|scopeType: 'intent'" packages/protocol/src/questioner/questioner.tools.ts packages/protocol/src/shared/agent/tool.helpers.ts` — matched focused intent lookup and host filter forwarding.
- ✓ Service scoped start-chat row-only behavior: `cd services/api && bun test src/services/tests/opportunity.service.startChat.spec.ts` — 13 pass, 0 fail.
- ✓ Service scoped status update row-only behavior: `cd services/api && bun test tests/opportunity-service.self-accept-guard.spec.ts` — 5 pass, 0 fail.
- ✓ REST mutation scope parsing: `grep -n "parseIntentScopeFromBody\|scopeType\|scopeId" services/api/src/controllers/opportunity.controller.ts` — matched body parser and mutation use sites.
- ✓ REST mutation non-object rejection: `grep -n "function isRecord\|let body: unknown" services/api/src/controllers/opportunity.controller.ts` — matched `isRecord` guard and unknown body parsing.
- ✓ Protocol update_opportunity selected-intent guard: `grep -n "focusedIntentId\|scopeType\|scopeId\|matchesSelectedIntentScope" packages/protocol/src/opportunity/opportunity.tools.ts` — matched guard before graph mutation.
- ✓ Mac API contract: `cd apps/mac && bun test api/client.spec.mjs` — 4 pass, 0 fail.
- ✓ API docs scope coverage: `grep -n "scopeType\|scopeId\|intentId" docs/specs/api-reference.md` — matched opportunity, mutation, tool, and question docs.
- ✓ Generated Mac bundles untouched: `git diff --name-only -- apps/mac | grep -v '^apps/mac/api/'` — no output.
- ✓ Existing protocol update-opportunity network guard regression check: `cd packages/protocol && bun test src/opportunity/tests/update-opportunity.spec.ts` — 8 pass, 0 fail after preserving legacy `networkId` fallback at tool call sites.
- ✓ API build: `cd services/api && bun run build` — passed protocol build plus API `tsc`.
- ✓ No regressions detected in targeted plan and adjacent checks.

### Code Review Findings

#### Matches Plan:

- `packages/protocol/src/shared/agent/tool.scope.ts` — extends `ToolScopeType` with `intent` and adds `scopeFromIntentId`, `hasIntentScope`, and `focusedIntentId` while keeping network helpers network-only.
- `services/api/src/adapters/opportunity.database.adapter.ts` — applies selected-intent opportunity narrowing SQL-side using `detection.triggeredBy` or the viewer actor's `intent`, after existing visibility/network/status conditions.
- `services/api/src/controllers/opportunity.controller.ts` — normalizes REST `scopeType/scopeId` and `intentId` alias for list/home/status/start-chat, with null/non-object body rejection for mutation bodies.
- `packages/protocol/src/opportunity/feed/feed.graph.ts` — forwards selected-intent scope into the database load before visibility checks, sorting, presentation, and counterpart dedupe.
- `packages/protocol/src/opportunity/opportunity.tools.ts` — accepts context and explicit selected-intent scope for `list_opportunities` and `update_opportunity`, rejects mismatched context scope, preserves network guard behavior, and keeps digest accepted-suppression scoped.
- `services/api/src/adapters/questioner.adapter.ts` — returns direct intent questions and negotiation questions joined through source opportunities matching the canonical selected-intent predicate.
- `services/api/src/services/opportunity.service.ts` — rejects non-matching selected-intent mutations before side effects and skips sibling acceptance only for selected-intent scoped accept/start-chat.
- `apps/mac/api/client.mjs` and `apps/mac/api/client.spec.mjs` — expose and test canonical `scopeType/scopeId` helpers without touching generated HaloApp bundles.
- `docs/specs/api-reference.md` — documents canonical `scopeType/scopeId`, `intentId` as alias, and row-only scoped accept/start-chat behavior.

#### Deviations from Plan:

- None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ Controller parsing follows existing Zod `safeParse` and `Response.json(..., { status: 400 })` conventions.
- ✓ Service tests follow existing Bun mock-DB factory style and assert side-effect ordering with `toHaveBeenCalledWith` / `not.toHaveBeenCalled`.
- ✓ Drizzle adapters preserve the existing composable `conditions` array and JSONB SQL predicate style.
- ✓ Protocol tool changes use the established scope-helper pattern; legacy `context.networkId` fallback is preserved at opportunity tool call sites for backward-compatible direct tool tests without changing `focusedNetworkId` semantics.
- ✓ Mac API tests follow the existing `expectCall` endpoint-contract pattern. Query ordering differences in `*ForIntent` helpers are explicitly pinned by tests and are acceptable.

### Manual Testing Required:

1. REST selected-intent opportunity reads:
   - [ ] Call `GET /api/opportunities?scopeType=intent&scopeId=<intentId>` and confirm only selected-intent rows return.
   - [ ] Call `GET /api/opportunities?intentId=<intentId>` and confirm it behaves identically to the canonical query form.
   - [ ] Combine `networkId` with selected-intent scope and confirm it narrows results without broadening network visibility.

2. REST selected-intent home and questions:
   - [ ] Call `GET /api/opportunities/home?intentId=<intentId>` and confirm narrowing occurs before counterpart dedupe.
   - [ ] Call `GET /api/questions?status=pending&intentId=<intentId>` and confirm direct intent questions plus matching negotiation questions return without requiring opportunity ids.

3. Scoped mutations:
   - [ ] Call `PATCH /api/opportunities/:id/status` with a matching selected-intent scope and `status=accepted`; confirm only the row changes and sibling opportunities for the same counterpart under other intents remain untouched.
   - [ ] Call `POST /api/opportunities/:id/start-chat` with a non-matching selected-intent scope and confirm not-found semantics before DM creation or row mutation.
   - [ ] Repeat accept/start-chat without scope and confirm existing sibling acceptance behavior is unchanged.

4. Mac contract surface:
   - [ ] Confirm only `apps/mac/api/client.mjs` and `apps/mac/api/client.spec.mjs` changed under `apps/mac`.
   - [ ] Confirm HaloApp generated Resources/dist/app bundle paths remain untouched.

### Recommendations:

- Ready to commit — implementation is complete and validated.
