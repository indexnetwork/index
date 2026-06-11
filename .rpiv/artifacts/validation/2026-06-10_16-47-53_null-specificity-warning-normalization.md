---
date: 2026-06-10T16:47:53+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "Validation of Null specificity warning normalization"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-06-10_16-03-04_null-specificity-warning-normalization.md"
tags: [validation, plan, blueprint, intent, protocol, frontend, intent-proposal]
last_updated: 2026-06-10T16:47:53+0300
---

## Validation Report: Null Specificity Warning Normalization

### Implementation Status

- ✓ Phase 1: Protocol warning contract — Fully implemented
- ✓ Phase 2: Frontend card display guard — Fully implemented

### Automated Verification Results

- ✓ Protocol regression tests: `cd packages/protocol && bun test src/intent/tests/update-intent.spec.ts` — 13 pass, 0 fail (includes 2 new null-like regression cases)
- ✓ Protocol build: `cd packages/protocol && bun run build` — clean TypeScript compile, no errors
- ✓ Frontend component tests: `cd frontend && bun --bun vitest run src/components/chat/__tests__/IntentProposalCard.test.tsx` — 2 pass, 0 fail
- ✓ Frontend build: `cd frontend && bun run build` — clean Vite build in 4.91s, no errors
- ✓ No direct protocol passthrough: `grep "specificity_warning ?? null" packages/protocol/src/intent/intent.tools.ts` — no matches
- ✓ No direct frontend trim: `grep "card\.specificityWarning?.trim" frontend/src/components/chat/IntentProposalCard.tsx` — no matches
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- `packages/protocol/src/intent/intent.tools.ts:56` — `NULL_LIKE_SPECIFICITY_WARNING_VALUES` Set is file-private (no `export`), contains `"null"` and `"undefined"` exactly as planned
- `packages/protocol/src/intent/intent.tools.ts:58-62` — `normalizeSpecificityWarning(value: string | null | undefined): string | null` signature, trim, empty guard, and set membership check match plan specification exactly; file-private, not exported
- `packages/protocol/src/intent/intent.tools.ts:64-66` — `specificityWarningFor` delegates to `normalizeSpecificityWarning` with `?? DEFAULT_SPECIFICITY_WARNING` fallback, replacing the old trim+length check
- `packages/protocol/src/intent/intent.tools.ts:398` — non-broad proposal serialization uses `normalizeSpecificityWarning(v.verification?.specificity_warning)` instead of the old direct `?? null` passthrough
- `packages/protocol/src/intent/tests/update-intent.spec.ts:5` — `DEFAULT_SPECIFICITY_WARNING` imported from `../intent.specificity.js` as planned
- `packages/protocol/src/intent/tests/update-intent.spec.ts:138` — MCP broad null-like sentinel test: asserts `result.error` contains `DEFAULT_SPECIFICITY_WARNING`, does not match `/\bnull\b/i`, includes missing constraints
- `packages/protocol/src/intent/tests/update-intent.spec.ts:187` — web non-broad `" undefined "` test: asserts serialized proposal has `specificityWarning: null` and preserves `referentialBreadth` and `semanticEntropy`
- `packages/protocol/package.json` — version bumped `3.0.0 → 3.0.1` as planned
- `packages/protocol/src/intent/intent.graph.ts` — not in `git diff`; graph logging helper left unchanged as per developer-confirmed scope
- `frontend/src/components/chat/IntentProposalCard.tsx:52` — `NULL_LIKE_SPECIFICITY_WARNING_VALUES` Set placed before the component function, after `DEFAULT_SPECIFICITY_WARNING`; file-private, not exported
- `frontend/src/components/chat/IntentProposalCard.tsx:54-58` — `normalizeSpecificityWarning` helper identical logic to protocol counterpart; file-private
- `frontend/src/components/chat/IntentProposalCard.tsx:84` — `const specificityWarning = normalizeSpecificityWarning(card.specificityWarning)` replaces old `.trim()` call; `requiresManualApproval` and `displayWarning` derivations downstream are unchanged
- `frontend/src/components/chat/__tests__/IntentProposalCard.test.tsx` — new file; imports `render`/`screen` from `@testing-library/react`, `describe`/`it`/`expect`/`vi` from `vitest`; two test cases match plan specification
- `frontend/src/components/ChatContent.tsx`, `frontend/src/app/onboarding/page.tsx` — not in `git diff`; parsers untouched as required

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan.

### Manual Testing Required:

1. Protocol MCP path:
   - [ ] In a live MCP session, create an intent that produces a broad signal where the verifier emits `specificity_warning: " null "` — auto-approve rejection error must contain the default broad warning text, missing constraints, and no literal word `null`

2. Protocol web proposal path:
   - [ ] In a live chat session, create a non-broad intent where the verifier emits `specificity_warning: " undefined "` — the `intent_proposal` fenced JSON in the assistant message must have `"specificityWarning": null` while `referentialBreadth` and `semanticEntropy` remain populated

3. Frontend card rendering:
   - [ ] Render a card with `referentialBreadth: "narrow"` and `specificityWarning: " NuLl "` — no amber warning banner, no `Create anyway` button, countdown/create-now button visible
   - [ ] Render a card with `referentialBreadth: "broad"` and `specificityWarning: "undefined"` — default broad warning text in amber banner, `Create anyway` button visible, no literal `undefined` text
   - [ ] Approve, skip, and undo callbacks receive only `proposalId`, `description`, and optional `networkId` (no new arguments)

### Recommendations:

Ready to commit — implementation is complete and validated. Proceed with the two-commit plan: `fix(protocol)` for the protocol layer and `fix(frontend)` for the card guard.
