---
date: 2026-06-10T15:44:43+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "Null specificity warning in intent proposal card"
tags: [research, codebase, intent, frontend, protocol, intent-proposal]
status: ready
last_updated: 2026-06-10T15:44:43+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: Null specificity warning in intent proposal card

## Research Question
How should the codebase fix the literal `null` text rendered in an intent proposal warning while keeping the change limited to `specificityWarning` payload/display handling, preserving broad-intent fallback warnings, and avoiding approval/skip/undo or persistence-flow changes?

## Summary
The visible `null` is explained by a string sentinel crossing the verifier-output → proposal JSON → card render seam. The verifier schema allows `specificity_warning` to be either any string or actual `null`, so a model-produced string `"null"` is structurally valid and is carried through `VerifiedIntent` unchanged (`packages/protocol/src/intent/intent.verifier.ts:211-226`, `packages/protocol/src/intent/intent.state.ts:13-15`). The protocol proposal builder serializes that value into `specificityWarning` at `packages/protocol/src/intent/intent.tools.ts:391`, and `sanitizeJsonForCodeFence()` only escapes backticks, not JSON values (`packages/protocol/src/intent/intent.tools.ts:19-20`). The shared frontend card then trims `card.specificityWarning`, treats any non-empty string as meaningful, displays it in the amber banner, and uses it to require manual approval (`frontend/src/components/chat/IntentProposalCard.tsx:76-83`, `frontend/src/components/chat/IntentProposalCard.tsx:272-275`).

## Detailed Findings

### Protocol proposal boundary
- `createIntentTools()` starts the create flow by invoking the intent graph in `operationMode: 'propose'`, then reads `result.verifiedIntents` for both web proposals and MCP auto-approve handling (`packages/protocol/src/intent/intent.tools.ts:262-273`).
- `specificityWarningFor()` currently only trims and tests length; actual `null`, actual `undefined`, empty string, and whitespace fall back to `DEFAULT_SPECIFICITY_WARNING`, but literal `"null"` and `"undefined"` remain non-empty strings (`packages/protocol/src/intent/intent.tools.ts:56-58`).
- The web proposal serializer assigns `specificityWarning` in the `data` object at the exact payload boundary: broad intents use `specificityWarningFor(v)`, while non-broad intents pass `v.verification?.specificity_warning ?? null` through directly (`packages/protocol/src/intent/intent.tools.ts:379-392`).
- `sanitizeJsonForCodeFence()` only replaces backticks before the JSON is wrapped in an `intent_proposal` fenced block, so it cannot correct semantic null-like values after `JSON.stringify(data)` (`packages/protocol/src/intent/intent.tools.ts:15-20`, `packages/protocol/src/intent/intent.tools.ts:393-397`).
- Developer checkpoint narrowed protocol scope to the tool helper: normalize `intent.tools.ts:56-58` so web proposal and MCP rejection share clean warning copy, but do not change the graph-local logging helper at `packages/protocol/src/intent/intent.graph.ts:111-113`.

### Verifier contract and graph behavior
- The verifier prompt asks the model to output `null` for non-broad cases, but this is prompt guidance rather than runtime normalization (`packages/protocol/src/intent/intent.verifier.ts:151-153`).
- The Zod schema is `z.string().nullable()`, which permits actual `null` and any string including `"null"`; parsing preserves that value (`packages/protocol/src/intent/intent.verifier.ts:211-212`, `packages/protocol/src/intent/intent.verifier.ts:266-267`).
- `SemanticVerifierOutput` is inferred directly from the schema, and `VerifiedIntent` embeds it as `verification?: SemanticVerifierOutput`, so TypeScript does not distinguish sentinel strings from meaningful warning text (`packages/protocol/src/intent/intent.verifier.ts:224-226`, `packages/protocol/src/intent/intent.state.ts:13-15`).
- The graph attaches `verification: verdict` unchanged when verification succeeds (`packages/protocol/src/intent/intent.graph.ts:335-340`).
- Non-propose graph runs drop broad intents before persistence and only use `getSpecificityWarning()` for warning metadata in logs; propose mode skips that broad-drop branch, allowing broad intents to become proposal cards (`packages/protocol/src/intent/intent.graph.ts:319-325`, `packages/protocol/src/intent/intent.graph.ts:396`).

### Frontend card display boundary
- `IntentProposalData` declares `referentialBreadth?: "narrow" | "moderate" | "broad" | null` and `specificityWarning?: string | null`, so the component expects nullable data but does not model string sentinels specially (`frontend/src/components/chat/IntentProposalCard.tsx:7-16`).
- The card computes `specificityWarning = card.specificityWarning?.trim()`, then `requiresManualApproval = Boolean(specificityWarning || card.referentialBreadth === "broad")` (`frontend/src/components/chat/IntentProposalCard.tsx:76-77`).
- `displayWarning` uses the trimmed warning if present, otherwise the frontend default warning only when manual approval is required (`frontend/src/components/chat/IntentProposalCard.tsx:49-50`, `frontend/src/components/chat/IntentProposalCard.tsx:81-83`).
- Consequences by payload shape: actual null/undefined/absent values already behave correctly; non-broad cards show no warning and broad cards fall back to the default. Literal `"null"` and `"undefined"` are truthy after trim, so they render as banner text and also force manual approval (`frontend/src/components/chat/IntentProposalCard.tsx:76-83`, `frontend/src/components/chat/IntentProposalCard.tsx:272-275`).
- The warning banner is display-only and suppressed once the proposal is rejected; it renders `{displayWarning}` inside the amber warning region (`frontend/src/components/chat/IntentProposalCard.tsx:272-276`).

### Main chat parser and historical malformed messages
- `ChatContent` parses assistant content with a fenced-block regex covering `opportunity`, `intent_proposal`, and `networks_panel` (`frontend/src/components/ChatContent.tsx:104-106`).
- For `intent_proposal`, `JSON.parse` is used and the object is accepted if it has a `proposalId` and either a string `description` or no `description`; then it is cast directly to `IntentProposalData` (`frontend/src/components/ChatContent.tsx:123-134`).
- The parser has no schema-level validation or coercion for `specificityWarning`; malformed-but-parseable historical messages therefore reach the shared card unchanged (`frontend/src/components/ChatContent.tsx:129-134`).
- `dedupeSegments()` only deduplicates by `proposalId` and does not mutate payload fields (`frontend/src/components/ChatContent.tsx:191-204`).
- `AssistantMessageContent()` parses/dedupes, then passes `card={segment.data}` directly into `IntentProposalCard`, making the card the correct defensive rendering boundary for historical malformed messages (`frontend/src/components/ChatContent.tsx:261-262`, `frontend/src/components/ChatContent.tsx:309-318`).

### Onboarding mirror path
- Onboarding duplicates a smaller parser for `opportunity` and `intent_proposal` blocks (`frontend/src/app/onboarding/page.tsx:86-88`).
- It accepts intent proposal blocks with only `data.proposalId` and casts directly to `IntentProposalData`, which is looser than main chat and still performs no `specificityWarning` coercion (`frontend/src/app/onboarding/page.tsx:99-105`).
- Onboarding dedupe also only tracks `proposalId` (`frontend/src/app/onboarding/page.tsx:145-157`).
- Onboarding converges on the same shared `IntentProposalCard` with `card={seg.data}`, so card-level normalization covers both main chat and onboarding without widening either parser contract (`frontend/src/app/onboarding/page.tsx:197`, `frontend/src/app/onboarding/page.tsx:238-249`).

### Card workflow and persistence invariants
- The card persistence callbacks are narrow: approval receives `proposalId`, `description`, and optional `networkId`; rejection and undo receive only `proposalId` (`frontend/src/components/chat/IntentProposalCard.tsx:19-24`).
- Manual approval disables countdown because the countdown-start effect returns early when `requiresManualApproval` is true (`frontend/src/components/chat/IntentProposalCard.tsx:85-92`).
- Auto-save approval and manual `Create anyway` call the same approval callback with the same arguments, so warning normalization must not alter persisted payloads (`frontend/src/components/chat/IntentProposalCard.tsx:112-124`, `frontend/src/components/chat/IntentProposalCard.tsx:146-163`).
- Skip and undo similarly call only `onReject(card.proposalId)` and `onUndo(card.proposalId)` (`frontend/src/components/chat/IntentProposalCard.tsx:126-144`, `frontend/src/components/chat/IntentProposalCard.tsx:165-178`).
- `ChatContent` persists approve/reject/archive through `/intents/confirm`, `/intents/reject`, and `/intents/${intentId}/archive`; none include warning fields (`frontend/src/components/ChatContent.tsx:860-898`).
- A key invariant: do not convert absent warning text into the default before computing `requiresManualApproval`, or non-broad proposals would incorrectly require manual approval and lose the countdown path (`frontend/src/components/chat/IntentProposalCard.tsx:76-83`, `frontend/src/components/chat/IntentProposalCard.tsx:281-323`).

### Existing targeted test seam
- Existing protocol tests already capture tools by calling `createIntentTools()` with stub dependencies, directly exercising the production proposal serializer (`packages/protocol/src/intent/tests/update-intent.spec.ts:25-35`).
- `extractFirstIntentProposal()` parses the `intent_proposal` fenced JSON exactly like the production contract requires (`packages/protocol/src/intent/tests/update-intent.spec.ts:39-42`).
- The existing broad warning test stubs a broad verified intent, invokes web-proposal mode (`isMcp: false`, `autoApprove: false`), parses the proposal, and asserts breadth, warning, constraints, and semantic entropy are preserved (`packages/protocol/src/intent/tests/update-intent.spec.ts:137-178`).
- The smallest protocol regression is a neighboring test with non-broad `referential_breadth` and `specificity_warning: "null"`, asserting parsed `proposal.specificityWarning` is `null` or at least not `"null"` while preserving adjacent fields (`packages/protocol/src/intent/tests/update-intent.spec.ts:39-44`, `packages/protocol/src/intent/intent.tools.ts:379-392`).

## Code References
- `packages/protocol/src/intent/intent.tools.ts:56-58` — Current protocol warning helper that trims and falls back but treats `"null"` as meaningful.
- `packages/protocol/src/intent/intent.tools.ts:262-273` — Create flow invokes intent graph in propose mode and reads `verifiedIntents`.
- `packages/protocol/src/intent/intent.tools.ts:318-327` — MCP auto-approve broad rejection uses `specificityWarningFor()`.
- `packages/protocol/src/intent/intent.tools.ts:379-397` — Web proposal block serializer maps `VerifiedIntent` to fenced `intent_proposal` JSON.
- `packages/protocol/src/intent/intent.tools.ts:19-20` — Code-fence sanitizer only escapes backticks.
- `packages/protocol/src/intent/intent.verifier.ts:151-153` — Prompt instruction says non-broad warnings should output null.
- `packages/protocol/src/intent/intent.verifier.ts:211-226` — `specificity_warning` schema and inferred type permit any string or actual null.
- `packages/protocol/src/intent/intent.verifier.ts:266-267` — Structured output is parsed but not semantically normalized.
- `packages/protocol/src/intent/intent.state.ts:13-15` — `VerifiedIntent` carries verifier output unchanged.
- `packages/protocol/src/intent/intent.graph.ts:111-113` — Separate graph-local warning fallback used for broad-drop logging.
- `packages/protocol/src/intent/intent.graph.ts:319-325` — Non-propose broad intents are dropped before persistence.
- `packages/protocol/src/intent/intent.graph.ts:335-340` — Successful verifier result is attached to the intent unchanged.
- `frontend/src/components/chat/IntentProposalCard.tsx:7-16` — Intent proposal card data shape.
- `frontend/src/components/chat/IntentProposalCard.tsx:49-50` — Frontend default warning copy mirrors protocol default.
- `frontend/src/components/chat/IntentProposalCard.tsx:76-83` — Display/manual-approval decision point for warning text.
- `frontend/src/components/chat/IntentProposalCard.tsx:85-92` — Manual approval prevents countdown auto-start.
- `frontend/src/components/chat/IntentProposalCard.tsx:112-178` — Approve, skip, and undo callbacks do not include warning fields.
- `frontend/src/components/chat/IntentProposalCard.tsx:272-323` — Warning banner plus `Create anyway` versus countdown button render.
- `frontend/src/components/ChatContent.tsx:104-145` — Main chat fenced-block parsing and direct cast to `IntentProposalData`.
- `frontend/src/components/ChatContent.tsx:191-204` — Main chat proposal dedupe by ID only.
- `frontend/src/components/ChatContent.tsx:309-318` — Main chat passes parsed proposal data unchanged into the card.
- `frontend/src/components/ChatContent.tsx:860-898` — Confirm, reject, and archive API callbacks.
- `frontend/src/app/onboarding/page.tsx:86-105` — Onboarding fenced-block parsing and direct cast to `IntentProposalData`.
- `frontend/src/app/onboarding/page.tsx:145-157` — Onboarding proposal dedupe by ID only.
- `frontend/src/app/onboarding/page.tsx:238-249` — Onboarding passes parsed proposal data unchanged into the shared card.
- `packages/protocol/src/intent/tests/update-intent.spec.ts:25-44` — Existing tool-capture and proposal-extraction test helpers.
- `packages/protocol/src/intent/tests/update-intent.spec.ts:137-178` — Existing broad proposal warning coverage.

## Integration Points

### Inbound References
- `frontend/src/components/ChatContent.tsx:309-318` — Main chat renders parsed `intent_proposal` segments as `IntentProposalCard` with callbacks and status map.
- `frontend/src/app/onboarding/page.tsx:238-249` — Onboarding renders parsed `intent_proposal` segments as the same shared `IntentProposalCard`.
- `packages/protocol/src/intent/tests/update-intent.spec.ts:25-35` — Test harness calls `createIntentTools()` directly.

### Outbound Dependencies
- `packages/protocol/src/intent/intent.tools.ts:3-4` — Tool code depends on `VerifiedIntent` and `DEFAULT_SPECIFICITY_WARNING`.
- `packages/protocol/src/intent/intent.tools.ts:11` — Tool code invokes graph/model through `invokeWithAbortSignal`.
- `packages/protocol/src/intent/intent.graph.ts:3-5` — Intent graph depends on the inferrer, verifier, and default warning constant.
- `frontend/src/components/chat/IntentProposalCard.tsx:1-4` — Card depends on React state/effects, icon components, and `cn` utility.
- `frontend/src/components/ChatContent.tsx:870` — Approval callback depends on API client `POST /intents/confirm`.
- `frontend/src/components/ChatContent.tsx:886` — Reject callback depends on API client `POST /intents/reject`.
- `frontend/src/components/ChatContent.tsx:862` — Undo/archive callback depends on API client `PATCH /intents/${intentId}/archive`.

### Infrastructure Wiring
- `packages/protocol/src/intent/intent.tools.ts:61` — `createIntentTools()` registers intent tool handlers through injected `defineTool` and `ToolDeps`.
- `packages/protocol/src/intent/intent.tools.ts:262-273` — The `create_intent` tool wires profile/user context into the intent graph propose call.
- `frontend/src/components/ChatContent.tsx:261-262` — Main chat wiring normalizes markdown, parses blocks, dedupes, and renders segments.
- `frontend/src/app/onboarding/page.tsx:197` — Onboarding wiring follows the same parse/dedupe/render pattern.

## Architecture Insights
- The correct deterministic protocol boundary is `intent.tools.ts`, not `intent.verifier.ts`: the verifier schema intentionally remains broad enough for structured LLM output, and the bug is a semantic sentinel leaking into a user-facing proposal field (`packages/protocol/src/intent/intent.verifier.ts:211-226`, `packages/protocol/src/intent/intent.tools.ts:391`).
- The protocol helper should normalize before fallback selection, so `"null"` and `"undefined"` behave like absent text for both web proposal serialization and MCP broad rejection (`packages/protocol/src/intent/intent.tools.ts:56-58`, `packages/protocol/src/intent/intent.tools.ts:318-327`).
- The graph-local helper is a similar shape but currently logging/filtering-only for non-propose broad drops; developer scope explicitly excludes changing it for this card bug (`packages/protocol/src/intent/intent.graph.ts:111-113`, `packages/protocol/src/intent/intent.graph.ts:319-325`).
- Frontend parser functions are generic fenced-block extractors, not schema normalizers. Since both main chat and onboarding cast and pass the data unchanged, the shared card is the right defensive normalization point (`frontend/src/components/ChatContent.tsx:123-134`, `frontend/src/app/onboarding/page.tsx:99-105`, `frontend/src/components/chat/IntentProposalCard.tsx:76-83`).
- Warning normalization affects behavior, not only text: sentinel strings currently set `requiresManualApproval`, disabling countdown and showing `Create anyway`. Normalization must run before that boolean is computed (`frontend/src/components/chat/IntentProposalCard.tsx:76-92`, `frontend/src/components/chat/IntentProposalCard.tsx:281-323`).
- Do not set the default warning as the normalized warning for absent non-broad payloads; fallback belongs after `requiresManualApproval` is true, or countdown behavior changes for non-broad proposals (`frontend/src/components/chat/IntentProposalCard.tsx:76-83`).

## Precedents & Lessons
3 similar past changes analyzed.

### Precedent: Broad intent proposal warnings and manual approval
**Commit(s)**: `1a9416b6c5` — "fix(protocol): guard broad attributive intents" (2026-06-05)
**Blast radius**: 9 files across 3 layers
  protocol/intent/ — verifier/tools/graph/specificity emitted breadth and warning metadata
  frontend/ — `IntentProposalCard` displayed warning UI and disabled autosave for broad proposals
  tests/deps/ — protocol tests and package metadata changed

**Follow-up fixes**:
- `09bb565252` — "fix(frontend): show default specificity warning when broad signal lacks a message" (2026-06-06) — broad proposal could require manual approval but show no explanatory warning
- `f824e46569` — "fix(protocol): humanize missing-constraint hint in broad-intent rejection" (2026-06-06) — backend rejection copy needed clearer user-facing wording

**Lessons from docs**:
- `.rpiv/artifacts/discover/2026-06-10_14-41-08_null-specificity-warning.md` — preserve broad-intent default warning while normalizing null-like values at protocol and UI boundaries.

**Takeaway**: Warning text and breadth/manual-approval state are separate contract fields; fixes must preserve their existing relationship.

### Precedent: Intent proposal card parsing and malformed payload resilience
**Commit(s)**: `7c4d62fd01` — "feat: add IntentProposalCard component" (2026-02-24); `c4838f86d3` — "feat: parse and render intent_proposal code blocks in chat" (2026-02-24)
**Blast radius**: 2 files across 1 layer
  frontend/ — introduced the card component and chat fenced JSON parsing/rendering

**Follow-up fixes**:
- `8fd8f31b75` — "fix: improve ChatContent intent proposal parsing robustness" (2026-02-24) — parser needed hardening for proposal blocks
- `9f0d853d87` — "fix: improve IntentProposalCard quality" (2026-02-24) — card UX/data presentation needed immediate polish
- `71e66644b1` — "fix: sanitize JSON in intent proposal code fences" (2026-02-24) — protocol-emitted fenced JSON needed sanitization
- `b804c6d319` — "fix(chat): normalize intent proposal confidence display for 0-1 and 0-100" (2026-02-26) — frontend needed defensive normalization for inconsistent numeric payloads
- `f9c0e6d4cc` — "fix(chat): require create_intent tool for intent proposals, add fallback for broken blocks" (2026-02-26) — chat needed fallback behavior for broken proposal blocks

**Lessons from docs**:
- `.rpiv/artifacts/discover/2026-06-10_14-41-08_null-specificity-warning.md` — card data is rendered from fenced `intent_proposal` JSON, not from the confirm response; malformed historical chat messages must be handled defensively.

**Takeaway**: Intent proposal payloads have repeatedly needed render-side normalization in addition to generation-side cleanup.

### Precedent: Auto-save proposal card workflow
**Commit(s)**: `35d52a0f94` — "Add auto-save intent proposal card & toasts" (2026-03-04)
**Blast radius**: 4 files across 1 layer
  frontend/ — card autosave, `ChatContent` state wiring, dev page, and toast context

**Follow-up fixes**:
- `6aea579fe6` — "fix(chat): prevent countdown until proposal status is resolved" (2026-03-06) — countdown could start before status was known
- `75416ea9f9` — "fix(chat): track failed action for correct retry behavior, remove unsafe pending fallback" (2026-03-06) — retry/pending state was unsafe after failed action
- `eb66d4d92a` — "fix(intent): return intent record from proposal status endpoint" (2026-03-06) — status endpoint lacked data needed by frontend
- `16dfdefa16` — "fix(intent): return archived status in proposal status check" (2026-03-06) — archived state was not represented correctly

**Lessons from docs**:
- `.rpiv/artifacts/discover/2026-06-10_14-41-08_null-specificity-warning.md` — approval, skip, undo, and persistence flow are explicitly out of scope.

**Takeaway**: Display-only card changes can still affect autosave/manual-approval flow, so keep callback payloads and status handling unchanged.

### Composite Lessons
- Normalize malformed proposal fields at both protocol output and frontend rendering; prior fixes (`71e66644b1`, `b804c6d319`, `f9c0e6d4cc`) show proposal JSON is not reliably well-formed.
- Keep specificity-warning fixes separate from breadth classification and autosave/manual-approval behavior; prior fixes (`09bb565252`, `6aea579fe6`, `75416ea9f9`) show small changes here can regress visible flow.
- Add focused regression tests around null-like strings, absent warning text, and broad fallback rather than relying on broad suite coverage.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-06-10_14-41-08_null-specificity-warning.md` — FRD for the null specificity warning bug.

## Developer Context
**Q (discover: Bug cause): From the probe I inferred that the literal `null` most likely comes from the proposal payload carrying `specificityWarning: "null"`, which the card renders as truthy text (`packages/protocol/src/intent/intent.tools.ts:391`, `frontend/src/components/chat/IntentProposalCard.tsx:76-82`). Should the FRD keep that as the bug cause to investigate/fix?**
A: Confirm cause.

**Q (discover: Success goal): What should success look like for this `null` warning bug?**
A: No literal null.

**Q (discover: Fix shape): Which fix shape should the FRD recommend for the `specificityWarning` contract?**
A: Dual guard.

**Q (discover: Verification bar): What verification bar should the FRD require for the fix?**
A: Unit + targeted build.

**Q (discover: Non-goals): What should stay out of scope for this bug fix?**
A: Only display contract.

**Q (discover: Malformed values): Which malformed warning values should be treated as absent?**
A: Null-like strings.

**Q (`packages/protocol/src/intent/intent.tools.ts:56-58`, `packages/protocol/src/intent/intent.tools.ts:318-326`, `packages/protocol/src/intent/intent.graph.ts:111-113`): `intent.tools.ts` also feeds MCP auto-approve broad rejection, while `intent.graph.ts` has a separate graph logging fallback. Should the research scope include normalizing those non-card warning paths too?**
A: Tool helper only — normalize `intent.tools.ts:56-58` so web proposal and MCP rejection share clean warning copy; leave graph logging-only helper unchanged.

## Related Research
- None.

## Open Questions
None.
