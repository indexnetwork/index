# Question schema + generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure protocol-layer `QuestionGenerator` that turns a structured discovery turn (query, profile, negotiation transcripts + outcomes, optional chat digest, time) into 0–3 decision questions matching the brainstorming `AskUserQuestion` shape.

**Architecture:** Three small protocol-side files with single responsibilities — `question.schema.ts` (public + internal Zod schemas and types), `question.prompt.ts` (system prompt constant + input type + pure user-prompt builder), `question.generator.ts` (LLM-driven class + guardrails). Zero DB, zero events. Slice 3 will be the first consumer.

**Tech Stack:** TypeScript (strict), Zod, LangChain/OpenAI (`createModel`), `bun:test`.

**Linear:** IND-298 (parent IND-296). Slice 1 (IND-297) shipped to `dev` at `698f7a60`; `@indexnetwork/protocol` is at `0.31.0` with `ChatContextDigest` available.

**Spec:** `docs/superpowers/specs/2026-05-14-question-generator-design.md`. **Master design:** `docs/superpowers/specs/2026-05-14-discovery-decision-questions-design.md`.

---

## Spec adjustment applied

The spec describes a truncation rule "keep the 4 with most turns plus the 4 with highest seed-assessment scores" but the `DiscoveryQuestionInput` shape has no seed-assessment-score field. Resolution: add an optional `seedAssessmentScore?: number` to each negotiation; truncation uses a single deterministic sort `[turns.length desc, (seedAssessmentScore ?? 0) desc]` and keeps the top 8. Slice 3 will populate `seedAssessmentScore` from the opportunity graph; Slice 2 callers without the score still get sensible behavior.

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `packages/protocol/src/shared/agent/model.config.ts` | Modify | Add `discoveryQuestionGenerator` model slot. |
| `packages/protocol/src/shared/schemas/question.schema.ts` | Create | Public `QuestionSchema` + internal `QuestionWithStrategySchema` + `QuestionGeneratorResponseSchema` + types + `QuestionGenerationResult` interface. |
| `packages/protocol/src/shared/schemas/tests/question.schema.spec.ts` | Create | Schema validation tests. |
| `packages/protocol/src/opportunity/question.prompt.ts` | Create | `SYSTEM_PROMPT` constant + `DiscoveryQuestionInput` type + `buildQuestionPrompt` builder (pure string output). |
| `packages/protocol/src/opportunity/tests/question.prompt.spec.ts` | Create | Builder tests (string assertions, no LLM). |
| `packages/protocol/src/opportunity/question.generator.ts` | Create | `QuestionGenerator` class + guardrail helpers (dedup, strategy diversity). |
| `packages/protocol/src/opportunity/tests/question.generator.spec.ts` | Create | Generator behavior with mocked LLM. |
| `packages/protocol/src/index.ts` | Modify | Export schemas, types, `DiscoveryQuestionInput`, `QuestionGenerator`. |

---

## Pre-flight (run once at start)

The worktree is already on `feat/question-generator` tracking `upstream/dev` with deps installed. Confirm before Task 1:

```bash
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions status
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions log --oneline -3
```

Expected: clean working tree, branch `feat/question-generator`, tip is the upstream/dev merge `698f7a60`. If the protocol's `dist/` is stale (downstream backend tsc can fail with "Cannot find module '@indexnetwork/protocol'"), build it:

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol && bun run build
```

---

## Task 1: Add `discoveryQuestionGenerator` model slot

**Files:**
- Modify: `packages/protocol/src/shared/agent/model.config.ts`

Pattern mirrors `chatContextSummarizer` and `negotiationInsights`. The generator is a structured-output pass over ~10 KB of negotiation evidence; medium-tier model is appropriate — keep `gemini-2.5-flash` (the file's default) and use a slightly higher temperature than the extractive summarizer to allow phrasing variety in the questions.

- [ ] **Step 1: Locate the slot block**

```bash
grep -n "chatContextSummarizer\|negotiationInsights" /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol/src/shared/agent/model.config.ts
```

Expected: two adjacent lines around 59–60.

- [ ] **Step 2: Add the new slot directly after `chatContextSummarizer`**

```ts
    chatContextSummarizer: { model: "google/gemini-2.5-flash", temperature: 0.2, maxTokens: 512 },
    discoveryQuestionGenerator: { model: "google/gemini-2.5-flash", temperature: 0.5, maxTokens: 1024 },
```

Rationale: `temperature: 0.5` is mid-band (above extractive 0.2, below narrative 0.4 since this output is more generative than `negotiationInsights`); `maxTokens: 1024` accommodates up to 3 questions × ~400 chars prompt + 2–4 options × ~280 chars description ≈ 4–5 KB → well under 1024 tokens.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol
bun x tsc --noEmit
```

Expected: clean (the slot key automatically widens `keyof ReturnType<typeof getModelConfig>`).

- [ ] **Step 4: Commit**

```bash
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions add packages/protocol/src/shared/agent/model.config.ts
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions commit -m "feat(protocol): add discoveryQuestionGenerator model slot (IND-298)"
```

---

## Task 2: Question schemas + types + tests

**Files:**
- Create: `packages/protocol/src/shared/schemas/question.schema.ts`
- Create: `packages/protocol/src/shared/schemas/tests/question.schema.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/shared/schemas/tests/question.schema.spec.ts`:

```ts
import { describe, it, expect } from "bun:test";

import {
  QuestionOptionSchema,
  QuestionSchema,
  QuestionStrategySchema,
  QuestionWithStrategySchema,
  QuestionGeneratorResponseSchema,
} from "../question.schema.js";

const okOption = { label: "Stay focused", description: "Higher risk but cleaner narrative" };

const okQuestion = {
  title: "Stage",
  prompt: "Are you pre- or post-revenue?",
  options: [okOption, { label: "Pivot", description: "Wider candidate pool" }],
  multiSelect: false,
};

describe("QuestionOptionSchema", () => {
  it("accepts well-formed options", () => {
    expect(() => QuestionOptionSchema.parse(okOption)).not.toThrow();
  });
  it("rejects option label longer than 120 chars", () => {
    const long = { label: "x".repeat(121), description: "ok" };
    expect(() => QuestionOptionSchema.parse(long)).toThrow();
  });
  it("rejects option description longer than 280 chars", () => {
    const long = { label: "ok", description: "x".repeat(281) };
    expect(() => QuestionOptionSchema.parse(long)).toThrow();
  });
  it("rejects empty label", () => {
    expect(() => QuestionOptionSchema.parse({ label: "", description: "ok" })).toThrow();
  });
});

describe("QuestionSchema", () => {
  it("accepts a single-select question with 2 options", () => {
    expect(() => QuestionSchema.parse(okQuestion)).not.toThrow();
  });

  it("accepts a multi-select question with 4 options", () => {
    const four = {
      ...okQuestion,
      multiSelect: true,
      options: [
        { label: "a", description: "d1" },
        { label: "b", description: "d2" },
        { label: "c", description: "d3" },
        { label: "d", description: "d4" },
      ],
    };
    expect(() => QuestionSchema.parse(four)).not.toThrow();
  });

  it("rejects title longer than 12 chars", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, title: "x".repeat(13) })).toThrow();
  });

  it("rejects fewer than 2 options", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, options: [okOption] })).toThrow();
  });

  it("rejects more than 4 options", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ label: `o${i}`, description: `d${i}` }));
    expect(() => QuestionSchema.parse({ ...okQuestion, options: five })).toThrow();
  });

  it("rejects prompt longer than 400 chars", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, prompt: "x".repeat(401) })).toThrow();
  });

  it("rejects empty prompt", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, prompt: "" })).toThrow();
  });

  it("rejects missing multiSelect", () => {
    const { multiSelect: _, ...rest } = okQuestion;
    expect(() => QuestionSchema.parse(rest)).toThrow();
  });
});

describe("QuestionStrategySchema", () => {
  const strategies = [
    "refine_intent",
    "surface_missing_detail",
    "open_adjacent_thread",
    "reflective_summary",
    "surface_emergent_knowledge",
  ];

  for (const s of strategies) {
    it(`accepts strategy "${s}"`, () => {
      expect(() => QuestionStrategySchema.parse(s)).not.toThrow();
    });
  }

  it("rejects an unknown strategy", () => {
    expect(() => QuestionStrategySchema.parse("guess_lottery_numbers")).toThrow();
  });
});

describe("QuestionWithStrategySchema", () => {
  it("accepts a question with a valid strategy", () => {
    expect(() => QuestionWithStrategySchema.parse({ ...okQuestion, strategy: "refine_intent" })).not.toThrow();
  });
  it("rejects a question with an invalid strategy", () => {
    expect(() => QuestionWithStrategySchema.parse({ ...okQuestion, strategy: "bogus" })).toThrow();
  });
});

describe("QuestionGeneratorResponseSchema", () => {
  it("accepts an empty questions array", () => {
    expect(() => QuestionGeneratorResponseSchema.parse({ questions: [] })).not.toThrow();
  });
  it("accepts up to 3 questions", () => {
    const three = Array.from({ length: 3 }, (_, i) => ({
      ...okQuestion,
      title: `T${i}`,
      strategy: "refine_intent" as const,
    }));
    expect(() => QuestionGeneratorResponseSchema.parse({ questions: three })).not.toThrow();
  });
  it("rejects more than 3 questions", () => {
    const four = Array.from({ length: 4 }, (_, i) => ({
      ...okQuestion,
      title: `T${i}`,
      strategy: "refine_intent" as const,
    }));
    expect(() => QuestionGeneratorResponseSchema.parse({ questions: four })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol
bun test src/shared/schemas/tests/question.schema.spec.ts
```

Expected: FAIL with `Cannot find module '../question.schema.js'`.

- [ ] **Step 3: Write the schema file**

Create `packages/protocol/src/shared/schemas/question.schema.ts`:

```ts
/**
 * Question — public structured shape consumed by frontend renderers and MCP
 * elicitation dispatch. Mirrors the brainstorming AskUserQuestion skill so a
 * Question can be rendered identically across surfaces.
 *
 * `QuestionWithStrategy` extends the public shape with an internal `strategy`
 * tag used by the generator's guardrails (dedup/diversity) and recorded in
 * `debugMeta`. The tag is stripped before the public payload leaves the
 * generator — users never see it.
 */
import { z } from "zod";

export const QuestionOptionSchema = z.object({
  /** Display text. Suffix " (Recommended)" on the safest path; list it first. */
  label: z.string().min(1).max(120),
  /** Explains the consequence of choosing this option, not just its definition. */
  description: z.string().min(1).max(280),
});

export const QuestionSchema = z.object({
  /** ≤12 chars. Noun of the decision domain — e.g. "Stage", "Timing", "Role". */
  title: z.string().min(1).max(12),
  /** ≤2 sentences, ≤400 chars. Ends in a question mark. */
  prompt: z.string().min(1).max(400),
  /** 2–4 options. No explicit "Other" — clients provide that automatically. */
  options: z.array(QuestionOptionSchema).min(2).max(4),
  /** True when options are not mutually exclusive (priorities, bundles). */
  multiSelect: z.boolean(),
});

export const QuestionStrategySchema = z.enum([
  "refine_intent",
  "surface_missing_detail",
  "open_adjacent_thread",
  "reflective_summary",
  "surface_emergent_knowledge",
]);

export const QuestionWithStrategySchema = QuestionSchema.extend({
  strategy: QuestionStrategySchema,
});

export const QuestionGeneratorResponseSchema = z.object({
  questions: z.array(QuestionWithStrategySchema).max(3),
});

export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionStrategy = z.infer<typeof QuestionStrategySchema>;
export type QuestionWithStrategy = z.infer<typeof QuestionWithStrategySchema>;
export type QuestionGeneratorResponse = z.infer<typeof QuestionGeneratorResponseSchema>;

/**
 * Internal generator output: public questions plus a parallel strategies
 * array for debug-only consumption. The generator emits this; callers
 * forward `questions` to renderers and `strategies` to `debugMeta` only.
 */
export interface QuestionGenerationResult {
  questions: Question[];
  strategies: QuestionStrategy[];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol
bun test src/shared/schemas/tests/question.schema.spec.ts
```

Expected: all tests pass (around 22 assertions).

- [ ] **Step 5: Typecheck**

```bash
bun x tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions add packages/protocol/src/shared/schemas/question.schema.ts packages/protocol/src/shared/schemas/tests/question.schema.spec.ts
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions commit -m "feat(protocol): add Question/QuestionStrategy/Generator schemas (IND-298)"
```

---

## Task 3: Prompt module — DiscoveryQuestionInput + buildQuestionPrompt + tests

**Files:**
- Create: `packages/protocol/src/opportunity/question.prompt.ts`
- Create: `packages/protocol/src/opportunity/tests/question.prompt.spec.ts`

The prompt module owns the `DiscoveryQuestionInput` contract and the pure string-building logic. The generator class (Task 4) imports both.

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/opportunity/tests/question.prompt.spec.ts`:

```ts
import { describe, it, expect } from "bun:test";

import {
  buildQuestionPrompt,
  type DiscoveryQuestionInput,
  type DiscoveryNegotiation,
} from "../question.prompt.js";
import type { ChatContextDigest } from "../../shared/schemas/chat-context.schema.js";

function makeNegotiation(overrides: Partial<DiscoveryNegotiation> = {}): DiscoveryNegotiation {
  return {
    counterpartyId: "u1",
    counterpartyHint: "Backend engineer in Berlin",
    indexContext: "Builders looking for co-founders",
    turns: [
      {
        action: "propose",
        reasoning: "Could be a fit; both backend-heavy",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
    ],
    outcome: {
      hasOpportunity: false,
      reasoning: "No clear stage alignment",
    },
    ...overrides,
  };
}

function makeInput(overrides: Partial<DiscoveryQuestionInput> = {}): DiscoveryQuestionInput {
  return {
    query: "I'm looking for a technical co-founder",
    sourceProfile: { name: "Alex" },
    negotiations: [makeNegotiation()],
    summary: {
      totalCandidates: 1,
      opportunitiesFound: 0,
      noOpportunityCount: 1,
      timeoutCount: 0,
      roleDistribution: { peer: 1 },
    },
    now: "2026-05-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildQuestionPrompt", () => {
  it("includes the query verbatim", () => {
    const out = buildQuestionPrompt(makeInput({ query: "find me a Rust mentor" }));
    expect(out).toContain("find me a Rust mentor");
  });

  it("includes the summary counters", () => {
    const out = buildQuestionPrompt(makeInput({
      summary: {
        totalCandidates: 5,
        opportunitiesFound: 2,
        noOpportunityCount: 3,
        timeoutCount: 1,
        roleDistribution: { peer: 3, agent: 1, patient: 1 },
      },
    }));
    expect(out).toContain("5 candidates evaluated");
    expect(out).toContain("2 opportunities found");
    expect(out).toContain("3 ended without opportunity");
    expect(out).toContain("1 hit turn-cap/timeout");
  });

  it("indicates absent chat context", () => {
    const out = buildQuestionPrompt(makeInput({ chatContext: undefined }));
    expect(out).toContain("(no chat context available)");
  });

  it("renders chat-context fields when present", () => {
    const chatContext: ChatContextDigest = {
      statedFacts: ["Pre-revenue", "Based in Berlin"],
      openQuestions: ["What stage?"],
      rejectionReasons: ["All US-based candidates"],
      surfacedFindings: ["Two candidates mentioned the same VC"],
    };
    const out = buildQuestionPrompt(makeInput({ chatContext }));
    expect(out).toContain("Pre-revenue");
    expect(out).toContain("What stage?");
    expect(out).toContain("All US-based candidates");
    expect(out).toContain("Two candidates mentioned the same VC");
  });

  it("includes the now timestamp", () => {
    const out = buildQuestionPrompt(makeInput({ now: "2026-12-25T00:00:00.000Z" }));
    expect(out).toContain("2026-12-25T00:00:00.000Z");
  });

  it("truncates per-turn reasoning to 200 chars", () => {
    const longReasoning = "x".repeat(500);
    const neg = makeNegotiation({
      turns: [{
        action: "propose",
        reasoning: longReasoning,
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      }],
    });
    const out = buildQuestionPrompt(makeInput({ negotiations: [neg] }));
    expect(out).toContain("x".repeat(200));
    expect(out).not.toContain("x".repeat(201));
  });

  it("truncates outcome.reasoning to 300 chars", () => {
    const longReasoning = "y".repeat(500);
    const neg = makeNegotiation({
      outcome: { hasOpportunity: false, reasoning: longReasoning },
    });
    const out = buildQuestionPrompt(makeInput({ negotiations: [neg] }));
    expect(out).toContain("y".repeat(300));
    expect(out).not.toContain("y".repeat(301));
  });

  it("keeps only the last 6 turns per negotiation", () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({
      action: "propose" as const,
      reasoning: `turn-${i}`,
      suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const },
    }));
    const out = buildQuestionPrompt(makeInput({ negotiations: [makeNegotiation({ turns })] }));
    // First 4 turns dropped; last 6 retained.
    expect(out).not.toContain("turn-0");
    expect(out).not.toContain("turn-3");
    expect(out).toContain("turn-4");
    expect(out).toContain("turn-9");
  });

  it("caps the number of negotiations at 8, sorting by [turns desc, seedAssessmentScore desc]", () => {
    // 10 negotiations, distinguishable by counterpartyHint.
    // The two with the FEWEST turns and lowest scores should be dropped.
    const negotiations: DiscoveryNegotiation[] = Array.from({ length: 10 }, (_, i) => makeNegotiation({
      counterpartyHint: `cp-${i}`,
      // i=0..7 get many turns; i=8,9 get one turn — they should be dropped.
      turns: Array.from({ length: i < 8 ? 5 : 1 }, () => ({
        action: "propose" as const,
        reasoning: `t-${i}`,
        suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const },
      })),
      seedAssessmentScore: 1.0 - i * 0.1,
    }));
    const out = buildQuestionPrompt(makeInput({ negotiations }));
    for (let i = 0; i < 8; i++) {
      expect(out).toContain(`cp-${i}`);
    }
    expect(out).not.toContain("cp-8");
    expect(out).not.toContain("cp-9");
  });

  it("includes counterpartyHint and indexContext per negotiation", () => {
    const out = buildQuestionPrompt(makeInput({
      negotiations: [makeNegotiation({
        counterpartyHint: "AI infra founder, Berlin",
        indexContext: "Builders network",
      })],
    }));
    expect(out).toContain("AI infra founder, Berlin");
    expect(out).toContain("Builders network");
  });

  it("never includes counterpartyId", () => {
    const out = buildQuestionPrompt(makeInput({
      negotiations: [makeNegotiation({ counterpartyId: "user-abc123-secret" })],
    }));
    expect(out).not.toContain("user-abc123-secret");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol
bun test src/opportunity/tests/question.prompt.spec.ts
```

Expected: FAIL with `Cannot find module '../question.prompt.js'`.

- [ ] **Step 3: Write the prompt module**

Create `packages/protocol/src/opportunity/question.prompt.ts`:

```ts
/**
 * Prompt module for the decision-question generator: the system prompt
 * constant, the `DiscoveryQuestionInput` contract, and a pure string-building
 * `buildQuestionPrompt` that assembles the user message.
 *
 * Pure: no I/O, no LLM call. The generator class (`question.generator.ts`)
 * orchestrates this module + an LLM client.
 */
import type { ChatContextDigest } from "../shared/schemas/chat-context.schema.js";

/** Roles used in the existing negotiation framework. */
export type NegotiationRole = "agent" | "patient" | "peer";

/** One turn within a negotiation. */
export interface DiscoveryTurn {
  action: "propose" | "accept" | "reject" | "counter" | "question";
  reasoning: string;
  suggestedRoles: { ownUser: NegotiationRole; otherUser: NegotiationRole };
}

/** Outcome of a negotiation. */
export interface DiscoveryOutcome {
  hasOpportunity: boolean;
  reasoning: string;
  agreedRoles?: Array<{ userId: string; role: NegotiationRole }>;
  /** Why the negotiation stopped, when not by an explicit accept/reject. */
  reason?: "turn_cap" | "timeout";
}

/** One negotiation that ran during this discovery turn. */
export interface DiscoveryNegotiation {
  /** Opaque counterparty identifier; NEVER surfaced to the user (kept out of the prompt). */
  counterpartyId: string;
  /** Abstract profile slice for the LLM (e.g. "AI infra founder, Berlin"). */
  counterpartyHint: string;
  /** The network/community prompt this negotiation ran under. */
  indexContext: string;
  /** Last 6 turns are retained; earlier ones are dropped. */
  turns: DiscoveryTurn[];
  outcome: DiscoveryOutcome;
  /**
   * Optional pre-negotiation evaluator score (0..1). When more than
   * `MAX_NEGOTIATIONS` candidates exist, this is used as a tie-breaker after
   * `turns.length` to decide which to keep.
   */
  seedAssessmentScore?: number;
}

/** Aggregate counters across all negotiations in this discovery turn. */
export interface DiscoverySummary {
  totalCandidates: number;
  opportunitiesFound: number;
  noOpportunityCount: number;
  /** Subset of `noOpportunityCount` where the negotiation hit a turn-cap or timeout. */
  timeoutCount: number;
  /** Map of role → count across all outcomes' `agreedRoles`. */
  roleDistribution: Partial<Record<NegotiationRole, number>>;
}

/** The seeker's profile slice the generator sees. All fields optional. */
export interface DiscoverySourceProfile {
  name?: string;
  bio?: string;
  location?: string;
  skills?: string[];
  interests?: string[];
}

/** Full input to the question generator. */
export interface DiscoveryQuestionInput {
  /** The seeker's original natural-language query / signal that triggered discovery. */
  query: string;
  sourceProfile: DiscoverySourceProfile;
  /** Negotiations from THIS discovery turn (capped/sorted by the builder). */
  negotiations: DiscoveryNegotiation[];
  summary: DiscoverySummary;
  /** Distilled chat-session digest, when a session is in scope. */
  chatContext?: ChatContextDigest;
  /** ISO timestamp used as the "now" anchor in the prompt. */
  now: string;
}

/** Upper bound on negotiations included in the prompt; ~10 KB total prompt budget. */
const MAX_NEGOTIATIONS = 8;
/** Upper bound on turns included per negotiation (last N retained). */
const MAX_TURNS_PER_NEGOTIATION = 6;
/** Per-turn reasoning truncation. */
const MAX_TURN_REASONING_CHARS = 200;
/** Outcome reasoning truncation. */
const MAX_OUTCOME_REASONING_CHARS = 300;

export const SYSTEM_PROMPT = `You sit between a human and a discovery protocol that just ran negotiations on their behalf. Your job: surface the minimum set of structured decision questions the human must answer to make the next discovery turn sharper, or improve their outlook on the intent.

You may pick from five strategies. Choose contextually; mix when multiple questions genuinely complement.
- refine_intent: ask the user to sharpen or pivot their original signal.
- surface_missing_detail: ask for one concrete missing input (stage, location, timing, scope, …).
- open_adjacent_thread: offer a pivot suggested by recurring counterparty signals.
- reflective_summary: mirror what the negotiations revealed and ask the user to decide.
- surface_emergent_knowledge: cite a fact you learned from negotiations and ask the user to decide in light of it.

Ask a question only when ALL of these hold:
1. The agent cannot resolve the decision autonomously from the evidence shown.
2. The answer would materially change which candidates surface next.
3. The same fact is NOT already in chatContext.statedFacts, NOT already asked in chatContext.openQuestions, and NOT already shared in chatContext.surfacedFindings.

Cardinality. Default one question. Add a second only when a DIFFERENT strategy genuinely complements the first (e.g. one surface_emergent_knowledge + one refine_intent). Add a third only when there are ≥3 substantive candidates and three distinct strategies each unblock a real decision. Two questions of the same strategy are acceptable only if their decision domains differ (different titles). Avoid stacking three pulls (info-from-user); balance with pushes (info-to-user via reflective_summary / surface_emergent_knowledge).

Ordering. Questions whose answer unblocks the most failed negotiations come first; then highest-impact; then ambiguity-clarifying. Negotiations whose outcome.reason is "turn_cap" or "timeout" signal under-specification — prioritize.

Option construction. Each option must represent a meaningfully different outcome. Suffix the safest path with " (Recommended)" and list it first. The description states the CONSEQUENCE of choosing the option, not its definition. 2–4 options. Never add an "Other" option — clients provide a free-text fallback automatically. For surface_emergent_knowledge questions, anchor the prompt in the concrete cited fact ("Multiple candidates flagged that…") and let the options represent decisions in light of that fact, not different versions of the fact.

Title rules. ≤12 chars. Noun of the decision domain. Discovery examples: "Stage", "Timing", "Role", "Location", "Stack", "Budget", "Scope", "Format".

Anti-patterns — never do these.
- Don't ask procedural confirmations ("Should I look again?").
- Don't ask about hypothetical edge cases that didn't occur.
- Don't ask about specific candidate identities; treat counterpartyHint as the only allowed reference.
- Don't repeat anything in chatContext.openQuestions.
- Don't re-surface anything in chatContext.surfacedFindings.
- Don't ask for facts in chatContext.statedFacts.

Output. Return at most 3 entries in the "questions" array. Each entry must include a "strategy" field (one of the five values). If nothing is worth asking, return "questions": [].`;

/** Pure builder: assembles the user message string from a structured input. */
export function buildQuestionPrompt(input: DiscoveryQuestionInput): string {
  const profileSummary = renderProfile(input.sourceProfile);
  const negotiationBlocks = renderNegotiations(input.negotiations);
  const chatContextBlock = input.chatContext
    ? renderDigest(input.chatContext)
    : "(no chat context available)";
  const roleDistribution = renderRoleDistribution(input.summary.roleDistribution);

  return [
    "## Seeker's query",
    input.query,
    "",
    "## Seeker profile",
    profileSummary,
    "",
    "## This discovery turn",
    `- ${input.summary.totalCandidates} candidates evaluated`,
    `- ${input.summary.opportunitiesFound} opportunities found`,
    `- ${input.summary.noOpportunityCount} ended without opportunity (${input.summary.timeoutCount} hit turn-cap/timeout)`,
    `- Role distribution across outcomes: ${roleDistribution}`,
    "",
    "## Negotiation evidence",
    negotiationBlocks,
    "",
    "## What the user has already said in this session",
    chatContextBlock,
    "",
    "## Now",
    input.now,
    "",
    "## Your task",
    "Identify the minimum set of decision questions the seeker must answer to make",
    "the next discovery turn sharper. Apply every rule from your system prompt",
    "before outputting. Return an empty `questions` array if nothing is worth asking.",
  ].join("\n");
}

function renderProfile(p: DiscoverySourceProfile): string {
  const lines: string[] = [];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.bio) lines.push(`Bio: ${p.bio}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.skills && p.skills.length > 0) lines.push(`Skills: ${p.skills.join(", ")}`);
  if (p.interests && p.interests.length > 0) lines.push(`Interests: ${p.interests.join(", ")}`);
  return lines.length > 0 ? lines.join("\n") : "(no profile data)";
}

function renderRoleDistribution(dist: Partial<Record<NegotiationRole, number>>): string {
  const entries = (Object.entries(dist) as Array<[NegotiationRole, number]>)
    .filter(([, n]) => n > 0);
  if (entries.length === 0) return "(none)";
  return entries.map(([role, n]) => `${role}=${n}`).join(", ");
}

function renderDigest(d: ChatContextDigest): string {
  const lines: string[] = [];
  if (d.statedFacts.length > 0) {
    lines.push("Stated facts:");
    for (const f of d.statedFacts) lines.push(`  - ${f}`);
  }
  if (d.openQuestions.length > 0) {
    lines.push("Open questions (assistant already asked):");
    for (const q of d.openQuestions) lines.push(`  - ${q}`);
  }
  if (d.rejectionReasons.length > 0) {
    lines.push("User pushback / rejections:");
    for (const r of d.rejectionReasons) lines.push(`  - ${r}`);
  }
  if (d.surfacedFindings.length > 0) {
    lines.push("Findings already surfaced to user:");
    for (const f of d.surfacedFindings) lines.push(`  - ${f}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(digest is empty)";
}

function renderNegotiations(negotiations: DiscoveryNegotiation[]): string {
  if (negotiations.length === 0) return "(no negotiations)";
  const selected = selectNegotiations(negotiations).map(renderNegotiation);
  return selected.join("\n\n");
}

/** Sort + cap selection: top MAX_NEGOTIATIONS by [turns.length desc, seedAssessmentScore desc]. */
function selectNegotiations(negotiations: DiscoveryNegotiation[]): DiscoveryNegotiation[] {
  if (negotiations.length <= MAX_NEGOTIATIONS) return negotiations;
  return [...negotiations]
    .sort((a, b) => {
      if (b.turns.length !== a.turns.length) return b.turns.length - a.turns.length;
      return (b.seedAssessmentScore ?? 0) - (a.seedAssessmentScore ?? 0);
    })
    .slice(0, MAX_NEGOTIATIONS);
}

function renderNegotiation(n: DiscoveryNegotiation): string {
  const lastTurns = n.turns.slice(-MAX_TURNS_PER_NEGOTIATION);
  const turnsRendered = lastTurns
    .map((t) => `    [${t.action}] (${t.suggestedRoles.ownUser}↔${t.suggestedRoles.otherUser}) ${truncate(t.reasoning, MAX_TURN_REASONING_CHARS)}`)
    .join("\n");
  const outcomeRole = n.outcome.hasOpportunity ? "opportunity" : "no-opportunity";
  const reasonSuffix = n.outcome.reason ? ` (${n.outcome.reason})` : "";
  return [
    `- Counterparty: ${n.counterpartyHint}`,
    `  Index: ${n.indexContext}`,
    `  Turns (last ${lastTurns.length} of ${n.turns.length}):`,
    turnsRendered,
    `  Outcome: ${outcomeRole}${reasonSuffix} — ${truncate(n.outcome.reasoning, MAX_OUTCOME_REASONING_CHARS)}`,
  ].join("\n");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol
bun test src/opportunity/tests/question.prompt.spec.ts
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
bun x tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions add packages/protocol/src/opportunity/question.prompt.ts packages/protocol/src/opportunity/tests/question.prompt.spec.ts
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions commit -m "feat(protocol): add DiscoveryQuestionInput + system prompt + builder (IND-298)"
```

---

## Task 4: QuestionGenerator class + guardrails + tests

**Files:**
- Create: `packages/protocol/src/opportunity/question.generator.ts`
- Create: `packages/protocol/src/opportunity/tests/question.generator.spec.ts`

The generator wraps the LLM call, validates output via Zod, and applies guardrails (drop invalid, dedup by `title`, strategy diversity), then strips `strategy` from the public payload.

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/opportunity/tests/question.generator.spec.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.test" });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key-for-unit-tests";

import { describe, it, expect, mock } from "bun:test";
import { QuestionGenerator } from "../question.generator.js";
import type { DiscoveryQuestionInput } from "../question.prompt.js";

function makeInput(): DiscoveryQuestionInput {
  return {
    query: "test query",
    sourceProfile: { name: "Tester" },
    negotiations: [],
    summary: {
      totalCandidates: 0,
      opportunitiesFound: 0,
      noOpportunityCount: 0,
      timeoutCount: 0,
      roleDistribution: {},
    },
    now: "2026-05-15T12:00:00.000Z",
  };
}

function makeGenerator(invokeImpl: (input: unknown) => Promise<unknown>) {
  const gen = new QuestionGenerator();
  (gen as unknown as { model: { invoke: typeof invokeImpl } }).model = { invoke: invokeImpl };
  return gen;
}

const okOption = { label: "A", description: "desc-a" };

function makeQuestion(overrides: Record<string, unknown> = {}) {
  return {
    title: "T",
    prompt: "Does it?",
    options: [okOption, { label: "B", description: "desc-b" }],
    multiSelect: false,
    strategy: "refine_intent",
    ...overrides,
  };
}

describe("QuestionGenerator", () => {
  it("returns null when the LLM throws", async () => {
    const gen = makeGenerator(async () => {
      throw new Error("model down");
    });
    const result = await gen.generate(makeInput());
    expect(result).toBeNull();
  });

  it("returns null when LLM output fails Zod parse", async () => {
    const gen = makeGenerator(async () => ({ questions: "not-an-array" }));
    const result = await gen.generate(makeInput());
    expect(result).toBeNull();
  });

  it("returns null when LLM emits an empty questions array", async () => {
    const gen = makeGenerator(async () => ({ questions: [] }));
    const result = await gen.generate(makeInput());
    expect(result).toBeNull();
  });

  it("returns the parsed questions on a clean LLM output", async () => {
    const gen = makeGenerator(async () => ({
      questions: [makeQuestion({ title: "Stage" })],
    }));
    const result = await gen.generate(makeInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(1);
    expect(result!.questions[0].title).toBe("Stage");
    expect(result!.strategies).toEqual(["refine_intent"]);
  });

  it("strips the strategy field from the public questions array", async () => {
    const gen = makeGenerator(async () => ({
      questions: [makeQuestion({ title: "Stage" })],
    }));
    const result = await gen.generate(makeInput());
    expect(result).not.toBeNull();
    // strategy must NOT leak onto the public Question shape
    expect("strategy" in (result!.questions[0] as Record<string, unknown>)).toBe(false);
  });

  it("dedupes questions by title, keeping the first occurrence", async () => {
    const gen = makeGenerator(async () => ({
      questions: [
        makeQuestion({ title: "Stage", prompt: "first?" }),
        makeQuestion({ title: "Stage", prompt: "second?" }),
        makeQuestion({ title: "Timing", strategy: "surface_missing_detail" }),
      ],
    }));
    const result = await gen.generate(makeInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
    expect(result!.questions[0].prompt).toBe("first?");
    expect(result!.questions.map((q) => q.title)).toEqual(["Stage", "Timing"]);
  });

  it("returns parallel strategies array in the same order as questions", async () => {
    const gen = makeGenerator(async () => ({
      questions: [
        makeQuestion({ title: "Q1", strategy: "refine_intent" }),
        makeQuestion({ title: "Q2", strategy: "surface_missing_detail" }),
        makeQuestion({ title: "Q3", strategy: "open_adjacent_thread" }),
      ],
    }));
    const result = await gen.generate(makeInput());
    expect(result!.strategies).toEqual([
      "refine_intent",
      "surface_missing_detail",
      "open_adjacent_thread",
    ]);
  });

  it("returns null when a 4-question LLM payload fails Zod parse (max 3)", async () => {
    // The schema's `.max(3)` rejects this; the parse error path returns null.
    const gen = makeGenerator(async () => ({
      questions: [
        makeQuestion({ title: "A1", strategy: "refine_intent" }),
        makeQuestion({ title: "A2", strategy: "refine_intent" }),
        makeQuestion({ title: "A3", strategy: "refine_intent" }),
        makeQuestion({ title: "B", strategy: "surface_missing_detail" }),
      ],
    }));
    const result = await gen.generate(makeInput());
    expect(result).toBeNull();
  });

  it("keeps all 3 when a Zod-valid batch has 2 same-strategy + 1 distinct (diversity satisfied)", async () => {
    // refine_intent count = 2 (at cap), surface_missing_detail = 1 — all kept.
    const gen = makeGenerator(async () => ({
      questions: [
        makeQuestion({ title: "A1", strategy: "refine_intent" }),
        makeQuestion({ title: "A2", strategy: "refine_intent" }),
        makeQuestion({ title: "B", strategy: "surface_missing_detail" }),
      ],
    }));
    const result = await gen.generate(makeInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(3);
    expect(result!.strategies).toEqual([
      "refine_intent",
      "refine_intent",
      "surface_missing_detail",
    ]);
  });

  it("drops the 3rd same-strategy question (never 3 of the same)", async () => {
    // Three refine_intent in a Zod-valid 3-question batch. The diversity rule
    // caps same-strategy at MAX_SAME_STRATEGY=2, so the 3rd is dropped
    // regardless of whether a distinct alternative exists.
    const gen = makeGenerator(async () => ({
      questions: [
        makeQuestion({ title: "A1", strategy: "refine_intent" }),
        makeQuestion({ title: "A2", strategy: "refine_intent" }),
        makeQuestion({ title: "A3", strategy: "refine_intent" }),
      ],
    }));
    const result = await gen.generate(makeInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
    expect(result!.strategies).toEqual(["refine_intent", "refine_intent"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol
bun test src/opportunity/tests/question.generator.spec.ts
```

Expected: FAIL with `Cannot find module '../question.generator.js'`.

- [ ] **Step 3: Write the generator class**

Create `packages/protocol/src/opportunity/question.generator.ts`:

```ts
/**
 * QuestionGenerator — pure LLM pass that turns a structured DiscoveryQuestionInput
 * into 0–3 decision questions. No DB, no events, no caller wired here; Slice 3
 * (opportunity.discover.ts) is the first consumer.
 *
 * Flow:
 *   1. buildQuestionPrompt(input) → user message string.
 *   2. model.invoke([system, user]) returns a structured payload.
 *   3. safeParse via QuestionGeneratorResponseSchema → null on failure.
 *   4. Guardrails: dedup by title, then strategy-diversity (never 3 same).
 *   5. If empty, return null. Otherwise split into public Question[] + parallel
 *      QuestionStrategy[] (debug-only; strategy is NEVER on the public shape).
 */
import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
  QuestionGeneratorResponseSchema,
  type Question,
  type QuestionGenerationResult,
  type QuestionStrategy,
  type QuestionWithStrategy,
} from "../shared/schemas/question.schema.js";
import { createModel } from "../shared/agent/model.config.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import {
  SYSTEM_PROMPT,
  buildQuestionPrompt,
  type DiscoveryQuestionInput,
} from "./question.prompt.js";

const logger = protocolLogger("QuestionGenerator");

/** Maximum same-strategy questions allowed in a single emission. */
const MAX_SAME_STRATEGY = 2;

export class QuestionGenerator {
  private model: ReturnType<ChatOpenAI["withStructuredOutput"]>;

  constructor() {
    const llm = createModel("discoveryQuestionGenerator");
    this.model = llm.withStructuredOutput(QuestionGeneratorResponseSchema, {
      name: "clarifying_questions",
    });
  }

  /**
   * Generate up to 3 decision questions from the given discovery turn.
   * @returns A result with parallel questions[] and strategies[] arrays,
   *   or null when the LLM fails, the output is malformed, or the
   *   guardrails leave zero questions standing.
   */
  @Timed()
  async generate(input: DiscoveryQuestionInput): Promise<QuestionGenerationResult | null> {
    const user = buildQuestionPrompt(input);

    let raw: unknown;
    try {
      raw = await this.model.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(user),
      ]);
    } catch (err) {
      logger.warn("QuestionGenerator LLM call failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    const parsed = QuestionGeneratorResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("QuestionGenerator parse failed", { error: parsed.error.message });
      return null;
    }

    const filtered = applyGuardrails(parsed.data.questions);
    if (filtered.length === 0) return null;

    return {
      questions: filtered.map(stripStrategy),
      strategies: filtered.map((q) => q.strategy),
    };
  }
}

/**
 * Guardrail pipeline. Order matters:
 *   1. Dedup by title (keep first occurrence).
 *   2. Strategy diversity: cap same-strategy entries at MAX_SAME_STRATEGY when
 *      a question with a distinct strategy exists in the batch.
 */
function applyGuardrails(questions: QuestionWithStrategy[]): QuestionWithStrategy[] {
  const dedupedByTitle = dedupByTitle(questions);
  return enforceStrategyDiversity(dedupedByTitle);
}

function dedupByTitle(questions: QuestionWithStrategy[]): QuestionWithStrategy[] {
  const seen = new Set<string>();
  const out: QuestionWithStrategy[] = [];
  for (const q of questions) {
    if (seen.has(q.title)) continue;
    seen.add(q.title);
    out.push(q);
  }
  return out;
}

/**
 * Enforce the "never 3 same-strategy" rule. Walks the array in order; once a
 * given strategy has appeared MAX_SAME_STRATEGY times, subsequent entries with
 * the same strategy are dropped. Distinct-strategy entries are always kept
 * (subject to the schema's overall 3-question cap, which has already applied).
 */
function enforceStrategyDiversity(
  questions: QuestionWithStrategy[],
): QuestionWithStrategy[] {
  const counts = new Map<QuestionStrategy, number>();
  const out: QuestionWithStrategy[] = [];
  for (const q of questions) {
    const n = counts.get(q.strategy) ?? 0;
    if (n >= MAX_SAME_STRATEGY) continue;
    counts.set(q.strategy, n + 1);
    out.push(q);
  }
  return out;
}

function stripStrategy(q: QuestionWithStrategy): Question {
  const { strategy: _strategy, ...publicShape } = q;
  return publicShape;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol
bun test src/opportunity/tests/question.generator.spec.ts
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
bun x tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions add packages/protocol/src/opportunity/question.generator.ts packages/protocol/src/opportunity/tests/question.generator.spec.ts
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions commit -m "feat(protocol): add QuestionGenerator class with guardrails (IND-298)"
```

---

## Task 5: Export from protocol index

**Files:**
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Locate the existing "Shared schemas" + "Agents" sections**

```bash
grep -n "Shared schemas\|chat.summarizer\|chat-context.schema" /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol/src/index.ts
```

- [ ] **Step 2: Add exports alongside the existing schema/generator groups**

Within the "Shared schemas" section (next to the `ChatContextDigest` exports), add:

```ts
export {
  QuestionOptionSchema,
  QuestionSchema,
  QuestionStrategySchema,
  QuestionWithStrategySchema,
  QuestionGeneratorResponseSchema,
  type Question,
  type QuestionOption,
  type QuestionStrategy,
  type QuestionWithStrategy,
  type QuestionGeneratorResponse,
  type QuestionGenerationResult,
} from "./shared/schemas/question.schema.js";
```

Within the "Agents" section (next to `ChatSummarizer`), add:

```ts
export { QuestionGenerator } from "./opportunity/question.generator.js";
export type {
  DiscoveryQuestionInput,
  DiscoveryNegotiation,
  DiscoveryOutcome,
  DiscoveryTurn,
  DiscoverySummary,
  DiscoverySourceProfile,
  NegotiationRole,
} from "./opportunity/question.prompt.js";
```

(Adjust placement to match the existing section comment style — search for a similar `── Shared schemas ──` or `── Agents ──` divider and slot in next to it.)

- [ ] **Step 3: Build the protocol dist**

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol
bun run build
```

Expected: build succeeds. The dist refresh is what lets backend tsc resolve the new exports later (Slice 3+).

- [ ] **Step 4: Typecheck**

```bash
bun x tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions add packages/protocol/src/index.ts
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions commit -m "feat(protocol): export Question schemas + QuestionGenerator + DiscoveryQuestionInput (IND-298)"
```

---

## Task 6: Final verification

**Files:** (none — verification only)

- [ ] **Step 1: Run the slice's full test set**

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol
bun test \
  src/shared/schemas/tests/question.schema.spec.ts \
  src/opportunity/tests/question.prompt.spec.ts \
  src/opportunity/tests/question.generator.spec.ts
```

Expected: all tests pass; combined count roughly 22 (schema) + 10 (prompt) + 10 (generator) = ~42.

- [ ] **Step 2: Typecheck both workspaces**

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol && bun x tsc --noEmit
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/backend && bun x tsc --noEmit
```

Expected: clean in both.

If `backend` reports `Cannot find module '@indexnetwork/protocol'`, the protocol dist is stale — rebuild:

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/packages/protocol && bun run build
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/backend && bun x tsc --noEmit
```

- [ ] **Step 3: Lint backend (protocol has no `lint` script)**

```bash
cd /Users/aposto/Projects/index/.worktrees/feat-decision-questions/backend
bun run lint 2>&1 | grep -E "question\.|chat-summary|chat\.summarizer" || echo "no slice-2 lint issues"
```

Expected: no issues attributable to Slice 2. (Pre-existing lint errors in unrelated files are out of scope; surface them but do not fix.)

- [ ] **Step 4: If any lint fixes were needed for slice files, commit them**

```bash
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions add <changed files>
git -C /Users/aposto/Projects/index/.worktrees/feat-decision-questions commit -m "style: lint cleanup after IND-298 slice"
```

(If no fixes needed, skip this step.)

---

## Acceptance summary (matches spec)

- [x] `QuestionSchema`, `QuestionStrategySchema`, `QuestionWithStrategySchema`, `QuestionGeneratorResponseSchema`, and all derived types exported from `@indexnetwork/protocol`.
- [x] `DiscoveryQuestionInput` type exported from `@indexnetwork/protocol`.
- [x] `QuestionGenerator` exported from `@indexnetwork/protocol`.
- [x] `discoveryQuestionGenerator` model slot in `model.config.ts`.
- [x] Public `Question` payload never contains the `strategy` field; strategy returned only via `QuestionGenerationResult.strategies` (debug-only).
- [x] Guardrails enforce dedup by title and "never 3 same-strategy."
- [x] LLM failure / parse failure / empty output → `null`.
- [x] Unit tests for schema validation, prompt builder, and generator behavior all pass with LLM mocked.
- [x] `tsc --noEmit` clean in both protocol and backend workspaces.

---

## Risks / open questions (carry-over for Slice 3)

- **No integration test against the real opportunity graph.** Slice 2 is intentionally pure; Slice 3 will wire the generator into `opportunity.discover.ts` and exercise the end-to-end path with a real graph output.
- **`seedAssessmentScore` is optional.** Slice 3 must populate it from the evaluator if the team wants the score-based truncation tie-breaker to matter. Without it, truncation falls back to turn count alone, which is fine for v1.
- **Prompt-bloat risk.** The system prompt is ~2 KB. If real-world quality degrades or the model rejects, consider trimming examples or moving them into the user prompt.
- **Strategy enum churn.** Adding a sixth strategy requires updating the Zod enum + prompt + tests. The enum is exported and `strategy` is debug-only — no public-renderer surface depends on the values today, so a value addition is non-breaking.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-question-generator-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks. Continues the Slice 1 pattern.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans`, batched with checkpoints.
