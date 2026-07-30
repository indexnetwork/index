# Fast Signal Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make intent creation at `/i/new` fast by precomputing a per-user intake brief plus round-1 question in the background, then driving the funnel as a deterministic state machine that calls `gemini-2.5-flash` twice instead of running four sequential `gemini-3-pro-preview` agent turns.

**Architecture:** A background job (inside the existing `regenerate_contexts` handler) stores a `signal_intake_packs` row per user holding a prose intake brief and a ready round-1 `QuestionPayload`. Five new `/intents/intake/*` endpoints drive the funnel: round 1 is a table read, round 2 is one structured flash call, round 3 is a deterministic client-side community picker, and synthesis is one structured flash call fired speculatively while the user picks. Speculation is durable — it creates the real `intent_proposals` row early — with a `signal_intake_runs` table providing single-flight and failure reporting. `POST /intents/confirm` is unchanged.

**Tech Stack:** Bun, TypeScript, Drizzle ORM (Postgres), BullMQ, LangChain/LangGraph, OpenRouter (`google/gemini-2.5-flash`), Zod, React 19 + React Router, Vitest (web), `bun test` (api/protocol).

**Spec:** `docs/specs/2026-07-30-fast-signal-intake-design.md`

## Post-implementation corrections (2026-07-30 branch review)

A whole-branch review found three defects that originated in this plan and the
spec, and were implemented faithfully from them. The **spec is the corrected
source of truth**; the task listings below are left as the historical record
except where a code snippet is explicitly corrected inline.

1. **Proposals are not network-agnostic.** `createFromProposal` rejects any
   confirmation whose `networkId` differs from the stored
   `intent_proposals.network_id`, so `POST /intents/intake/proposal` (and
   `/revise`) must persist the picked community onto the proposal row — with
   server-side membership verification — before returning. Task 7's schema
   parsed `networkId` and then dropped it, which 409'd every community pick at
   confirm.
2. **An answer-hash match is not sufficient grounds for run reuse.** With a
   handful of canned options per round, a user's second signal can hash to their
   first run; reusing it replays an already-consumed proposal. `prepare` now
   reopens a matched run whose proposal is no longer pending.
3. **Revise feedback is not a where-constraint.** Task 6 below mandated
   `whereText: input.feedback`, which rendered content corrections into the
   `Where constraint:` prompt slot. `SynthesisInput` now carries a distinct
   `feedback` field with its own prompt line (snippet corrected inline in Task
   6).

Also corrected while fixing the above: the speculative-hit path now returns the
synthesized `lookingFor`/`youBring` (persisted on the run) instead of empty
strings; the background pack refresh is gated on `FAST_SIGNAL_INTAKE`;
`prepare`/`revise` use a dedicated `intake_synthesis` limiter class; the where
picker filters out personal networks; and empty intake answers are rejected at
the controller.

## Global Constraints

- Branch: `feat/fast-signal-intake`; worktree `/home/yanek/Projects/index/.worktrees/feat-fast-signal-intake`. Never commit from the canonical root.
- Flag name is exactly `FAST_SIGNAL_INTAKE`. Enabled only when the env var is exactly the string `"true"`, matching `isWebSignalAgentEnabled()` in `services/api/src/lib/signal-feature.ts`.
- Ship dark: the flag defaults off in every environment in this PR.
- New model key is exactly `signalIntakePack`, value `{ model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 1024 }`.
- New tables are exactly `signal_intake_packs` and `signal_intake_runs`.
- Do **not** modify `POST /intents/confirm`, the intent graph's `create` path, indexing, or general Signal Agent chat behavior.
- Do **not** delete `getSignalIntakeStage` / `buildSignalIntakeGuidance` in this PR — that is a follow-up.
- Protocol code must not import from `services/api`. Host wiring stays in `services/api`.
- Log event name for stage timers is exactly `signal_intake_stage`, with `stage` one of `start`, `question`, `prepare`, `proposal`, `revise`, and fields `durationMs`, `packHit`, `speculationHit`, `whereTextUsed`, `fallbackUsed`.
- Verification rejection is recoverable, not terminal: the API returns the clarification question and the web app renders it as a fourth round, then re-synthesizes.
- Test commands: protocol `cd packages/protocol && bun test <path>`; api `cd services/api && NODE_ENV=test bun test <path>`; web `cd apps/web && bun --bun vitest run <path>`.
- Lint before every commit: `bun run lint` from the repo root (the pre-commit hook runs lint-staged).

---

### Task 1: Intake pack generator (protocol)

Produces the brief + round-1 question from premises. Pure protocol code, no host dependencies, model stubbed in tests.

**Files:**
- Modify: `packages/protocol/src/shared/agent/model.config.ts` (add `signalIntakePack` key next to `questioner` on line 55)
- Create: `packages/protocol/src/signals/application/intake.pack.generator.ts`
- Test: `packages/protocol/src/signals/application/tests/intake.pack.generator.spec.ts`

**Interfaces:**
- Consumes: `createStructuredModel` from `../../shared/agent/model.config.js`.
- Produces:
  ```ts
  export interface IntakePackQuestionOption { label: string; description: string }
  export interface IntakePackQuestion {
    title: string;
    prompt: string;
    options: IntakePackQuestionOption[];
    multiSelect: boolean;
  }
  export interface IntakePackInput {
    premises: Array<{ text: string }>;
    networkTitles: string[];
    globalContext: string | null;
  }
  export interface IntakePack { brief: string; question: IntakePackQuestion }
  export class SignalIntakePackGenerator {
    constructor(model?: Runnable<BaseLanguageModelInput, IntakePack>);
    generate(input: IntakePackInput): Promise<IntakePack>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/signals/application/tests/intake.pack.generator.spec.ts`:

```ts
import { describe, expect, it } from "bun:test";

import { SignalIntakePackGenerator, type IntakePack } from "../intake.pack.generator.js";

function stubModel(pack: IntakePack, capture?: { prompt?: string }) {
  return {
    invoke: async (messages: Array<{ content: unknown }>) => {
      if (capture) capture.prompt = String(messages[messages.length - 1]?.content ?? "");
      return pack;
    },
  } as never;
}

const validPack: IntakePack = {
  brief: "Ada builds developer tools and is looking for design partners.",
  question: {
    title: "Question 1",
    prompt: "Who do you want to meet right now?",
    options: [
      { label: "A design partner", description: "Someone to test your tooling" },
      { label: "A technical co-founder", description: "Someone to build with" },
      { label: "An early customer", description: "Someone with the problem you solve" },
    ],
    multiSelect: false,
  },
};

describe("SignalIntakePackGenerator", () => {
  it("returns the generated brief and question", async () => {
    const generator = new SignalIntakePackGenerator(stubModel(validPack));

    const result = await generator.generate({
      premises: [{ text: "Ada builds developer tools." }],
      networkTitles: ["Builders"],
      globalContext: "Ada is a developer-tools founder.",
    });

    expect(result.brief).toBe(validPack.brief);
    expect(result.question.prompt).toBe("Who do you want to meet right now?");
    expect(result.question.options).toHaveLength(3);
  });

  it("grounds the prompt in premises, networks, and global context", async () => {
    const capture: { prompt?: string } = {};
    const generator = new SignalIntakePackGenerator(stubModel(validPack, capture));

    await generator.generate({
      premises: [{ text: "Ada builds developer tools." }],
      networkTitles: ["Builders"],
      globalContext: "Ada is a developer-tools founder.",
    });

    expect(capture.prompt).toContain("Ada builds developer tools.");
    expect(capture.prompt).toContain("Builders");
    expect(capture.prompt).toContain("Ada is a developer-tools founder.");
  });

  it("clamps to at most 4 options and forces a non-empty title", async () => {
    const noisy: IntakePack = {
      brief: "b",
      question: {
        title: "",
        prompt: "Who?",
        options: [
          { label: "a", description: "1" },
          { label: "b", description: "2" },
          { label: "c", description: "3" },
          { label: "d", description: "4" },
          { label: "e", description: "5" },
        ],
        multiSelect: false,
      },
    };
    const generator = new SignalIntakePackGenerator(stubModel(noisy));

    const result = await generator.generate({ premises: [{ text: "x" }], networkTitles: [], globalContext: null });

    expect(result.question.options).toHaveLength(4);
    expect(result.question.title).toBe("Question 1");
  });

  it("rejects a pack with fewer than two options", async () => {
    const thin: IntakePack = {
      brief: "b",
      question: { title: "t", prompt: "Who?", options: [{ label: "only", description: "d" }], multiSelect: false },
    };
    const generator = new SignalIntakePackGenerator(stubModel(thin));

    await expect(
      generator.generate({ premises: [{ text: "x" }], networkTitles: [], globalContext: null }),
    ).rejects.toThrow("at least 2 options");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/signals/application/tests/intake.pack.generator.spec.ts`
Expected: FAIL — cannot resolve module `../intake.pack.generator.js`.

- [ ] **Step 3: Add the model key**

In `packages/protocol/src/shared/agent/model.config.ts`, directly after the `questioner` line:

```ts
    signalIntakePack: { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 1024 },
```

- [ ] **Step 4: Write the generator**

Create `packages/protocol/src/signals/application/intake.pack.generator.ts`:

```ts
/**
 * Signal intake pack generator.
 *
 * Produces the offline half of the fast intake path: a prose brief written for
 * the intake task and a ready round-1 question. Both are stored per user and
 * refreshed in the background, so `/i/new` can render round 1 with no model call.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";

import { createStructuredModel } from "../../shared/agent/model.config.js";

/** One selectable option on the round-1 question. */
export interface IntakePackQuestionOption {
  label: string;
  description: string;
}

/** Round-1 question, shaped exactly like the frontend `QuestionPayload`. */
export interface IntakePackQuestion {
  title: string;
  prompt: string;
  options: IntakePackQuestionOption[];
  multiSelect: boolean;
}

/** Everything the generator needs about a user. */
export interface IntakePackInput {
  premises: Array<{ text: string }>;
  networkTitles: string[];
  globalContext: string | null;
}

/** Stored artifact: the brief plus the ready round-1 question. */
export interface IntakePack {
  brief: string;
  question: IntakePackQuestion;
}

const packSchema = z.object({
  brief: z.string().min(1),
  question: z.object({
    title: z.string(),
    prompt: z.string().min(1),
    options: z.array(z.object({ label: z.string().min(1), description: z.string() })),
    multiSelect: z.boolean(),
  }),
});

const SYSTEM_PROMPT = `You prepare a person's signal-intake pack for a networking product.

Produce two things:

1. "brief": 4-8 sentences of prose, third person, written specifically to help a
   small model run an intake interview with this person. Cover who they are, what
   they plausibly need from a connection, what they can offer in return, and which
   communities they belong to. Be concrete. Never invent facts beyond the input.

2. "question": the opening intake question asking who they want to meet right now.
   Give 3-4 concrete, distinct recipient profiles grounded in the person's actual
   background (for example a design partner, a technical co-founder, an early
   customer, a specific expertise gap) — never generic choices like "anyone".
   Each option needs a short label and a one-line description. Set multiSelect false.

Never expose raw JSON, IDs, or internal vocabulary in either field.`;

/** Generates and normalizes the per-user intake pack. */
export class SignalIntakePackGenerator {
  private readonly model: Runnable<BaseLanguageModelInput, IntakePack>;

  /**
   * @param model - Optional injected structured model. Tests pass a stub.
   */
  constructor(model?: Runnable<BaseLanguageModelInput, IntakePack>) {
    this.model = model ?? createStructuredModel("signalIntakePack", packSchema) as unknown as Runnable<BaseLanguageModelInput, IntakePack>;
  }

  /**
   * Generate the intake pack for one user.
   *
   * @param input - Active premises, membership titles, and the global context paragraph
   * @returns Normalized brief and round-1 question
   */
  async generate(input: IntakePackInput): Promise<IntakePack> {
    const premiseBlock = input.premises.map((p) => `- ${p.text}`).join("\n");
    const networkBlock = input.networkTitles.length > 0
      ? input.networkTitles.join(", ")
      : "none";
    const contextBlock = input.globalContext?.trim() ? input.globalContext.trim() : "none";

    const raw = await this.model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(
        `Communities: ${networkBlock}\n\nGlobal context:\n${contextBlock}\n\nPremises:\n${premiseBlock}\n\nWrite the intake pack.`,
      ),
    ]);

    return normalizeIntakePack(raw);
  }
}

/**
 * Clamp a generated pack into the shape the frontend can render.
 *
 * @param pack - Raw model output
 * @returns Normalized pack
 * @throws When the question has fewer than 2 usable options
 */
export function normalizeIntakePack(pack: IntakePack): IntakePack {
  const options = pack.question.options
    .filter((option) => option.label.trim().length > 0)
    .slice(0, 4)
    .map((option) => ({
      label: option.label.trim().slice(0, 120),
      description: option.description.trim().slice(0, 280),
    }));

  if (options.length < 2) {
    throw new Error("Intake pack question needs at least 2 options.");
  }

  return {
    brief: pack.brief.trim(),
    question: {
      title: pack.question.title.trim() || "Question 1",
      prompt: pack.question.prompt.trim().slice(0, 400),
      options,
      multiSelect: pack.question.multiSelect,
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/protocol && bun test src/signals/application/tests/intake.pack.generator.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/shared/agent/model.config.ts \
        packages/protocol/src/signals/application/intake.pack.generator.ts \
        packages/protocol/src/signals/application/tests/intake.pack.generator.spec.ts
git commit -m "feat(protocol): add signal intake pack generator"
```

---

### Task 2: Pack table, adapter, and background refresh

Persists the pack and keeps it fresh inside the existing `regenerate_contexts` job, reusing the `premiseHash` short-circuit.

**Files:**
- Modify: `services/api/src/schemas/database.schema.ts` (add table after `userContexts`, around line 374)
- Create: `services/api/src/adapters/signal-intake-pack.database.adapter.ts`
- Modify: `services/api/src/queues/usercontext.queue.ts`
- Test: `services/api/src/queues/tests/usercontext.intake-pack.spec.ts`

**Interfaces:**
- Consumes: `SignalIntakePackGenerator`, `IntakePack` (Task 1); `computePremiseHash` from `../lib/usercontext/premise-hash`.
- Produces:
  ```ts
  export interface SignalIntakePackRecord {
    userId: string;
    brief: string;
    question: IntakePackQuestion;
    premiseHash: string | null;
    generatedAt: Date;
  }
  export class SignalIntakePackDatabaseAdapter {
    getPack(userId: string): Promise<SignalIntakePackRecord | null>;
    upsertPack(input: { userId: string; brief: string; question: IntakePackQuestion; premiseHash: string }): Promise<void>;
  }
  ```
  Plus `UserContextQueueDeps` gains two optional injectable members:
  ```ts
  getExistingIntakePack?: (userId: string) => Promise<{ premiseHash: string | null } | null>;
  regenerateIntakePack?: (userId: string, premiseHash: string) => Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

Create `services/api/src/queues/tests/usercontext.intake-pack.spec.ts`:

```ts
import { describe, expect, it, mock } from 'bun:test';

import { UserContextQueue } from '../usercontext.queue';

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    getUserNetworkIds: async () => [],
    getActivePremises: async () => [
      { id: 'p1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), assertion: { text: 'Ada builds tools.' } },
    ],
    getExistingContext: async () => ({ premiseHash: 'stale' }),
    getNetwork: async () => null,
    generateContext: async () => ({ text: 't', embedding: [] }),
    generateGlobalContext: async () => ({ text: 'g', embedding: [] }),
    upsertUserContext: async () => ({ id: 'ctx-1' }),
    generateContextHyde: async () => undefined,
    ...overrides,
  };
}

describe('UserContextQueue intake pack regeneration', () => {
  it('regenerates the pack with the same premise hash used for contexts', async () => {
    const regenerateIntakePack = mock(async () => undefined);
    const queue = new UserContextQueue(baseDeps({
      getExistingIntakePack: async () => null,
      regenerateIntakePack,
    }) as never);

    await queue.processJob('regenerate_contexts', { userId: 'user-1' });

    expect(regenerateIntakePack).toHaveBeenCalledTimes(1);
    const [userId, hash] = regenerateIntakePack.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('skips regeneration when the stored pack hash is unchanged', async () => {
    const regenerateIntakePack = mock(async () => undefined);
    let observedHash = '';
    const queue = new UserContextQueue(baseDeps({
      getExistingIntakePack: async () => ({ premiseHash: observedHash }),
      regenerateIntakePack,
    }) as never);

    // First run learns the hash, second run must short-circuit.
    const learner = new UserContextQueue(baseDeps({
      getExistingIntakePack: async () => null,
      regenerateIntakePack: async (_u: string, h: string) => { observedHash = h; },
    }) as never);
    await learner.processJob('regenerate_contexts', { userId: 'user-1' });

    await queue.processJob('regenerate_contexts', { userId: 'user-1' });

    expect(regenerateIntakePack).not.toHaveBeenCalled();
  });

  it('does not fail the job when pack regeneration throws', async () => {
    const queue = new UserContextQueue(baseDeps({
      getExistingIntakePack: async () => null,
      regenerateIntakePack: async () => { throw new Error('model down'); },
    }) as never);

    await expect(queue.processJob('regenerate_contexts', { userId: 'user-1' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && NODE_ENV=test bun test src/queues/tests/usercontext.intake-pack.spec.ts`
Expected: FAIL — `regenerateIntakePack` never called (the handler does not know about packs yet).

- [ ] **Step 3: Add the table**

In `services/api/src/schemas/database.schema.ts`, immediately after the `userContexts` table definition (after line 374), add:

```ts
/** Precomputed fast-intake artifact: one row per user. */
export const signalIntakePacks = pgTable('signal_intake_packs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  brief: text('brief').notNull(),
  question: jsonb('question').$type<{
    title: string;
    prompt: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>().notNull(),
  premiseHash: text('premise_hash'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('signal_intake_packs_user_id_idx').on(table.userId),
}));

export type SignalIntakePackRow = typeof signalIntakePacks.$inferSelect;
export type NewSignalIntakePackRow = typeof signalIntakePacks.$inferInsert;
```

- [ ] **Step 4: Write the adapter**

Create `services/api/src/adapters/signal-intake-pack.database.adapter.ts`:

```ts
import { eq } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { signalIntakePacks } from '../schemas/database.schema';
import type { IntakePackQuestion } from '@indexnetwork/protocol';

/** Stored pack as the intake service consumes it. */
export interface SignalIntakePackRecord {
  userId: string;
  brief: string;
  question: IntakePackQuestion;
  premiseHash: string | null;
  generatedAt: Date;
}

/** Durable storage for the precomputed per-user intake pack. */
export class SignalIntakePackDatabaseAdapter {
  /**
   * Read one user's pack.
   *
   * @param userId - Owner
   * @returns The stored pack, or null when it has never been generated
   */
  async getPack(userId: string): Promise<SignalIntakePackRecord | null> {
    const [row] = await db
      .select()
      .from(signalIntakePacks)
      .where(eq(signalIntakePacks.userId, userId))
      .limit(1);
    if (!row) return null;
    return {
      userId: row.userId,
      brief: row.brief,
      question: row.question,
      premiseHash: row.premiseHash,
      generatedAt: row.generatedAt,
    };
  }

  /**
   * Insert or replace a user's pack.
   *
   * @param input - Owner, brief, round-1 question, and staleness key
   */
  async upsertPack(input: {
    userId: string;
    brief: string;
    question: IntakePackQuestion;
    premiseHash: string;
  }): Promise<void> {
    await db
      .insert(signalIntakePacks)
      .values({
        userId: input.userId,
        brief: input.brief,
        question: input.question,
        premiseHash: input.premiseHash,
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: signalIntakePacks.userId,
        set: {
          brief: input.brief,
          question: input.question,
          premiseHash: input.premiseHash,
          generatedAt: new Date(),
        },
      });
  }
}

export const signalIntakePackAdapter = new SignalIntakePackDatabaseAdapter();
```

- [ ] **Step 5: Wire the queue**

In `services/api/src/queues/usercontext.queue.ts`, add to the `UserContextQueueDeps` interface:

```ts
  /** Existing pack for the premiseHash short-circuit. */
  getExistingIntakePack?: (userId: string) => Promise<{ premiseHash: string | null } | null>;
  /** Regenerate and persist the user's fast-intake pack. */
  regenerateIntakePack?: (userId: string, premiseHash: string) => Promise<void>;
```

In `handleRegenerate`, after the per-network `for` loop and **before** the `if (failures > 0)` check, add:

```ts
    // Fast-intake pack shares the premise-hash staleness key with the context rows.
    // It is best-effort: a pack failure must not fail context regeneration, because
    // `/intents/intake/start` regenerates synchronously on a cache miss anyway.
    const getExistingIntakePack = this.deps?.getExistingIntakePack;
    const regenerateIntakePack = this.deps?.regenerateIntakePack;
    if (regenerateIntakePack) {
      try {
        const existingPack = getExistingIntakePack ? await getExistingIntakePack(userId) : null;
        if (!existingPack || existingPack.premiseHash !== premiseHash) {
          await regenerateIntakePack(userId, premiseHash);
          this.logger.verbose('Regenerated signal intake pack', { userId });
        }
      } catch (err) {
        this.logger.error('Failed to regenerate signal intake pack', { userId, error: err });
      }
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd services/api && NODE_ENV=test bun test src/queues/tests/usercontext.intake-pack.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Generate the migration**

Run: `cd services/api && bun run db:generate`
Expected: a new file under `services/api/drizzle/` containing `CREATE TABLE "signal_intake_packs"`. Open it and confirm it contains no `DROP` statements.

- [ ] **Step 8: Commit**

```bash
git add services/api/src/schemas/database.schema.ts \
        services/api/src/adapters/signal-intake-pack.database.adapter.ts \
        services/api/src/queues/usercontext.queue.ts \
        services/api/src/queues/tests/usercontext.intake-pack.spec.ts \
        services/api/drizzle
git commit -m "feat(api): persist and refresh signal intake packs"
```

---

### Task 3: Intake orchestrator (protocol)

Pure stage logic: round-2 question generation and final synthesis. No I/O, no agent loop.

**Files:**
- Create: `packages/protocol/src/signals/application/intake.orchestrator.ts`
- Test: `packages/protocol/src/signals/application/tests/intake.orchestrator.spec.ts`
- Modify: `packages/protocol/src/signals/index.ts` (export the new modules)

**Interfaces:**
- Consumes: `IntakePackQuestion` (Task 1); `createStructuredModel`.
- Produces:
  ```ts
  export interface IntakeAnswer { selectedOptions: string[]; freeText?: string }
  export interface SynthesisInput {
    brief: string;
    whoAnswer: IntakeAnswer;
    bringAnswer: IntakeAnswer;
    whereText?: string;
  }
  export interface SynthesisResult { description: string; lookingFor: string; youBring: string }
  export class SignalIntakeOrchestrator {
    constructor(models?: { question?: Runnable<...>; synthesis?: Runnable<...> });
    nextQuestion(input: { brief: string; whoAnswer: IntakeAnswer }): Promise<IntakePackQuestion>;
    synthesize(input: SynthesisInput): Promise<SynthesisResult>;
  }
  export function answerLabel(answer: IntakeAnswer): string;
  export const FALLBACK_WHO_QUESTION: IntakePackQuestion;
  export const FALLBACK_BRING_QUESTION: IntakePackQuestion;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/signals/application/tests/intake.orchestrator.spec.ts`:

```ts
import { describe, expect, it } from "bun:test";

import {
  answerLabel,
  FALLBACK_BRING_QUESTION,
  FALLBACK_WHO_QUESTION,
  SignalIntakeOrchestrator,
} from "../intake.orchestrator.js";

function stub<T>(value: T, capture?: { prompt?: string }) {
  return {
    invoke: async (messages: Array<{ content: unknown }>) => {
      if (capture) capture.prompt = String(messages[messages.length - 1]?.content ?? "");
      return value;
    },
  } as never;
}

const question = {
  title: "Question 2",
  prompt: "What would you bring to that connection?",
  options: [
    { label: "Distribution", description: "You have an audience" },
    { label: "Engineering depth", description: "You can build it" },
  ],
  multiSelect: false,
};

describe("answerLabel", () => {
  it("joins selected options and free text", () => {
    expect(answerLabel({ selectedOptions: ["A", "B"], freeText: "and C" })).toBe("A, B, and C");
  });

  it("ignores empty free text", () => {
    expect(answerLabel({ selectedOptions: ["A"], freeText: "   " })).toBe("A");
  });
});

describe("SignalIntakeOrchestrator.nextQuestion", () => {
  it("grounds round 2 in the brief and the round-1 answer", async () => {
    const capture: { prompt?: string } = {};
    const orchestrator = new SignalIntakeOrchestrator({ question: stub(question, capture) });

    const result = await orchestrator.nextQuestion({
      brief: "Ada builds developer tools.",
      whoAnswer: { selectedOptions: ["A design partner"] },
    });

    expect(result.prompt).toBe("What would you bring to that connection?");
    expect(capture.prompt).toContain("Ada builds developer tools.");
    expect(capture.prompt).toContain("A design partner");
  });

  it("falls back to the static question when the model fails", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      question: { invoke: async () => { throw new Error("model down"); } } as never,
    });

    const result = await orchestrator.nextQuestion({
      brief: "b",
      whoAnswer: { selectedOptions: ["x"] },
    });

    expect(result).toEqual(FALLBACK_BRING_QUESTION);
  });
});

describe("SignalIntakeOrchestrator.synthesize", () => {
  const synthesis = {
    description: "Looking for a design partner to test developer tooling.",
    lookingFor: "A design partner",
    youBring: "Engineering depth",
  };

  it("includes both answers in the synthesis prompt", async () => {
    const capture: { prompt?: string } = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    const result = await orchestrator.synthesize({
      brief: "Ada builds developer tools.",
      whoAnswer: { selectedOptions: ["A design partner"] },
      bringAnswer: { selectedOptions: ["Engineering depth"] },
    });

    expect(result.description).toBe(synthesis.description);
    expect(capture.prompt).toContain("A design partner");
    expect(capture.prompt).toContain("Engineering depth");
  });

  it("includes the where constraint only when provided", async () => {
    const withWhere: { prompt?: string } = {};
    const withoutWhere: { prompt?: string } = {};

    await new SignalIntakeOrchestrator({ synthesis: stub(synthesis, withWhere) }).synthesize({
      brief: "b",
      whoAnswer: { selectedOptions: ["x"] },
      bringAnswer: { selectedOptions: ["y"] },
      whereText: "Berlin only",
    });
    await new SignalIntakeOrchestrator({ synthesis: stub(synthesis, withoutWhere) }).synthesize({
      brief: "b",
      whoAnswer: { selectedOptions: ["x"] },
      bringAnswer: { selectedOptions: ["y"] },
    });

    expect(withWhere.prompt).toContain("Berlin only");
    expect(withoutWhere.prompt).not.toContain("Where constraint");
  });

  it("propagates synthesis failures so the caller can degrade", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      synthesis: { invoke: async () => { throw new Error("model down"); } } as never,
    });

    await expect(orchestrator.synthesize({
      brief: "b",
      whoAnswer: { selectedOptions: ["x"] },
      bringAnswer: { selectedOptions: ["y"] },
    })).rejects.toThrow("model down");
  });
});

describe("static fallbacks", () => {
  it("are renderable questions", () => {
    for (const q of [FALLBACK_WHO_QUESTION, FALLBACK_BRING_QUESTION]) {
      expect(q.prompt.length).toBeGreaterThan(0);
      expect(q.options.length).toBeGreaterThanOrEqual(2);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/signals/application/tests/intake.orchestrator.spec.ts`
Expected: FAIL — cannot resolve `../intake.orchestrator.js`.

- [ ] **Step 3: Write the orchestrator**

Create `packages/protocol/src/signals/application/intake.orchestrator.ts`:

```ts
/**
 * Deterministic signal-intake stage logic.
 *
 * The fast intake path is a fixed funnel, so stages are driven here rather than
 * by an agent loop: round 1 comes from the precomputed pack, round 2 is one
 * structured call, round 3 is a deterministic client-side picker, and synthesis
 * is one structured call. This module owns no I/O.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";

import { createStructuredModel } from "../../shared/agent/model.config.js";
import { normalizeIntakePack, type IntakePackQuestion } from "./intake.pack.generator.js";

/** One answered intake round. */
export interface IntakeAnswer {
  selectedOptions: string[];
  freeText?: string;
}

/** Everything synthesis needs to write the signal. */
export interface SynthesisInput {
  brief: string;
  whoAnswer: IntakeAnswer;
  bringAnswer: IntakeAnswer;
  whereText?: string;
}

/** Synthesized signal text plus its summary fields. */
export interface SynthesisResult {
  description: string;
  lookingFor: string;
  youBring: string;
}

const questionSchema = z.object({
  title: z.string(),
  prompt: z.string().min(1),
  options: z.array(z.object({ label: z.string().min(1), description: z.string() })),
  multiSelect: z.boolean(),
});

const synthesisSchema = z.object({
  description: z.string().min(1),
  lookingFor: z.string().min(1),
  youBring: z.string().min(1),
});

/** Static round-1 question used only when pack generation fails outright. */
export const FALLBACK_WHO_QUESTION: IntakePackQuestion = {
  title: "Question 1",
  prompt: "Who do you want to meet right now?",
  options: [
    { label: "A collaborator", description: "Someone to build or work on something with" },
    { label: "A customer or user", description: "Someone who has the problem you solve" },
    { label: "An expert", description: "Someone who has done this before" },
    { label: "A peer", description: "Someone at a similar stage to compare notes with" },
  ],
  multiSelect: false,
};

/** Static round-2 question used when live generation fails. */
export const FALLBACK_BRING_QUESTION: IntakePackQuestion = {
  title: "Question 2",
  prompt: "What would you bring, and what gap should they fill?",
  options: [
    { label: "Hands-on expertise", description: "You can do the work with them" },
    { label: "Introductions and reach", description: "You can open doors for them" },
    { label: "Funding or resources", description: "You can back what they are doing" },
    { label: "A mutual exchange", description: "You each cover the other's gap" },
  ],
  multiSelect: false,
};

const QUESTION_SYSTEM_PROMPT = `You write one intake question for a networking product.

Given a brief about the person and who they said they want to meet, ask what they
would bring to that connection and what gap the other side should fill. Give 3-4
concrete options grounded in the brief, each with a short label and a one-line
description. Include an option for mutual exchange when both sides matter. Set
multiSelect false. Never expose raw JSON, IDs, or internal vocabulary.`;

const SYNTHESIS_SYSTEM_PROMPT = `You write one clear signal for a networking product.

Combine the brief and the person's answers into a specific description of who they
want to meet, what they bring or need, and any stated constraint. Write it in the
person's own voice, first person, 1-3 sentences, concrete and free of hype. Also
return short "lookingFor" and "youBring" summaries for the confirmation card.
Never invent facts beyond the brief and the answers.`;

/**
 * Render an answer as a human-readable label.
 *
 * @param answer - Selected options plus optional free text
 * @returns Comma-joined non-empty parts
 */
export function answerLabel(answer: IntakeAnswer): string {
  return [...answer.selectedOptions, answer.freeText?.trim() ?? ""].filter(Boolean).join(", ");
}

/** Runs the two live stages of the fast intake funnel. */
export class SignalIntakeOrchestrator {
  private readonly questionModel: Runnable<BaseLanguageModelInput, IntakePackQuestion>;
  private readonly synthesisModel: Runnable<BaseLanguageModelInput, SynthesisResult>;

  /**
   * @param models - Optional injected structured models. Tests pass stubs.
   */
  constructor(models?: {
    question?: Runnable<BaseLanguageModelInput, IntakePackQuestion>;
    synthesis?: Runnable<BaseLanguageModelInput, SynthesisResult>;
  }) {
    this.questionModel = models?.question
      ?? createStructuredModel("signalIntakePack", questionSchema) as unknown as Runnable<BaseLanguageModelInput, IntakePackQuestion>;
    this.synthesisModel = models?.synthesis
      ?? createStructuredModel("signalIntakePack", synthesisSchema) as unknown as Runnable<BaseLanguageModelInput, SynthesisResult>;
  }

  /**
   * Generate round 2 from the brief and the round-1 answer.
   *
   * @param input - Brief plus the answered round-1 question
   * @returns A renderable question; the static fallback when generation fails
   */
  async nextQuestion(input: { brief: string; whoAnswer: IntakeAnswer }): Promise<IntakePackQuestion> {
    try {
      const raw = await this.questionModel.invoke([
        new SystemMessage(QUESTION_SYSTEM_PROMPT),
        new HumanMessage(
          `Brief:\n${input.brief}\n\nThey want to meet: ${answerLabel(input.whoAnswer)}\n\nWrite the question.`,
        ),
      ]);
      return normalizeIntakePack({ brief: input.brief, question: raw }).question;
    } catch {
      return FALLBACK_BRING_QUESTION;
    }
  }

  /**
   * Write the signal from both answers and any where-constraint.
   *
   * @param input - Brief, both answers, optional free-text constraint
   * @returns Description plus card summary fields
   * @throws Propagates model failure so the caller can mark the run failed
   */
  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const whereLine = input.whereText?.trim()
      ? `\n\nWhere constraint: ${input.whereText.trim()}`
      : "";
    const result = await this.synthesisModel.invoke([
      new SystemMessage(SYNTHESIS_SYSTEM_PROMPT),
      new HumanMessage(
        `Brief:\n${input.brief}\n\nThey want to meet: ${answerLabel(input.whoAnswer)}\n\nThey bring: ${answerLabel(input.bringAnswer)}${whereLine}\n\nWrite the signal.`,
      ),
    ]);
    return {
      description: result.description.trim(),
      lookingFor: result.lookingFor.trim(),
      youBring: result.youBring.trim(),
    };
  }
}
```

- [ ] **Step 4: Export from the signals barrel**

In `packages/protocol/src/signals/index.ts`, add:

```ts
export * from "./application/intake.pack.generator.js";
export * from "./application/intake.orchestrator.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/protocol && bun test src/signals/application/tests/intake.orchestrator.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/signals/application/intake.orchestrator.ts \
        packages/protocol/src/signals/application/tests/intake.orchestrator.spec.ts \
        packages/protocol/src/signals/index.ts
git commit -m "feat(protocol): add deterministic signal intake orchestrator"
```

---

### Task 4: Intake runs table and adapter

Durable single-flight for speculative synthesis, replica-safe.

**Files:**
- Modify: `services/api/src/schemas/database.schema.ts`
- Create: `services/api/src/adapters/signal-intake-run.database.adapter.ts`
- Test: `services/api/src/adapters/tests/signal-intake-run.hash.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function computeAnswersHash(input: {
    whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer; whereText?: string;
  }): string;
  export interface SignalIntakeRunRecord {
    id: string; userId: string; answersHash: string;
    status: 'pending' | 'ready' | 'failed';
    proposalId: string | null; error: string | null; createdAt: Date;
  }
  export class SignalIntakeRunDatabaseAdapter {
    claimRun(userId: string, answersHash: string): Promise<{ run: SignalIntakeRunRecord; claimed: boolean }>;
    markReady(runId: string, proposalId: string): Promise<void>;
    markFailed(runId: string, error: string): Promise<void>;
    getRunForOwner(runId: string, userId: string): Promise<SignalIntakeRunRecord | null>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `services/api/src/adapters/tests/signal-intake-run.hash.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { computeAnswersHash } from '../signal-intake-run.database.adapter';

const base = {
  whoAnswer: { selectedOptions: ['A design partner'] },
  bringAnswer: { selectedOptions: ['Engineering depth'] },
};

describe('computeAnswersHash', () => {
  it('is stable for identical answers', () => {
    expect(computeAnswersHash(base)).toBe(computeAnswersHash(base));
  });

  it('changes when an answer changes', () => {
    expect(computeAnswersHash(base)).not.toBe(
      computeAnswersHash({ ...base, bringAnswer: { selectedOptions: ['Distribution'] } }),
    );
  });

  it('separates a whereText re-synthesis from the speculative run', () => {
    expect(computeAnswersHash(base)).not.toBe(computeAnswersHash({ ...base, whereText: 'Berlin only' }));
  });

  it('treats blank whereText as absent so speculation is reused', () => {
    expect(computeAnswersHash({ ...base, whereText: '   ' })).toBe(computeAnswersHash(base));
  });

  it('is insensitive to selected-option ordering', () => {
    const ab = computeAnswersHash({ ...base, bringAnswer: { selectedOptions: ['a', 'b'] } });
    const ba = computeAnswersHash({ ...base, bringAnswer: { selectedOptions: ['b', 'a'] } });
    expect(ab).toBe(ba);
  });
});

describe('SIGNAL_INTAKE_RUN_TTL_MS', () => {
  it('matches the 24h proposal retention window', async () => {
    const { SIGNAL_INTAKE_RUN_TTL_MS } = await import('../signal-intake-run.database.adapter');
    expect(SIGNAL_INTAKE_RUN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && NODE_ENV=test bun test src/adapters/tests/signal-intake-run.hash.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the table**

In `services/api/src/schemas/database.schema.ts`, after `signalIntakePacks`:

```ts
export const signalIntakeRunStatusEnum = pgEnum('signal_intake_run_status', ['pending', 'ready', 'failed']);

/** Single-flight record for speculative intake synthesis. */
export const signalIntakeRuns = pgTable('signal_intake_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  answersHash: text('answers_hash').notNull(),
  status: signalIntakeRunStatusEnum('status').notNull().default('pending'),
  proposalId: text('proposal_id'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userAnswersUniq: uniqueIndex('signal_intake_runs_user_answers_uniq').on(table.userId, table.answersHash),
  userIdIdx: index('signal_intake_runs_user_id_idx').on(table.userId),
  createdAtIdx: index('signal_intake_runs_created_at_idx').on(table.createdAt),
}));

export type SignalIntakeRunRow = typeof signalIntakeRuns.$inferSelect;
```

- [ ] **Step 4: Write the adapter**

Create `services/api/src/adapters/signal-intake-run.database.adapter.ts`:

```ts
import crypto from 'crypto';

import { and, eq, lt } from 'drizzle-orm/sql';
import type { IntakeAnswer } from '@indexnetwork/protocol';

import db from '../lib/drizzle/drizzle';
import { signalIntakeRuns } from '../schemas/database.schema';

/** One speculative or on-demand synthesis run. */
export interface SignalIntakeRunRecord {
  id: string;
  userId: string;
  answersHash: string;
  status: 'pending' | 'ready' | 'failed';
  proposalId: string | null;
  error: string | null;
  createdAt: Date;
}

/**
 * Deterministic key over the full answer set that feeds synthesis.
 *
 * CORRECTED (branch review): a where-driven re-synthesis does NOT get its own
 * row — it reuses the run and replaces `proposal_id` in place. Only the two
 * answers are ever hashed, and a hash match is re-validated against the
 * proposal's status before the run is reused. See the spec.
 *
 * @param input - Both answers plus the optional where constraint
 * @returns A 16-char hex digest, stable across option ordering
 */
export function computeAnswersHash(input: {
  whoAnswer: IntakeAnswer;
  bringAnswer: IntakeAnswer;
  whereText?: string;
}): string {
  const part = (answer: IntakeAnswer) =>
    [...answer.selectedOptions].sort().join('|') + '::' + (answer.freeText?.trim() ?? '');
  const payload = [
    part(input.whoAnswer),
    part(input.bringAnswer),
    input.whereText?.trim() ?? '',
  ].join('###');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/** Durable single-flight storage for intake synthesis runs. */
export class SignalIntakeRunDatabaseAdapter {
  /**
   * Claim a run for this answer set, or return the existing one.
   *
   * @param userId - Owner
   * @param answersHash - Key from {@link computeAnswersHash}
   * @returns The run and whether this caller created it (and must do the work)
   */
  async claimRun(userId: string, answersHash: string): Promise<{ run: SignalIntakeRunRecord; claimed: boolean }> {
    const [inserted] = await db
      .insert(signalIntakeRuns)
      .values({ userId, answersHash, status: 'pending' })
      .onConflictDoNothing({ target: [signalIntakeRuns.userId, signalIntakeRuns.answersHash] })
      .returning();
    if (inserted) return { run: inserted as SignalIntakeRunRecord, claimed: true };

    const [existing] = await db
      .select()
      .from(signalIntakeRuns)
      .where(and(eq(signalIntakeRuns.userId, userId), eq(signalIntakeRuns.answersHash, answersHash)))
      .limit(1);
    return { run: existing as SignalIntakeRunRecord, claimed: false };
  }

  /** Record a completed proposal against the run. Also used by revise. */
  async markReady(runId: string, proposalId: string): Promise<void> {
    await db
      .update(signalIntakeRuns)
      .set({ status: 'ready', proposalId, error: null })
      .where(eq(signalIntakeRuns.id, runId));
  }

  /** Record a synthesis failure so the proposal call can retry serially. */
  async markFailed(runId: string, error: string): Promise<void> {
    await db
      .update(signalIntakeRuns)
      .set({ status: 'failed', error: error.slice(0, 500) })
      .where(eq(signalIntakeRuns.id, runId));
  }

  /** Resolve a run without exposing another user's records. */
  async getRunForOwner(runId: string, userId: string): Promise<SignalIntakeRunRecord | null> {
    const [run] = await db
      .select()
      .from(signalIntakeRuns)
      .where(and(eq(signalIntakeRuns.id, runId), eq(signalIntakeRuns.userId, userId)))
      .limit(1);
    return (run as SignalIntakeRunRecord) ?? null;
  }

  /**
   * Delete this user's runs older than the retention window.
   *
   * Called opportunistically from `claimRun` rather than from a dedicated job:
   * abandoned runs are tiny, per-user, and only ever read by their owner, so a
   * sweep at claim time bounds growth without new queue infrastructure.
   *
   * @param userId - Owner whose stale runs are removed
   * @param olderThan - Cutoff timestamp
   */
  async sweepStaleRuns(userId: string, olderThan: Date): Promise<void> {
    await db
      .delete(signalIntakeRuns)
      .where(and(eq(signalIntakeRuns.userId, userId), lt(signalIntakeRuns.createdAt, olderThan)));
  }
}

/** Abandoned-run retention window, matching the proposal TTL. */
export const SIGNAL_INTAKE_RUN_TTL_MS = 24 * 60 * 60 * 1000;

export const signalIntakeRunAdapter = new SignalIntakeRunDatabaseAdapter();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/api && NODE_ENV=test bun test src/adapters/tests/signal-intake-run.hash.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Generate the migration**

Run: `cd services/api && bun run db:generate`
Expected: new migration containing `CREATE TABLE "signal_intake_runs"` and the status enum. Confirm no `DROP` statements.

- [ ] **Step 7: Commit**

```bash
git add services/api/src/schemas/database.schema.ts \
        services/api/src/adapters/signal-intake-run.database.adapter.ts \
        services/api/src/adapters/tests/signal-intake-run.hash.spec.ts \
        services/api/drizzle
git commit -m "feat(api): add signal intake run single-flight store"
```

---

### Task 5: Intake service (pack read, synthesis, proposal creation)

The host-side service the controller calls. Owns cold-start generation, the propose-graph invocation, and proposal persistence.

**Files:**
- Create: `services/api/src/services/signal-intake.service.ts`
- Test: `services/api/src/services/tests/signal-intake.service.isolated.ts`

**Interfaces:**
- Consumes: `SignalIntakePackGenerator`, `SignalIntakeOrchestrator`, `computeAnswersHash`, `signalIntakePackAdapter`, `signalIntakeRunAdapter`, `IntentProposalDatabaseAdapter.createProposals`, and the compiled intent graph from `toolService`.
- Produces:
  ```ts
  export interface IntakeProposal {
    proposalId: string; description: string; lookingFor: string; youBring: string;
  }
  export class SignalIntakeService {
    constructor(deps?: SignalIntakeServiceDeps);
    getOrCreatePack(userId: string): Promise<{ brief: string; question: IntakePackQuestion; packHit: boolean }>;
    nextQuestion(userId: string, whoAnswer: IntakeAnswer): Promise<IntakePackQuestion>;
    prepare(userId: string, answers: { whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer }): Promise<{ runId: string }>;
    resolveProposal(userId: string, input: { runId: string; whereText?: string }): Promise<IntakeProposal>;
    revise(userId: string, input: { runId: string; feedback: string }): Promise<IntakeProposal>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `services/api/src/services/tests/signal-intake.service.isolated.ts`:

```ts
import { describe, expect, it, mock } from 'bun:test';

import { SignalIntakeService } from '../signal-intake.service';

const question = {
  title: 'Question 1',
  prompt: 'Who do you want to meet?',
  options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
  multiSelect: false,
};

const verifiedIntent = {
  description: 'Looking for a design partner.',
  score: 0.8,
  verification: {
    reasoning: 'clear',
    classification: 'DIRECTIVE',
    felicity_scores: { clarity: 0.9, authority: 0.9, sincerity: 0.9 },
    semantic_entropy: 0.2,
    referential_anchor: 'design partner',
    referential_breadth: 'narrow',
    missing_selectional_constraints: [],
    specificity_warning: null,
    flags: [],
  },
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    packStore: {
      getPack: mock(async () => ({
        userId: 'u1', brief: 'Ada builds tools.', question, premiseHash: 'h', generatedAt: new Date(),
      })),
      upsertPack: mock(async () => undefined),
    },
    runStore: {
      claimRun: mock(async () => ({
        run: { id: 'run-1', userId: 'u1', answersHash: 'h', status: 'pending', proposalId: null, error: null, createdAt: new Date() },
        claimed: true,
      })),
      markReady: mock(async () => undefined),
      markFailed: mock(async () => undefined),
      sweepStaleRuns: mock(async () => undefined),
      getRunForOwner: mock(async () => ({
        id: 'run-1', userId: 'u1', answersHash: 'h', status: 'ready', proposalId: 'prop-1', error: null, createdAt: new Date(),
      })),
    },
    proposalStore: {
      createProposals: mock(async () => undefined),
      getProposalForOwner: mock(async () => ({ id: 'prop-1', description: 'Looking for a design partner.' })),
    },
    orchestrator: {
      nextQuestion: mock(async () => question),
      synthesize: mock(async () => ({ description: 'Looking for a design partner.', lookingFor: 'A design partner', youBring: 'Depth' })),
    },
    packGenerator: { generate: mock(async () => ({ brief: 'generated brief', question })) },
    getPremises: mock(async () => [{ text: 'Ada builds tools.' }]),
    getNetworkTitles: mock(async () => ['Builders']),
    getGlobalContext: mock(async () => 'Ada is a founder.'),
    invokeIntentGraph: mock(async () => ({ verifiedIntents: [verifiedIntent], trace: [] })),
    ...overrides,
  };
}

describe('SignalIntakeService.getOrCreatePack', () => {
  it('reads the stored pack without generating', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    const result = await service.getOrCreatePack('u1');

    expect(result.packHit).toBe(true);
    expect(result.brief).toBe('Ada builds tools.');
    expect(deps.packGenerator.generate).not.toHaveBeenCalled();
  });

  it('generates and persists synchronously on a cold miss', async () => {
    const deps = makeDeps({ packStore: { getPack: mock(async () => null), upsertPack: mock(async () => undefined) } });
    const service = new SignalIntakeService(deps as never);

    const result = await service.getOrCreatePack('u1');

    expect(result.packHit).toBe(false);
    expect(result.brief).toBe('generated brief');
    expect(deps.packStore.upsertPack).toHaveBeenCalledTimes(1);
  });

  it('falls back to the static question when generation fails', async () => {
    const deps = makeDeps({
      packStore: { getPack: mock(async () => null), upsertPack: mock(async () => undefined) },
      packGenerator: { generate: mock(async () => { throw new Error('model down'); }) },
    });
    const service = new SignalIntakeService(deps as never);

    const result = await service.getOrCreatePack('u1');

    expect(result.packHit).toBe(false);
    expect(result.question.options.length).toBeGreaterThanOrEqual(2);
  });
});

describe('SignalIntakeService.resolveProposal', () => {
  const answers = {
    whoAnswer: { selectedOptions: ['A design partner'] },
    bringAnswer: { selectedOptions: ['Engineering depth'] },
  };

  it('returns the speculative proposal without re-synthesizing', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    const result = await service.resolveProposal('u1', { runId: 'run-1', answers });

    expect(result.proposalId).toBe('prop-1');
    expect(deps.orchestrator.synthesize).not.toHaveBeenCalled();
  });

  it('re-synthesizes when whereText is supplied', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    await service.resolveProposal('u1', { runId: 'run-1', whereText: 'Berlin only', answers });

    expect(deps.orchestrator.synthesize).toHaveBeenCalledTimes(1);
    expect(deps.proposalStore.createProposals).toHaveBeenCalledTimes(1);
  });

  it('returns before speculative synthesis settles', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = makeDeps({
      orchestrator: {
        nextQuestion: mock(async () => question),
        synthesize: mock(async () => {
          await gate;
          return { description: 'd', lookingFor: 'l', youBring: 'y' };
        }),
      },
    });
    const service = new SignalIntakeService(deps as never);

    const result = await service.prepare('u1', answers);

    expect(result.runId).toBe('run-1');
    expect(deps.proposalStore.createProposals).not.toHaveBeenCalled();
    release?.();
  });

  it('synthesizes serially when the speculative run failed', async () => {
    const deps = makeDeps({
      runStore: {
        ...makeDeps().runStore,
        getRunForOwner: mock(async () => ({
          id: 'run-1', userId: 'u1', answersHash: 'h', status: 'failed', proposalId: null, error: 'boom', createdAt: new Date(),
        })),
      },
    });
    const service = new SignalIntakeService(deps as never);

    const result = await service.resolveProposal('u1', { runId: 'run-1', answers });

    expect(deps.orchestrator.synthesize).toHaveBeenCalledTimes(1);
    expect(result.description).toBe('Looking for a design partner.');
  });

  it('rejects a run owned by another user', async () => {
    const deps = makeDeps({
      runStore: { ...makeDeps().runStore, getRunForOwner: mock(async () => null) },
    });
    const service = new SignalIntakeService(deps as never);

    await expect(service.resolveProposal('u1', { runId: 'run-1', answers })).rejects.toThrow('run_not_found');
  });

  it('surfaces verification rejection with a clarification question', async () => {
    const deps = makeDeps({
      runStore: {
        ...makeDeps().runStore,
        getRunForOwner: mock(async () => ({
          id: 'run-1', userId: 'u1', answersHash: 'h', status: 'failed', proposalId: null, error: 'x', createdAt: new Date(),
        })),
      },
      invokeIntentGraph: mock(async () => ({ verifiedIntents: [], trace: [] })),
    });
    const service = new SignalIntakeService(deps as never);

    const call = service.resolveProposal('u1', { runId: 'run-1', answers });

    await expect(call).rejects.toThrow('verification_rejected');
    await call.catch((error: { clarification?: { options: unknown[] } }) => {
      expect(error.clarification?.options.length).toBeGreaterThanOrEqual(2);
    });
    expect(deps.runStore.markFailed).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && NODE_ENV=test bun test src/services/tests/signal-intake.service.isolated.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `services/api/src/services/signal-intake.service.ts`:

```ts
/**
 * Deterministic signal-intake host service.
 *
 * Owns cold-start pack generation, speculative synthesis, and proposal
 * persistence. Speculation is durable: it creates the real `intent_proposals`
 * row early, so a proposal produced while the user picks a community is
 * indistinguishable from one produced on demand.
 */

import crypto from 'crypto';

import {
  FALLBACK_WHO_QUESTION,
  normalizeIntentDescription,
  SignalIntakeOrchestrator,
  SignalIntakePackGenerator,
  type IntakeAnswer,
  type IntakePackQuestion,
} from '@indexnetwork/protocol';

import { signalIntakePackAdapter } from '../adapters/signal-intake-pack.database.adapter';
import {
  computeAnswersHash,
  signalIntakeRunAdapter,
  SIGNAL_INTAKE_RUN_TTL_MS,
} from '../adapters/signal-intake-run.database.adapter';
import { intentProposalDatabaseAdapter } from '../adapters/intent-proposal.database.adapter';
import { log } from '../lib/log';

const logger = log.service.from('signal-intake');

/** Proposal as the intake surfaces render it. */
export interface IntakeProposal {
  proposalId: string;
  description: string;
  lookingFor: string;
  youBring: string;
}

/** Raised when synthesis produced nothing specific enough to persist. */
export class IntakeVerificationRejectedError extends Error {
  /**
   * @param clarification - Question to ask the user before retrying
   */
  constructor(readonly clarification: IntakePackQuestion) {
    super('verification_rejected');
    this.name = 'IntakeVerificationRejectedError';
  }
}

/** Raised when a run does not exist for this owner. */
export class IntakeRunNotFoundError extends Error {
  constructor() {
    super('run_not_found');
    this.name = 'IntakeRunNotFoundError';
  }
}

/** Injection surface; production values default to the real adapters. */
export interface SignalIntakeServiceDeps {
  packStore: typeof signalIntakePackAdapter;
  runStore: typeof signalIntakeRunAdapter;
  proposalStore: Pick<typeof intentProposalDatabaseAdapter, 'createProposals' | 'getProposalForOwner'>;
  orchestrator: Pick<SignalIntakeOrchestrator, 'nextQuestion' | 'synthesize'>;
  packGenerator: Pick<SignalIntakePackGenerator, 'generate'>;
  getPremises: (userId: string) => Promise<Array<{ text: string }>>;
  getNetworkTitles: (userId: string) => Promise<string[]>;
  getGlobalContext: (userId: string) => Promise<string | null>;
  invokeIntentGraph: (input: {
    userId: string;
    userProfile: string;
    inputContent: string;
  }) => Promise<{ verifiedIntents?: Array<Record<string, unknown>> }>;
  recordAnsweredQuestion?: (input: {
    userId: string;
    prompt: string;
    answer: IntakeAnswer;
    stage: 'who' | 'bring';
  }) => Promise<void>;
  now?: () => Date;
}

/** Poll cadence and ceiling while awaiting a speculative run. */
const POLL_INTERVAL_MS = 250;
const POLL_CEILING_MS = 20_000;

/** Clarification shown when verification rejects the synthesized signal. */
const CLARIFICATION_QUESTION: IntakePackQuestion = {
  title: 'One more detail',
  prompt: 'That was a little broad to match on. What would make it concrete?',
  options: [
    { label: 'A specific role or skill', description: 'Name what they actually do' },
    { label: 'A specific outcome', description: 'What should happen if this works' },
    { label: 'A timeframe', description: 'When you need this to happen' },
    { label: 'A domain or industry', description: 'Where they should come from' },
  ],
  multiSelect: true,
};

/** Drives the deterministic intake funnel. */
export class SignalIntakeService {
  private readonly deps: SignalIntakeServiceDeps;

  /**
   * @param deps - Injected collaborators; tests pass fakes.
   */
  constructor(deps: SignalIntakeServiceDeps) {
    this.deps = deps;
  }

  private get now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * Read the user's pack, generating it synchronously on a cold miss.
   *
   * @param userId - Owner
   * @returns Brief, round-1 question, and whether the pack was already warm
   */
  async getOrCreatePack(userId: string): Promise<{ brief: string; question: IntakePackQuestion; packHit: boolean }> {
    const started = Date.now();
    const stored = await this.deps.packStore.getPack(userId);
    if (stored) {
      logger.info('signal_intake_stage', {
        stage: 'start', durationMs: Date.now() - started,
        packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
      });
      return { brief: stored.brief, question: stored.question, packHit: true };
    }

    try {
      const [premises, networkTitles, globalContext] = await Promise.all([
        this.deps.getPremises(userId),
        this.deps.getNetworkTitles(userId),
        this.deps.getGlobalContext(userId),
      ]);
      const pack = await this.deps.packGenerator.generate({ premises, networkTitles, globalContext });
      // premiseHash is owned by the background job; a cold-start write stores an
      // empty key so the next regen always refreshes rather than short-circuiting.
      await this.deps.packStore.upsertPack({
        userId, brief: pack.brief, question: pack.question, premiseHash: '',
      });
      logger.info('signal_intake_stage', {
        stage: 'start', durationMs: Date.now() - started,
        packHit: false, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
      });
      return { brief: pack.brief, question: pack.question, packHit: false };
    } catch (error) {
      logger.error('Intake pack generation failed', { userId, error });
      logger.info('signal_intake_stage', {
        stage: 'start', durationMs: Date.now() - started,
        packHit: false, speculationHit: false, whereTextUsed: false, fallbackUsed: true,
      });
      return { brief: '', question: FALLBACK_WHO_QUESTION, packHit: false };
    }
  }

  /**
   * Generate round 2 from the round-1 answer.
   *
   * @param userId - Owner
   * @param whoAnswer - Answer to round 1
   * @returns The round-2 question
   */
  async nextQuestion(userId: string, whoAnswer: IntakeAnswer): Promise<IntakePackQuestion> {
    const started = Date.now();
    const { brief, question: round1 } = await this.getOrCreatePack(userId);
    this.record({ userId, prompt: round1.prompt, answer: whoAnswer, stage: 'who' });
    const question = await this.deps.orchestrator.nextQuestion({ brief, whoAnswer });
    logger.info('signal_intake_stage', {
      stage: 'question', durationMs: Date.now() - started,
      packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
    });
    return question;
  }

  /**
   * Claim a run and start speculative synthesis without awaiting it.
   *
   * @param userId - Owner
   * @param answers - Both answered rounds
   * @returns The run handle the client polls with
   */
  async prepare(
    userId: string,
    answers: { whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer; round2Prompt?: string },
  ): Promise<{ runId: string }> {
    const started = Date.now();
    await this.deps.runStore.sweepStaleRuns(userId, new Date(this.now.getTime() - SIGNAL_INTAKE_RUN_TTL_MS));
    this.record({
      userId, prompt: answers.round2Prompt ?? '', answer: answers.bringAnswer, stage: 'bring',
    });

    const answersHash = computeAnswersHash({
      whoAnswer: answers.whoAnswer, bringAnswer: answers.bringAnswer,
    });
    const { run, claimed } = await this.deps.runStore.claimRun(userId, answersHash);

    if (claimed) {
      // Deliberately not awaited: this is the speculation that overlaps the
      // user's community pick. Failures are recorded on the run, never thrown.
      void this.runSynthesis(userId, run.id, answers).catch(() => undefined);
    }

    logger.info('signal_intake_stage', {
      stage: 'prepare', durationMs: Date.now() - started,
      packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
    });
    return { runId: run.id };
  }

  /**
   * Resolve the proposal for a run, awaiting or redoing synthesis as needed.
   *
   * @param userId - Owner
   * @param input - Run handle plus the optional free-text where constraint
   * @returns The proposal to render on the confirmation card
   */
  async resolveProposal(
    userId: string,
    input: { runId: string; whereText?: string; answers?: { whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer } },
  ): Promise<IntakeProposal> {
    const started = Date.now();
    const run = await this.deps.runStore.getRunForOwner(input.runId, userId);
    if (!run) throw new IntakeRunNotFoundError();

    const whereTextUsed = Boolean(input.whereText?.trim());

    // A where-constraint invalidates the speculative description, and a failed
    // speculation has nothing to hand back — both synthesize serially here.
    if (whereTextUsed || run.status === 'failed') {
      const proposal = await this.runSynthesis(userId, run.id, {
        ...(input.answers ?? (await this.answersForRun(run.id))),
        ...(input.whereText?.trim() ? { whereText: input.whereText.trim() } : {}),
      });
      logger.info('signal_intake_stage', {
        stage: 'proposal', durationMs: Date.now() - started,
        packHit: true, speculationHit: false, whereTextUsed, fallbackUsed: run.status === 'failed',
      });
      return proposal;
    }

    const ready = run.status === 'ready' ? run : await this.awaitRun(userId, run.id);
    if (ready?.status === 'ready' && ready.proposalId) {
      const stored = await this.deps.proposalStore.getProposalForOwner(ready.proposalId, userId);
      logger.info('signal_intake_stage', {
        stage: 'proposal', durationMs: Date.now() - started,
        packHit: true, speculationHit: run.status === 'ready', whereTextUsed: false, fallbackUsed: false,
      });
      return {
        proposalId: ready.proposalId,
        description: stored?.description ?? '',
        lookingFor: '',
        youBring: '',
      };
    }

    const proposal = await this.runSynthesis(userId, run.id, input.answers ?? (await this.answersForRun(run.id)));
    logger.info('signal_intake_stage', {
      stage: 'proposal', durationMs: Date.now() - started,
      packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: true,
    });
    return proposal;
  }

  /**
   * Replace a run's proposal from user feedback on the visible draft.
   *
   * @param userId - Owner
   * @param input - Run handle, feedback text, and the original answers
   * @returns The replacement proposal
   */
  async revise(
    userId: string,
    input: {
      runId: string;
      feedback: string;
      answers: { whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer };
    },
  ): Promise<IntakeProposal> {
    const started = Date.now();
    const run = await this.deps.runStore.getRunForOwner(input.runId, userId);
    if (!run) throw new IntakeRunNotFoundError();

    // CORRECTED (branch review): feedback is a correction to the whole draft,
    // not a place constraint, so it travels in its own `feedback` slot. The
    // original plan text said `whereText: input.feedback`.
    const proposal = await this.runSynthesis(userId, run.id, {
      ...input.answers,
      feedback: input.feedback,
    });
    logger.info('signal_intake_stage', {
      stage: 'revise', durationMs: Date.now() - started,
      packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
    });
    return proposal;
  }

  /**
   * Synthesize, verify, persist a proposal, and settle the run.
   *
   * @param userId - Owner
   * @param runId - Run to settle
   * @param answers - Answers plus any where constraint
   * @returns The persisted proposal
   * @throws IntakeVerificationRejectedError when nothing verified
   */
  private async runSynthesis(
    userId: string,
    runId: string,
    answers: { whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer; whereText?: string },
  ): Promise<IntakeProposal> {
    try {
      const { brief } = await this.getOrCreatePack(userId);
      const synthesis = await this.deps.orchestrator.synthesize({ brief, ...answers });

      // The brief stands in for the profile graph here: it is already a
      // distilled identity paragraph, so `propose` skips that leg entirely.
      const graphResult = await this.deps.invokeIntentGraph({
        userId,
        userProfile: brief,
        inputContent: synthesis.description,
      });

      const verified = graphResult.verifiedIntents ?? [];
      if (verified.length === 0) {
        await this.deps.runStore.markFailed(runId, 'verification_rejected');
        throw new IntakeVerificationRejectedError(CLARIFICATION_QUESTION);
      }

      const first = verified[0] as {
        description: string;
        score?: number | null;
        verification?: unknown;
      };
      if (!first.verification) {
        await this.deps.runStore.markFailed(runId, 'missing_verifier_analysis');
        throw new IntakeVerificationRejectedError(CLARIFICATION_QUESTION);
      }

      const proposalId = crypto.randomUUID();
      const description = normalizeIntentDescription(first.description);
      await this.deps.proposalStore.createProposals([{
        proposalId,
        userId,
        description,
        analysis: { verifierOutput: first.verification, combinedScore: first.score ?? null },
      }]);
      await this.deps.runStore.markReady(runId, proposalId);

      return {
        proposalId,
        description,
        lookingFor: synthesis.lookingFor,
        youBring: synthesis.youBring,
      };
    } catch (error) {
      if (error instanceof IntakeVerificationRejectedError) throw error;
      await this.deps.runStore.markFailed(runId, error instanceof Error ? error.message : 'synthesis_failed');
      throw error;
    }
  }

  /** Poll a pending run until it settles or the ceiling elapses. */
  private async awaitRun(userId: string, runId: string) {
    const deadline = Date.now() + POLL_CEILING_MS;
    while (Date.now() < deadline) {
      const run = await this.deps.runStore.getRunForOwner(runId, userId);
      if (run && run.status !== 'pending') return run;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return null;
  }

  /**
   * Answers are client-held; a serial retry without them cannot proceed.
   * Callers always pass `answers`, so this only guards a malformed request.
   */
  private async answersForRun(_runId: string): Promise<{ whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer }> {
    throw new Error('answers_required');
  }

  /** Fire-and-forget analytics mirror; never blocks or fails a request. */
  private record(input: { userId: string; prompt: string; answer: IntakeAnswer; stage: 'who' | 'bring' }): void {
    void this.deps.recordAnsweredQuestion?.(input).catch(() => undefined);
  }
}
```

Note the two behaviors the tests in Step 1 pin down: `prepare` must return **before** synthesis settles, and `runSynthesis` must record failure on the run rather than leaking it into the request path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && NODE_ENV=test bun test src/services/tests/signal-intake.service.isolated.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/signal-intake.service.ts \
        services/api/src/services/tests/signal-intake.service.isolated.ts
git commit -m "feat(api): add signal intake service with speculative synthesis"
```

---

### Task 6: Feature flag plumbing

Ships `FAST_SIGNAL_INTAKE` dark across every surface.

**Files:**
- Create: `services/api/src/lib/fast-intake-feature.ts`
- Modify: `services/api/src/startup.env.ts` (add after `WEB_SIGNAL_AGENT_ENABLED`, line 112)
- Modify: `services/api/src/controllers/auth.controller.ts` (features payload, line ~109)
- Modify: `.env.example`, `.env.development`
- Test: `services/api/src/lib/tests/fast-intake-feature.spec.ts`

**Interfaces:**
- Produces: `isFastSignalIntakeEnabled(): boolean`; features payload gains `fastSignalIntake: boolean`.

- [ ] **Step 1: Write the failing test**

Create `services/api/src/lib/tests/fast-intake-feature.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'bun:test';

import { isFastSignalIntakeEnabled } from '../fast-intake-feature';

const original = process.env.FAST_SIGNAL_INTAKE;
afterEach(() => {
  if (original === undefined) delete process.env.FAST_SIGNAL_INTAKE;
  else process.env.FAST_SIGNAL_INTAKE = original;
});

describe('isFastSignalIntakeEnabled', () => {
  it('is disabled by default', () => {
    delete process.env.FAST_SIGNAL_INTAKE;
    expect(isFastSignalIntakeEnabled()).toBe(false);
  });

  it('is enabled only for the exact string "true"', () => {
    process.env.FAST_SIGNAL_INTAKE = 'true';
    expect(isFastSignalIntakeEnabled()).toBe(true);
    for (const value of ['TRUE', '1', 'yes', 'false', '']) {
      process.env.FAST_SIGNAL_INTAKE = value;
      expect(isFastSignalIntakeEnabled()).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && NODE_ENV=test bun test src/lib/tests/fast-intake-feature.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the flag module**

Create `services/api/src/lib/fast-intake-feature.ts`:

```ts
/**
 * Fast signal intake flag.
 *
 * Disabled unless FAST_SIGNAL_INTAKE is exactly "true". Gates the deterministic
 * /intents/intake/* funnel; the legacy Signal Agent intake path is untouched.
 */

/** @returns true when /i/new must use the deterministic intake funnel. */
export function isFastSignalIntakeEnabled(): boolean {
  return process.env.FAST_SIGNAL_INTAKE === 'true';
}
```

- [ ] **Step 4: Register the env var and expose the flag**

In `services/api/src/startup.env.ts`, after line 112:

```ts
  FAST_SIGNAL_INTAKE: optionalBoolean,
```

In `services/api/src/controllers/auth.controller.ts`, import `isFastSignalIntakeEnabled` from `'../lib/fast-intake-feature'` and add to the `features` object:

```ts
        fastSignalIntake: isFastSignalIntakeEnabled(),
```

In `.env.example` and `.env.development`, add (dark):

```bash
# Deterministic fast intake funnel for /i/new (ship dark; flip on dev first)
FAST_SIGNAL_INTAKE=false
```

The fourth surface is the Railway dev service variable. Set it dark now so dev and local agree, per the `manage-feature-flags` skill:

```bash
# Ship dark. Flip to "true" only after the stage timers have been read on dev.
railway variables --set FAST_SIGNAL_INTAKE=false
```

If the Railway CLI reports `Unauthorized`, follow the `configure-railway-auth` skill rather than re-running `railway login` in a loop.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/api && NODE_ENV=test bun test src/lib/tests/fast-intake-feature.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/lib/fast-intake-feature.ts \
        services/api/src/lib/tests/fast-intake-feature.spec.ts \
        services/api/src/startup.env.ts \
        services/api/src/controllers/auth.controller.ts \
        .env.example .env.development
git commit -m "feat(api): add FAST_SIGNAL_INTAKE flag (dark)"
# The Railway variable is infrastructure, not a tracked file — nothing to commit for it.
```

---

### Task 7: Intake controller

Five endpoints, guarded, flag-gated, with request validation.

**Files:**
- Create: `services/api/src/controllers/intent-intake.controller.ts`
- Modify: wherever controllers are registered (search: `rg -n "IntentController" services/api/src --glob '!*test*'`)
- Test: `services/api/src/controllers/tests/intent-intake.controller.isolated.ts`

**Interfaces:**
- Consumes: `SignalIntakeService` (Task 5), `isFastSignalIntakeEnabled` (Task 6), `AuthGuard`, `RateLimit` from `../guards/limiter.guard`.
- Produces routes under `@Controller('/intents/intake')`:
  - `POST /start` → `{ question }`
  - `POST /question` → `{ question }`
  - `POST /prepare` → `202 { runId }`
  - `POST /proposal` → `{ proposalId, description, lookingFor, youBring }`
  - `POST /revise` → same shape as `/proposal`

Zod schemas:

```ts
const AnswerSchema = z.object({
  selectedOptions: z.array(z.string()).default([]),
  freeText: z.string().trim().optional(),
}).strict();
const QuestionSchema = z.object({ whoAnswer: AnswerSchema }).strict();
const PrepareSchema = z.object({ whoAnswer: AnswerSchema, bringAnswer: AnswerSchema }).strict();
const ProposalSchema = z.object({
  runId: z.string().uuid('runId must be a UUID'),
  networkId: z.string().uuid('networkId must be a UUID').optional(),
  whereText: z.string().trim().max(280).optional(),
}).strict();
const ReviseSchema = z.object({
  runId: z.string().uuid('runId must be a UUID'),
  feedback: z.string().trim().min(1).max(600),
}).strict();
```

- [ ] **Step 1: Write the failing test**

Create `services/api/src/controllers/tests/intent-intake.controller.isolated.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { IntentIntakeController } from '../intent-intake.controller';

const user = { id: 'u1' } as never;
const question = {
  title: 'Question 1',
  prompt: 'Who do you want to meet?',
  options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
  multiSelect: false,
};
const proposal = {
  proposalId: 'prop-1',
  description: 'Looking for a design partner.',
  lookingFor: 'A design partner',
  youBring: 'Engineering depth',
};
const answers = {
  whoAnswer: { selectedOptions: ['A design partner'] },
  bringAnswer: { selectedOptions: ['Engineering depth'] },
};

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    getOrCreatePack: mock(async () => ({ brief: 'b', question, packHit: true })),
    nextQuestion: mock(async () => question),
    prepare: mock(async () => ({ runId: 'run-1' })),
    resolveProposal: mock(async () => proposal),
    revise: mock(async () => proposal),
    ...overrides,
  };
}

const request = (body: unknown) => new Request('http://localhost/intents/intake', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const original = process.env.FAST_SIGNAL_INTAKE;
beforeEach(() => { process.env.FAST_SIGNAL_INTAKE = 'true'; });
afterEach(() => {
  if (original === undefined) delete process.env.FAST_SIGNAL_INTAKE;
  else process.env.FAST_SIGNAL_INTAKE = original;
});

describe('IntentIntakeController flag gating', () => {
  it('404s every route when the flag is off', async () => {
    process.env.FAST_SIGNAL_INTAKE = 'false';
    const controller = new IntentIntakeController({ service: makeService() as never });

    const responses = await Promise.all([
      controller.start(request({}), user),
      controller.question(request({ whoAnswer: answers.whoAnswer }), user),
      controller.prepare(request(answers), user),
      controller.proposal(request({ runId: '11111111-1111-4111-8111-111111111111', ...answers }), user),
      controller.revise(request({ runId: '11111111-1111-4111-8111-111111111111', feedback: 'x', ...answers }), user),
    ]);

    for (const response of responses) expect(response.status).toBe(404);
  });
});

describe('IntentIntakeController routes', () => {
  it('returns the pack question from /start', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });

    const response = await controller.start(request({}), user);
    const data = await response.json() as { question: { prompt: string } };

    expect(response.status).toBe(200);
    expect(data.question.prompt).toBe('Who do you want to meet?');
  });

  it('returns 202 with a runId from /prepare', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });

    const response = await controller.prepare(request(answers), user);
    const data = await response.json() as { runId: string };

    expect(response.status).toBe(202);
    expect(data.runId).toBe('run-1');
  });

  it('returns the proposal from /proposal', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });

    const response = await controller.proposal(
      request({ runId: '11111111-1111-4111-8111-111111111111', ...answers }), user,
    );
    const data = await response.json() as { proposalId: string };

    expect(response.status).toBe(200);
    expect(data.proposalId).toBe('prop-1');
  });

  it('maps a foreign run to 404 run_not_found', async () => {
    const service = makeService({
      resolveProposal: mock(async () => {
        const { IntakeRunNotFoundError } = await import('../../services/signal-intake.service');
        throw new IntakeRunNotFoundError();
      }),
    });
    const controller = new IntentIntakeController({ service: service as never });

    const response = await controller.proposal(
      request({ runId: '11111111-1111-4111-8111-111111111111', ...answers }), user,
    );
    const data = await response.json() as { code: string };

    expect(response.status).toBe(404);
    expect(data.code).toBe('run_not_found');
  });

  it('maps verification rejection to 422 with the clarification question', async () => {
    const service = makeService({
      resolveProposal: mock(async () => {
        const { IntakeVerificationRejectedError } = await import('../../services/signal-intake.service');
        throw new IntakeVerificationRejectedError(question);
      }),
    });
    const controller = new IntentIntakeController({ service: service as never });

    const response = await controller.proposal(
      request({ runId: '11111111-1111-4111-8111-111111111111', ...answers }), user,
    );
    const data = await response.json() as { code: string; clarification: { prompt: string } };

    expect(response.status).toBe(422);
    expect(data.code).toBe('verification_rejected');
    expect(data.clarification.prompt).toBe('Who do you want to meet?');
  });

  it('returns the replacement proposal from /revise', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });

    const response = await controller.revise(
      request({ runId: '11111111-1111-4111-8111-111111111111', feedback: 'more specific', ...answers }), user,
    );

    expect(response.status).toBe(200);
    expect((await response.json() as { proposalId: string }).proposalId).toBe('prop-1');
  });

  it('rejects malformed bodies with 400', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });

    const response = await controller.proposal(request({ runId: 'not-a-uuid' }), user);

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && NODE_ENV=test bun test src/controllers/tests/intent-intake.controller.isolated.ts`
Expected: FAIL — controller module not found.

- [ ] **Step 3: Write the controller**

Create `services/api/src/controllers/intent-intake.controller.ts`:

```ts
import { z } from 'zod';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { isFastSignalIntakeEnabled } from '../lib/fast-intake-feature';
import { log } from '../lib/log';
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import {
  IntakeRunNotFoundError,
  IntakeVerificationRejectedError,
  signalIntakeService,
  type SignalIntakeService,
} from '../services/signal-intake.service';

const logger = log.controller.from('intent-intake');

const AnswerSchema = z.object({
  selectedOptions: z.array(z.string()).default([]),
  freeText: z.string().trim().optional(),
}).strict();
const QuestionSchema = z.object({ whoAnswer: AnswerSchema }).strict();
const PrepareSchema = z.object({
  whoAnswer: AnswerSchema,
  bringAnswer: AnswerSchema,
  round2Prompt: z.string().trim().max(400).optional(),
}).strict();
const ProposalSchema = z.object({
  runId: z.string().uuid('runId must be a UUID'),
  whoAnswer: AnswerSchema,
  bringAnswer: AnswerSchema,
  networkId: z.string().uuid('networkId must be a UUID').optional(),
  whereText: z.string().trim().max(280).optional(),
}).strict();
const ReviseSchema = z.object({
  runId: z.string().uuid('runId must be a UUID'),
  feedback: z.string().trim().min(1).max(600),
  whoAnswer: AnswerSchema,
  bringAnswer: AnswerSchema,
}).strict();

/** Deterministic fast-intake funnel. Gated by FAST_SIGNAL_INTAKE. */
@Controller('/intents/intake')
export class IntentIntakeController {
  private readonly service: Pick<
    SignalIntakeService,
    'getOrCreatePack' | 'nextQuestion' | 'prepare' | 'resolveProposal' | 'revise'
  >;

  /**
   * @param deps - Optional service override for focused controller tests.
   */
  constructor(deps?: { service?: SignalIntakeService }) {
    this.service = deps?.service ?? signalIntakeService;
  }

  /** Round 1: pack lookup, or synchronous generation on a cold miss. */
  @Post('/start')
  @UseGuards(RateLimit('write'), AuthGuard)
  async start(_req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    try {
      const { question } = await this.service.getOrCreatePack(user.id);
      return Response.json({ question });
    } catch (error) {
      return this.fail(error, user.id, 'start');
    }
  }

  /** Round 2: one structured call grounded by the brief and round-1 answer. */
  @Post('/question')
  @UseGuards(RateLimit('write'), AuthGuard)
  async question(req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    const parsed = QuestionSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return this.invalid(parsed.error);
    try {
      const question = await this.service.nextQuestion(user.id, parsed.data.whoAnswer);
      return Response.json({ question });
    } catch (error) {
      return this.fail(error, user.id, 'question');
    }
  }

  /** Start speculative synthesis and return immediately. */
  @Post('/prepare')
  @UseGuards(RateLimit('write'), AuthGuard)
  async prepare(req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    const parsed = PrepareSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return this.invalid(parsed.error);
    try {
      const { runId } = await this.service.prepare(user.id, parsed.data);
      return Response.json({ runId }, { status: 202 });
    } catch (error) {
      return this.fail(error, user.id, 'prepare');
    }
  }

  /** Resolve the speculative proposal, or redo it when the where-text changed it. */
  @Post('/proposal')
  @UseGuards(RateLimit('write'), AuthGuard)
  async proposal(req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    const parsed = ProposalSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return this.invalid(parsed.error);
    const { runId, whereText, whoAnswer, bringAnswer } = parsed.data;
    try {
      const proposal = await this.service.resolveProposal(user.id, {
        runId,
        answers: { whoAnswer, bringAnswer },
        ...(whereText ? { whereText } : {}),
      });
      return Response.json(proposal);
    } catch (error) {
      return this.fail(error, user.id, 'proposal');
    }
  }

  /** Replace the visible draft from user feedback. */
  @Post('/revise')
  @UseGuards(RateLimit('write'), AuthGuard)
  async revise(req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    const parsed = ReviseSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return this.invalid(parsed.error);
    const { runId, feedback, whoAnswer, bringAnswer } = parsed.data;
    try {
      const proposal = await this.service.revise(user.id, {
        runId, feedback, answers: { whoAnswer, bringAnswer },
      });
      return Response.json(proposal);
    } catch (error) {
      return this.fail(error, user.id, 'revise');
    }
  }

  /** 400 with flattened Zod details, matching IntentController. */
  private invalid(error: z.ZodError) {
    return Response.json({ error: 'Validation failed', details: error.flatten() }, { status: 400 });
  }

  /**
   * Map service errors onto stable client codes.
   *
   * Verification rejection is recoverable: it carries the clarification question
   * the web app renders as a fourth round before retrying.
   */
  private fail(error: unknown, userId: string, stage: string) {
    if (error instanceof IntakeRunNotFoundError) {
      return Response.json({ error: 'run_not_found', code: 'run_not_found' }, { status: 404 });
    }
    if (error instanceof IntakeVerificationRejectedError) {
      return Response.json({
        error: 'verification_rejected',
        code: 'verification_rejected',
        clarification: error.clarification,
      }, { status: 422 });
    }
    logger.error('Intake request failed', { userId, stage, error });
    return Response.json({ error: 'Failed to process intake request' }, { status: 500 });
  }
}
```

Export a `signalIntakeService` singleton from `signal-intake.service.ts` wired to the real adapters, the compiled intent graph from `toolService`, and `chatDatabaseAdapter` readers for premises, network titles, and global context. Register `IntentIntakeController` wherever `IntentController` is registered.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && NODE_ENV=test bun test src/controllers/tests/intent-intake.controller.isolated.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/controllers/intent-intake.controller.ts \
        services/api/src/controllers/tests/intent-intake.controller.isolated.ts
git commit -m "feat(api): add deterministic intent intake endpoints"
```

---

### Task 8: Web intake flow

A new `FastSignalIntake` component drives the deterministic funnel, reusing `GuidedQuestion` and `ProposalCard` from `GuidedSignalIntake.tsx` verbatim plus a new `WherePicker`.

> **Refinement vs. the spec.** The spec said `GuidedSignalIntake` would "gain an intake-driven mode". Implementing it as a sibling component instead keeps the 554-line legacy file completely untouched, so the flag selects between two whole components rather than branching inside one. Same reuse, less risk, and deleting the legacy path in the follow-up becomes a file deletion.

**Files:**
- Create: `apps/web/src/services/intake.ts`
- Create: `apps/web/src/components/signals/WherePicker.tsx`
- Create: `apps/web/src/components/signals/FastSignalIntake.tsx`
- Modify: `apps/web/src/components/signals/GuidedSignalIntake.tsx` (export `GuidedQuestion`/`ProposalCard` only — they are already exported; no behavior change)
- Modify: `apps/web/src/app/i/new/page.tsx`, `apps/web/src/app/onboarding/page.tsx`
- Test: `apps/web/tests/fast-signal-intake.test.tsx`

**Interfaces:**
- Consumes: `apiClient` from `@/lib/api`; `useNetworksState`; `features.fastSignalIntake` from `useAuthContext`.
- Produces:
  ```ts
  // apps/web/src/services/intake.ts
  export interface IntakeAnswerBody { selectedOptions: string[]; freeText?: string }
  export interface IntakeQuestionResponse { question: QuestionPayload }
  export interface IntakeProposalResponse {
    proposalId: string; description: string; lookingFor: string; youBring: string;
  }
  export const intakeService: {
    start(): Promise<IntakeQuestionResponse>;
    question(whoAnswer: IntakeAnswerBody): Promise<IntakeQuestionResponse>;
    prepare(whoAnswer: IntakeAnswerBody, bringAnswer: IntakeAnswerBody): Promise<{ runId: string }>;
    proposal(input: { runId: string; networkId?: string; whereText?: string }): Promise<IntakeProposalResponse>;
    revise(input: { runId: string; feedback: string }): Promise<IntakeProposalResponse>;
  };
  ```
  `WherePicker` props: `{ networks: Array<{ id: string; title: string }>; onSelect: (choice: { networkId?: string; whereText?: string }) => void; busy: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/fast-signal-intake.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

import NewSignalPage from "@/app/i/new/page";

const mocks = vi.hoisted(() => ({
  fastSignalIntake: true,
  sendWebMessage: vi.fn(),
  start: vi.fn(),
  question: vi.fn(),
  prepare: vi.fn(),
  proposal: vi.fn(),
  revise: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  addNotification: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/contexts/AIChatContext", () => ({
  useAIChat: () => ({
    messages: [], liveQuestions: [], isLoading: false,
    startSignalSession: vi.fn(), sendWebMessage: mocks.sendWebMessage, clearChat: vi.fn(),
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuthContext: () => ({
    isAuthenticated: true,
    features: { signalAgent: true, fastSignalIntake: mocks.fastSignalIntake },
    signOut: vi.fn(), openLoginModal: vi.fn(),
  }),
}));
vi.mock("@/contexts/IndexesContext", () => ({
  useNetworksState: () => ({ indexes: [{ id: "network-1", title: "Builders", isPersonal: false }] }),
}));
vi.mock("@/contexts/APIContext", () => ({ useQuestionsService: () => ({ answer: vi.fn() }) }));
vi.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({ addNotification: mocks.addNotification, error: mocks.showError }),
}));
vi.mock("@/lib/api", () => ({ apiClient: { post: mocks.apiPost, patch: mocks.apiPatch } }));
vi.mock("@/services/intake", () => ({
  intakeService: {
    start: mocks.start, question: mocks.question, prepare: mocks.prepare,
    proposal: mocks.proposal, revise: mocks.revise,
  },
}));

const question = (prompt: string) => ({
  title: "t", prompt,
  options: [{ label: "A design partner", description: "a" }, { label: "Other", description: "b" }],
  multiSelect: false,
});

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/i/new"]}>
      <Routes><Route path="*" element={<><NewSignalPage /><LocationProbe /></>} /></Routes>
    </MemoryRouter>,
  );
}

async function answer(prompt: string, label: string) {
  await screen.findByText(prompt);
  fireEvent.click(screen.getByText(label));
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fastSignalIntake = true;
  mocks.start.mockResolvedValue({ question: question("Who do you want to meet?") });
  mocks.question.mockResolvedValue({ question: question("What would you bring?") });
  mocks.prepare.mockResolvedValue({ runId: "run-1" });
  mocks.proposal.mockResolvedValue({
    proposalId: "prop-1", description: "Looking for a design partner.",
    lookingFor: "A design partner", youBring: "Engineering depth",
  });
  mocks.apiPost.mockResolvedValue({ intentId: "intent-1" });
});

describe("fast signal intake", () => {
  test("renders round 1 from /start without any chat kickoff", async () => {
    renderPage();

    await screen.findByText("Who do you want to meet?");
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.sendWebMessage).not.toHaveBeenCalled();
  });

  test("answering round 1 requests round 2", async () => {
    renderPage();

    await answer("Who do you want to meet?", "A design partner");

    await screen.findByText("What would you bring?");
    expect(mocks.question).toHaveBeenCalledWith({ selectedOptions: ["A design partner"] });
  });

  test("shows the where picker before any proposal resolves", async () => {
    let releaseProposal: (() => void) | undefined;
    mocks.proposal.mockImplementation(() => new Promise((resolve) => {
      releaseProposal = () => resolve({
        proposalId: "prop-1", description: "d", lookingFor: "l", youBring: "y",
      });
    }));
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");

    await screen.findByText(/everywhere/i);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/does this feel right/i)).toBeNull();
    releaseProposal?.();
  });

  test("picking a community resolves the proposal without whereText", async () => {
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    fireEvent.click(await screen.findByText("Builders"));

    await screen.findByText(/does this feel right/i);
    expect(mocks.proposal).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1", networkId: "network-1",
    }));
    expect(mocks.proposal.mock.calls[0][0]).not.toHaveProperty("whereText");
  });

  test("free text sends whereText", async () => {
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    await screen.findByText(/everywhere/i);
    fireEvent.change(screen.getByPlaceholderText(/somewhere more specific/i), {
      target: { value: "Berlin only" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(mocks.proposal).toHaveBeenCalledWith(
      expect.objectContaining({ whereText: "Berlin only" }),
    ));
  });

  test("confirming posts to /intents/confirm and navigates", async () => {
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    fireEvent.click(await screen.findByText("Builders"));
    fireEvent.click(await screen.findByRole("button", { name: /confirm signal/i }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/intents/confirm", {
      proposalId: "prop-1",
      description: "Looking for a design partner.",
      networkId: "network-1",
    }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/i/intent-1"));
  });

  test("renders the clarification round when verification is rejected", async () => {
    mocks.proposal
      .mockRejectedValueOnce({ code: "verification_rejected", clarification: question("What would make it concrete?") })
      .mockResolvedValueOnce({
        proposalId: "prop-2", description: "Sharper signal.", lookingFor: "l", youBring: "y",
      });
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    fireEvent.click(await screen.findByText("Builders"));

    await answer("What would make it concrete?", "A design partner");
    await screen.findByText(/does this feel right/i);
    expect(mocks.proposal).toHaveBeenCalledTimes(2);
  });

  test("falls back to the legacy chat path when the flag is off", async () => {
    mocks.fastSignalIntake = false;
    renderPage();

    await waitFor(() => expect(mocks.sendWebMessage).toHaveBeenCalledWith(
      "new-signal-kickoff", undefined, undefined, expect.objectContaining({ hidden: true, persona: "signal" }),
    ));
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bun --bun vitest run tests/fast-signal-intake.test.tsx`
Expected: FAIL — `@/services/intake` not found.

- [ ] **Step 3: Write the service client**

Create `apps/web/src/services/intake.ts`:

```ts
/** Client for the deterministic /intents/intake funnel. */

import { apiClient } from "@/lib/api";
import type { QuestionPayload } from "@/services/questions";

/** One answered intake round. */
export interface IntakeAnswerBody {
  selectedOptions: string[];
  freeText?: string;
}

export interface IntakeQuestionResponse { question: QuestionPayload }

export interface IntakeProposalResponse {
  proposalId: string;
  description: string;
  lookingFor: string;
  youBring: string;
}

/** Both answers travel with every call: the server holds no funnel state. */
interface IntakeAnswers {
  whoAnswer: IntakeAnswerBody;
  bringAnswer: IntakeAnswerBody;
}

export const intakeService = {
  /** Round 1 from the precomputed pack. */
  start: () => apiClient.post<IntakeQuestionResponse>("/intents/intake/start", {}),

  /** Round 2, grounded by the round-1 answer. */
  question: (whoAnswer: IntakeAnswerBody) =>
    apiClient.post<IntakeQuestionResponse>("/intents/intake/question", { whoAnswer }),

  /** Kick off speculative synthesis; returns immediately. */
  prepare: (input: IntakeAnswers & { round2Prompt?: string }) =>
    apiClient.post<{ runId: string }>("/intents/intake/prepare", input),

  /** Resolve the proposal once the user has chosen where to look. */
  proposal: (input: IntakeAnswers & { runId: string; networkId?: string; whereText?: string }) =>
    apiClient.post<IntakeProposalResponse>("/intents/intake/proposal", input),

  /** Replace the visible draft from feedback. */
  revise: (input: IntakeAnswers & { runId: string; feedback: string }) =>
    apiClient.post<IntakeProposalResponse>("/intents/intake/revise", input),
};
```

- [ ] **Step 4: Write the WherePicker**

Create `apps/web/src/components/signals/WherePicker.tsx`:

```tsx
import { useState } from "react";
import { Loader2, Send } from "lucide-react";

/** Deterministic round 3: existing memberships plus a free-text escape hatch. */
export function WherePicker({
  networks,
  onSelect,
  busy,
}: {
  networks: Array<{ id: string; title: string }>;
  onSelect: (choice: { networkId?: string; whereText?: string }) => void;
  busy: boolean;
}) {
  const [whereText, setWhereText] = useState("");

  return (
    <section aria-label="Where to look" className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Last one</p>
      <h1 className="mt-3 text-2xl font-semibold leading-tight text-[#041729] sm:text-3xl">
        Where should we look?
      </h1>
      <div className="mt-6 grid gap-3">
        {networks.map((network) => (
          <button
            key={network.id}
            type="button"
            disabled={busy}
            onClick={() => onSelect({ networkId: network.id })}
            className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left text-sm font-medium text-gray-800 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {network.title}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => onSelect({})}
          className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left text-sm font-medium text-gray-800 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Everywhere
          <span className="mt-1 block text-xs text-gray-500">No community or place constraint</span>
        </button>
      </div>
      <input
        value={whereText}
        onChange={(event) => setWhereText(event.target.value)}
        disabled={busy}
        placeholder="Somewhere more specific?"
        className="mt-4 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#041729] focus:ring-2 focus:ring-[#041729]/10 disabled:opacity-60"
      />
      <button
        type="button"
        disabled={busy || whereText.trim().length === 0}
        onClick={() => onSelect({ whereText: whereText.trim() })}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Continue
      </button>
      <p className="mt-2 text-xs text-gray-500">
        Naming a place rewrites your signal, so it takes a moment longer.
      </p>
    </section>
  );
}
```

- [ ] **Step 5: Write the FastSignalIntake component**

Create `apps/web/src/components/signals/FastSignalIntake.tsx`. It holds the funnel in local state (`stage`, `whoAnswer`, `bringAnswer`, `runId`, `proposal`, `clarification`), calls `intakeService`, and renders:

- `stage === "who" | "bring" | "clarify"` → `<GuidedQuestion question={...} onAnswer={...} disabled={busy} />` imported from `./GuidedSignalIntake`
- `stage === "where"` → `<WherePicker networks={indexes} onSelect={...} busy={busy} />`
- `stage === "proposal"` → `<ProposalCard ... onConfirm={...} onFeedback={(f) => intakeService.revise(...)} onSkip={...} />`

Critical behaviors the Step 1 tests pin down:

```tsx
// Round 2's answer starts speculation, then immediately advances to the picker.
const handleBringAnswer = useCallback(async (answer: IntakeAnswerBody) => {
  setBringAnswer(answer);
  setStage("where");                       // render the picker first
  const { runId } = await intakeService.prepare({
    whoAnswer: whoAnswer!, bringAnswer: answer, round2Prompt: bringQuestion!.prompt,
  });
  setRunId(runId);                          // speculation now runs in the background
}, [whoAnswer, bringQuestion]);

// A rejected verification is recoverable: show the clarification, then retry.
const resolve = useCallback(async (choice: { networkId?: string; whereText?: string }) => {
  setBusy(true);
  try {
    const result = await intakeService.proposal({
      runId: runId!, whoAnswer: whoAnswer!, bringAnswer: bringAnswer!, ...choice,
    });
    setProposal(result);
    setStage("proposal");
  } catch (error) {
    const rejection = error as { code?: string; clarification?: QuestionPayload };
    if (rejection.code === "verification_rejected" && rejection.clarification) {
      setClarification(rejection.clarification);
      setPendingChoice(choice);
      setStage("clarify");
      return;
    }
    setError("Couldn't build your signal. Please try again.");
  } finally {
    setBusy(false);
  }
}, [runId, whoAnswer, bringAnswer]);
```

Answering the clarification merges its text into `bringAnswer.freeText` and calls `resolve(pendingChoice)` again.

- [ ] **Step 6: Switch the pages on the flag**

In `apps/web/src/app/i/new/page.tsx` and `apps/web/src/app/onboarding/page.tsx`, render `<FastSignalIntake onConfirmed={handleConfirmed} />` when `features?.fastSignalIntake === true`, else the existing `<GuidedSignalIntake ... />` untouched. In the fast path, skip `sendKickoff`/`startSignalSession` entirely.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/web && bun --bun vitest run tests/fast-signal-intake.test.tsx tests/guided-signal-flow.test.tsx`
Expected: PASS — 8 new intake tests plus the untouched legacy suite.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/services/intake.ts \
        apps/web/src/components/signals/WherePicker.tsx \
        apps/web/src/components/signals/FastSignalIntake.tsx \
        apps/web/src/app/i/new/page.tsx \
        apps/web/src/app/onboarding/page.tsx \
        apps/web/tests/fast-signal-intake.test.tsx
git commit -m "feat(web): add deterministic fast intake flow for /i/new"
```

---

### Task 9: Async questions write-back

Keeps intake Q&A visible to question analytics without adding latency.

**Files:**
- Modify: `services/api/src/services/signal-intake.service.ts`
- Test: `services/api/src/services/tests/signal-intake.writeback.isolated.ts`

**Interfaces:**
- Consumes: the host question persistence used by `chatQuestions.persist`. Locate it first with `rg -n "persist" services/api/src/adapters --glob '*question*'`.
- Produces: the real `recordAnsweredQuestion` implementation injected into `signalIntakeService` (the dep and the `record()` call site already exist from Task 5).

- [ ] **Step 1: Write the failing test**

Create `services/api/src/services/tests/signal-intake.writeback.isolated.ts`:

```ts
import { describe, expect, it, mock } from 'bun:test';

import { SignalIntakeService } from '../signal-intake.service';

const question = {
  title: 'Question 1',
  prompt: 'Who do you want to meet?',
  options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
  multiSelect: false,
};

function makeDeps(recordAnsweredQuestion: unknown) {
  return {
    packStore: {
      getPack: mock(async () => ({
        userId: 'u1', brief: 'b', question, premiseHash: 'h', generatedAt: new Date(),
      })),
      upsertPack: mock(async () => undefined),
    },
    runStore: {
      claimRun: mock(async () => ({
        run: { id: 'run-1', userId: 'u1', answersHash: 'h', status: 'pending', proposalId: null, error: null, createdAt: new Date() },
        claimed: false,
      })),
      markReady: mock(async () => undefined),
      markFailed: mock(async () => undefined),
      sweepStaleRuns: mock(async () => undefined),
      getRunForOwner: mock(async () => null),
    },
    proposalStore: {
      createProposals: mock(async () => undefined),
      getProposalForOwner: mock(async () => null),
    },
    orchestrator: {
      nextQuestion: mock(async () => question),
      synthesize: mock(async () => ({ description: 'd', lookingFor: 'l', youBring: 'y' })),
    },
    packGenerator: { generate: mock(async () => ({ brief: 'b', question })) },
    getPremises: mock(async () => []),
    getNetworkTitles: mock(async () => []),
    getGlobalContext: mock(async () => null),
    invokeIntentGraph: mock(async () => ({ verifiedIntents: [] })),
    recordAnsweredQuestion,
  };
}

const whoAnswer = { selectedOptions: ['A design partner'] };
const bringAnswer = { selectedOptions: ['Engineering depth'] };

describe('intake answer write-back', () => {
  it('records the round-1 answer with stage "who"', async () => {
    const recorder = mock(async () => undefined);
    const service = new SignalIntakeService(makeDeps(recorder) as never);

    await service.nextQuestion('u1', whoAnswer);

    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder.mock.calls[0][0]).toMatchObject({
      userId: 'u1', stage: 'who', prompt: 'Who do you want to meet?',
    });
  });

  it('records the round-2 answer with stage "bring"', async () => {
    const recorder = mock(async () => undefined);
    const service = new SignalIntakeService(makeDeps(recorder) as never);

    await service.prepare('u1', { whoAnswer, bringAnswer, round2Prompt: 'What would you bring?' });

    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder.mock.calls[0][0]).toMatchObject({ stage: 'bring', prompt: 'What would you bring?' });
  });

  it('does not await the recorder before responding', async () => {
    let settled = false;
    const recorder = mock(() => new Promise<void>((resolve) => setTimeout(() => {
      settled = true;
      resolve();
    }, 50)));
    const service = new SignalIntakeService(makeDeps(recorder) as never);

    await service.prepare('u1', { whoAnswer, bringAnswer });

    expect(settled).toBe(false);
  });

  it('never fails a request when the recorder rejects', async () => {
    const recorder = mock(async () => { throw new Error('questions table down'); });
    const service = new SignalIntakeService(makeDeps(recorder) as never);

    await expect(service.prepare('u1', { whoAnswer, bringAnswer })).resolves.toMatchObject({ runId: 'run-1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && NODE_ENV=test bun test src/services/tests/signal-intake.writeback.isolated.ts`
Expected: FAIL — no `recordAnsweredQuestion` is wired into the exported singleton yet, and the prompt assertions do not match.

- [ ] **Step 3: Wire the real recorder**

In the `signalIntakeService` singleton construction, pass a `recordAnsweredQuestion` that persists an already-answered question row through the same host persistence `chatQuestions.persist` uses, with `detection.mode: 'chat'`, `sourceType: 'conversation'`, `sourceId: `intake:${stage}``, and the answer attached. It must return a promise and never be awaited by the caller (Task 5's `record()` already enforces that with `void ... .catch()`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && NODE_ENV=test bun test src/services/tests/signal-intake.writeback.isolated.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/signal-intake.service.ts \
        services/api/src/services/tests/signal-intake.writeback.isolated.ts
git commit -m "feat(api): mirror intake answers into question analytics"
```

---

### Task 10: Full verification sweep

**Files:** none created; fixes only.

- [ ] **Step 1: Protocol tests**

Run: `cd packages/protocol && bun test`
Expected: PASS. Fix any regression before continuing.

- [ ] **Step 2: Protocol architecture gates**

Run: `cd packages/protocol && bun run test:architecture`
Expected: PASS — confirms the new modules respect layering.

- [ ] **Step 3: Eval inventory gate**

Run: `cd packages/protocol && bun run eval:verify`
Expected: PASS. The new `signalIntakePack` model key may trip inventory/coverage — if it does, follow the `run-protocol-evals` skill to register it rather than weakening the gate.

- [ ] **Step 4: API tests**

Run: `cd services/api && bun run test`
Expected: PASS.

- [ ] **Step 5: Web tests**

Run: `cd apps/web && bun run test`
Expected: PASS.

- [ ] **Step 6: Lint**

Run: `bun run lint`
Expected: clean.

- [ ] **Step 7: Confirm the flag is still dark**

Run: `rg -n "FAST_SIGNAL_INTAKE" .env.example .env.development services/api/src`
Expected: every declared value is `false`; only `isFastSignalIntakeEnabled()` reads the variable.

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "test: fix fallout from fast signal intake"
```

---

## Verification Checklist

- [ ] `/i/new` with the flag off behaves exactly as before (legacy chat kickoff path).
- [ ] `/i/new` with the flag on renders round 1 with zero model calls on a warm pack.
- [ ] Round 3 issues no model call; the community picker is rendered from existing memberships.
- [ ] The where-picker appears before synthesis completes (speculation is genuinely overlapped).
- [ ] A community pick reaches `/intents/confirm` as `networkId`.
- [ ] Free-text where triggers exactly one re-synthesis.
- [ ] `signal_intake_stage` logs appear for `start`, `question`, `prepare`, `proposal`, `revise`, each carrying `packHit`, `speculationHit`, `whereTextUsed`, `fallbackUsed`.
- [ ] A rejected verification renders the clarification round and recovers on retry rather than dead-ending.
- [ ] Abandoned runs are swept: a run older than `SIGNAL_INTAKE_RUN_TTL_MS` is deleted on the owner's next `prepare`.
- [ ] Intake answers appear in the questions table with `sourceId` `intake:who` / `intake:bring`, written after the response.
- [ ] Both migrations contain only `CREATE` statements — no `DROP`.
- [ ] `getSignalIntakeStage` and `buildSignalIntakeGuidance` are untouched.
- [ ] `FAST_SIGNAL_INTAKE` is `false` in `.env.example`, `.env.development`, and the Railway dev service.
