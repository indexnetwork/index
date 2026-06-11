---
date: 2026-06-10T16:03:04+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "Null specificity warning normalization"
tags: [plan, blueprint, intent, protocol, frontend, intent-proposal]
status: ready
parent: .rpiv/artifacts/research/2026-06-10_15-44-43_null-specificity-warning-research.md
phase_count: 2
phases:
  - { n: 1, title: Protocol warning contract }
  - { n: 2, title: Frontend card display guard }
unresolved_phase_count: 0
last_updated: 2026-06-10T16:03:04+0300
last_updated_by: Yankı Ekin Yüksel
---

# Null Specificity Warning Normalization Implementation Plan

## Overview
This plan fixes the intent proposal card bug where literal null-like strings such as `"null"` or `"undefined"` can appear as specificity warning text. The chosen architecture is a dual boundary guard: normalize verifier warning output in the protocol tool payload path and defensively normalize historical or malformed payloads in the shared frontend card before display/manual-approval decisions.

## Requirements
- Users must never see literal `null`, `undefined`, or case/whitespace variants of those values in the specificity warning banner.
- Broad proposals with no usable warning must still require manual approval and show the existing default broad-intent warning.
- Non-broad proposals with no usable warning must not show a warning and must keep the countdown auto-save path.
- Protocol output must stop serializing null-like warning strings in `intent_proposal` fenced JSON.
- MCP auto-approve broad rejection must reuse the cleaned warning fallback through the protocol tool helper.
- Existing approve, reject, undo, archive, parser, verifier, graph, and persistence contracts must remain unchanged.
- Verification must include focused protocol tool tests, focused frontend component tests, and targeted build/test commands.

## Current State Analysis
The verifier contract permits `specificity_warning: string | null`; a model-produced string `"null"` is schema-valid and reaches `VerifiedIntent` unchanged. The protocol tool serializer and frontend card both trim strings but only treat empty strings as absent, so null-like sentinel strings remain truthy. The shared card is rendered by both main chat and onboarding parse paths, making it the right frontend defensive boundary without parser rewrites.

### Key Discoveries
- `packages/protocol/src/intent/intent.verifier.ts:211-226` permits any string or actual null for `specificity_warning`.
- `packages/protocol/src/intent/intent.state.ts:13-15` carries verifier output directly on `VerifiedIntent`.
- `packages/protocol/src/intent/intent.tools.ts:56-58` trims warning copy and falls back only for empty/absent values.
- `packages/protocol/src/intent/intent.tools.ts:318-327` uses `specificityWarningFor()` in MCP broad rejection.
- `packages/protocol/src/intent/intent.tools.ts:379-397` serializes `specificityWarning` into the `intent_proposal` fenced JSON.
- `frontend/src/components/chat/IntentProposalCard.tsx:76-83` uses trimmed warning text for both manual approval gating and banner fallback.
- `frontend/src/components/chat/IntentProposalCard.tsx:272-323` renders the warning banner and chooses `Create anyway` vs countdown UI.
- `frontend/src/components/ChatContent.tsx:123-134` and `frontend/src/app/onboarding/page.tsx:99-105` parse `intent_proposal` blocks generically and pass card data unchanged.
- `packages/protocol/src/intent/tests/update-intent.spec.ts:25-44` already provides tool-capture and fenced proposal parsing helpers for targeted protocol tests.
- `frontend/src/components/DecisionQuestions/__tests__/QuestionCard.test.tsx:1-22` demonstrates Vitest + Testing Library component tests for prop-driven leaf components.

## Desired End State
Protocol proposal output normalizes warning copy before serialization:

```json
{
  "referentialBreadth": "moderate",
  "specificityWarning": null
}
```

Broad protocol output and MCP rejection preserve default warning fallback:

```text
This signal is broad and may produce many weak matches. Add a more concrete role, outcome, location, timeframe, domain, or specific need to get better recommendations.
```

Frontend cards render null-like warning payloads as absent:

```tsx
<IntentProposalCard
  card={{
    proposalId: "p1",
    description: "Find agent builders",
    referentialBreadth: "narrow",
    specificityWarning: " null ",
  }}
  currentStatus="pending"
  onApprove={approve}
/>
```

Expected UI: no amber warning banner with `null`, no `Create anyway` button for the non-broad card, and the normal countdown/create-now control remains available.

## What We're NOT Doing
- Not changing verifier prompts, Zod output schema, or structured LLM behavior.
- Not changing broadness scoring, referential-breadth classification, semantic entropy, or intent specificity policy.
- Not normalizing the graph-local logging helper in `packages/protocol/src/intent/intent.graph.ts:111-113`; developer scope chose the protocol tool helper only.
- Not rewriting `ChatContent` or onboarding fenced-block parsers.
- Not changing approve/reject/undo callback signatures or `/intents/confirm`, `/intents/reject`, archive, or proposal status persistence flows.
- Not redesigning proposal-card UX beyond removing null-like warning text and preserving existing fallback behavior.

## Decisions

### Dual boundary guard
The fix normalizes at both the protocol output boundary and the frontend render boundary. Protocol cleanup prevents new dirty payloads; frontend cleanup protects historical chat messages and any future malformed payloads that bypass protocol.

Evidence: `packages/protocol/src/intent/intent.tools.ts:391` serializes `specificityWarning`, while `frontend/src/components/chat/IntentProposalCard.tsx:76-83` decides banner text and manual approval from the parsed card data.

### Tool helper only for protocol normalization
Normalize `packages/protocol/src/intent/intent.tools.ts:56-58` and use that helper for broad warnings; also apply the same local normalizer to the non-broad proposal assignment. Do not change `packages/protocol/src/intent/intent.graph.ts:111-113` because that helper feeds broad-drop logging for non-propose graph runs and is outside the visible card bug.

Evidence: `packages/protocol/src/intent/intent.tools.ts:318-327` already routes MCP broad rejection through `specificityWarningFor()`, while `packages/protocol/src/intent/intent.graph.ts:319-325` is a separate logging/filtering path.

### Null-like string set
Treat actual `null`/`undefined`, empty/whitespace strings, and case-insensitive string values `"null"` and `"undefined"` as absent. Preserve all other trimmed warning strings exactly.

Evidence: `packages/protocol/src/intent/intent.verifier.ts:151-153` asks the model for null on non-broad cases, but `packages/protocol/src/intent/intent.verifier.ts:211-212` allows any string, including sentinel strings.

### Local helpers over shared utility
Use file-private `normalizeSpecificityWarning()` helpers in `intent.tools.ts` and `IntentProposalCard.tsx` rather than a shared exported utility. This keeps API surface unchanged and matches local boundary-helper precedent.

Evidence: `packages/protocol/src/intent/intent.tools.ts:19-20` has file-private `sanitizeJsonForCodeFence()`, and `frontend/src/components/ChatContent.tsx:83-89` / `frontend/src/app/onboarding/page.tsx:73-77` use local markdown normalization helpers.

### Preserve card behavior invariants
Normalize before computing `requiresManualApproval`, but apply the default warning only after manual approval is required. This prevents non-broad absent-warning cards from being converted into manual-approval cards.

Evidence: `frontend/src/components/chat/IntentProposalCard.tsx:76-83` controls both warning display and approval mode, and `frontend/src/components/chat/IntentProposalCard.tsx:85-92` prevents countdown when manual approval is required.

## Phase 1: Protocol warning contract

### Overview
This phase delivers the protocol-side boundary fix and protocol regression tests. It is the foundation phase and has no dependencies.

### Changes Required:

#### 1. packages/protocol/src/intent/intent.tools.ts:56-58,379-392
**File**: `packages/protocol/src/intent/intent.tools.ts`
**Changes**: MODIFY — add a local warning normalizer and use it in both broad fallback and non-broad proposal serialization.

```ts
const NULL_LIKE_SPECIFICITY_WARNING_VALUES = new Set(["null", "undefined"]);

function normalizeSpecificityWarning(value: string | null | undefined): string | null {
  const warning = value?.trim();
  if (!warning) return null;
  return NULL_LIKE_SPECIFICITY_WARNING_VALUES.has(warning.toLowerCase()) ? null : warning;
}

function specificityWarningFor(intent: VerifiedIntent): string {
  return normalizeSpecificityWarning(intent.verification?.specificity_warning) ?? DEFAULT_SPECIFICITY_WARNING;
}
```

```ts
specificityWarning: isBroad
  ? specificityWarningFor(v)
  : normalizeSpecificityWarning(v.verification?.specificity_warning),
```

#### 2. packages/protocol/src/intent/tests/update-intent.spec.ts
**File**: `packages/protocol/src/intent/tests/update-intent.spec.ts`
**Changes**: MODIFY — add focused regression tests for MCP broad fallback and web proposal null-like normalization.

```ts
import { DEFAULT_SPECIFICITY_WARNING } from "../intent.specificity.js";
```

```ts
test("uses default broad warning in MCP auto-approve mode when verifier emits a null-like string", async () => {
  let createCalls = 0;
  const tools = captureTools({
    userDb: {},
    systemDb: {},
    graphs: {
      profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
      intent: {
        invoke: async (input: { operationMode?: string }) => {
          if (input.operationMode === "propose") {
            return {
              verifiedIntents: [{
                description: "Meet creative people, builders, and makers interested in AI and somatic exploration",
                score: 82,
                verification: {
                  classification: "DIRECTIVE",
                  semantic_entropy: 0.42,
                  referential_breadth: "broad",
                  missing_selectional_constraints: ["role", "outcome", "timeframe"],
                  specificity_warning: " null ",
                },
              }],
              agentTimings: [],
              trace: [],
            };
          }
          createCalls++;
          return { executionResults: [{ success: true }], agentTimings: [] };
        },
      },
    },
  } as unknown as ToolDeps);
  const tool = tools.find((t) => t.name === "create_intent")!;

  const result = JSON.parse(await tool.handler({
    context: makeContext("alice"),
    query: {
      description: "Meet creative people, builders, and makers interested in AI and somatic exploration",
      autoApprove: true,
    },
  }));

  expect(result.success).toBe(false);
  expect(result.error).toContain(DEFAULT_SPECIFICITY_WARNING);
  expect(result.error).not.toMatch(/\bnull\b/i);
  expect(result.error).toContain("role, outcome, timeframe");
  expect(createCalls).toBe(0);
});

test("normalizes null-like specificity warnings in web proposal cards", async () => {
  const tools = captureTools({
    userDb: {},
    systemDb: {},
    graphs: {
      profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
      intent: {
        invoke: async () => ({
          verifiedIntents: [{
            description: "Find agent builders for TypeScript protocol tooling",
            score: 77,
            verification: {
              classification: "DIRECTIVE",
              semantic_entropy: 0.33,
              referential_breadth: "moderate",
              missing_selectional_constraints: [],
              specificity_warning: " undefined ",
            },
          }],
          agentTimings: [],
          trace: [],
        }),
      },
    },
  } as unknown as ToolDeps);
  const tool = tools.find((t) => t.name === "create_intent")!;
  const context = { ...makeContext("alice"), isMcp: false } as ResolvedToolContext;

  const result = JSON.parse(await tool.handler({
    context,
    query: {
      description: "Find agent builders for TypeScript protocol tooling",
      autoApprove: false,
    },
  }));

  expect(result.success).toBe(true);
  const proposal = extractFirstIntentProposal(result.data.message);
  expect(proposal.referentialBreadth).toBe("moderate");
  expect(proposal.specificityWarning).toBeNull();
  expect(proposal.semanticEntropy).toBe(0.33);
});
```

#### 3. packages/protocol/package.json
**File**: `packages/protocol/package.json`
**Changes**: MODIFY — bump the protocol package patch version because this phase changes the published package.

```json
"version": "3.0.1",
```

### Success Criteria:

#### Automated Verification:
- [x] Protocol focused regression tests pass: `cd packages/protocol && bun test src/intent/tests/update-intent.spec.ts`
- [x] Protocol package builds after the helper/type changes: `cd packages/protocol && bun run build`
- [x] Protocol serializer no longer directly passes non-broad warnings through unnormalized: old direct `v.verification?.specificity_warning ?? null` pattern removed; field now routed through `normalizeSpecificityWarning()`.
  - Note: `grep -n "specificityWarning:.*verification?.specificity_warning"` still matches line 398 because the field name appears inside the normalizer call — the old direct passthrough `v.verification?.specificity_warning ?? null` is gone (verified by `grep -n "specificity_warning ?? null"` returning no matches).

#### Manual Verification:
- [ ] MCP broad auto-approve rejection with verifier `specificity_warning: " null "` uses `DEFAULT_SPECIFICITY_WARNING`, includes missing constraints, and does not contain literal `null`.
- [ ] Web proposal JSON for a non-broad verifier `specificity_warning: " undefined "` contains `"specificityWarning": null` while preserving `referentialBreadth` and `semanticEntropy`.
- [ ] `packages/protocol/src/intent/intent.graph.ts` remains unchanged for this bug fix, preserving the developer-approved tool-helper-only scope.

## Phase 2: Frontend card display guard

### Overview
This phase delivers the frontend defensive guard in the shared card plus component tests. It depends on Phase 1 conceptually, but remains necessary for historical malformed proposal payloads.

### Changes Required:

#### 1. frontend/src/components/chat/IntentProposalCard.tsx:43-83
**File**: `frontend/src/components/chat/IntentProposalCard.tsx`
**Changes**: MODIFY — add a local warning normalizer and apply it before manual-approval/banner decisions.

```tsx
const NULL_LIKE_SPECIFICITY_WARNING_VALUES = new Set(["null", "undefined"]);

function normalizeSpecificityWarning(value: string | null | undefined): string | null {
  const warning = value?.trim();
  if (!warning) return null;
  return NULL_LIKE_SPECIFICITY_WARNING_VALUES.has(warning.toLowerCase()) ? null : warning;
}
```

```tsx
const specificityWarning = normalizeSpecificityWarning(card.specificityWarning);
const requiresManualApproval = Boolean(specificityWarning || card.referentialBreadth === "broad");
// When manual approval is required, always show a warning banner — fall back to
// the default if the backend sent a broad breadth without a specific message, so
// the disabled countdown is explained rather than looking stuck.
const displayWarning = requiresManualApproval
  ? specificityWarning || DEFAULT_SPECIFICITY_WARNING
  : undefined;
```

#### 2. frontend/src/components/chat/__tests__/IntentProposalCard.test.tsx
**File**: `frontend/src/components/chat/__tests__/IntentProposalCard.test.tsx`
**Changes**: NEW — add Vitest/Testing Library coverage for null-like warning payload behavior.

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import IntentProposalCard, { type IntentProposalData } from "../IntentProposalCard";

const baseCard: IntentProposalData = {
  proposalId: "proposal-1",
  description: "Find agent builders for TypeScript protocol tooling",
};

describe("IntentProposalCard", () => {
  it("treats null-like warning strings as absent for non-broad proposals", () => {
    render(
      <IntentProposalCard
        card={{
          ...baseCard,
          referentialBreadth: "narrow",
          specificityWarning: " NuLl ",
        }}
        currentStatus="pending"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.queryByText(/^null$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create anyway/i })).not.toBeInTheDocument();
    expect(screen.getByTitle("Create now")).toBeInTheDocument();
  });

  it("falls back to the default warning for broad proposals with null-like warning strings", () => {
    render(
      <IntentProposalCard
        card={{
          ...baseCard,
          referentialBreadth: "broad",
          specificityWarning: "undefined",
        }}
        currentStatus="pending"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.queryByText(/^undefined$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/This signal is broad and may produce many weak matches/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create anyway/i })).toBeInTheDocument();
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Frontend card component tests pass: `cd frontend && bun --bun vitest run src/components/chat/__tests__/IntentProposalCard.test.tsx`
- [x] Frontend build still passes after the component/test change: `cd frontend && bun run build`
- [x] Card no longer trims warning text directly without null-like normalization: `grep -n "card\.specificityWarning?.trim" frontend/src/components/chat/IntentProposalCard.tsx` returns no matches.
- [x] Full targeted bug regression passes across both layers: 13 protocol + 2 frontend = 15 tests, 0 failures.

#### Manual Verification:
- [ ] Non-broad card payload with `specificityWarning: " NuLl "` shows no warning banner and renders the normal create-now/countdown control instead of `Create anyway`.
- [ ] Broad card payload with `specificityWarning: "undefined"` shows the default broad warning and renders `Create anyway`.
- [ ] `ChatContent.tsx` and onboarding parser logic remain unchanged; historical malformed payloads are handled by the shared card.
- [ ] Approve, skip, and undo callbacks still receive only their existing arguments.

## Ordering Constraints
- Phase 1 should run before Phase 2 so the protocol no longer emits dirty warning payloads before frontend hardening is verified.
- Phase 2 is still independently valuable for historical messages already stored in chats.
- No phase should modify `intent.graph.ts`, `intent.verifier.ts`, `ChatContent.tsx`, onboarding parser logic, or approval/persistence callbacks.
- The terminal implementation should run both targeted protocol and frontend tests after both phases are applied.

## Verification Notes
- Run protocol focused tests: `cd packages/protocol && bun test src/intent/tests/update-intent.spec.ts`.
- Run frontend focused component tests: `cd frontend && bun --bun vitest run src/components/chat/__tests__/IntentProposalCard.test.tsx`.
- Run protocol build: `cd packages/protocol && bun run build`.
- Run frontend build or lint target: `cd frontend && bun run build` (or `bun run lint` if build is too slow in the implementation environment).
- Confirm no source code still serializes non-broad `specificityWarning` directly from `v.verification?.specificity_warning` without normalization.
- Confirm broad proposals with absent/null-like warning still display the default warning and `Create anyway`.
- Confirm non-broad proposals with null-like warning do not display a warning and do not require manual approval.
- Confirm approve/reject/undo callback payloads remain limited to existing `proposalId`, `description`, and optional `networkId` fields.

## Performance Considerations
The normalization is constant-time string trimming and set membership on tiny values. It runs only during proposal serialization or card render and has no database, network, embedding, or graph performance impact.

## Migration Notes
No database schema, data migration, queue migration, or persisted record shape changes are required. Existing stored chat messages may contain dirty `specificityWarning` values; Phase 2 intentionally handles them at render time for backwards compatibility.

## Pattern References
- `packages/protocol/src/intent/intent.tools.ts:19-20` — file-private protocol boundary helper (`sanitizeJsonForCodeFence`).
- `packages/protocol/src/intent/tests/update-intent.spec.ts:25-44` — existing pattern for capturing tools and parsing fenced `intent_proposal` JSON.
- `packages/protocol/src/intent/tests/update-intent.spec.ts:137-178` — existing broad proposal warning test to mirror for regression coverage.
- `frontend/src/components/chat/IntentProposalCard.tsx:76-83` — current card warning/manual approval decision point to preserve.
- `frontend/src/components/DecisionQuestions/__tests__/QuestionCard.test.tsx:1-22` — Vitest + Testing Library component test pattern for prop-driven leaf components.
- `frontend/src/components/ChatContent.tsx:83-89` and `frontend/src/app/onboarding/page.tsx:73-77` — local frontend helper precedent.

## Precedents & Lessons
- Broad warning behavior previously needed a follow-up fix when broad proposals required manual approval but lacked explanatory warning text; preserve default broad fallback.
- Intent proposal payloads have repeatedly needed generation-side and render-side normalization; use a dual guard rather than trusting one boundary.
- Auto-save proposal cards are sensitive to `requiresManualApproval`; avoid changing callback payloads, pending status handling, or countdown semantics.

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

**Q (blueprint Direction): About to follow the local boundary-helper pattern for normalization: `sanitizeJsonForCodeFence()` is file-private in `packages/protocol/src/intent/intent.tools.ts:19-20`, and `normalizeBlockquotes()` is file-private near chat render parsing in `frontend/src/components/ChatContent.tsx:83-89` / `frontend/src/app/onboarding/page.tsx:73-77`. Confirm that `normalizeSpecificityWarning()` should be local in `intent.tools.ts` and `IntentProposalCard.tsx`, rather than introducing a shared exported utility?**
A: Local helpers.

**Q (blueprint Design): Ready to proceed to decomposition with the dual-boundary local-helper design summary?**
A: Proceed.

**Q (blueprint Slices): 2 slices for null specificity warning normalization. Slice 1: Protocol warning contract (normalizer, protocol tests, protocol package patch bump). Slice 2: Frontend card display guard (card normalizer, component tests). Approve decomposition?**
A: Approve.

Step 8 code review unavailable; proceeded to developer review without artifact-code-reviewer findings.
Step 8 coverage review unavailable; proceeded to developer review without artifact-coverage-reviewer findings.

## Plan History
- Phase 1: Protocol warning contract — approved as generated
- Phase 2: Frontend card display guard — approved as generated

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

_Step 8 code review failed: artifact-code-reviewer completed without emitting findings or a no-findings table._
_Step 8 coverage review failed: artifact-coverage-reviewer completed without emitting findings or a no-findings table._

## References
- `.rpiv/artifacts/research/2026-06-10_15-44-43_null-specificity-warning-research.md`
- `.rpiv/artifacts/discover/2026-06-10_14-41-08_null-specificity-warning.md`
