# Discovery question integration — Slice 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `ChatSummaryReader` (Slice 1) and `QuestionGenerator` (Slice 2) into `runDiscoverFromQuery` so chat-driven discovery emits 0–3 `decisionQuestions` on the `done` event of the chat stream, gated by `ENABLE_DISCOVERY_QUESTIONS=true` and the orchestrator trigger.

**Architecture:** The opportunity graph's negotiate node accumulates a structured `discoveryNegotiations` list as each candidate resolves, by extending the existing `OnNegotiationResolved` hook to carry `turns` + `outcome`. `runDiscoverFromQuery` reads that data, fetches the chat-session digest via the protocol's `ChatSummaryReader`, builds a `DiscoveryQuestionInput`, calls `QuestionGeneratorReader.generate(...)`, and stashes the resulting `Question[]` on its return value. The `discover_opportunities` tool surfaces `questions` on its `success({...})` envelope; `ChatAgent` harvests it and forwards a typed `decision_questions` stream event to the SSE controller, which adds the field to the `done` event for Slice 4 to render.

**Tech Stack:** Bun, TypeScript, LangChain/LangGraph, Zod, Drizzle (no schema changes — Slice 1 covered persistence), bun:test.

---

## File map

**New files (protocol):**

- `packages/protocol/src/shared/interfaces/question-generator.interface.ts` — `QuestionGeneratorReader` interface, mirrors `ChatSummaryReader`.
- `packages/protocol/src/opportunity/discovery-question.helper.ts` — pure `buildDiscoveryQuestionInput()` mapper from graph state → `DiscoveryQuestionInput`.
- `packages/protocol/src/opportunity/negotiation-summary.builder.ts` — pure `toDiscoveryNegotiation()` + `buildDiscoverySummary()` helpers.
- `packages/protocol/src/opportunity/tests/discovery-question.helper.spec.ts`
- `packages/protocol/src/opportunity/tests/negotiation-summary.builder.spec.ts`
- `packages/protocol/src/opportunity/tests/opportunity.discover.questions.spec.ts`
- `packages/protocol/src/chat/tests/chat.streamer.decisionQuestions.spec.ts`

**New files (backend):**

- `backend/src/services/question-generator.service.ts` — lazy service wrapping `QuestionGenerator`, mirrors `ChatSummaryService`.
- `backend/src/services/tests/question-generator.service.spec.ts`

**Modified files (protocol):**

- `packages/protocol/src/opportunity/opportunity.state.ts` — add `discoveryNegotiations` + `discoverySummary` annotations.
- `packages/protocol/src/negotiation/negotiation.graph.ts` — extend `OnNegotiationResolved` payload with `turns` + `outcome`.
- `packages/protocol/src/opportunity/opportunity.graph.ts` — `negotiateNode`: capture per-candidate data via the extended hook; emit on state.
- `packages/protocol/src/opportunity/opportunity.discover.ts` — extend `DiscoverInput` with `chatSummary?`, `questionGenerator?`, `enableQuestions?`; integrate after graph returns; populate `questions` + `_discoveryQuestionsDebug` on `DiscoverResult`.
- `packages/protocol/src/opportunity/opportunity.tools.ts` — pass new deps + flag; surface `questions` on orchestrator-path `success({...})`.
- `packages/protocol/src/shared/agent/tool.helpers.ts` — add `questionGenerator?: QuestionGeneratorReader` slot to `ToolContext`/`ToolDeps`.
- `packages/protocol/src/chat/chat-streaming.types.ts` — add `chat_summarizer_start/end`, `question_generator_start/end`, `decision_questions` event types + creators; extend `DebugMetaEvent` with `discoveryQuestions?`; extend `DoneEvent` + `CreateDoneEventOptions` with `decisionQuestions?: Question[]`.
- `packages/protocol/src/chat/chat.agent.ts` — extract `questions` + `_discoveryQuestionsDebug` from `discover_opportunities` results; forward to debugMeta and via writer as `decision_questions` event.
- `packages/protocol/src/chat/chat.streamer.ts` — relay `decision_questions` writer events as typed stream events.
- `packages/protocol/src/chat/chat.prompt.modules.ts` — append decisionQuestions guidance line to `discoveryModule`.
- `packages/protocol/src/index.ts` — export `QuestionGeneratorReader`.

**Modified files (backend):**

- `backend/src/controllers/mcp.controller.ts` — instantiate `QuestionGeneratorService`; add to `protocolDeps`.
- `backend/src/controllers/chat.controller.ts` — capture `decision_questions` SSE events from the stream; surface on `done` event.
- `backend/src/types/chat-streaming.types.ts` — keep aligned with protocol counterpart (file is a backend copy).

---

## Shipped deviations (post-merge)

This plan was the implementation blueprint, but the shipped code diverges from
several snippets after multiple Copilot review rounds. The implementation
(merged via PR #781) is canonical; treat the plan as historical context, not
a re-implementation guide. Material deviations:

- **Strip behavior** (`chat.agent.ts` `normalizeToolResult`): the shipped code
  strips only `_discoveryQuestionsDebug` from the LLM-facing tool result;
  `questions` is kept visible so the agent can mention decision prompts per
  the prompt addendum. The plan snippet showing `delete obj.questions` is
  obsolete.
- **`ChatSummarizerEndEvent` payload**: simplified to `{ durationMs }` only.
  The plan's `{ newMessageCount, model, fromCached, durationMs }` shape was
  fabricated (the `ChatSummaryReader` contract doesn't expose those signals).
- **`QuestionGeneratorEndEvent` / `DebugMetaDiscoveryQuestions`**:
  `droppedCount` was removed — the generator doesn't expose a reliable
  guardrail-drop count, so reporting `0` was misleading.
- **`maybeBuildQuestions` failure tolerance**: the generator call is wrapped
  in `try/catch`; failures suppress questions but return cleanly. The plan
  snippet showing a bare `await questionGenerator.generate(...)` is obsolete.
- **`maybeBuildQuestions` position**: the call was hoisted above the three
  early-return paths in `runDiscoverFromQuery` (no-opps + existing connections,
  no-opps + nothing, createIntentSuggested) so questions are produced even
  when discovery finds zero candidates — the master spec's primary use case.
- **`tool.factory.ts` deps forwarding**: composition root deps `chatSummary`
  and `questionGenerator` are now spread into `toolDeps` (plan omitted this).
- **`opportunity.tools.ts` orchestrator-path success envelope**:
  `questions` + `_discoveryQuestionsDebug` are surfaced on ALL `success(...)`
  branches that return after a successful `runDiscoverFromQuery` (including
  the no-results envelopes), not just the happy path.
- **`OnNegotiationResolved` payload**: widened with `turns` + `outcome`;
  `negotiateNode` now uses an unconditional hook with the orchestrator
  streaming work gated by an early-return on non-orchestrator triggers.
- **Hallucination-recovery path**: also captures `discoveryQuestionsDebug`
  and emits `decision_questions` writer events (mirror of the main tool loop).
- **Trace-event sessionId**: `maybeBuildQuestions` emits with an empty-string
  `sessionId`; the streamer re-stamps the real session id at relay time.
- **`counterpartyHint`**: bio is trimmed before fallback; empty bios fall
  through to `interests.join(", ")` (the plan's bare `??` chain treated `""`
  as valid bio).

See PR #781 for the full commit trail.

---

## Task 1: Extend negotiation hook payload

**Files:**
- Modify: `packages/protocol/src/negotiation/negotiation.graph.ts` (lines 378–520)

**Why:** The existing `OnNegotiationResolved` hook fires per-candidate inside `negotiateCandidates` but only carries `{ candidate, accepted }`. The negotiate node needs the full turn list and outcome for `DiscoveryNegotiation` construction. The inner map scope already has both — pass them through.

- [ ] **Step 1.1: Write the failing test**

Create `packages/protocol/src/negotiation/tests/negotiation.graph.on-resolved-payload.spec.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.test" });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key";

import { describe, it, expect } from "bun:test";
import { negotiateCandidates, type NegotiationCandidate } from "../negotiation.graph.js";
import type { NegotiationGraphLike } from "../negotiation.state.js";

const sourceUser = {
  id: "source-1",
  intentDescription: "looking for design partner",
  profile: { name: "Source", bio: "founder", interests: [] },
};

const candidate: NegotiationCandidate = {
  userId: "cand-1",
  reasoning: "complementary expertise",
  valencyRole: "Peer",
  networkId: "net-1",
  candidateUser: {
    id: "cand-1",
    intentDescription: "looking for technical co-founder",
    profile: { name: "Cand", bio: "designer", interests: [] },
  },
};

const fakeGraph: NegotiationGraphLike = {
  invoke: async () => ({
    outcome: {
      hasOpportunity: true,
      agreedRoles: [
        { userId: "source-1", role: "peer" },
        { userId: "cand-1", role: "peer" },
      ],
      reasoning: "shipped",
      turnCount: 2,
    },
    messages: [
      {
        id: "m1",
        senderId: "agent:source-1",
        role: "agent",
        parts: [{ kind: "data", data: { action: "propose", assessment: { reasoning: "lets pair", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } }],
        createdAt: new Date(),
      },
      {
        id: "m2",
        senderId: "agent:cand-1",
        role: "agent",
        parts: [{ kind: "data", data: { action: "accept", assessment: { reasoning: "agreed", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } }],
        createdAt: new Date(),
      },
    ],
  }),
};

describe("negotiateCandidates onCandidateResolved payload", () => {
  it("passes turns and outcome to the hook for accepted candidates", async () => {
    const seen: Array<{ accepted: boolean; turns: number; hasOpportunity: boolean }> = [];
    await negotiateCandidates(
      fakeGraph,
      sourceUser,
      [candidate],
      { networkId: "", prompt: "" },
      {
        onCandidateResolved: async ({ accepted, turns, outcome }) => {
          seen.push({
            accepted: accepted !== null,
            turns: turns.length,
            hasOpportunity: outcome.hasOpportunity,
          });
        },
      },
    );
    expect(seen).toEqual([{ accepted: true, turns: 2, hasOpportunity: true }]);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/negotiation/tests/negotiation.graph.on-resolved-payload.spec.ts`
Expected: FAIL with TypeScript error about `turns`/`outcome` not on the hook payload type.

- [ ] **Step 1.3: Extend the `OnNegotiationResolved` type and pass through**

Edit `packages/protocol/src/negotiation/negotiation.graph.ts`. Replace the existing type and the call sites:

Replace lines 378–388 (the `OnNegotiationResolved` definition) with:

```ts
/**
 * Per-candidate resolution hook — fires as each negotiation settles, before
 * Promise.all aggregates. Used by the orchestrator branch to progressively
 * stream `opportunity_draft_ready` events as each candidate resolves, rather
 * than emitting all at once after the full fan-out completes. Awaited so the
 * caller can run async work (DB update, event emit) before the next settle.
 *
 * `turns` and `outcome` are passed through from the underlying negotiation
 * graph so consumers can build per-candidate decision-question inputs without
 * re-walking trace events or DB artifacts. Both are present on every
 * resolution (accepted, rejected, stalled, error); error paths receive a
 * synthesized `outcome` with `hasOpportunity: false`.
 */
export type OnNegotiationResolved = (entry: {
  candidate: NegotiationCandidate;
  accepted: NegotiationResult | null;
  turns: NegotiationTurn[];
  outcome: NegotiationOutcome;
}) => Promise<void>;
```

Add the import near the top of the file (alongside existing imports):

```ts
import type { NegotiationTurn, NegotiationOutcome } from "./negotiation.state.js";
```

In the success branch around line 488–500, replace the existing hook call site:

```ts
        if (onCandidateResolved) {
          try {
            await onCandidateResolved({ candidate, accepted });
          } catch (hookErr) {
            logger.error("[negotiateCandidates] onCandidateResolved hook threw", {
              candidateUserId: candidate.userId,
              error: hookErr,
            });
          }
        }
```

with:

```ts
        if (onCandidateResolved) {
          const turnHistory: NegotiationTurn[] = (result.messages ?? [])
            .map((m) => {
              const dataPart = (m.parts as Array<{ kind?: string; data?: unknown }>)?.find(
                (p) => p.kind === "data",
              );
              return dataPart?.data as NegotiationTurn | undefined;
            })
            .filter((t): t is NegotiationTurn => !!t);
          const resolvedOutcome: NegotiationOutcome = result.outcome ?? {
            hasOpportunity: false,
            agreedRoles: [],
            reasoning: "no outcome returned by negotiation graph",
            turnCount: turnHistory.length,
          };
          try {
            await onCandidateResolved({
              candidate,
              accepted,
              turns: turnHistory,
              outcome: resolvedOutcome,
            });
          } catch (hookErr) {
            logger.error("[negotiateCandidates] onCandidateResolved hook threw", {
              candidateUserId: candidate.userId,
              error: hookErr,
            });
          }
        }
```

In the error branch around line 515–522, replace:

```ts
        if (onCandidateResolved) {
          try {
            await onCandidateResolved({ candidate, accepted: null });
          } catch {
            // ignore hook failure on error path
          }
        }
```

with:

```ts
        if (onCandidateResolved) {
          try {
            await onCandidateResolved({
              candidate,
              accepted: null,
              turns: [],
              outcome: {
                hasOpportunity: false,
                agreedRoles: [],
                reasoning: err instanceof Error ? err.message : String(err),
                turnCount: 0,
              },
            });
          } catch {
            // ignore hook failure on error path
          }
        }
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `cd packages/protocol && bun test src/negotiation/tests/negotiation.graph.on-resolved-payload.spec.ts`
Expected: PASS, 1 test.

- [ ] **Step 1.5: Commit**

```bash
git add packages/protocol/src/negotiation/negotiation.graph.ts packages/protocol/src/negotiation/tests/negotiation.graph.on-resolved-payload.spec.ts
git commit -m "refactor(negotiation): extend OnNegotiationResolved with turns + outcome"
```

---

## Task 2: Discovery negotiation/summary state annotations + pure mapper

**Files:**
- Create: `packages/protocol/src/opportunity/negotiation-summary.builder.ts`
- Create: `packages/protocol/src/opportunity/tests/negotiation-summary.builder.spec.ts`
- Modify: `packages/protocol/src/opportunity/opportunity.state.ts`

**Why:** Map per-candidate negotiation data (turns/outcome) into the `DiscoveryNegotiation` shape that `question.prompt.ts` consumes, and aggregate into `DiscoverySummary`. Pure functions — no DB, no LLM.

- [ ] **Step 2.1: Write the failing test**

Create `packages/protocol/src/opportunity/tests/negotiation-summary.builder.spec.ts`:

```ts
import { describe, it, expect } from "bun:test";
import {
  toDiscoveryNegotiation,
  buildDiscoverySummary,
  type NegotiationResolution,
} from "../negotiation-summary.builder.js";

const baseResolution: NegotiationResolution = {
  candidateUserId: "cand-1",
  counterpartyHint: "designer, Berlin",
  indexContext: "Founders network",
  turns: [
    {
      action: "propose",
      assessment: {
        reasoning: "let's pair on the redesign",
        suggestedRoles: { ownUser: "agent", otherUser: "patient" },
      },
    },
    {
      action: "accept",
      assessment: {
        reasoning: "happy to take it",
        suggestedRoles: { ownUser: "patient", otherUser: "agent" },
      },
    },
  ],
  outcome: {
    hasOpportunity: true,
    agreedRoles: [
      { userId: "source-1", role: "agent" },
      { userId: "cand-1", role: "patient" },
    ],
    reasoning: "alignment confirmed",
    turnCount: 2,
  },
};

describe("toDiscoveryNegotiation", () => {
  it("maps turns + outcome from negotiation shapes to DiscoveryNegotiation shape", () => {
    const d = toDiscoveryNegotiation(baseResolution);
    expect(d.counterpartyId).toBe("cand-1");
    expect(d.counterpartyHint).toBe("designer, Berlin");
    expect(d.indexContext).toBe("Founders network");
    expect(d.turns).toEqual([
      {
        action: "propose",
        reasoning: "let's pair on the redesign",
        suggestedRoles: { ownUser: "agent", otherUser: "patient" },
      },
      {
        action: "accept",
        reasoning: "happy to take it",
        suggestedRoles: { ownUser: "patient", otherUser: "agent" },
      },
    ]);
    expect(d.outcome.hasOpportunity).toBe(true);
    expect(d.outcome.reasoning).toBe("alignment confirmed");
    expect(d.outcome.agreedRoles).toEqual([
      { userId: "source-1", role: "agent" },
      { userId: "cand-1", role: "patient" },
    ]);
  });

  it("preserves turn_cap reason on outcome", () => {
    const d = toDiscoveryNegotiation({
      ...baseResolution,
      outcome: { ...baseResolution.outcome, hasOpportunity: false, reason: "turn_cap" },
    });
    expect(d.outcome.hasOpportunity).toBe(false);
    expect(d.outcome.reason).toBe("turn_cap");
  });

  it("omits agreedRoles when outcome lacks opportunity", () => {
    const d = toDiscoveryNegotiation({
      ...baseResolution,
      outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "no fit", turnCount: 1 },
    });
    expect(d.outcome.agreedRoles).toBeUndefined();
  });
});

describe("buildDiscoverySummary", () => {
  const ok = (overrides: Partial<NegotiationResolution> = {}): NegotiationResolution => ({
    ...baseResolution,
    candidateUserId: overrides.candidateUserId ?? baseResolution.candidateUserId,
    outcome: overrides.outcome ?? baseResolution.outcome,
    turns: overrides.turns ?? baseResolution.turns,
    counterpartyHint: overrides.counterpartyHint ?? baseResolution.counterpartyHint,
    indexContext: overrides.indexContext ?? baseResolution.indexContext,
  });

  it("counts opportunities, no-ops, and turn-cap timeouts", () => {
    const summary = buildDiscoverySummary([
      ok(),
      ok({
        candidateUserId: "c2",
        outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "x", turnCount: 6, reason: "turn_cap" },
      }),
      ok({
        candidateUserId: "c3",
        outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "x", turnCount: 0, reason: "timeout" },
      }),
      ok({
        candidateUserId: "c4",
        outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "x", turnCount: 3 },
      }),
    ]);
    expect(summary.totalCandidates).toBe(4);
    expect(summary.opportunitiesFound).toBe(1);
    expect(summary.noOpportunityCount).toBe(3);
    expect(summary.timeoutCount).toBe(2);
  });

  it("aggregates roleDistribution across all agreedRoles entries", () => {
    const summary = buildDiscoverySummary([
      ok({
        candidateUserId: "c1",
        outcome: {
          hasOpportunity: true,
          agreedRoles: [
            { userId: "source-1", role: "agent" },
            { userId: "c1", role: "patient" },
          ],
          reasoning: "ok",
          turnCount: 2,
        },
      }),
      ok({
        candidateUserId: "c2",
        outcome: {
          hasOpportunity: true,
          agreedRoles: [
            { userId: "source-1", role: "peer" },
            { userId: "c2", role: "peer" },
          ],
          reasoning: "ok",
          turnCount: 2,
        },
      }),
    ]);
    expect(summary.roleDistribution).toEqual({ agent: 1, patient: 1, peer: 2 });
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/opportunity/tests/negotiation-summary.builder.spec.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 2.3: Create the builder file**

Create `packages/protocol/src/opportunity/negotiation-summary.builder.ts`:

```ts
/**
 * Pure mappers from raw per-candidate negotiation data to the protocol's
 * `DiscoveryNegotiation` / `DiscoverySummary` shapes consumed by the question
 * generator. No DB access, no LLM — safe to import from anywhere.
 */
import type {
  NegotiationTurn,
  NegotiationOutcome,
} from "../negotiation/negotiation.state.js";
import type {
  DiscoveryNegotiation,
  DiscoveryOutcome,
  DiscoverySummary,
  DiscoveryTurn,
  NegotiationRole,
} from "./question.prompt.js";

/**
 * The input shape collected by the opportunity graph's negotiate node for
 * each candidate that completed a negotiation attempt (accepted, rejected,
 * stalled, or errored).
 */
export interface NegotiationResolution {
  candidateUserId: string;
  /** Abstract profile slice for the LLM (e.g. "AI infra founder, Berlin"). */
  counterpartyHint: string;
  /** Network/community prompt for the negotiation. */
  indexContext: string;
  turns: NegotiationTurn[];
  outcome: NegotiationOutcome;
  /** Optional pre-negotiation evaluator score (0..1). */
  seedAssessmentScore?: number;
}

/** Convert one negotiation resolution to `DiscoveryNegotiation`. */
export function toDiscoveryNegotiation(r: NegotiationResolution): DiscoveryNegotiation {
  const turns: DiscoveryTurn[] = r.turns.map((t) => ({
    action: t.action,
    reasoning: t.assessment.reasoning,
    suggestedRoles: {
      ownUser: t.assessment.suggestedRoles.ownUser as NegotiationRole,
      otherUser: t.assessment.suggestedRoles.otherUser as NegotiationRole,
    },
  }));
  const outcome: DiscoveryOutcome = {
    hasOpportunity: r.outcome.hasOpportunity,
    reasoning: r.outcome.reasoning,
    ...(r.outcome.hasOpportunity && r.outcome.agreedRoles.length > 0
      ? { agreedRoles: r.outcome.agreedRoles.map((a) => ({ userId: a.userId, role: a.role as NegotiationRole })) }
      : {}),
    ...(r.outcome.reason ? { reason: r.outcome.reason } : {}),
  };
  return {
    counterpartyId: r.candidateUserId,
    counterpartyHint: r.counterpartyHint,
    indexContext: r.indexContext,
    turns,
    outcome,
    ...(r.seedAssessmentScore !== undefined ? { seedAssessmentScore: r.seedAssessmentScore } : {}),
  };
}

/** Aggregate counters across all negotiations in a single discovery turn. */
export function buildDiscoverySummary(resolutions: NegotiationResolution[]): DiscoverySummary {
  const roleDistribution: Partial<Record<NegotiationRole, number>> = {};
  let opportunitiesFound = 0;
  let noOpportunityCount = 0;
  let timeoutCount = 0;

  for (const r of resolutions) {
    if (r.outcome.hasOpportunity) {
      opportunitiesFound += 1;
      for (const role of r.outcome.agreedRoles) {
        const key = role.role as NegotiationRole;
        roleDistribution[key] = (roleDistribution[key] ?? 0) + 1;
      }
    } else {
      noOpportunityCount += 1;
      if (r.outcome.reason === "turn_cap" || r.outcome.reason === "timeout") {
        timeoutCount += 1;
      }
    }
  }

  return {
    totalCandidates: resolutions.length,
    opportunitiesFound,
    noOpportunityCount,
    timeoutCount,
    roleDistribution,
  };
}
```

- [ ] **Step 2.4: Add state annotations**

Edit `packages/protocol/src/opportunity/opportunity.state.ts`. Add this import near the top alongside the existing type imports:

```ts
import type { DiscoveryNegotiation, DiscoverySummary } from "./question.prompt.js";
```

Then add two annotations to the `OpportunityGraphState` Annotation.Root call. Insert immediately before the closing `});` at line 476:

```ts
  /**
   * Per-candidate negotiation records captured by `negotiateNode`. Populated
   * regardless of accept/reject so the question generator sees a complete
   * picture. Empty when the negotiate node was skipped (no opportunities to
   * negotiate) or when the orchestrator path didn't run.
   */
  discoveryNegotiations: Annotation<DiscoveryNegotiation[]>({
    reducer: (curr, next) => [...curr, ...(next || [])],
    default: () => [],
  }),

  /** Aggregate counters across `discoveryNegotiations`. Built in the negotiate node. */
  discoverySummary: Annotation<DiscoverySummary | null>({
    reducer: (_curr, next) => next ?? null,
    default: () => null,
  }),
```

- [ ] **Step 2.5: Run test to verify it passes**

Run: `cd packages/protocol && bun test src/opportunity/tests/negotiation-summary.builder.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 2.6: Commit**

```bash
git add packages/protocol/src/opportunity/negotiation-summary.builder.ts packages/protocol/src/opportunity/tests/negotiation-summary.builder.spec.ts packages/protocol/src/opportunity/opportunity.state.ts
git commit -m "feat(opportunity): add discoveryNegotiations/Summary state + pure builder"
```

---

## Task 3: Capture negotiation resolutions in the negotiate node

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts` (around lines 1849–1986)

**Why:** Funnel data through the extended `onCandidateResolved` hook into the new state annotations.

- [ ] **Step 3.1: Write the failing test**

Create `packages/protocol/src/opportunity/tests/opportunity.graph.discovery-negotiations.spec.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.test" });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key";

import { describe, it, expect } from "bun:test";
import { buildDiscoverySummary, toDiscoveryNegotiation } from "../negotiation-summary.builder.js";
import type { NegotiationOutcome, NegotiationTurn } from "../../negotiation/negotiation.state.js";

// Smoke test for the public surface the negotiate node exposes via the builder;
// the graph-level wiring is exercised end-to-end in Task 9's integration test.
describe("discovery negotiations builder integration", () => {
  it("produces a stable state-update shape consumable by the question generator", () => {
    const turns: NegotiationTurn[] = [
      {
        action: "propose",
        assessment: { reasoning: "hi", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      },
      {
        action: "accept",
        assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      },
    ];
    const outcome: NegotiationOutcome = {
      hasOpportunity: true,
      agreedRoles: [
        { userId: "u-s", role: "peer" },
        { userId: "u-c", role: "peer" },
      ],
      reasoning: "shipped",
      turnCount: 2,
    };
    const negotiation = toDiscoveryNegotiation({
      candidateUserId: "u-c",
      counterpartyHint: "founder",
      indexContext: "AI",
      turns,
      outcome,
    });
    const summary = buildDiscoverySummary([
      { candidateUserId: "u-c", counterpartyHint: "founder", indexContext: "AI", turns, outcome },
    ]);
    expect(negotiation.outcome.hasOpportunity).toBe(true);
    expect(summary.opportunitiesFound).toBe(1);
    expect(summary.roleDistribution).toEqual({ peer: 2 });
  });
});
```

- [ ] **Step 3.2: Run test to verify it passes (smoke only — failure mode comes from Step 3.3 graph wiring)**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.graph.discovery-negotiations.spec.ts`
Expected: PASS, 1 test.

- [ ] **Step 3.3: Wire the negotiate node to populate the new state**

Edit `packages/protocol/src/opportunity/opportunity.graph.ts`. Add the import near the top (alongside existing imports from `./negotiation.graph.js` and the negotiation context loader):

```ts
import {
  buildDiscoverySummary,
  toDiscoveryNegotiation,
  type NegotiationResolution,
} from "./negotiation-summary.builder.js";
```

In `negotiateNode`, right before the `negotiationWork = negotiateCandidates(...)` call (around line 1881), declare a resolution accumulator:

```ts
        const resolutions: NegotiationResolution[] = [];
```

Replace the existing `onCandidateResolved` closure construction. The current code has:

```ts
        const onCandidateResolved: OnNegotiationResolved | undefined = state.trigger === 'orchestrator'
          ? async ({ candidate, accepted }) => {
              // ... existing streaming logic ...
            }
          : undefined;
```

Find the start of that block (near line 1849, just above where `negotiationWork` is constructed) and rewrite it so the orchestrator branch records the resolution AND the always-on branch records it too:

```ts
        const onCandidateResolved: OnNegotiationResolved = async ({ candidate, accepted, turns, outcome }) => {
          resolutions.push({
            candidateUserId: candidate.userId,
            counterpartyHint: candidate.candidateUser.profile?.bio
              ?? (candidate.candidateUser.profile?.interests ?? []).join(", ")
              ?? "",
            indexContext: candidate.networkId
              ? indexContextMap.get(candidate.networkId) ?? ""
              : "",
            turns,
            outcome,
          });

          if (state.trigger !== 'orchestrator') return;
          // ── retain the existing orchestrator streaming work below ──
          /* paste the existing orchestrator block body here, unchanged */
        };
```

> **Implementer note:** the existing orchestrator branch body (which currently lives inside the `state.trigger === 'orchestrator' ? async ({ candidate, accepted }) => { ... }` arm) is several dozen lines long. Cut-and-paste it verbatim into the new structure — do not retype. The change is purely structural: pull the closure out of the ternary, accept the wider payload, push a `resolution`, then early-return for non-orchestrator triggers. Confirm with `git diff` that the only deltas are (a) the wider hook signature, (b) the new `resolutions.push(...)` line, and (c) the early-return guard.

Next, replace the call site that wires `onCandidateResolved` into `opts`. The current site reads:

```ts
            ...(onCandidateResolved && { onCandidateResolved }) },
```

with:

```ts
            onCandidateResolved },
```

Finally, update the success return at the bottom of the node (currently returns only `{ trace: negotiateTrace }` near line 1986). Replace that line with:

```ts
        const discoveryNegotiations = resolutions.map(toDiscoveryNegotiation);
        const discoverySummary = buildDiscoverySummary(resolutions);
        return {
          trace: negotiateTrace,
          discoveryNegotiations,
          discoverySummary,
        };
```

And in the early-out timeout branch around line 1928, change:

```ts
            return {
              trace: [{ ... }],
            };
```

to:

```ts
            const discoveryNegotiationsPartial = resolutions.map(toDiscoveryNegotiation);
            const discoverySummaryPartial = buildDiscoverySummary(resolutions);
            return {
              trace: [{
                node: 'negotiate',
                detail: 'timed_out',
                data: {
                  negotiateTimeoutMs: budgetMs,
                  candidateCount: candidates.length,
                  durationMs: Date.now() - graphStart,
                },
              }],
              discoveryNegotiations: discoveryNegotiationsPartial,
              discoverySummary: discoverySummaryPartial,
            };
```

In the catch branch around line 1987:

```ts
        return {
          trace: [{ ... }],
        };
```

to:

```ts
        return {
          trace: [{
            node: 'negotiate',
            detail: 'Negotiation failed',
            data: { durationMs: Date.now() - graphStart, error: true },
          }],
          discoveryNegotiations: [],
          discoverySummary: buildDiscoverySummary([]),
        };
```

- [ ] **Step 3.4: Run tsc to verify wiring compiles**

Run: `cd packages/protocol && bun run build`
Expected: tsc completes with no errors.

- [ ] **Step 3.5: Run smoke test**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.graph.discovery-negotiations.spec.ts`
Expected: PASS.

- [ ] **Step 3.6: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts packages/protocol/src/opportunity/tests/opportunity.graph.discovery-negotiations.spec.ts
git commit -m "feat(opportunity): capture discoveryNegotiations + summary in negotiate node"
```

---

## Task 4: `QuestionGeneratorReader` interface + ToolDeps slot

**Files:**
- Create: `packages/protocol/src/shared/interfaces/question-generator.interface.ts`
- Modify: `packages/protocol/src/shared/agent/tool.helpers.ts`
- Modify: `packages/protocol/src/index.ts`

**Why:** Tools need to consume `QuestionGenerator` through an injected interface (mirrors `ChatSummaryReader` from Slice 1). Keeps the heavy OpenRouter-keyed construction out of module load.

- [ ] **Step 4.1: Write the failing test**

Create `packages/protocol/src/shared/interfaces/tests/question-generator.interface.spec.ts`:

```ts
import { describe, it, expect } from "bun:test";
import type {
  QuestionGenerationResult,
  Question,
  QuestionStrategy,
} from "../../schemas/question.schema.js";
import type { DiscoveryQuestionInput } from "../../../opportunity/question.prompt.js";
import type { QuestionGeneratorReader } from "../question-generator.interface.js";

describe("QuestionGeneratorReader contract", () => {
  it("accepts a DiscoveryQuestionInput and returns a Promise of QuestionGenerationResult | null", async () => {
    const fake: QuestionGeneratorReader = {
      generate: async (_input: DiscoveryQuestionInput): Promise<QuestionGenerationResult | null> => null,
    };
    const result = await fake.generate({
      query: "x",
      sourceProfile: {},
      negotiations: [],
      summary: {
        totalCandidates: 0,
        opportunitiesFound: 0,
        noOpportunityCount: 0,
        timeoutCount: 0,
        roleDistribution: {},
      },
      now: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });

  it("permits implementations that return a non-null QuestionGenerationResult", async () => {
    const q: Question = { title: "T", prompt: "P?", options: [{ label: "a", description: "x" }, { label: "b", description: "y" }], multiSelect: false };
    const s: QuestionStrategy[] = ["refine_intent"];
    const ok: QuestionGeneratorReader = { generate: async () => ({ questions: [q], strategies: s }) };
    const r = await ok.generate({ query: "x", sourceProfile: {}, negotiations: [], summary: { totalCandidates: 0, opportunitiesFound: 0, noOpportunityCount: 0, timeoutCount: 0, roleDistribution: {} }, now: "" });
    expect(r?.questions).toHaveLength(1);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/shared/interfaces/tests/question-generator.interface.spec.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 4.3: Create the interface**

Create `packages/protocol/src/shared/interfaces/question-generator.interface.ts`:

```ts
/**
 * Protocol-level read contract for decision-question generation. Implementations
 * live in the backend (see `QuestionGeneratorService`) and are injected into the
 * protocol via `ProtocolDeps`/`ToolDeps`. The protocol module never constructs
 * its own LLM-bound `QuestionGenerator` — callers inject one (or `undefined` to
 * opt out).
 */
import type { DiscoveryQuestionInput } from "../../opportunity/question.prompt.js";
import type { QuestionGenerationResult } from "../schemas/question.schema.js";

export interface QuestionGeneratorReader {
  /**
   * Run the question generator over a single discovery turn.
   * @returns The structured result, or `null` when generation failed,
   *   guardrails dropped all candidates, or the underlying LLM threw.
   */
  generate(input: DiscoveryQuestionInput): Promise<QuestionGenerationResult | null>;
}
```

- [ ] **Step 4.4: Add the slot to `ToolContext`/`ToolDeps`**

Edit `packages/protocol/src/shared/agent/tool.helpers.ts`. Add the import near the top alongside the `ChatSummaryReader` import:

```ts
import type { QuestionGeneratorReader } from "../interfaces/question-generator.interface.js";
```

Add a field right after the existing `chatSummary?: ChatSummaryReader;` line (currently around line 116):

```ts
  /** Decision-question generator. Optional; consumers fall back to no `questions`. */
  questionGenerator?: QuestionGeneratorReader;
```

- [ ] **Step 4.5: Export the type from the protocol package**

Edit `packages/protocol/src/index.ts`. Find the existing `ChatSummaryReader` export (around line 23) and add right below it:

```ts
export type { QuestionGeneratorReader } from "./shared/interfaces/question-generator.interface.js";
```

- [ ] **Step 4.6: Run tests to verify**

Run: `cd packages/protocol && bun test src/shared/interfaces/tests/question-generator.interface.spec.ts && bun run build`
Expected: PASS, 2 tests. tsc clean.

- [ ] **Step 4.7: Commit**

```bash
git add packages/protocol/src/shared/interfaces/question-generator.interface.ts packages/protocol/src/shared/interfaces/tests packages/protocol/src/shared/agent/tool.helpers.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): add QuestionGeneratorReader interface + ToolContext slot"
```

---

## Task 5: Backend `QuestionGeneratorService` (lazy)

**Files:**
- Create: `backend/src/services/question-generator.service.ts`
- Create: `backend/src/services/tests/question-generator.service.spec.ts`

**Why:** Same lazy-construction pattern as `ChatSummaryService` so module load never demands `OPENROUTER_API_KEY`.

- [ ] **Step 5.1: Write the failing test**

Create `backend/src/services/tests/question-generator.service.spec.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect } from "bun:test";
import { QuestionGeneratorService } from "../question-generator.service";
import type { Question, QuestionGenerationResult } from "@indexnetwork/protocol";

const baseInput = {
  query: "x",
  sourceProfile: {},
  negotiations: [],
  summary: { totalCandidates: 0, opportunitiesFound: 0, noOpportunityCount: 0, timeoutCount: 0, roleDistribution: {} },
  now: new Date().toISOString(),
};

describe("QuestionGeneratorService", () => {
  it("delegates to the injected generator", async () => {
    const q: Question = {
      title: "T",
      prompt: "P?",
      options: [
        { label: "a", description: "x" },
        { label: "b", description: "y" },
      ],
      multiSelect: false,
    };
    const result: QuestionGenerationResult = { questions: [q], strategies: ["refine_intent"] };
    const svc = new QuestionGeneratorService({ generate: async () => result });
    const got = await svc.generate(baseInput);
    expect(got).toEqual(result);
  });

  it("returns null when the underlying generator throws", async () => {
    const svc = new QuestionGeneratorService({
      generate: async () => {
        throw new Error("boom");
      },
    });
    const got = await svc.generate(baseInput);
    expect(got).toBeNull();
  });

  it("defers construction of the default generator until first call", async () => {
    const svc = new QuestionGeneratorService();
    // We don't make a real LLM call in unit tests; replace the lazy slot with a fake.
    (svc as unknown as { generator: { generate: typeof Function } }).generator = {
      generate: async () => null,
    };
    const got = await svc.generate(baseInput);
    expect(got).toBeNull();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `cd backend && bun test src/services/tests/question-generator.service.spec.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 5.3: Create the service**

Create `backend/src/services/question-generator.service.ts`:

```ts
/**
 * QuestionGeneratorService — implements the protocol's QuestionGeneratorReader
 * contract by delegating to `@indexnetwork/protocol`'s `QuestionGenerator`. The
 * default LLM-bound generator is constructed lazily on first `generate()` call
 * so module load never demands `OPENROUTER_API_KEY`. Tests inject a fake.
 */
import { QuestionGenerator } from "@indexnetwork/protocol";
import type {
  DiscoveryQuestionInput,
  QuestionGenerationResult,
  QuestionGeneratorReader,
} from "@indexnetwork/protocol";

import { log } from "../lib/log";

const logger = log.service.from("QuestionGeneratorService");

/** Minimal generator shape — used as the constructor type so tests can inject a fake. */
export interface QuestionGeneratorLike {
  generate(input: DiscoveryQuestionInput): Promise<QuestionGenerationResult | null>;
}

export class QuestionGeneratorService implements QuestionGeneratorReader {
  private generator: QuestionGeneratorLike | undefined;

  constructor(injected?: QuestionGeneratorLike) {
    this.generator = injected;
  }

  /** Lazily construct the default generator on first use. */
  private getGenerator(): QuestionGeneratorLike {
    if (!this.generator) {
      this.generator = new QuestionGenerator();
    }
    return this.generator;
  }

  async generate(input: DiscoveryQuestionInput): Promise<QuestionGenerationResult | null> {
    try {
      return await this.getGenerator().generate(input);
    } catch (err) {
      logger.warn("question-generator threw", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
}
```

- [ ] **Step 5.4: Run test to verify it passes**

Run: `cd backend && bun test src/services/tests/question-generator.service.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5.5: Commit**

```bash
git add backend/src/services/question-generator.service.ts backend/src/services/tests/question-generator.service.spec.ts
git commit -m "feat(backend): add QuestionGeneratorService (lazy wrapper)"
```

---

## Task 6: Composition root wiring

**Files:**
- Modify: `backend/src/controllers/mcp.controller.ts` (lines 53–107)

**Why:** Build the service alongside `ChatSummaryService` and add it to `protocolDeps` so chat tools receive it via `ToolDeps`.

- [ ] **Step 6.1: Edit the composition root**

Edit `backend/src/controllers/mcp.controller.ts`. Add an import alongside the existing `ChatSummaryService` import:

```ts
import { QuestionGeneratorService } from '../services/question-generator.service';
```

Add the service instantiation right after the existing `const chatSummaryService = ...` line (currently line 55):

```ts
const questionGeneratorService = new QuestionGeneratorService();
```

Add it to the `protocolDeps` object literal right after the `chatSummary: chatSummaryService,` line (currently line 86):

```ts
  questionGenerator: questionGeneratorService,
```

- [ ] **Step 6.2: Run tsc**

Run: `cd backend && bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
git add backend/src/controllers/mcp.controller.ts
git commit -m "feat(backend): wire QuestionGeneratorService into protocolDeps"
```

---

## Task 7: `buildDiscoveryQuestionInput` pure helper

**Files:**
- Create: `packages/protocol/src/opportunity/discovery-question.helper.ts`
- Create: `packages/protocol/src/opportunity/tests/discovery-question.helper.spec.ts`

**Why:** Centralize the mapping from graph result + digest → `DiscoveryQuestionInput`. Pure function so `runDiscoverFromQuery` stays thin.

- [ ] **Step 7.1: Write the failing test**

Create `packages/protocol/src/opportunity/tests/discovery-question.helper.spec.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { buildDiscoveryQuestionInput } from "../discovery-question.helper.js";
import type { ChatContextDigest } from "../../shared/schemas/chat-context.schema.js";
import type { DiscoveryNegotiation, DiscoverySummary } from "../question.prompt.js";

const negotiation: DiscoveryNegotiation = {
  counterpartyId: "u-1",
  counterpartyHint: "founder, NYC",
  indexContext: "ai-builders",
  turns: [
    { action: "propose", reasoning: "let's pair", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  ],
  outcome: { hasOpportunity: false, reasoning: "no fit" },
};

const summary: DiscoverySummary = {
  totalCandidates: 1,
  opportunitiesFound: 0,
  noOpportunityCount: 1,
  timeoutCount: 0,
  roleDistribution: {},
};

describe("buildDiscoveryQuestionInput", () => {
  it("maps query, source profile, negotiations, summary, and timestamp", () => {
    const input = buildDiscoveryQuestionInput({
      query: "find AI cofounders",
      sourceProfile: {
        identity: { name: "Eda", bio: "engineer", location: "NYC" },
        attributes: { skills: ["ml"], interests: ["startups"] },
      },
      negotiations: [negotiation],
      summary,
      chatContext: undefined,
      now: "2026-05-15T12:00:00.000Z",
    });
    expect(input.query).toBe("find AI cofounders");
    expect(input.sourceProfile).toEqual({
      name: "Eda",
      bio: "engineer",
      location: "NYC",
      skills: ["ml"],
      interests: ["startups"],
    });
    expect(input.negotiations).toEqual([negotiation]);
    expect(input.summary).toEqual(summary);
    expect(input.now).toBe("2026-05-15T12:00:00.000Z");
    expect(input.chatContext).toBeUndefined();
  });

  it("forwards a provided chatContext digest verbatim", () => {
    const digest: ChatContextDigest = {
      statedFacts: ["pre-revenue"],
      openQuestions: [],
      rejectionReasons: [],
      surfacedFindings: [],
    };
    const input = buildDiscoveryQuestionInput({
      query: "q",
      sourceProfile: null,
      negotiations: [],
      summary,
      chatContext: digest,
      now: "2026-05-15T12:00:00.000Z",
    });
    expect(input.chatContext).toEqual(digest);
  });

  it("tolerates a null source profile", () => {
    const input = buildDiscoveryQuestionInput({
      query: "q",
      sourceProfile: null,
      negotiations: [],
      summary,
      chatContext: undefined,
      now: "2026-05-15T12:00:00.000Z",
    });
    expect(input.sourceProfile).toEqual({});
  });
});
```

- [ ] **Step 7.2: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/opportunity/tests/discovery-question.helper.spec.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 7.3: Create the helper**

Create `packages/protocol/src/opportunity/discovery-question.helper.ts`:

```ts
/**
 * Pure mapper from opportunity-graph outputs + optional chat digest to a
 * `DiscoveryQuestionInput`. No I/O. Side-effect-free.
 */
import type { ChatContextDigest } from "../shared/schemas/chat-context.schema.js";
import type { SourceProfileData } from "./opportunity.state.js";
import type {
  DiscoveryNegotiation,
  DiscoveryQuestionInput,
  DiscoverySourceProfile,
  DiscoverySummary,
} from "./question.prompt.js";

export interface BuildDiscoveryQuestionInputArgs {
  query: string;
  sourceProfile: SourceProfileData | null;
  negotiations: DiscoveryNegotiation[];
  summary: DiscoverySummary;
  chatContext?: ChatContextDigest;
  now: string;
}

export function buildDiscoveryQuestionInput(args: BuildDiscoveryQuestionInputArgs): DiscoveryQuestionInput {
  return {
    query: args.query,
    sourceProfile: extractSourceProfile(args.sourceProfile),
    negotiations: args.negotiations,
    summary: args.summary,
    ...(args.chatContext !== undefined ? { chatContext: args.chatContext } : {}),
    now: args.now,
  };
}

function extractSourceProfile(profile: SourceProfileData | null): DiscoverySourceProfile {
  if (!profile) return {};
  const out: DiscoverySourceProfile = {};
  if (profile.identity?.name) out.name = profile.identity.name;
  if (profile.identity?.bio) out.bio = profile.identity.bio;
  if (profile.identity?.location) out.location = profile.identity.location;
  if (profile.attributes?.skills?.length) out.skills = profile.attributes.skills;
  if (profile.attributes?.interests?.length) out.interests = profile.attributes.interests;
  return out;
}
```

- [ ] **Step 7.4: Run test to verify it passes**

Run: `cd packages/protocol && bun test src/opportunity/tests/discovery-question.helper.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7.5: Commit**

```bash
git add packages/protocol/src/opportunity/discovery-question.helper.ts packages/protocol/src/opportunity/tests/discovery-question.helper.spec.ts
git commit -m "feat(opportunity): add pure buildDiscoveryQuestionInput helper"
```

---

## Task 8: Trace event types (`chat_summarizer_*`, `question_generator_*`, `decision_questions`) + DebugMeta + DoneEvent extension

**Files:**
- Modify: `packages/protocol/src/chat/chat-streaming.types.ts`
- Modify: `backend/src/types/chat-streaming.types.ts` (mirror)

**Why:** Land all type-level additions in one commit so downstream tasks can reference them with strong types.

- [ ] **Step 8.1: Write the failing test**

Create `packages/protocol/src/chat/tests/chat-streaming.types.discoveryQuestions.spec.ts`:

```ts
import { describe, it, expect } from "bun:test";
import {
  createChatSummarizerStartEvent,
  createChatSummarizerEndEvent,
  createQuestionGeneratorStartEvent,
  createQuestionGeneratorEndEvent,
  createDecisionQuestionsEvent,
  createDebugMetaEvent,
  type DebugMetaDiscoveryQuestions,
  type DebugMetaLlm,
} from "../chat-streaming.types.js";
import type { Question, QuestionStrategy } from "../../shared/schemas/question.schema.js";

const question: Question = {
  title: "Stage",
  prompt: "Where in your journey?",
  options: [
    { label: "ideating", description: "early" },
    { label: "shipping", description: "live" },
  ],
  multiSelect: false,
};
const strategies: QuestionStrategy[] = ["refine_intent"];

describe("decision-question stream types", () => {
  it("creates chat_summarizer_start / end events with the expected shape", () => {
    const start = createChatSummarizerStartEvent("s-1", { sessionId: "c-1" });
    expect(start.type).toBe("chat_summarizer_start");
    expect(start.sessionId).toBe("s-1");
    expect(start.payload).toEqual({ sessionId: "c-1" });
    const end = createChatSummarizerEndEvent("s-1", { newMessageCount: 4, model: "x", fromCached: false, durationMs: 12 });
    expect(end.type).toBe("chat_summarizer_end");
    expect(end.payload.durationMs).toBe(12);
  });

  it("creates question_generator_start / end events with the expected shape", () => {
    const start = createQuestionGeneratorStartEvent("s-1", { inputMode: "transcripts", negotiationCount: 3, hasChatContext: true });
    expect(start.type).toBe("question_generator_start");
    expect(start.payload.inputMode).toBe("transcripts");
    const end = createQuestionGeneratorEndEvent("s-1", { finalCount: 2, droppedCount: 1, strategies, durationMs: 250, inputMode: "transcripts" });
    expect(end.type).toBe("question_generator_end");
    expect(end.payload.finalCount).toBe(2);
  });

  it("creates a decision_questions event carrying the questions array", () => {
    const ev = createDecisionQuestionsEvent("s-1", { questions: [question] });
    expect(ev.type).toBe("decision_questions");
    expect(ev.questions).toEqual([question]);
  });

  it("createDebugMetaEvent accepts an optional discoveryQuestions slot", () => {
    const llm: DebugMetaLlm = { calls: 0, totalDurationMs: 0, resets: [], hallucinations: [] };
    const dq: DebugMetaDiscoveryQuestions = {
      inputMode: "transcripts",
      finalCount: 1,
      droppedCount: 0,
      strategies,
      durationMs: 100,
    };
    const ev = createDebugMetaEvent("s-1", "agent_loop", 1, [], llm, undefined, dq);
    expect(ev.discoveryQuestions).toEqual(dq);
  });
});
```

- [ ] **Step 8.2: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/chat/tests/chat-streaming.types.discoveryQuestions.spec.ts`
Expected: FAIL with missing exports.

- [ ] **Step 8.3: Extend `chat-streaming.types.ts`**

Edit `packages/protocol/src/chat/chat-streaming.types.ts`.

Add `Question` import near the top:

```ts
import type { Question, QuestionStrategy } from "../shared/schemas/question.schema.js";
```

Extend the `ChatStreamEventType` union (around line 42). Append before the closing `;`:

```ts
  // Discovery decision-question events
  | "chat_summarizer_start"
  | "chat_summarizer_end"
  | "question_generator_start"
  | "question_generator_end"
  | "decision_questions";
```

Add typed event interfaces directly after the negotiation event interfaces (after `NegotiationOutcomeEvent`, around line 479):

```ts
export interface ChatSummarizerStartEvent extends ChatStreamEventBase {
  type: "chat_summarizer_start";
  payload: { sessionId: string };
}

export interface ChatSummarizerEndEvent extends ChatStreamEventBase {
  type: "chat_summarizer_end";
  payload: {
    newMessageCount: number;
    model: string;
    fromCached: boolean;
    durationMs: number;
  };
}

export interface QuestionGeneratorStartEvent extends ChatStreamEventBase {
  type: "question_generator_start";
  payload: {
    inputMode: "transcripts" | "insights";
    negotiationCount: number;
    hasChatContext: boolean;
    truncated?: { originalCount: number; keptCount: number };
  };
}

export interface QuestionGeneratorEndEvent extends ChatStreamEventBase {
  type: "question_generator_end";
  payload: {
    finalCount: number;
    droppedCount: number;
    strategies: QuestionStrategy[];
    durationMs: number;
    inputMode: "transcripts" | "insights";
  };
}

export interface DecisionQuestionsEvent extends ChatStreamEventBase {
  type: "decision_questions";
  questions: Question[];
}
```

Extend the `DebugMetaEvent` shape (around line 397). Find the existing interface and add the optional slot:

```ts
export interface DebugMetaEvent extends ChatStreamEventBase {
  type: "debug_meta";
  graph: string;
  iterations: number;
  tools: DebugMetaToolCall[];
  llm: DebugMetaLlm;
  orchestratorNegotiations?: DebugMetaOrchestratorNegotiations;
  /** Decision-question generation debug data (orchestrator path only). */
  discoveryQuestions?: DebugMetaDiscoveryQuestions;
}
```

Add the new debug-meta shape near the other `DebugMeta*` interfaces (e.g. right after `DebugMetaOrchestratorNegotiations`):

```ts
export interface DebugMetaDiscoveryQuestions {
  inputMode: "transcripts" | "insights";
  finalCount: number;
  droppedCount: number;
  strategies: QuestionStrategy[];
  durationMs: number;
}
```

Extend `DoneEvent` (around line 174) by adding inside the interface body:

```ts
  /** Decision questions to render (orchestrator flow only). */
  decisionQuestions?: Question[];
```

Extend `CreateDoneEventOptions` (around line 645) similarly:

```ts
  decisionQuestions?: Question[];
```

Add the 5 events to the `ChatStreamEvent` union (around line 484). Append before the closing `;`:

```ts
  | ChatSummarizerStartEvent
  | ChatSummarizerEndEvent
  | QuestionGeneratorStartEvent
  | QuestionGeneratorEndEvent
  | DecisionQuestionsEvent;
```

Update `createDebugMetaEvent` to accept the new optional argument. Replace the existing function (around line 854) with:

```ts
export function createDebugMetaEvent(
  sessionId: string,
  graph: string,
  iterations: number,
  tools: DebugMetaToolCall[],
  llm: DebugMetaLlm,
  orchestratorNegotiations?: DebugMetaOrchestratorNegotiations,
  discoveryQuestions?: DebugMetaDiscoveryQuestions,
): DebugMetaEvent {
  return createStreamEvent<DebugMetaEvent>("debug_meta", sessionId, {
    graph,
    iterations,
    tools,
    llm,
    ...(orchestratorNegotiations !== undefined && { orchestratorNegotiations }),
    ...(discoveryQuestions !== undefined && { discoveryQuestions }),
  });
}
```

Add new creators at the bottom of the file, after the negotiation creators:

```ts
export function createChatSummarizerStartEvent(
  sessionId: string,
  payload: ChatSummarizerStartEvent["payload"],
): ChatSummarizerStartEvent {
  return createStreamEvent<ChatSummarizerStartEvent>("chat_summarizer_start", sessionId, { payload });
}

export function createChatSummarizerEndEvent(
  sessionId: string,
  payload: ChatSummarizerEndEvent["payload"],
): ChatSummarizerEndEvent {
  return createStreamEvent<ChatSummarizerEndEvent>("chat_summarizer_end", sessionId, { payload });
}

export function createQuestionGeneratorStartEvent(
  sessionId: string,
  payload: QuestionGeneratorStartEvent["payload"],
): QuestionGeneratorStartEvent {
  return createStreamEvent<QuestionGeneratorStartEvent>("question_generator_start", sessionId, { payload });
}

export function createQuestionGeneratorEndEvent(
  sessionId: string,
  payload: QuestionGeneratorEndEvent["payload"],
): QuestionGeneratorEndEvent {
  return createStreamEvent<QuestionGeneratorEndEvent>("question_generator_end", sessionId, { payload });
}

export function createDecisionQuestionsEvent(
  sessionId: string,
  payload: { questions: Question[] },
): DecisionQuestionsEvent {
  return createStreamEvent<DecisionQuestionsEvent>("decision_questions", sessionId, payload);
}
```

- [ ] **Step 8.4: Mirror into the backend copy**

Edit `backend/src/types/chat-streaming.types.ts` and apply the **same** additions (union members, interfaces, `Question`/`QuestionStrategy` imports — re-import from `@indexnetwork/protocol`, `DebugMetaEvent` slot, `DoneEvent` / `CreateDoneEventOptions` extensions, the five creators). The two files are kept in sync intentionally — any diff between them will cause the controller's SSE assembly to drop fields.

Imports for the backend copy:

```ts
import type { Question, QuestionStrategy } from "@indexnetwork/protocol";
```

(Otherwise the additions are byte-for-byte identical to the protocol-side edits in Step 8.3.)

- [ ] **Step 8.5: Run the test**

Run: `cd packages/protocol && bun test src/chat/tests/chat-streaming.types.discoveryQuestions.spec.ts && bun run build && cd ../../backend && bun run tsc --noEmit`
Expected: PASS, 4 tests. Both tsc runs clean.

- [ ] **Step 8.6: Commit**

```bash
git add packages/protocol/src/chat/chat-streaming.types.ts packages/protocol/src/chat/tests/chat-streaming.types.discoveryQuestions.spec.ts backend/src/types/chat-streaming.types.ts
git commit -m "feat(chat): add decision-question stream event + debug meta types"
```

---

## Task 9: Wire `runDiscoverFromQuery` to the question generator

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.discover.ts` (lines 34–80, 556–826)
- Create: `packages/protocol/src/opportunity/tests/opportunity.discover.questions.spec.ts`

**Why:** This is the integration point. Add the trigger/flag gate, build `DiscoveryQuestionInput`, call generator, emit trace events, return `questions` + debug meta on `DiscoverResult`.

- [ ] **Step 9.1: Write the failing integration test**

Create `packages/protocol/src/opportunity/tests/opportunity.discover.questions.spec.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.test" });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runDiscoverFromQuery, type DiscoverInput } from "../opportunity.discover.js";
import type { Question, ChatContextDigest, QuestionGeneratorReader, ChatSummaryReader } from "@indexnetwork/protocol";

const baseQuestion: Question = {
  title: "Stage",
  prompt: "Where are you in your journey?",
  options: [
    { label: "ideating", description: "" },
    { label: "shipping", description: "" },
  ],
  multiSelect: false,
};

function makeFakeGraph(opportunities: unknown[] = [], extras: Record<string, unknown> = {}) {
  return {
    invoke: async () => ({
      opportunities,
      remainingCandidates: [],
      trace: [],
      existingBetweenActors: [],
      dedupAlreadyAccepted: [],
      sourceProfile: null,
      discoveryNegotiations: extras.discoveryNegotiations ?? [],
      discoverySummary: extras.discoverySummary ?? {
        totalCandidates: 0,
        opportunitiesFound: 0,
        noOpportunityCount: 0,
        timeoutCount: 0,
        roleDistribution: {},
      },
      ...extras,
    }),
  } as unknown as DiscoverInput["opportunityGraph"];
}

function makeFakeDatabase(): DiscoverInput["database"] {
  return {
    getProfile: async () => null,
    getUser: async () => null,
    getOpportunity: async () => null,
    getOpportunitiesByIds: async () => [],
  } as unknown as DiscoverInput["database"];
}

const originalFlag = process.env.ENABLE_DISCOVERY_QUESTIONS;
beforeEach(() => { process.env.ENABLE_DISCOVERY_QUESTIONS = "true"; });
afterEach(() => { process.env.ENABLE_DISCOVERY_QUESTIONS = originalFlag; });

describe("runDiscoverFromQuery — decision-question integration", () => {
  it("returns questions when trigger=orchestrator and the generator yields a result", async () => {
    const chatSummary: ChatSummaryReader = { getDigest: async () => null };
    const questionGenerator: QuestionGeneratorReader = {
      generate: async () => ({ questions: [baseQuestion], strategies: ["refine_intent"] }),
    };
    const result = await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "find mentors",
      indexScope: ["i-1"],
      trigger: "orchestrator",
      chatSessionId: "s-1",
      enableQuestions: true,
      chatSummary,
      questionGenerator,
    });
    expect(result.questions).toEqual([baseQuestion]);
    expect(result.discoveryQuestionsDebug?.finalCount).toBe(1);
    expect(result.discoveryQuestionsDebug?.strategies).toEqual(["refine_intent"]);
  });

  it("does not call generator when trigger=ambient (even with flag on)", async () => {
    let called = 0;
    const questionGenerator: QuestionGeneratorReader = {
      generate: async () => { called += 1; return null; },
    };
    const result = await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "q",
      indexScope: ["i-1"],
      trigger: "ambient",
      enableQuestions: true,
      questionGenerator,
    });
    expect(called).toBe(0);
    expect(result.questions).toBeUndefined();
    expect(result.discoveryQuestionsDebug).toBeUndefined();
  });

  it("does not call generator when enableQuestions is false", async () => {
    let called = 0;
    const questionGenerator: QuestionGeneratorReader = {
      generate: async () => { called += 1; return null; },
    };
    await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "q",
      indexScope: ["i-1"],
      trigger: "orchestrator",
      enableQuestions: false,
      questionGenerator,
    });
    expect(called).toBe(0);
  });

  it("passes the chat-session digest when chatSummary returns one", async () => {
    const digest: ChatContextDigest = { statedFacts: ["pre-rev"], openQuestions: [], rejectionReasons: [], surfacedFindings: [] };
    let observedDigest: ChatContextDigest | undefined;
    const chatSummary: ChatSummaryReader = { getDigest: async () => digest };
    const questionGenerator: QuestionGeneratorReader = {
      generate: async (input) => { observedDigest = input.chatContext; return null; },
    };
    await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "q",
      indexScope: ["i-1"],
      trigger: "orchestrator",
      chatSessionId: "s-1",
      enableQuestions: true,
      chatSummary,
      questionGenerator,
    });
    expect(observedDigest).toEqual(digest);
  });

  it("survives a chatSummary failure and still runs the generator with undefined chatContext", async () => {
    const chatSummary: ChatSummaryReader = { getDigest: async () => { throw new Error("db down"); } };
    let observedDigest: ChatContextDigest | undefined = { statedFacts: [], openQuestions: [], rejectionReasons: [], surfacedFindings: [] };
    const questionGenerator: QuestionGeneratorReader = {
      generate: async (input) => { observedDigest = input.chatContext; return null; },
    };
    await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "q",
      indexScope: ["i-1"],
      trigger: "orchestrator",
      chatSessionId: "s-1",
      enableQuestions: true,
      chatSummary,
      questionGenerator,
    });
    expect(observedDigest).toBeUndefined();
  });

  it("returns no questions when the generator returns null", async () => {
    const questionGenerator: QuestionGeneratorReader = { generate: async () => null };
    const result = await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "q",
      indexScope: ["i-1"],
      trigger: "orchestrator",
      chatSessionId: "s-1",
      enableQuestions: true,
      questionGenerator,
    });
    expect(result.questions).toBeUndefined();
    expect(result.discoveryQuestionsDebug?.finalCount).toBe(0);
  });
});
```

- [ ] **Step 9.2: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.discover.questions.spec.ts`
Expected: FAIL — `enableQuestions` / `chatSummary` / `questionGenerator` / `questions` / `discoveryQuestionsDebug` do not yet exist on `DiscoverInput`/`DiscoverResult`.

- [ ] **Step 9.3: Extend `DiscoverInput`/`DiscoverResult` and integrate**

Edit `packages/protocol/src/opportunity/opportunity.discover.ts`.

Add imports near the top alongside the existing protocol imports:

```ts
import type { ChatSummaryReader, ChatContextDigest } from "../shared/interfaces/chat-summary.interface.js";
import type { QuestionGeneratorReader } from "../shared/interfaces/question-generator.interface.js";
import type { Question, QuestionStrategy } from "../shared/schemas/question.schema.js";
import { requestContext } from "../shared/observability/request-context.js";
import {
  createChatSummarizerStartEvent,
  createChatSummarizerEndEvent,
  createQuestionGeneratorStartEvent,
  createQuestionGeneratorEndEvent,
} from "../chat/chat-streaming.types.js";
import { buildDiscoveryQuestionInput } from "./discovery-question.helper.js";
```

Extend `DiscoverInput` (currently lines 34–80). Add these fields inside the interface body:

```ts
  /** Optional read-through chat-session digest reader. Required for chatContext enrichment. */
  chatSummary?: ChatSummaryReader;
  /** Optional decision-question generator. When omitted, no questions are produced. */
  questionGenerator?: QuestionGeneratorReader;
  /**
   * Master switch for decision-question generation. When false, this code path
   * is skipped entirely regardless of trigger. The composition root passes
   * `process.env.ENABLE_DISCOVERY_QUESTIONS === "true"`.
   */
  enableQuestions?: boolean;
```

Extend `DiscoverResult` (currently lines 154–183). Add inside the interface body:

```ts
  /** 0–3 decision questions produced by the orchestrator path. Omitted when none. */
  questions?: Question[];
  /** Debug metadata for `debugMeta.discoveryQuestions` plumbing. */
  discoveryQuestionsDebug?: {
    inputMode: "transcripts" | "insights";
    finalCount: number;
    droppedCount: number;
    strategies: QuestionStrategy[];
    durationMs: number;
  };
```

Now extend `runDiscoverFromQuery`. The current happy-path return is at the bottom of the function (around lines 808–817). Replace it so a questions branch runs before returning.

Find the existing successful-return block:

```ts
      return {
        found: true,
        count: enriched.length,
        opportunities: enriched,
        ...(existingConnectionsForCards.length > 0 ? { existingConnections: existingConnectionsForCards } : {}),
        ...(existingConnections.length > 0 ? { existingConnectionsForMention: existingConnections } : {}),
        ...(alreadyAcceptedPairs.length > 0 ? { alreadyAcceptedPairs } : {}),
        debugSteps,
        pagination,
      };
```

Replace with:

```ts
      const questionPayload = await maybeBuildQuestions({
        trigger,
        enableQuestions: input.enableQuestions ?? false,
        chatSummary: input.chatSummary,
        questionGenerator: input.questionGenerator,
        chatSessionId,
        graphResult: result,
        query: queryOrEmpty,
      });

      return {
        found: true,
        count: enriched.length,
        opportunities: enriched,
        ...(existingConnectionsForCards.length > 0 ? { existingConnections: existingConnectionsForCards } : {}),
        ...(existingConnections.length > 0 ? { existingConnectionsForMention: existingConnections } : {}),
        ...(alreadyAcceptedPairs.length > 0 ? { alreadyAcceptedPairs } : {}),
        debugSteps,
        pagination,
        ...(questionPayload.questions !== undefined ? { questions: questionPayload.questions } : {}),
        ...(questionPayload.debug !== undefined ? { discoveryQuestionsDebug: questionPayload.debug } : {}),
      };
```

Then, add the `maybeBuildQuestions` helper near the bottom of the file (before `export async function continueDiscovery`):

```ts
type GraphResultLike = {
  sourceProfile?: import("./opportunity.state.js").SourceProfileData | null;
  discoveryNegotiations?: import("./question.prompt.js").DiscoveryNegotiation[];
  discoverySummary?: import("./question.prompt.js").DiscoverySummary | null;
};

interface MaybeBuildQuestionsInput {
  trigger: 'ambient' | 'orchestrator' | undefined;
  enableQuestions: boolean;
  chatSummary: ChatSummaryReader | undefined;
  questionGenerator: QuestionGeneratorReader | undefined;
  chatSessionId: string | undefined;
  graphResult: GraphResultLike;
  query: string;
}

async function maybeBuildQuestions(args: MaybeBuildQuestionsInput): Promise<{
  questions?: Question[];
  debug?: DiscoverResult["discoveryQuestionsDebug"];
}> {
  if (!args.enableQuestions) return {};
  if (args.trigger !== 'orchestrator') return {};
  if (!args.questionGenerator) return {};

  const traceEmitter = requestContext.getStore()?.traceEmitter;
  const inputMode = (process.env.DISCOVERY_QUESTIONS_INPUT_MODE === "insights" ? "insights" : "transcripts") as "transcripts" | "insights";

  let chatContext: ChatContextDigest | undefined;
  if (args.chatSummary && args.chatSessionId) {
    const summarizerStart = Date.now();
    traceEmitter?.(createChatSummarizerStartEvent("", { sessionId: args.chatSessionId }));
    try {
      chatContext = (await args.chatSummary.getDigest(args.chatSessionId)) ?? undefined;
    } catch (err) {
      logger.warn("chatSummary.getDigest threw — proceeding without digest", {
        sessionId: args.chatSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      chatContext = undefined;
    }
    traceEmitter?.(createChatSummarizerEndEvent("", {
      newMessageCount: chatContext ? (chatContext.statedFacts.length + chatContext.openQuestions.length) : 0,
      model: "deferred",
      fromCached: chatContext == null,
      durationMs: Date.now() - summarizerStart,
    }));
  }

  const negotiations = args.graphResult.discoveryNegotiations ?? [];
  const summary = args.graphResult.discoverySummary ?? {
    totalCandidates: 0,
    opportunitiesFound: 0,
    noOpportunityCount: 0,
    timeoutCount: 0,
    roleDistribution: {},
  };

  const generatorStart = Date.now();
  traceEmitter?.(createQuestionGeneratorStartEvent("", {
    inputMode,
    negotiationCount: negotiations.length,
    hasChatContext: chatContext !== undefined,
  }));

  const input = buildDiscoveryQuestionInput({
    query: args.query,
    sourceProfile: args.graphResult.sourceProfile ?? null,
    negotiations,
    summary,
    chatContext,
    now: new Date().toISOString(),
  });

  const result = await args.questionGenerator.generate(input);
  const durationMs = Date.now() - generatorStart;

  const finalCount = result?.questions?.length ?? 0;
  const strategies: QuestionStrategy[] = result?.strategies ?? [];
  const droppedCount = 0; // generator does not expose a dropped count; reserved for future.

  traceEmitter?.(createQuestionGeneratorEndEvent("", {
    finalCount,
    droppedCount,
    strategies,
    durationMs,
    inputMode,
  }));

  return {
    ...(result && result.questions.length > 0 ? { questions: result.questions } : {}),
    debug: {
      inputMode,
      finalCount,
      droppedCount,
      strategies,
      durationMs,
    },
  };
}
```

- [ ] **Step 9.4: Run the integration test**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.discover.questions.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9.5: Run tsc**

Run: `cd packages/protocol && bun run build`
Expected: clean.

- [ ] **Step 9.6: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.discover.ts packages/protocol/src/opportunity/tests/opportunity.discover.questions.spec.ts
git commit -m "feat(opportunity): integrate decision-question generator into runDiscoverFromQuery"
```

---

## Task 10: Surface `questions` on the tool envelope

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.tools.ts` (around lines 855–890, 1113–1131)

**Why:** Forward the orchestrator-path `questions` field on the `success({...})` payload. Stripped from the LLM-facing string the same way `_graphTimings` is.

- [ ] **Step 10.1: Pass deps + flag into `runDiscoverFromQuery`**

Find the existing `result = await runDiscoverFromQuery({...})` call around line 863 and add three lines inside the option object:

```ts
        ...(deps.chatSummary && { chatSummary: deps.chatSummary }),
        ...(deps.questionGenerator && { questionGenerator: deps.questionGenerator }),
        enableQuestions: process.env.ENABLE_DISCOVERY_QUESTIONS === "true",
```

- [ ] **Step 10.2: Surface `questions` + `_discoveryQuestionsDebug` on success envelope**

In the same file, the final orchestrator-path `success({...})` block around line 1113–1131. Replace it with:

```ts
      return success({
        found: true,
        count: displayedCards.length,
        message,
        summary: `Found ${displayedCards.length} match(es)`,
        ...(result.existingConnections?.length ? { existingConnections: result.existingConnections } : {}),
        ...(result.pagination ? { pagination: result.pagination } : {}),
        debugSteps: allDebugSteps,
        ...(searchQuery && !query.targetUserId && !isIntroducerFlow
          ? {
              suggestIntentCreationForVisibility: true,
              suggestedIntentDescription: searchQuery,
            }
          : {}),
        ...(result.questions && result.questions.length > 0 ? { questions: result.questions } : {}),
        ...(result.discoveryQuestionsDebug ? { _discoveryQuestionsDebug: result.discoveryQuestionsDebug } : {}),
        _graphTimings: _allGraphTimings,
      });
```

- [ ] **Step 10.3: Run tsc**

The behavioral path (`questions` produced by the generator and threading through the discover result) is exercised by Task 9's integration test against `runDiscoverFromQuery`. Steps 10.1–10.2 are pure shape additions — tsc will catch any mismatch in the spread.

Run: `cd packages/protocol && bun run build`
Expected: tsc clean.

- [ ] **Step 10.4: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.tools.ts
git commit -m "feat(tool): surface questions + discoveryQuestionsDebug on discover_opportunities envelope"
```

---

## Task 11: Harvest decisionQuestions in `chat.agent.ts` + emit `decision_questions` event

**Files:**
- Modify: `packages/protocol/src/chat/chat.agent.ts` (lines ~605–675, 875–1010, 1177–1190)

**Why:** Extract `questions` + `_discoveryQuestionsDebug` from the `discover_opportunities` tool result, emit a `decision_questions` writer event, and forward both into the agent loop's `debugMeta` for the SSE controller.

- [ ] **Step 11.1: Extract questions + debug from the tool result**

Edit `normalizeToolResult` (around line 600). Extend its return type:

```ts
  ): Promise<{
    resultStr: string;
    summary: string;
    debugSteps?: Array<{ step: string; detail?: string; data?: Record<string, unknown> }>;
    graphTimings?: Array<{ name: string; durationMs: number; agents: Array<{ name: string; durationMs: number }> }>;
    decisionQuestions?: import("../shared/schemas/question.schema.js").Question[];
    discoveryQuestionsDebug?: import("./chat-streaming.types.js").DebugMetaDiscoveryQuestions;
  }>
```

Inside the existing `try { const parsed = JSON.parse(normalized) ...` block, after the `_graphTimings` extraction (around line 667, just before the final `return {...}`), add:

```ts
      const rawQuestions = (payload as { questions?: unknown }).questions ?? (parsed as { questions?: unknown }).questions;
      const rawQuestionDebug = (payload as { _discoveryQuestionsDebug?: unknown })._discoveryQuestionsDebug
        ?? (parsed as { _discoveryQuestionsDebug?: unknown })._discoveryQuestionsDebug;
      let decisionQuestions: import("../shared/schemas/question.schema.js").Question[] | undefined;
      let discoveryQuestionsDebug: import("./chat-streaming.types.js").DebugMetaDiscoveryQuestions | undefined;
      if (Array.isArray(rawQuestions)) {
        decisionQuestions = rawQuestions as import("../shared/schemas/question.schema.js").Question[];
      }
      if (rawQuestionDebug && typeof rawQuestionDebug === "object") {
        discoveryQuestionsDebug = rawQuestionDebug as import("./chat-streaming.types.js").DebugMetaDiscoveryQuestions;
      }
      // Strip both from the LLM-facing string the same way _graphTimings is stripped.
      if (decisionQuestions !== undefined || discoveryQuestionsDebug !== undefined) {
        try {
          const cleaned = JSON.parse(normalized) as Record<string, unknown>;
          const stripFrom = (obj: Record<string, unknown>) => {
            delete obj.questions;
            delete obj._discoveryQuestionsDebug;
          };
          stripFrom(cleaned);
          if (cleaned.data && typeof cleaned.data === "object") {
            stripFrom(cleaned.data as Record<string, unknown>);
          }
          normalized = JSON.stringify(cleaned);
        } catch { /* keep original */ }
      }
```

Update the final return:

```ts
    return {
      resultStr: normalized,
      summary,
      debugSteps,
      graphTimings,
      ...(decisionQuestions !== undefined ? { decisionQuestions } : {}),
      ...(discoveryQuestionsDebug !== undefined ? { discoveryQuestionsDebug } : {}),
    };
```

- [ ] **Step 11.2: Surface the data through the streaming agent loop**

Inside `streamRun` (around line 750), declare two new locals at the top alongside `orchestratorNegotiationIds`:

```ts
    let latestDecisionQuestions: import("../shared/schemas/question.schema.js").Question[] | undefined;
    let latestDiscoveryQuestionsDebug: import("./chat-streaming.types.js").DebugMetaDiscoveryQuestions | undefined;
```

Find the spot inside the loop where `normalizeToolResult` is called for `discover_opportunities` (search for the existing `await this.normalizeToolResult(toolName, resultStr, toolArgs)` call). Capture the new fields immediately after:

```ts
        const normalized = await this.normalizeToolResult(toolName, resultStr, toolArgs);
        if (normalized.decisionQuestions) latestDecisionQuestions = normalized.decisionQuestions;
        if (normalized.discoveryQuestionsDebug) latestDiscoveryQuestionsDebug = normalized.discoveryQuestionsDebug;
```

(Re-assign existing destructure of `normalized.resultStr`, etc., from this object — the implementer keeps the existing pattern.)

When questions are present, emit a `decision_questions` writer event right after the tool result is pushed into `toolResults`. Add the writer call inside the relevant branch:

```ts
        if (latestDecisionQuestions && latestDecisionQuestions.length > 0) {
          emit({ type: "decision_questions", questions: latestDecisionQuestions });
        }
```

You'll need to add `decision_questions` to the `AgentStreamEvent` union (top of chat.agent.ts, around line 60):

```ts
  | { type: "decision_questions"; questions: import("../shared/schemas/question.schema.js").Question[] }
```

- [ ] **Step 11.3: Forward into the agent loop's `debugMeta` returns**

At each existing `return { responseText, messages, iterationCount, debugMeta: {...} }` site (three occurrences around lines 1177, 1196, and the hard-limit branch), extend the `debugMeta` object:

```ts
          debugMeta: {
            graph: "agent_loop",
            iterations: iterationCount,
            tools: toolsDebug,
            llm,
            ...(orchestratorNegotiationIds.size > 0 && {
              orchestratorNegotiations: { opportunityIds: [...orchestratorNegotiationIds] },
            }),
            ...(latestDiscoveryQuestionsDebug && { discoveryQuestions: latestDiscoveryQuestionsDebug }),
          },
```

The `Question[]` itself does NOT need to thread through the `run()` return signature. It travels via the writer-emitted `decision_questions` event (Step 11.2 + streamer relay in Step 11.5 + controller capture in Task 12). Only the `discoveryQuestions` debug block flows through `debugMeta` (above). Leave `run()` and `runIteration()` return signatures unchanged.

- [ ] **Step 11.4: Write the streamer relay test**

Create `packages/protocol/src/chat/tests/chat.streamer.decisionQuestions.spec.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { ChatStreamer } from "../chat.streamer.js";

describe("ChatStreamer — decision_questions relay", () => {
  it("forwards a custom decision_questions writer event as a typed stream event", async () => {
    const fakeGraph = {
      async *stream(_initial: unknown, _opts: unknown) {
        yield ["custom", { type: "decision_questions", questions: [{ title: "T", prompt: "P?", options: [{ label: "a", description: "x" }, { label: "b", description: "y" }], multiSelect: false }] }];
        yield ["updates", { agent_loop: { responseText: "ok", debugMeta: { graph: "agent_loop", iterations: 1 } } }];
      },
    };
    const streamer = new ChatStreamer(async () => [], () => fakeGraph as never);
    const events: Array<{ type?: string }> = [];
    for await (const ev of streamer.streamChatEvents({ userId: "u", messages: [] }, "s-1")) {
      events.push(ev);
    }
    const decisionEvents = events.filter((e) => e.type === "decision_questions");
    expect(decisionEvents).toHaveLength(1);
  });
});
```

- [ ] **Step 11.5: Add the relay handler in `chat.streamer.ts`**

Edit `packages/protocol/src/chat/chat.streamer.ts`. Add an import:

```ts
import { createDecisionQuestionsEvent } from "./chat-streaming.types.js";
```

Inside the `custom` branch (around line 187), after the existing `agent_end` handler add:

```ts
          if (event.type === "decision_questions") {
            yield createDecisionQuestionsEvent(sessionId, { questions: event.questions });
          }
```

- [ ] **Step 11.6: Run the streamer test + tsc**

Run: `cd packages/protocol && bun test src/chat/tests/chat.streamer.decisionQuestions.spec.ts && bun run build`
Expected: PASS, 1 test. tsc clean.

- [ ] **Step 11.7: Commit**

```bash
git add packages/protocol/src/chat/chat.agent.ts packages/protocol/src/chat/chat.streamer.ts packages/protocol/src/chat/tests/chat.streamer.decisionQuestions.spec.ts
git commit -m "feat(chat): harvest + relay decisionQuestions through the chat stream"
```

---

## Task 12: Surface `decisionQuestions` on the `done` SSE event

**Files:**
- Modify: `backend/src/controllers/chat.controller.ts` (lines ~270–396)

**Why:** Collect the typed `decision_questions` events from the protocol's stream and attach `decisionQuestions` to the final `done` SSE event so the frontend (Slice 4) can render.

- [ ] **Step 12.1: Capture the events in the controller**

Edit `backend/src/controllers/chat.controller.ts`. Near the top of the inner async function (where existing locals like `assistantMessageId`, `fullResponse`, `debugMeta` are declared, around line 280), add:

```ts
        let decisionQuestions: import("@indexnetwork/protocol").Question[] | undefined;
```

Inside the loop that consumes `streamer.streamChatEventsWithContext(...)` (where `event.type` cases like `"token"` or `"done"` are handled), add:

```ts
          if (event.type === "decision_questions") {
            decisionQuestions = (event as { questions: import("@indexnetwork/protocol").Question[] }).questions;
            // Re-emit verbatim so the frontend can begin rendering immediately
            // without waiting for the `done` payload.
            controller.enqueue(encoder.encode(formatSSEEvent(event)));
            continue;
          }
```

Finally, extend the `createDoneEvent` call (around line 386):

```ts
              createDoneEvent(sessionId, fullResponse, {
                messageId: assistantMessageId,
                routingDecision,
                subgraphResults,
                title: sessionTitle,
                suggestions,
                ...(decisionQuestions !== undefined ? { decisionQuestions } : {}),
              }),
```

- [ ] **Step 12.2: Run tsc**

Run: `cd backend && bun run tsc --noEmit`
Expected: clean.

- [ ] **Step 12.3: Commit**

```bash
git add backend/src/controllers/chat.controller.ts
git commit -m "feat(chat-controller): forward decisionQuestions to done SSE event"
```

---

## Task 13: Chat prompt addendum

**Files:**
- Modify: `packages/protocol/src/chat/chat.prompt.modules.ts` (around line 152)

**Why:** Tell the LLM not to rephrase the questions — they render as their own card surface.

- [ ] **Step 13.1: Append the guidance line**

Edit `packages/protocol/src/chat/chat.prompt.modules.ts`. Find line 152 inside `discoveryModule.content`:

```ts
When either tool returns ```opportunity code blocks, include them verbatim in your reply so they render as cards.
```

Insert immediately after it (still inside the same template literal):

```ts

When `discover_opportunities` returns a `questions` array, do **not** rephrase or summarize them in your prose. The frontend renders them as an interactive decision card surface. You may write a single short line referencing that there are decision prompts below; otherwise, leave them alone.
```

- [ ] **Step 13.2: Run the existing prompt module tests**

Run: `cd packages/protocol && bun test src/chat/tests/chat.prompt.modules.spec.ts`
Expected: PASS, no regressions.

- [ ] **Step 13.3: Commit**

```bash
git add packages/protocol/src/chat/chat.prompt.modules.ts
git commit -m "docs(chat-prompt): instruct agent not to rephrase decision questions"
```

---

## Task 14: Final verification

**Files:**
- (Read-only): all of the above.

- [ ] **Step 14.1: Type-check the whole protocol package**

Run: `cd packages/protocol && bun run build`
Expected: tsc clean.

- [ ] **Step 14.2: Type-check the backend**

Run: `cd backend && bun run tsc --noEmit`
Expected: tsc clean.

- [ ] **Step 14.3: Lint both packages**

Run: `cd packages/protocol && bun run lint && cd ../../backend && bun run lint`
Expected: 0 errors.

- [ ] **Step 14.4: Run all the new/affected tests**

Run:
```bash
cd packages/protocol && \
bun test \
  src/negotiation/tests/negotiation.graph.on-resolved-payload.spec.ts \
  src/opportunity/tests/negotiation-summary.builder.spec.ts \
  src/opportunity/tests/discovery-question.helper.spec.ts \
  src/opportunity/tests/opportunity.graph.discovery-negotiations.spec.ts \
  src/opportunity/tests/opportunity.discover.questions.spec.ts \
  src/opportunity/tests/opportunity.tools.spec.ts \
  src/chat/tests/chat-streaming.types.discoveryQuestions.spec.ts \
  src/chat/tests/chat.streamer.decisionQuestions.spec.ts \
  src/shared/interfaces/tests/question-generator.interface.spec.ts && \
cd ../../backend && \
bun test src/services/tests/question-generator.service.spec.ts
```
Expected: All passing.

- [ ] **Step 14.5: Smoke-verify ambient path untouched**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.graph.dedup.spec.ts src/opportunity/tests/opportunity.graph.negotiate-timeout.spec.ts`
Expected: PASS — these exercise the ambient/legacy paths and must not regress.

- [ ] **Step 14.6: Final commit (if any docs need touching)**

If any acceptance criteria pointed at unchanged paths still need verification or doc tweaks (e.g. a missing JSDoc line), make them in this commit. Otherwise, no commit needed.

```bash
# Only if there are residual edits.
git status
```

---

## Acceptance criteria mapping (spec → tasks)

- Configuration (ENABLE_DISCOVERY_QUESTIONS + DISCOVERY_QUESTIONS_INPUT_MODE): Tasks 9, 10.
- Trigger gate (orchestrator-only): Task 9 (`maybeBuildQuestions` returns early).
- DiscoverInput dep injection (chatSummary + questionGenerator): Tasks 4, 6, 9, 10.
- Parallel digest fetch + generator call: Task 9 (`maybeBuildQuestions` ordering — digest first, then generator).
- Trace events (chat_summarizer_* + question_generator_*): Tasks 8, 9.
- Truncation accounting: Task 9 (deferred — generator's internal selection is opaque; the event has `truncated?` slot ready for a follow-up).
- Tool result extension: Task 10.
- Streamer extension (decisionQuestions block): Tasks 8, 11.
- Chat prompt addendum: Task 13.
- debugMeta.discoveryQuestions: Tasks 8, 9, 11.
- Tests (integration + streamer): Tasks 9, 11.

---

## Self-review notes

- **Spec coverage:** every section of `2026-05-14-discovery-question-integration-design.md` maps to a task above. The spec's `truncated` field on `question_generator_start` is wired into the event payload (Task 8) but populated only when generator-level truncation becomes observable — non-blocking for MVP, no behavioral test required.
- **Type consistency:** `Question`, `QuestionStrategy`, `DiscoveryQuestionInput`, `DiscoveryNegotiation`, `DiscoverySummary`, `ChatContextDigest`, `QuestionGeneratorReader`, `ChatSummaryReader` names are stable across tasks. `decisionQuestions` is consistently spelled (no `decision_questions` in field names — that's only the SSE event type).
- **Backwards compat:** `DiscoverInput` additions are all optional; existing ambient callers (queue workers, maintenance scripts) are unaffected. `DoneEvent.decisionQuestions` is optional. `OnNegotiationResolved` signature widens — existing destructuring-only consumers (orchestrator branch in opportunity.graph.ts) are fine because we control the only call site.
- **No schema migrations:** Slice 1 handled persistence; this slice is in-memory only.
