---
date: 2026-06-10T14:41:08+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "Null specificity warning in intent proposal card"
tags: [intent, frd, frontend, protocol, intent-proposal]
status: ready
last_updated: 2026-06-10T14:41:08+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: Null specificity warning in intent proposal card

## Summary
Fix the intent proposal card so operators and users never see a literal `null` warning below a proposed intent. The likely cause is a malformed proposal payload carrying the string `"null"` for `specificityWarning`, which the current frontend treats as real warning copy and renders under the proposed intent.

## Problem & Intent
Operator: the screen shows `null` under a proposed intent, and the operator needs to understand whether this indicates backend/runtime data leaking into the UI and what should be fixed so users do not see it.

Input screenshot shows a proposed intent, “Meet up with people in Istanbul for drinks and socializing.”, with an amber warning banner whose text is literally `null`.

## Goals
- Users never see literal `null` in the proposed-intent warning area.
- Broad proposals continue to show a useful default or backend-supplied specificity warning.
- Non-broad proposals with absent warning copy show no warning banner unless existing breadth rules require one.
- The protocol proposal payload and frontend card both treat null-like sentinel strings as absent warning text.

## Non-Goals
- Do not redesign intent specificity, broadness scoring, or proposal-card UX.
- Do not rewrite the verifier’s speech-act or referential-breadth classification behavior as part of this bug fix.
- Do not change the approval, skip, undo, or persistence flow for intent proposals.

## Functional Requirements
1. The system SHALL normalize `specificityWarning` values so actual `null`/`undefined` and null-like string sentinels such as `"null"` and `"undefined"` are treated as absent warning text.
2. The protocol proposal path SHALL avoid emitting `specificityWarning: "null"` in `intent_proposal` JSON blocks.
3. The frontend intent proposal card SHALL defensively avoid rendering null-like warning strings if they appear in existing or malformed proposal messages.
4. The existing broad-intent behavior SHALL be preserved: broad proposals with absent warning text still display the default specificity warning.
5. Non-broad proposals with absent/null-like warning text SHALL not display a warning banner solely because the malformed string was present.

## Non-Functional Requirements
- **Performance**: Normalization must be constant-time string handling with no network calls or additional graph/model invocations.
- **Security**: No new auth or data-access behavior; this is display/payload normalization only.
- **UX / Accessibility**: Warning banners should contain meaningful copy only; existing icon, contrast, and card interaction behavior should remain unchanged.
- **Reliability**: The UI must be resilient to historical or malformed chat messages even after the protocol output is corrected.

## Constraints & Assumptions
- The intent proposal card is rendered from fenced `intent_proposal` JSON parsed by chat content code, not from the `/intents/confirm` response.
- The verifier schema allows `specificity_warning` to be either a string or null, so a model-produced string `"null"` can pass schema validation unless normalized.
- The fix should be narrow and target the display contract rather than changing intent classification semantics.
- Targeted tests are preferred over broad full-suite runs.

## Acceptance Criteria
- [ ] A focused protocol test or equivalent targeted check proves that an intent proposal with verifier output `specificity_warning: "null"` does not serialize `specificityWarning: "null"` in the emitted `intent_proposal` block.
- [ ] A focused frontend test or component-level check proves that `specificityWarning: "null"` and `specificityWarning: "undefined"` do not render literal text in `IntentProposalCard`.
- [ ] A focused frontend test or component-level check proves that a broad proposal with absent/null-like warning text renders the existing default specificity warning.
- [ ] Running the targeted affected test commands exits 0; if exact test files do not already exist, add the smallest focused tests and run those files directly.
- [ ] Manual verification with a proposal matching the screenshot behavior shows either a useful warning or no warning, never literal `null`.

## Recommended Approach
Add a small shared-style normalization helper at the protocol proposal boundary and a mirrored defensive normalization in `IntentProposalCard`. Keep the change limited to `specificityWarning` payload/display handling so the verifier, broadness scoring, and card workflow remain unchanged.

## Decisions

### Bug cause
**Question**: From the probe I inferred that the literal `null` most likely comes from the proposal payload carrying `specificityWarning: "null"`, which the card renders as truthy text (`packages/protocol/src/intent/intent.tools.ts:391`, `frontend/src/components/chat/IntentProposalCard.tsx:76-82`). Should the FRD keep that as the bug cause to investigate/fix?
**Recommended**: Confirm cause — record the likely cause as model/protocol output stringifying null, then require a guard so users never see literal `null`.
**Chosen**: Confirm cause.
**Rationale**: evidence: `packages/protocol/src/intent/intent.tools.ts:391` passes non-broad verifier warning through; `frontend/src/components/chat/IntentProposalCard.tsx:76-82` trims and treats any non-empty string as displayable warning; confirmed by developer.

### Success goal
**Question**: What should success look like for this `null` warning bug?
**Recommended**: No literal null — users never see literal `null`; broad proposals show a useful warning and non-broad proposals show no warning, matching existing card behavior.
**Chosen**: No literal null.
**Rationale**: Preserves existing UX while removing the operator-visible malformed warning.

### Fix shape
**Question**: Which fix shape should the FRD recommend for the `specificityWarning` contract?
**Recommended**: Dual guard — normalize at protocol output and UI rendering.
**Chosen**: Dual guard.
**Rationale**: Optimizes robust user protection: clean future payloads plus resilience to historical or malformed messages.

### Verification bar
**Question**: What verification bar should the FRD require for the fix?
**Recommended**: Unit + targeted build — add/update focused tests for warning normalization and run targeted frontend/protocol checks.
**Chosen**: Unit + targeted build.
**Rationale**: Provides regression coverage without paying the cost of unrelated full-suite runs.

### Non-goals
**Question**: What should stay out of scope for this bug fix?
**Recommended**: Only display contract — do not redesign intent specificity, broadness scoring, or card UX; only prevent invalid/null warning text from leaking to users.
**Chosen**: Only display contract.
**Rationale**: Keeps the fix narrowly tied to the observed `null` leakage.

### Malformed values
**Question**: Which malformed warning values should be treated as absent?
**Recommended**: Null-like strings — treat actual null/undefined plus case-insensitive string sentinels like `"null"` and `"undefined"` as absent.
**Chosen**: Null-like strings.
**Rationale**: Covers the observed failure and adjacent sentinel values with low behavior-change risk.

## Open Questions
None.

## Suggested Follow-ups
- If malformed verifier output continues beyond `specificity_warning`, consider tightening the verifier prompt/schema or adding broader structured-output normalization near `packages/protocol/src/intent/intent.verifier.ts:151-153` and `packages/protocol/src/intent/intent.verifier.ts:211-212`.

## References
- Screenshot: `/var/folders/k4/95z4symn45lgskrlkvx5bprh0000gp/T/pi-clipboard-1507fa24-74ed-42b8-aa65-ed22f69d7430.png`
- `frontend/src/components/chat/IntentProposalCard.tsx:76-82`
- `frontend/src/components/chat/IntentProposalCard.tsx:272-275`
- `packages/protocol/src/intent/intent.tools.ts:56-58`
- `packages/protocol/src/intent/intent.tools.ts:382-397`
- `packages/protocol/src/intent/intent.verifier.ts:151-153`
- `packages/protocol/src/intent/intent.verifier.ts:211-212`
- `frontend/src/components/ChatContent.tsx:123-134`
