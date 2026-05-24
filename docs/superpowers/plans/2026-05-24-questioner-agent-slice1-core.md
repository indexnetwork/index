# QuestionerAgent Slice 1: Core Agent + Schemas + Interface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the QuestionerAgent class, type system, discovery preset (migrated from existing QuestionGenerator), persistence interface, and schema extensions in `packages/protocol` — no backend changes.

**Architecture:** Stateless `QuestionerAgent` class receives a `QuestionerInput` envelope containing a `mode` field. The agent selects a preset (system prompt + builder function) based on the mode, invokes the LLM with structured output, and applies guardrails (dedup + strategy diversity). The discovery preset is a direct migration of `question.prompt.ts` and `question.generator.ts`. New persistence types (`QuestionDetection`, `QuestionActor`, `QuestionAnswer`) follow the opportunity table's composable jsonb pattern.

**Tech Stack:** TypeScript, Zod, LangChain (`@langchain/openai`), `bun:test`

---

### Task 1: Add persistence types to question schema

**Files:**
- Modify: `packages/protocol/src/shared/schemas/question.schema.ts`
- Test: `packages/protocol/src/shared/schemas/tests/question.schema.spec.ts`

- [ ] **Step 1: Write the failing tests for new schema types**

Add the following test block to the bottom of `packages/protocol/src/shared/schemas/tests/question.schema.spec.ts`:

```typescript
import {
  QuestionModeSchema,
  QuestionDetectionSchema,
  QuestionActorSchema,
  QuestionAnswerSchema,
} from "../question.schema.js";

describe("QuestionDetection", () => {
  it("accepts a valid detection object", () => {
    const result = QuestionDetectionSchema.safeParse({
      mode: "discovery",
      sourceType: "opportunity",
      sourceId: "abc-123",
      timestamp: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional triggeredBy", () => {
    const result = QuestionDetectionSchema.safeParse({
      mode: "intent",
      sourceType: "intent",
      sourceId: "abc-123",
      triggeredBy: "intent-456",
      timestamp: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.data!.triggeredBy).toBe("intent-456");
  });

  it("rejects an invalid mode", () => {
    const result = QuestionDetectionSchema.safeParse({
      mode: "invalid",
      sourceType: "opportunity",
      sourceId: "abc-123",
      timestamp: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("QuestionActor", () => {
  it("accepts a minimal actor (userId + role only)", () => {
    const result = QuestionActorSchema.safeParse({
      userId: "user-1",
      role: "subject",
    });
    expect(result.success).toBe(true);
    expect(result.data!.networkId).toBeUndefined();
  });

  it("accepts an actor with networkId", () => {
    const result = QuestionActorSchema.safeParse({
      userId: "user-1",
      networkId: "net-1",
      role: "subject",
    });
    expect(result.success).toBe(true);
    expect(result.data!.networkId).toBe("net-1");
  });
});

describe("QuestionAnswer", () => {
  it("accepts a valid answer with selected options", () => {
    const result = QuestionAnswerSchema.safeParse({
      selectedOptions: ["Berlin"],
      answeredBy: "user-1",
      answeredAt: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.data!.freeText).toBeUndefined();
  });

  it("accepts an answer with freeText", () => {
    const result = QuestionAnswerSchema.safeParse({
      selectedOptions: [],
      freeText: "Custom answer",
      answeredBy: "user-1",
      answeredAt: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.data!.freeText).toBe("Custom answer");
  });

  it("requires answeredBy", () => {
    const result = QuestionAnswerSchema.safeParse({
      selectedOptions: ["Berlin"],
      answeredAt: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("QuestionMode", () => {
  it.each(["discovery", "intent", "profile", "negotiation"])("accepts '%s'", (mode) => {
    const result = QuestionModeSchema.safeParse(mode);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown mode", () => {
    const result = QuestionModeSchema.safeParse("unknown");
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/protocol && bun test src/shared/schemas/tests/question.schema.spec.ts`
Expected: FAIL — `QuestionModeSchema`, `QuestionDetectionSchema`, `QuestionActorSchema`, `QuestionAnswerSchema` are not exported.

- [ ] **Step 3: Implement the new schemas**

Add the following to the bottom of `packages/protocol/src/shared/schemas/question.schema.ts`, before the closing `QuestionGenerationResult` interface:

```typescript
// ─── Persistence types (opportunity-style composable jsonb) ──────────────────

export const QuestionModeSchema = z.enum([
  "discovery",
  "intent",
  "profile",
  "negotiation",
]);

export const QuestionDetectionSchema = z.object({
  /** Which preset mode generated this question. */
  mode: QuestionModeSchema,
  /** Entity type that triggered generation (e.g. "opportunity", "intent", "profile"). */
  sourceType: z.string().min(1),
  /** ID of the triggering entity. */
  sourceId: z.string().min(1),
  /** Optional intent ID that was the root cause. */
  triggeredBy: z.string().optional(),
  /** ISO-8601 timestamp of generation. */
  timestamp: z.string().min(1),
});

export const QuestionActorSchema = z.object({
  /** The user this question is for. */
  userId: z.string().min(1),
  /** Optional network context. */
  networkId: z.string().optional(),
  /** Actor's role in the question — currently always "subject". */
  role: z.literal("subject"),
});

export const QuestionAnswerSchema = z.object({
  /** Option labels the user selected. */
  selectedOptions: z.array(z.string()),
  /** Free-text input when the user chose "Other" or elaborated. */
  freeText: z.string().optional(),
  /** User ID of the answerer. */
  answeredBy: z.string().min(1),
  /** ISO-8601 timestamp of when the answer was submitted. */
  answeredAt: z.string().min(1),
});

export type QuestionMode = z.infer<typeof QuestionModeSchema>;
export type QuestionDetection = z.infer<typeof QuestionDetectionSchema>;
export type QuestionActor = z.infer<typeof QuestionActorSchema>;
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/protocol && bun test src/shared/schemas/tests/question.schema.spec.ts`
Expected: All new tests PASS, all existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/shared/schemas/question.schema.ts packages/protocol/src/shared/schemas/tests/question.schema.spec.ts
git commit -m "feat(protocol): add QuestionDetection, QuestionActor, QuestionAnswer schemas"
```

---

### Task 2: Create QuestionerInput types

**Files:**
- Create: `packages/protocol/src/questioner/questioner.types.ts`

- [ ] **Step 1: Create the types file**

```typescript
/**
 * QuestionerAgent input types. The `QuestionerInput` envelope carries a `mode`
 * field that selects a preset, plus a polymorphic `context` that varies per mode.
 *
 * Slice 1 defines all four context shapes but only `DiscoveryContext` has a
 * working preset implementation. The others are type stubs for future slices.
 */
import type { DiscoveryQuestionInput } from "../opportunity/question.prompt.js";
import type { QuestionMode } from "../shared/schemas/question.schema.js";

// ─── Per-mode context types ─────────────────────────────────────────────────

/**
 * Discovery context — wraps the existing DiscoveryQuestionInput wholesale.
 * The discovery preset's buildPrompt delegates to the migrated builder.
 */
export type DiscoveryContext = DiscoveryQuestionInput;

/** Intent context — data needed to generate questions about an intent. */
export interface IntentContext {
  intentId: string;
  payload: string;
  summary?: string;
  userProfile: { name?: string; bio?: string; skills?: string[]; interests?: string[] };
}

/** Profile context — data needed to generate questions to fill profile gaps. */
export interface ProfileContext {
  userProfile: { name?: string; bio?: string; location?: string; skills?: string[]; interests?: string[] };
  gaps: string[];
}

/** Negotiation context — data from a stalled or capped negotiation. */
export interface NegotiationContext {
  negotiationId: string;
  counterpartyHint: string;
  indexContext: string;
  outcomeReason: "turn_cap" | "timeout" | "stalled";
  keyTake: string;
  userProfile: { name?: string; bio?: string; skills?: string[]; interests?: string[] };
}

/** Discriminated union: mode selects the context shape. */
export type QuestionerContext =
  | DiscoveryContext
  | IntentContext
  | ProfileContext
  | NegotiationContext;

/** Top-level input envelope for QuestionerAgent.invoke(). */
export interface QuestionerInput {
  /** Selects the preset (system prompt + builder). */
  mode: QuestionMode;
  /** User the questions are generated for. */
  userId: string;
  /** Entity type that triggered this (e.g. "opportunity", "intent", "profile"). */
  sourceType: string;
  /** ID of the triggering entity. */
  sourceId: string;
  /** Mode-specific context. Must align with the selected mode. */
  context: QuestionerContext;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd packages/protocol && npx tsc --noEmit src/questioner/questioner.types.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/questioner/questioner.types.ts
git commit -m "feat(protocol): add QuestionerInput types and per-mode context shapes"
```

---

### Task 3: Create the discovery preset

**Files:**
- Create: `packages/protocol/src/questioner/questioner.presets.ts`
- Test: `packages/protocol/src/questioner/tests/questioner.presets.spec.ts`

- [ ] **Step 1: Write the failing test for the discovery preset**

Create `packages/protocol/src/questioner/tests/questioner.presets.spec.ts`:

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect } from "bun:test";
import { getPreset } from "../questioner.presets.js";

describe("getPreset", () => {
  it("returns the discovery preset with systemPrompt and buildPrompt", () => {
    const preset = getPreset("discovery");
    expect(preset).toBeDefined();
    expect(typeof preset.systemPrompt).toBe("string");
    expect(preset.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof preset.buildPrompt).toBe("function");
  });

  it("discovery buildPrompt produces a string containing the query", () => {
    const preset = getPreset("discovery");
    const result = preset.buildPrompt({
      query: "looking for ML engineers",
      sourceProfile: { name: "Alice" },
      negotiationDigests: [],
      summary: {
        totalCandidates: 5,
        opportunitiesFound: 2,
        noOpportunityCount: 3,
        timeoutCount: 1,
        roleDistribution: {},
      },
      now: "2026-05-24T12:00:00.000Z",
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("looking for ML engineers");
    expect(result).toContain("Alice");
  });

  it("throws for an unimplemented mode", () => {
    expect(() => getPreset("intent")).toThrow("not implemented");
    expect(() => getPreset("profile")).toThrow("not implemented");
    expect(() => getPreset("negotiation")).toThrow("not implemented");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.presets.spec.ts`
Expected: FAIL — module `../questioner.presets.js` not found.

- [ ] **Step 3: Implement the presets module**

Create `packages/protocol/src/questioner/questioner.presets.ts`:

```typescript
/**
 * Mode presets for the QuestionerAgent. Each preset provides a system prompt
 * and a buildPrompt function that assembles the user message from a typed
 * context object. Only the `discovery` preset ships in Slice 1; others throw
 * until their implementation slices land.
 */
import type { QuestionMode } from "../shared/schemas/question.schema.js";
import {
  SYSTEM_PROMPT as DISCOVERY_SYSTEM_PROMPT,
  buildQuestionPrompt as buildDiscoveryPrompt,
} from "../opportunity/question.prompt.js";

export interface QuestionerPreset {
  /** The LLM system prompt for this mode. */
  systemPrompt: string;
  /** Builds the user-message string from the mode-specific context. */
  buildPrompt: (context: unknown) => string;
}

const presets: Partial<Record<QuestionMode, QuestionerPreset>> = {
  discovery: {
    systemPrompt: DISCOVERY_SYSTEM_PROMPT,
    buildPrompt: (context: unknown) => buildDiscoveryPrompt(context as Parameters<typeof buildDiscoveryPrompt>[0]),
  },
};

/**
 * Retrieve the preset for the given mode.
 * @throws Error if the mode's preset is not yet implemented.
 */
export function getPreset(mode: QuestionMode): QuestionerPreset {
  const preset = presets[mode];
  if (!preset) {
    throw new Error(`QuestionerAgent preset "${mode}" is not implemented yet`);
  }
  return preset;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.presets.spec.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/questioner/questioner.presets.ts packages/protocol/src/questioner/tests/questioner.presets.spec.ts
git commit -m "feat(protocol): add questioner presets module with discovery preset"
```

---

### Task 4: Create the QuestionerAgent class

**Files:**
- Create: `packages/protocol/src/questioner/questioner.agent.ts`
- Test: `packages/protocol/src/questioner/tests/questioner.agent.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/protocol/src/questioner/tests/questioner.agent.spec.ts`:

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key-for-unit-tests";

import { describe, it, expect } from "bun:test";
import { QuestionerAgent } from "../questioner.agent.js";
import type { QuestionerInput, DiscoveryContext } from "../questioner.types.js";

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

function makeDiscoveryInput(): QuestionerInput {
  const context: DiscoveryContext = {
    query: "test query",
    sourceProfile: { name: "Tester" },
    negotiationDigests: [],
    summary: {
      totalCandidates: 0,
      opportunitiesFound: 0,
      noOpportunityCount: 0,
      timeoutCount: 0,
      roleDistribution: {},
    },
    now: "2026-05-24T12:00:00.000Z",
  };
  return {
    mode: "discovery",
    userId: "user-1",
    sourceType: "opportunity",
    sourceId: "opp-1",
    context,
  };
}

function makeAgent(
  invokeImpl: (input: unknown, config?: { signal?: AbortSignal }) => Promise<unknown>,
): QuestionerAgent {
  const agent = new QuestionerAgent();
  // Swap the internal model for a mock, same pattern as question.generator.spec.ts
  (agent as unknown as { model: { invoke: typeof invokeImpl } }).model = { invoke: invokeImpl };
  return agent;
}

describe("QuestionerAgent", () => {
  it("returns null when the LLM throws", async () => {
    const agent = makeAgent(async () => { throw new Error("model down"); });
    const result = await agent.invoke(makeDiscoveryInput());
    expect(result).toBeNull();
  });

  it("returns null when LLM output fails Zod parse", async () => {
    const agent = makeAgent(async () => ({ questions: "not-an-array" }));
    const result = await agent.invoke(makeDiscoveryInput());
    expect(result).toBeNull();
  });

  it("returns null when LLM emits an empty questions array", async () => {
    const agent = makeAgent(async () => ({ questions: [] }));
    const result = await agent.invoke(makeDiscoveryInput());
    expect(result).toBeNull();
  });

  it("returns parsed questions on a clean LLM output", async () => {
    const agent = makeAgent(async () => ({
      questions: [makeQuestion({ title: "Stage" })],
    }));
    const result = await agent.invoke(makeDiscoveryInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(1);
    expect(result!.questions[0].title).toBe("Stage");
    expect(result!.strategies).toEqual(["refine_intent"]);
  });

  it("strips the strategy field from the public questions array", async () => {
    const agent = makeAgent(async () => ({
      questions: [makeQuestion({ title: "Stage" })],
    }));
    const result = await agent.invoke(makeDiscoveryInput());
    expect(result).not.toBeNull();
    expect("strategy" in (result!.questions[0] as Record<string, unknown>)).toBe(false);
  });

  it("dedupes questions by title, keeping the first occurrence", async () => {
    const agent = makeAgent(async () => ({
      questions: [
        makeQuestion({ title: "Stage", prompt: "first?" }),
        makeQuestion({ title: "Stage", prompt: "second?" }),
        makeQuestion({ title: "Timing", strategy: "surface_missing_detail" }),
      ],
    }));
    const result = await agent.invoke(makeDiscoveryInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
    expect(result!.questions[0].prompt).toBe("first?");
  });

  it("drops the 3rd same-strategy question", async () => {
    const agent = makeAgent(async () => ({
      questions: [
        makeQuestion({ title: "A1", strategy: "refine_intent" }),
        makeQuestion({ title: "A2", strategy: "refine_intent" }),
        makeQuestion({ title: "A3", strategy: "refine_intent" }),
      ],
    }));
    const result = await agent.invoke(makeDiscoveryInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
  });

  it("forwards the AbortSignal to the model", async () => {
    let captured: { signal?: AbortSignal } | undefined;
    const agent = makeAgent(async (_input, config) => {
      captured = config;
      return { questions: [makeQuestion({ title: "Stage" })] };
    });
    const controller = new AbortController();
    const result = await agent.invoke(makeDiscoveryInput(), { signal: controller.signal });
    expect(result).not.toBeNull();
    expect(captured?.signal).toBe(controller.signal);
  });

  it("returns null when the signal is already aborted", async () => {
    const controller = new AbortController();
    const agent = makeAgent(async () => {
      controller.abort(new Error("deadline"));
      throw new Error("aborted");
    });
    const result = await agent.invoke(makeDiscoveryInput(), { signal: controller.signal });
    expect(result).toBeNull();
  });

  it("throws for an unimplemented mode", async () => {
    const agent = new QuestionerAgent();
    const input = { ...makeDiscoveryInput(), mode: "intent" as const };
    await expect(agent.invoke(input)).rejects.toThrow("not implemented");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.agent.spec.ts`
Expected: FAIL — module `../questioner.agent.js` not found.

- [ ] **Step 3: Add the `questioner` agent key to model config**

In `packages/protocol/src/shared/agent/model.config.ts`, add a `questioner` entry to the config object inside `getModelConfig()`, after the `discoveryQuestionGenerator` line:

```typescript
    questioner: { model: "google/gemini-2.5-flash", temperature: 0.5, maxTokens: 1024 },
```

- [ ] **Step 4: Implement the QuestionerAgent class**

Create `packages/protocol/src/questioner/questioner.agent.ts`:

```typescript
/**
 * QuestionerAgent — stateless, mode-driven agent that generates structured
 * decision questions from arbitrary protocol contexts.
 *
 * Follows the IndexNegotiator pattern: constructor takes optional config,
 * single public `invoke()` method receives the full context per call.
 * The LLM model is bound once at construction; the preset (system prompt +
 * builder) is selected per invocation based on `input.mode`.
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
import { getPreset } from "./questioner.presets.js";
import type { QuestionerInput } from "./questioner.types.js";

const logger = protocolLogger("QuestionerAgent");

/** Maximum same-strategy questions allowed in a single emission. */
const MAX_SAME_STRATEGY = 2;

export interface QuestionerAgentConfig {
  /** Optional model config override. */
  modelConfig?: Parameters<typeof createModel>[1];
}

/**
 * Stateless question-generation agent. Accepts a `QuestionerInput` envelope,
 * selects the preset for the given mode, invokes the LLM, and applies
 * guardrails (dedup + strategy diversity).
 */
export class QuestionerAgent {
  private model: ReturnType<ChatOpenAI["withStructuredOutput"]>;

  constructor(config?: QuestionerAgentConfig) {
    const llm = createModel("questioner", config?.modelConfig);
    this.model = llm.withStructuredOutput(QuestionGeneratorResponseSchema, {
      name: "clarifying_questions",
    });
  }

  /**
   * Generate up to 3 decision questions from the given input.
   *
   * @param input  Envelope with mode, userId, source info, and mode-specific context.
   * @param options.signal  Optional AbortSignal to cancel the in-flight LLM call.
   * @returns A result with parallel questions[] and strategies[] arrays,
   *   or null when generation failed, guardrails dropped all candidates,
   *   the LLM threw, or the call was aborted.
   */
  @Timed()
  async invoke(
    input: QuestionerInput,
    options?: { signal?: AbortSignal },
  ): Promise<QuestionGenerationResult | null> {
    const preset = getPreset(input.mode);
    const userMessage = preset.buildPrompt(input.context);

    let raw: unknown;
    try {
      raw = await this.model.invoke(
        [new SystemMessage(preset.systemPrompt), new HumanMessage(userMessage)],
        options?.signal ? { signal: options.signal } : undefined,
      );
    } catch (err) {
      const aborted = options?.signal?.aborted ?? false;
      if (aborted) {
        logger.info("QuestionerAgent aborted by signal", {
          mode: input.mode,
          reason: options?.signal?.reason instanceof Error
            ? options.signal.reason.message
            : String(options?.signal?.reason ?? "unknown"),
        });
      } else {
        logger.warn("QuestionerAgent LLM call failed", {
          mode: input.mode,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return null;
    }

    const parsed = QuestionGeneratorResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("QuestionerAgent parse failed", {
        mode: input.mode,
        error: parsed.error.message,
      });
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

// ─── Guardrails (migrated from question.generator.ts) ────────────────────────

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.agent.spec.ts`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/questioner/questioner.agent.ts packages/protocol/src/questioner/tests/questioner.agent.spec.ts packages/protocol/src/shared/agent/model.config.ts
git commit -m "feat(protocol): add QuestionerAgent class with discovery mode support"
```

---

### Task 5: Create the QuestionerDatabase interface

**Files:**
- Create: `packages/protocol/src/shared/interfaces/questioner.interface.ts`
- Test: `packages/protocol/src/shared/interfaces/tests/questioner.interface.spec.ts`

- [ ] **Step 1: Write the type-level test**

Create `packages/protocol/src/shared/interfaces/tests/questioner.interface.spec.ts`:

```typescript
/**
 * Compile-time contract test for QuestionerDatabase. Verifies the interface
 * is importable and that a mock implementation satisfies the contract.
 */
import { describe, it, expect } from "bun:test";
import type {
  QuestionerDatabase,
  PersistableQuestion,
  PersistedQuestion,
} from "../questioner.interface.js";
import type { QuestionAnswer } from "../../schemas/question.schema.js";

describe("QuestionerDatabase interface", () => {
  it("is satisfiable by a mock implementation", () => {
    const mock: QuestionerDatabase = {
      persist: async (_questions: PersistableQuestion[]): Promise<void> => {},
      findPending: async (_userId: string): Promise<PersistedQuestion[]> => [],
      answer: async (_questionId: string, _answer: QuestionAnswer): Promise<void> => {},
      dismiss: async (_questionId: string): Promise<void> => {},
    };
    expect(mock).toBeDefined();
    expect(typeof mock.persist).toBe("function");
    expect(typeof mock.findPending).toBe("function");
    expect(typeof mock.answer).toBe("function");
    expect(typeof mock.dismiss).toBe("function");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/protocol && bun test src/shared/interfaces/tests/questioner.interface.spec.ts`
Expected: FAIL — module `../questioner.interface.js` not found.

- [ ] **Step 3: Implement the interface**

Create `packages/protocol/src/shared/interfaces/questioner.interface.ts`:

```typescript
/**
 * Protocol-level persistence contract for structured questions generated by
 * the QuestionerAgent. Implementations live in the backend and are injected
 * into ProtocolDeps.
 */
import type {
  Question,
  QuestionMode,
  QuestionStrategy,
  QuestionDetection,
  QuestionActor,
  QuestionAnswer,
} from "../schemas/question.schema.js";

/** Shape accepted by `persist()` — everything needed to insert a question row. */
export interface PersistableQuestion {
  detection: QuestionDetection;
  actors: QuestionActor[];
  payload: Question;
  strategy: QuestionStrategy;
}

/** Shape returned by `findPending()` — a persisted question with its DB id and status. */
export interface PersistedQuestion {
  id: string;
  detection: QuestionDetection;
  actors: QuestionActor[];
  payload: Question;
  status: "pending" | "answered" | "dismissed";
  answer: QuestionAnswer | null;
  createdAt: string;
}

/** Optional filters for `findPending()`. */
export interface QuestionFilters {
  mode?: QuestionMode;
  sourceType?: string;
  sourceId?: string;
}

export interface QuestionerDatabase {
  /** Persist a batch of generated questions (up to 3 per generation). */
  persist(questions: PersistableQuestion[]): Promise<void>;

  /** Find pending questions for a user, optionally filtered by mode/source. */
  findPending(userId: string, filters?: QuestionFilters): Promise<PersistedQuestion[]>;

  /** Record an answer for a question. Sets status to "answered". */
  answer(questionId: string, answer: QuestionAnswer): Promise<void>;

  /** Dismiss a question. Sets status to "dismissed". */
  dismiss(questionId: string): Promise<void>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/protocol && bun test src/shared/interfaces/tests/questioner.interface.spec.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/shared/interfaces/questioner.interface.ts packages/protocol/src/shared/interfaces/tests/questioner.interface.spec.ts
git commit -m "feat(protocol): add QuestionerDatabase interface for question persistence"
```

---

### Task 6: Export new modules from index.ts

**Files:**
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Add exports**

Add the following exports to `packages/protocol/src/index.ts`:

Under the `// ─── Shared schemas` section, find the existing `question.schema.js` export block (lines 55-71) and add the new exports to it. The block should become:

```typescript
export {
  QuestionOptionSchema,
  QuestionSchema,
  QuestionStrategySchema,
  QuestionWithStrategySchema,
  QuestionGeneratorResponseSchema,
  QuestionModeSchema,
  QuestionDetectionSchema,
  QuestionActorSchema,
  QuestionAnswerSchema,
  type Question,
  type QuestionOption,
  type QuestionStrategy,
  type QuestionWithStrategy,
  type QuestionGeneratorResponse,
  type QuestionGenerationResult,
  type QuestionMode,
  type QuestionDetection,
  type QuestionActor,
  type QuestionAnswer,
} from "./shared/schemas/question.schema.js";
```

Under the `// ─── Interfaces` section, add:

```typescript
export type {
  QuestionerDatabase,
  PersistableQuestion,
  PersistedQuestion,
  QuestionFilters,
} from "./shared/interfaces/questioner.interface.js";
```

Under the `// ─── Agents` section, after the `IndexNegotiator` export, add:

```typescript
export { QuestionerAgent } from "./questioner/questioner.agent.js";
export type { QuestionerAgentConfig } from "./questioner/questioner.agent.js";
export type {
  QuestionerInput,
  QuestionerContext,
  DiscoveryContext,
  IntentContext,
  ProfileContext,
  NegotiationContext,
} from "./questioner/questioner.types.js";
export { getPreset } from "./questioner/questioner.presets.js";
export type { QuestionerPreset } from "./questioner/questioner.presets.js";
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd packages/protocol && bun run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): export QuestionerAgent, schemas, and interfaces from index.ts"
```

---

### Task 7: Verify full test suite and type-check

**Files:** None (verification only)

- [ ] **Step 1: Run type-check**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Run all new tests**

Run: `cd packages/protocol && bun test src/questioner/ src/shared/schemas/tests/question.schema.spec.ts src/shared/interfaces/tests/questioner.interface.spec.ts`
Expected: All PASS.

- [ ] **Step 3: Run existing question generator tests to confirm no regressions**

Run: `cd packages/protocol && bun test src/opportunity/tests/question.generator.spec.ts src/opportunity/tests/question.prompt.spec.ts`
Expected: All existing tests still PASS (we did not modify the old files).
