# Configurable Fast-Intake Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deterministic fast-intake funnel's question budget (`SIGNAL_INTAKE_MAX_QUESTIONS`, total incl. cached round 1, default 2, clamp 1–10) and per-turn delivery mode (`SIGNAL_INTAKE_QUESTION_MODE=singular|plural`, default singular) configurable, with the follow-up count planned once by the model after the round-1 answer and then locked.

**Architecture:** One structured-output planning call in the protocol orchestrator produces follow-up questions plus a planned count; the stateless API service computes/clamps the locked `total` per mode and serves batches (plural) or single questions (singular); the web client steps through a question queue and only re-calls `/intents/intake/question` when the queue is empty and `rounds.length < total`. Synthesis generalizes from fixed `whoAnswer`/`bringAnswer` to an ordered `rounds` list.

**Tech Stack:** Bun, TypeScript, LangChain structured models + zod (protocol), Hono-style decorators + zod controllers (api), React + vitest (web).

**Spec:** `docs/specs/2026-08-02-configurable-intake-questions-design.md` (read it first).

## Global Constraints

- Worktree: `/home/yanek/Projects/index/.worktrees/feat-configurable-intake-questions`, branch `feat/configurable-intake-questions`. Run all commands there.
- Defaults must be byte-identical to current behavior: `n=2`, `singular`.
- Env accessors live in `services/api/src/lib/`; no bare `process.env` at call sites; `packages/protocol` stays `process.env`-free (values are passed in as parameters).
- No `/auth/me` features change; no `.env.development`/Railway changes in this PR.
- Web and API ship atomically: the controller accepts **only** the new `rounds` request shape — no legacy `whoAnswer`/`bringAnswer` compatibility shim.
- Where-picker and clarification rounds do not count toward `n`; clarification merges into the **last** round's answer.
- No database-backed tests: all validation is protocol `bun test`, api isolated suites (`bun run test:isolated`), and web `bun --bun vitest run`.

---

### Task 1: Protocol — `generateFollowUps` + rounds-based `synthesize`

**Files:**
- Modify: `packages/protocol/src/signals/application/intake.orchestrator.ts` (full rewrite of question/synthesis halves)
- Modify: `packages/protocol/src/signals/application/index.ts:37-46` (barrel exports)
- Test: `packages/protocol/src/signals/application/tests/intake.orchestrator.spec.ts`

**Interfaces:**
- Consumes: `normalizeIntakePack`, `IntakePackQuestion` from `./intake.pack.generator.js` (unchanged).
- Produces (used by Tasks 4 and api/web types):
  ```ts
  export interface IntakeRound { prompt: string; answer: IntakeAnswer }
  export interface FollowUpPlanInput {
    brief: string;
    rounds: IntakeRound[];               // round 1 first, in order
    maxFollowUps: number;                // hard cap for THIS call
    plannedFollowUpCount?: number;       // locked plan on continuation calls
  }
  export interface FollowUpPlan {
    questions: IntakePackQuestion[];     // length <= maxFollowUps
    plannedFollowUpCount: number;        // model's total follow-up plan (>= questions.length)
  }
  // SignalIntakeOrchestrator:
  generateFollowUps(input: FollowUpPlanInput): Promise<FollowUpPlan>
  synthesize(input: SynthesisInput): Promise<SynthesisResult>
  // SynthesisInput CHANGES to:
  export interface SynthesisInput {
    brief: string;
    rounds: IntakeRound[];
    whereText?: string;
    feedback?: string;
  }
  ```
  `nextQuestion` and the `question` constructor slot are **removed** (replaced by `planner`). `IntakeAnswer`, `SynthesisResult`, `answerLabel`, `FALLBACK_WHO_QUESTION`, `FALLBACK_BRING_QUESTION` stay.

- [ ] **Step 1: Write the failing tests**

Replace the `SignalIntakeOrchestrator.nextQuestion` and `SignalIntakeOrchestrator.synthesize` describes in `packages/protocol/src/signals/application/tests/intake.orchestrator.spec.ts` (keep the `answerLabel` describe and the `stub` helper unchanged):

```ts
describe("SignalIntakeOrchestrator.generateFollowUps", () => {
  const plan = {
    questions: [question, { ...question, prompt: "Where should we look?" }],
    plannedFollowUpCount: 2,
  };

  it("returns the planned questions and count, grounded in brief and rounds", async () => {
    const capture: { prompt?: string } = {};
    const orchestrator = new SignalIntakeOrchestrator({ planner: stub(plan, capture) });

    const result = await orchestrator.generateFollowUps({
      brief: "Ada builds developer tools.",
      rounds: [{ prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } }],
      maxFollowUps: 3,
    });

    expect(result.questions).toHaveLength(2);
    expect(result.plannedFollowUpCount).toBe(2);
    expect(capture.prompt).toContain("Ada builds developer tools.");
    expect(capture.prompt).toContain("A design partner");
  });

  it("truncates model output to maxFollowUps", async () => {
    const orchestrator = new SignalIntakeOrchestrator({ planner: stub(plan) });

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      maxFollowUps: 1,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.plannedFollowUpCount).toBe(2);
  });

  it("echoes a locked plannedFollowUpCount instead of re-planning", async () => {
    const orchestrator = new SignalIntakeOrchestrator({ planner: stub(plan) });

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [
        { prompt: "p1", answer: { selectedOptions: ["x"] } },
        { prompt: "p2", answer: { selectedOptions: ["y"] } },
      ],
      maxFollowUps: 1,
      plannedFollowUpCount: 3,
    });

    expect(result.plannedFollowUpCount).toBe(3);
  });

  it("falls back to the static question with count 1 when the model fails", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      planner: { invoke: async () => { throw new Error("model down"); } } as never,
    });

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      maxFollowUps: 2,
    });

    expect(result).toEqual({ questions: [FALLBACK_BRING_QUESTION], plannedFollowUpCount: 1 });
  });
});

describe("SignalIntakeOrchestrator.synthesize", () => {
  const synthesis = {
    description: "Looking for a design partner to test developer tooling.",
    lookingFor: "A design partner",
    youBring: "Engineering depth",
  };

  it("renders every round into the synthesis prompt", async () => {
    const capture: { prompt?: string } = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    const result = await orchestrator.synthesize({
      brief: "Ada builds developer tools.",
      rounds: [
        { prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } },
        { prompt: "What do you bring?", answer: { selectedOptions: ["Engineering depth"] } },
        { prompt: "When?", answer: { selectedOptions: [], freeText: "This quarter" } },
      ],
    });

    expect(result.description).toBe(synthesis.description);
    expect(capture.prompt).toContain("Q: Who do you want to meet?\nA: A design partner");
    expect(capture.prompt).toContain("Q: What do you bring?\nA: Engineering depth");
    expect(capture.prompt).toContain("Q: When?\nA: This quarter");
  });

  it("appends where and feedback lines when present", async () => {
    const capture: { prompt?: string } = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    await orchestrator.synthesize({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      whereText: "Berlin",
      feedback: "shorter please",
    });

    expect(capture.prompt).toContain("Where constraint: Berlin");
    expect(capture.prompt).toContain("Revision feedback on the previous draft: shorter please");
  });
});
```

Also update the import line at the top of the spec to drop nothing and add nothing (imports stay `answerLabel, FALLBACK_BRING_QUESTION, FALLBACK_WHO_QUESTION, SignalIntakeOrchestrator`); delete any now-unused references to `nextQuestion` fixtures.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/protocol && bun test src/signals/application/tests/intake.orchestrator.spec.ts`
Expected: FAIL — `orchestrator.generateFollowUps is not a function` (and synthesize prompt assertions fail against the old two-answer format).

- [ ] **Step 3: Rewrite `intake.orchestrator.ts`**

Keep the header comment, imports, `IntakeAnswer`, `SynthesisResult`, both fallbacks, and `answerLabel` as-is. Replace `SynthesisInput`, `QUESTION_SYSTEM_PROMPT`, the constructor's `question` slot, `nextQuestion`, and `synthesize`:

```ts
/** One answered intake round, in order (round 1 first). */
export interface IntakeRound {
  prompt: string;
  answer: IntakeAnswer;
}

/** Everything synthesis needs to write the signal. */
export interface SynthesisInput {
  brief: string;
  rounds: IntakeRound[];
  /** Free-text place/community constraint from the where round. */
  whereText?: string;
  /**
   * Free-text correction the user typed against a draft they already saw.
   * Distinct from {@link SynthesisInput.whereText}: feedback rewrites the
   * signal, it does not constrain where to look.
   */
  feedback?: string;
}

/** Planning input for one follow-up generation call. */
export interface FollowUpPlanInput {
  brief: string;
  /** Answered rounds in order (round 1 first). */
  rounds: IntakeRound[];
  /** Hard cap on questions returned by THIS call. */
  maxFollowUps: number;
  /** Locked interview plan on continuation calls; echoed unchanged. */
  plannedFollowUpCount?: number;
}

/** The model's follow-up batch plus its total follow-up plan. */
export interface FollowUpPlan {
  questions: IntakePackQuestion[];
  plannedFollowUpCount: number;
}

const followUpPlanSchema = z.object({
  questions: z.array(questionSchema),
  plannedFollowUpCount: z.number().int().min(0),
});

const PLAN_SYSTEM_PROMPT = `You plan and write follow-up intake questions for a networking product.

Given a brief about the person and the intake rounds they already answered, decide
how many further questions (up to the stated maximum) would make their signal
specific enough to match on, and write them. Each question is one concise prompt
with 3-4 concrete options grounded in the brief and the previous answers; each
option has a short label and a one-line description. Set multiSelect true only
when several options can genuinely apply together. Never re-ask a dimension that
is already answered; skip a dimension the brief already covers. Never expose raw
JSON, IDs, or internal vocabulary. plannedFollowUpCount is the TOTAL number of
follow-up questions the interview should contain, including any returned now;
when the input already fixes it, echo that value unchanged.`;
```

Constructor and methods:

```ts
export class SignalIntakeOrchestrator {
  private readonly plannerModel: Runnable<BaseLanguageModelInput, z.infer<typeof followUpPlanSchema>>;
  private readonly synthesisModel: Runnable<BaseLanguageModelInput, SynthesisResult>;

  /**
   * @param models - Optional injected structured models. Tests pass stubs.
   */
  constructor(models?: {
    planner?: Runnable<BaseLanguageModelInput, z.infer<typeof followUpPlanSchema>>;
    synthesis?: Runnable<BaseLanguageModelInput, SynthesisResult>;
  }) {
    this.plannerModel = models?.planner
      ?? createStructuredModel("signalIntakePack", followUpPlanSchema) as unknown as Runnable<BaseLanguageModelInput, z.infer<typeof followUpPlanSchema>>;
    this.synthesisModel = models?.synthesis
      ?? createStructuredModel("signalIntakePack", synthesisSchema) as unknown as Runnable<BaseLanguageModelInput, SynthesisResult>;
  }

  /**
   * Plan and write follow-up questions from the brief and answered rounds.
   *
   * @param input - Brief, answered rounds, per-call cap, and any locked plan
   * @returns Up to `maxFollowUps` renderable questions plus the total plan;
   * the static fallback question with count 1 when generation fails
   */
  async generateFollowUps(input: FollowUpPlanInput): Promise<FollowUpPlan> {
    const roundsText = input.rounds
      .map((round, index) => `Round ${index + 1} — Q: ${round.prompt}\nA: ${answerLabel(round.answer)}`)
      .join("\n\n");
    const lockedLine = input.plannedFollowUpCount !== undefined
      ? `\n\nThe interview plan is fixed at ${input.plannedFollowUpCount} follow-up question(s) in total; ${input.rounds.length - 1} already asked. Echo that count unchanged.`
      : "";
    try {
      const raw = await this.plannerModel.invoke([
        new SystemMessage(PLAN_SYSTEM_PROMPT),
        new HumanMessage(
          `Brief:\n${input.brief}\n\n${roundsText}\n\nWrite up to ${input.maxFollowUps} follow-up question(s).${lockedLine}`,
        ),
      ]);
      const questions = raw.questions
        .slice(0, input.maxFollowUps)
        .map((q) => normalizeIntakePack({ brief: input.brief, question: q }).question);
      return {
        questions,
        plannedFollowUpCount: input.plannedFollowUpCount
          ?? Math.max(raw.plannedFollowUpCount, questions.length),
      };
    } catch {
      if (input.maxFollowUps <= 0) return { questions: [], plannedFollowUpCount: 0 };
      return {
        questions: [FALLBACK_BRING_QUESTION],
        plannedFollowUpCount: input.plannedFollowUpCount ?? 1,
      };
    }
  }

  /**
   * Write the signal from every answered round, any where-constraint, and any
   * revision feedback.
   *
   * @param input - Brief, ordered rounds, optional where constraint, optional feedback
   * @returns Description plus card summary fields
   * @throws Propagates model failure so the caller can mark the run failed
   */
  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const roundsText = input.rounds
      .map((round) => `Q: ${round.prompt}\nA: ${answerLabel(round.answer)}`)
      .join("\n\n");
    const whereLine = input.whereText?.trim()
      ? `\n\nWhere constraint: ${input.whereText.trim()}`
      : "";
    const feedbackLine = input.feedback?.trim()
      ? `\n\nRevision feedback on the previous draft: ${input.feedback.trim()}`
      : "";
    const result = await this.synthesisModel.invoke([
      new SystemMessage(SYNTHESIS_SYSTEM_PROMPT),
      new HumanMessage(
        `Brief:\n${input.brief}\n\n${roundsText}${whereLine}${feedbackLine}\n\nWrite the signal.`,
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

Update the class docblock from "Runs the two live stages of the fast intake funnel." to "Runs the two live stages of the fast intake funnel: follow-up planning and synthesis."

Update the barrel (`packages/protocol/src/signals/application/index.ts:37-46`):

```ts
// ── Fast-intake orchestrator ──────────────────────────────────────────────────
export {
  SignalIntakeOrchestrator,
  answerLabel,
  FALLBACK_WHO_QUESTION,
  FALLBACK_BRING_QUESTION,
  type IntakeAnswer,
  type IntakeRound,
  type FollowUpPlan,
  type FollowUpPlanInput,
  type SynthesisInput,
  type SynthesisResult,
} from "./intake.orchestrator.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/protocol && bun test src/signals/application/tests/intake.orchestrator.spec.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Build protocol**

Run: `cd packages/protocol && bun run build`
Expected: builds clean. NOTE: downstream (`services/api`, `apps/web`) will not typecheck until Tasks 4–6 — expected at this point.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/signals/application/intake.orchestrator.ts \
        packages/protocol/src/signals/application/index.ts \
        packages/protocol/src/signals/application/tests/intake.orchestrator.spec.ts
git commit -m "feat(protocol): plan-based follow-up generation and rounds-based intake synthesis"
```

---

### Task 2: API — env accessors, startup registration, .env.example

**Files:**
- Modify: `services/api/src/lib/fast-intake-feature.ts`
- Modify: `services/api/src/startup.env.ts` (next to `FAST_SIGNAL_INTAKE`, ~line 137)
- Modify: `.env.example` (after the `FAST_SIGNAL_INTAKE` block, ~line 197)
- Test: `services/api/src/lib/tests/fast-intake-feature.spec.ts` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Task 4):
  ```ts
  export type SignalIntakeQuestionMode = 'singular' | 'plural';
  export function getSignalIntakeMaxQuestions(): number;   // default 2, clamp [1,10], garbage -> 2
  export function getSignalIntakeQuestionMode(): SignalIntakeQuestionMode; // default 'singular'
  export function getSignalIntakeConfig(): { maxQuestions: number; mode: SignalIntakeQuestionMode };
  ```

- [ ] **Step 1: Write the failing test**

Create `services/api/src/lib/tests/fast-intake-feature.spec.ts` (mirrors `signal-feature.spec.ts` env-restore style):

```ts
import { afterEach, describe, expect, test } from 'bun:test';

import { getSignalIntakeConfig, getSignalIntakeMaxQuestions, getSignalIntakeQuestionMode } from '../fast-intake-feature';

const prevMax = process.env.SIGNAL_INTAKE_MAX_QUESTIONS;
const prevMode = process.env.SIGNAL_INTAKE_QUESTION_MODE;

afterEach(() => {
  if (prevMax === undefined) delete process.env.SIGNAL_INTAKE_MAX_QUESTIONS;
  else process.env.SIGNAL_INTAKE_MAX_QUESTIONS = prevMax;
  if (prevMode === undefined) delete process.env.SIGNAL_INTAKE_QUESTION_MODE;
  else process.env.SIGNAL_INTAKE_QUESTION_MODE = prevMode;
});

describe('SIGNAL_INTAKE_MAX_QUESTIONS', () => {
  test('defaults to 2 when unset', () => {
    delete process.env.SIGNAL_INTAKE_MAX_QUESTIONS;
    expect(getSignalIntakeMaxQuestions()).toBe(2);
  });

  test('parses a valid integer', () => {
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = '5';
    expect(getSignalIntakeMaxQuestions()).toBe(5);
  });

  test('clamps into [1, 10]', () => {
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = '0';
    expect(getSignalIntakeMaxQuestions()).toBe(1);
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = '99';
    expect(getSignalIntakeMaxQuestions()).toBe(10);
  });

  test('falls back to 2 on garbage', () => {
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = 'abc';
    expect(getSignalIntakeMaxQuestions()).toBe(2);
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = '2.5';
    expect(getSignalIntakeMaxQuestions()).toBe(2);
  });
});

describe('SIGNAL_INTAKE_QUESTION_MODE', () => {
  test('defaults to singular and rejects other values', () => {
    delete process.env.SIGNAL_INTAKE_QUESTION_MODE;
    expect(getSignalIntakeQuestionMode()).toBe('singular');
    process.env.SIGNAL_INTAKE_QUESTION_MODE = 'plural';
    expect(getSignalIntakeQuestionMode()).toBe('plural');
    process.env.SIGNAL_INTAKE_QUESTION_MODE = 'batch';
    expect(getSignalIntakeQuestionMode()).toBe('singular');
  });

  test('getSignalIntakeConfig combines both', () => {
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = '4';
    process.env.SIGNAL_INTAKE_QUESTION_MODE = 'plural';
    expect(getSignalIntakeConfig()).toEqual({ maxQuestions: 4, mode: 'plural' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && NODE_ENV=test bun test src/lib/tests/fast-intake-feature.spec.ts`
Expected: FAIL — module has no exported member `getSignalIntakeMaxQuestions`.

- [ ] **Step 3: Implement the accessors**

Append to `services/api/src/lib/fast-intake-feature.ts`:

```ts
/** Per-turn delivery of intake follow-up questions. */
export type SignalIntakeQuestionMode = 'singular' | 'plural';

const DEFAULT_MAX_QUESTIONS = 2;
const MAX_QUESTIONS_FLOOR = 1;
const MAX_QUESTIONS_CEILING = 10;

/**
 * Total fast-intake question budget, including the cached round-1 question.
 * Defaults to 2 (the pre-configuration funnel: round 1 + one follow-up);
 * unparseable values fall back to the default rather than failing startup.
 *
 * @returns The configured budget clamped to [1, 10]
 */
export function getSignalIntakeMaxQuestions(): number {
  const raw = process.env.SIGNAL_INTAKE_MAX_QUESTIONS;
  if (!raw) return DEFAULT_MAX_QUESTIONS;
  const parsed = /^\d+$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : Number.NaN;
  if (Number.isNaN(parsed)) return DEFAULT_MAX_QUESTIONS;
  return Math.min(Math.max(parsed, MAX_QUESTIONS_FLOOR), MAX_QUESTIONS_CEILING);
}

/**
 * Per-turn delivery mode: `singular` serves one follow-up per /question turn;
 * `plural` serves the whole remaining batch in one turn. Default `singular`.
 *
 * @returns The configured mode, `singular` for any unrecognized value
 */
export function getSignalIntakeQuestionMode(): SignalIntakeQuestionMode {
  return process.env.SIGNAL_INTAKE_QUESTION_MODE === 'plural' ? 'plural' : 'singular';
}

/** @returns Both intake knobs, read once per call site. */
export function getSignalIntakeConfig(): { maxQuestions: number; mode: SignalIntakeQuestionMode } {
  return { maxQuestions: getSignalIntakeMaxQuestions(), mode: getSignalIntakeQuestionMode() };
}
```

Register in `services/api/src/startup.env.ts` right after `FAST_SIGNAL_INTAKE: optionalBoolean,` (deliberately plain optional strings — the accessors own parsing so a bad value can never fail startup validation):

```ts
  FAST_SIGNAL_INTAKE: optionalBoolean,
  SIGNAL_INTAKE_MAX_QUESTIONS: z.string().optional(),
  SIGNAL_INTAKE_QUESTION_MODE: z.string().optional(),
```

Document in `.env.example` immediately after the `FAST_SIGNAL_INTAKE` comment block:

```text
# SIGNAL_INTAKE_MAX_QUESTIONS=2              # Fast-intake total question budget INCLUDING the cached round 1
                                           # (integer 1-10, default 2 = round 1 + one follow-up, the pre-config
                                           # behavior). Unparseable values fall back to 2. Server-side only.
# SIGNAL_INTAKE_QUESTION_MODE=singular       # Per-turn delivery of follow-up questions: singular = one question
                                           # per /intents/intake/question turn (default, pre-config behavior);
                                           # plural = the whole planned batch (up to n-1) in one turn.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && NODE_ENV=test bun test src/lib/tests/fast-intake-feature.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/lib/fast-intake-feature.ts services/api/src/lib/tests/fast-intake-feature.spec.ts services/api/src/startup.env.ts .env.example
git commit -m "feat(api): signal-intake question budget and per-turn mode env knobs"
```

---

### Task 3: API — `computeAnswersHash` over the rounds list

**Files:**
- Modify: `services/api/src/adapters/signal-intake-run.database.adapter.ts:48-64`
- Test: `services/api/src/adapters/tests/signal-intake-run.hash.spec.ts`

**Interfaces:**
- Consumes: `IntakeRound` from `@indexnetwork/protocol` (Task 1).
- Produces (used by Task 4):
  ```ts
  export function computeAnswersHash(input: { rounds: IntakeRound[]; whereText?: string }): string
  ```

- [ ] **Step 1: Write the failing tests**

Rewrite `services/api/src/adapters/tests/signal-intake-run.hash.spec.ts`'s cases around the new shape (keep any boilerplate/imports, add `type IntakeRound`):

```ts
const round = (prompt: string, selectedOptions: string[], freeText?: string): IntakeRound => ({
  prompt,
  answer: { selectedOptions, ...(freeText !== undefined ? { freeText } : {}) },
});

describe('computeAnswersHash', () => {
  it('is stable across option ordering within a round', () => {
    const a = computeAnswersHash({ rounds: [round('p1', ['A', 'B']), round('p2', ['C'])] });
    const b = computeAnswersHash({ rounds: [round('p1', ['B', 'A']), round('p2', ['C'])] });
    expect(a).toBe(b);
  });

  it('changes when round order changes', () => {
    const a = computeAnswersHash({ rounds: [round('p1', ['A']), round('p2', ['B'])] });
    const b = computeAnswersHash({ rounds: [round('p2', ['B']), round('p1', ['A'])] });
    expect(a).not.toBe(b);
  });

  it('changes when a round is added', () => {
    const a = computeAnswersHash({ rounds: [round('p1', ['A']), round('p2', ['B'])] });
    const b = computeAnswersHash({ rounds: [round('p1', ['A']), round('p2', ['B']), round('p3', ['C'])] });
    expect(a).not.toBe(b);
  });

  it('folds in the where constraint', () => {
    const rounds = [round('p1', ['A']), round('p2', ['B'])];
    expect(computeAnswersHash({ rounds, whereText: 'Berlin' }))
      .not.toBe(computeAnswersHash({ rounds }));
  });
});
```

(Delete cases that only restate these with the old `whoAnswer`/`bringAnswer` shape.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && NODE_ENV=test bun test src/adapters/tests/signal-intake-run.hash.spec.ts`
Expected: FAIL — type error / wrong-shape arguments against the old signature.

- [ ] **Step 3: Implement**

In `services/api/src/adapters/signal-intake-run.database.adapter.ts`, replace the `computeAnswersHash` body and its docblock (import `type IntakeRound` alongside the existing protocol import):

```ts
/**
 * Stable hash of the full answered round list plus the optional where
 * constraint. Order matters across rounds (round 1 first); option order
 * within one round does not.
 *
 * @param input - Ordered answered rounds plus the optional where constraint
 * @returns A 16-char hex digest, stable across option ordering
 */
export function computeAnswersHash(input: {
  rounds: IntakeRound[];
  whereText?: string;
}): string {
  const part = (answer: IntakeAnswer) =>
    [...answer.selectedOptions].sort().join('|') + '::' + (answer.freeText?.trim() ?? '');
  const payload = [
    ...input.rounds.map((round) => part(round.answer)),
    input.whereText?.trim() ?? '',
  ].join('###');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && NODE_ENV=test bun test src/adapters/tests/signal-intake-run.hash.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/adapters/signal-intake-run.database.adapter.ts services/api/src/adapters/tests/signal-intake-run.hash.spec.ts
git commit -m "refactor(api): hash intake speculation runs over the full round list"
```

---

### Task 4: API — `SignalIntakeService` rounds flow + `followUpQuestions`

**Files:**
- Modify: `services/api/src/services/signal-intake.service.ts`
- Test: `services/api/src/services/tests/signal-intake.service.isolated.ts` (update in place)
- Test: `services/api/src/services/tests/signal-intake.writeback.isolated.ts` (shape updates only)
- Test: `services/api/src/services/tests/signal-intake.writeback-wiring.isolated.ts` (shape updates only)
- Test: `services/api/src/services/tests/signal-intake.confirm-seam.isolated.ts` (shape updates only)

**Interfaces:**
- Consumes: `generateFollowUps`/`synthesize` (Task 1), `getSignalIntakeConfig`, `SignalIntakeQuestionMode` (Task 2), `computeAnswersHash({ rounds })` (Task 3).
- Produces (used by Task 5):
  ```ts
  followUpQuestions(userId: string, input: { rounds: IntakeRound[]; plannedTotal?: number }):
    Promise<{ questions: IntakePackQuestion[]; total: number }>
  prepare(userId: string, input: { rounds: IntakeRound[] }): Promise<{ runId: string }>
  resolveProposal(userId: string, input: { runId: string; rounds: IntakeRound[]; whereText?: string; networkId?: string }): Promise<IntakeProposal>
  revise(userId: string, input: { runId: string; feedback: string; rounds: IntakeRound[]; networkId?: string }): Promise<IntakeProposal>
  ```
  `nextQuestion` is removed. New optional dep:
  ```ts
  intakeConfig?: () => { maxQuestions: number; mode: SignalIntakeQuestionMode };
  ```

- [ ] **Step 1: Write the failing tests**

In `signal-intake.service.isolated.ts`, update `makeDeps`: replace the `orchestrator` mock's `nextQuestion` with `generateFollowUps`, and change `synthesize` call expectations from `{ brief, whoAnswer, bringAnswer }` to `{ brief, rounds }`. Then replace the `nextQuestion` describe with:

```ts
describe('followUpQuestions', () => {
  const followUp = { title: 'Q2', prompt: 'What do you bring?', options: [{ label: 'X', description: 'x' }], multiSelect: false };

  it('singular: returns one question and locks the total from the plan', async () => {
    const service = new SignalIntakeService(makeDeps({
      intakeConfig: () => ({ maxQuestions: 4, mode: 'singular' as const }),
      orchestrator: {
        generateFollowUps: mock(async () => ({ questions: [followUp, { ...followUp, prompt: 'q3' }], plannedFollowUpCount: 2 })),
        synthesize: mock(async () => ({ description: 'd', lookingFor: 'l', youBring: 'y' })),
      },
    }));

    const result = await service.followUpQuestions('u1', {
      rounds: [{ prompt: 'Who?', answer: { selectedOptions: ['A design partner'] } }],
    });

    expect(result.questions).toHaveLength(1);
    expect(result.total).toBe(3);
  });

  it('plural: returns the whole batch and totals rounds + batch', async () => {
    const service = new SignalIntakeService(makeDeps({
      intakeConfig: () => ({ maxQuestions: 5, mode: 'plural' as const }),
      orchestrator: {
        generateFollowUps: mock(async () => ({ questions: [followUp, { ...followUp, prompt: 'q3' }, { ...followUp, prompt: 'q4' }], plannedFollowUpCount: 3 })),
        synthesize: mock(async () => ({ description: 'd', lookingFor: 'l', youBring: 'y' })),
      },
    }));

    const result = await service.followUpQuestions('u1', {
      rounds: [{ prompt: 'Who?', answer: { selectedOptions: ['A'] } }],
    });

    expect(result.questions).toHaveLength(3);
    expect(result.total).toBe(4);
  });

  it('caps the planning budget at maxQuestions - answered rounds', async () => {
    const generateFollowUps = mock(async () => ({ questions: [followUp], plannedFollowUpCount: 9 }));
    const service = new SignalIntakeService(makeDeps({
      intakeConfig: () => ({ maxQuestions: 3, mode: 'singular' as const }),
      orchestrator: { generateFollowUps, synthesize: mock(async () => ({ description: 'd', lookingFor: 'l', youBring: 'y' })) },
    }));

    const result = await service.followUpQuestions('u1', {
      rounds: [{ prompt: 'Who?', answer: { selectedOptions: ['A'] } }],
    });

    expect(generateFollowUps).toHaveBeenCalledWith(expect.objectContaining({ maxFollowUps: 2 }));
    expect(result.total).toBe(3); // plan of 9 follow-ups clamps to the configured budget
  });

  it('singular continuation: echoes a clamped client-carried plannedTotal', async () => {
    const service = new SignalIntakeService(makeDeps({
      intakeConfig: () => ({ maxQuestions: 4, mode: 'singular' as const }),
      orchestrator: {
        generateFollowUps: mock(async () => ({ questions: [followUp], plannedFollowUpCount: 1 })),
        synthesize: mock(async () => ({ description: 'd', lookingFor: 'l', youBring: 'y' })),
      },
    }));

    const result = await service.followUpQuestions('u1', {
      rounds: [
        { prompt: 'Who?', answer: { selectedOptions: ['A'] } },
        { prompt: 'Bring?', answer: { selectedOptions: ['B'] } },
      ],
      plannedTotal: 99,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.total).toBe(4);
  });

  it('returns an empty batch with total = answered rounds when the budget is spent', async () => {
    const service = new SignalIntakeService(makeDeps({
      intakeConfig: () => ({ maxQuestions: 1, mode: 'plural' as const }),
    }));

    const result = await service.followUpQuestions('u1', {
      rounds: [{ prompt: 'Who?', answer: { selectedOptions: ['A'] } }],
    });

    expect(result).toEqual({ questions: [], total: 1 });
  });
});
```

Add this exact test to the existing `prepare` describe:

```ts
  it('records every follow-up round with its client-sent prompt', async () => {
    const recordAnsweredQuestion = mock(async () => undefined);
    const service = new SignalIntakeService(makeDeps({ recordAnsweredQuestion }));

    await service.prepare('u1', {
      rounds: [
        { prompt: 'Who?', answer: { selectedOptions: ['A'] } },
        { prompt: 'Bring?', answer: { selectedOptions: ['B'] } },
        { prompt: 'When?', answer: { freeText: 'Now' } },
      ],
    });

    const stages = recordAnsweredQuestion.mock.calls.map((call) => (call[0] as { stage: string }).stage);
    expect(stages).toEqual(['followup-2', 'followup-3']);
    const prompts = recordAnsweredQuestion.mock.calls.map((call) => (call[0] as { prompt: string }).prompt);
    expect(prompts).toEqual(['Bring?', 'When?']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/api && NODE_ENV=test bun test src/services/tests/signal-intake.service.isolated.ts`
Expected: FAIL — `service.followUpQuestions is not a function`.

- [ ] **Step 3: Implement the service changes**

In `services/api/src/services/signal-intake.service.ts`:

1. Imports: add `type IntakeRound` to the protocol import; add
   `import { getSignalIntakeConfig, type SignalIntakeQuestionMode } from '../lib/fast-intake-feature';`
2. Deps interface: change `orchestrator: Pick<SignalIntakeOrchestrator, 'nextQuestion' | 'synthesize'>;` to
   `orchestrator: Pick<SignalIntakeOrchestrator, 'generateFollowUps' | 'synthesize'>;` and add
   ```ts
   /** Intake knobs; production reads the env accessors, tests inject fixed values. */
   intakeConfig?: () => { maxQuestions: number; mode: SignalIntakeQuestionMode };
   ```
   Widen `recordAnsweredQuestion`'s `stage: 'who' | 'bring'` to `stage: string` (both in the deps interface and the private `record` helper signature).
3. Replace `nextQuestion` with:

```ts
  /**
   * Plan and serve the next follow-up question batch.
   *
   * The total interview length is fixed by the first call's plan (or the
   * budget when the plan is smaller) and locked: continuation calls echo the
   * client-carried `plannedTotal`, clamped to the configured budget. Singular
   * mode serves one question per call; plural mode serves the remaining
   * batch in one call.
   *
   * @param userId - Owner
   * @param input - Answered rounds (round 1 first) and the locked total when continuing
   * @returns The next question batch (empty when the budget is spent) and the locked total
   */
  async followUpQuestions(
    userId: string,
    input: { rounds: IntakeRound[]; plannedTotal?: number },
  ): Promise<{ questions: IntakePackQuestion[]; total: number }> {
    const started = Date.now();
    const { maxQuestions, mode } = this.deps.intakeConfig?.() ?? getSignalIntakeConfig();
    const { brief, question: round1 } = await this.getOrCreatePack(userId);
    if (input.rounds.length === 1) {
      // Round 1's answer is recorded against the pack's authoritative question
      // payload, never the client-echoed prompt.
      this.record({
        userId,
        prompt: round1.prompt,
        answer: input.rounds[0].answer,
        stage: 'who',
        question: { title: round1.title, options: round1.options, multiSelect: round1.multiSelect },
      });
    }

    const remaining = Math.max(0, maxQuestions - input.rounds.length);
    if (remaining === 0) {
      logger.info('signal_intake_stage', {
        stage: 'question', durationMs: Date.now() - started,
        packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
      });
      return { questions: [], total: input.rounds.length };
    }

    const lockedTotal = input.plannedTotal !== undefined
      ? Math.min(Math.max(Math.trunc(input.plannedTotal), 1), maxQuestions)
      : undefined;
    const budget = mode === 'plural' || lockedTotal === undefined ? remaining : 1;
    const plan = await this.deps.orchestrator.generateFollowUps({
      brief,
      rounds: input.rounds,
      maxFollowUps: budget,
      ...(lockedTotal !== undefined
        ? { plannedFollowUpCount: Math.max(0, lockedTotal - input.rounds.length) }
        : {}),
    });

    const questions = mode === 'plural' ? plan.questions : plan.questions.slice(0, 1);
    const total = lockedTotal ?? (mode === 'plural'
      ? input.rounds.length + plan.questions.length
      : input.rounds.length + Math.min(Math.max(plan.plannedFollowUpCount, questions.length), remaining));

    logger.info('signal_intake_stage', {
      stage: 'question', durationMs: Date.now() - started,
      packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
    });
    return { questions, total };
  }
```

4. `prepare`: signature to `prepare(userId: string, input: { rounds: IntakeRound[] })`. Replace the single `this.record({ ... round2Prompt ... stage: 'bring' })` with:

```ts
    // Follow-up rounds arrive with their real prompts from the client; round 1
    // was already recorded by followUpQuestions against the pack payload.
    input.rounds.slice(1).forEach((round, index) => {
      this.record({ userId, prompt: round.prompt, answer: round.answer, stage: `followup-${index + 2}` });
    });
```

   Hash: `const answersHash = computeAnswersHash({ rounds: input.rounds });`
   Speculation kick: `void this.runSynthesis(userId, run.id, { rounds: input.rounds }).catch(() => undefined);`
5. `resolveProposal` / `revise`: replace `answers: { whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer }` with `rounds: IntakeRound[]` throughout, passing `{ rounds: input.rounds, ...where/feedback }` into `runSynthesis`.
6. `runSynthesis`: parameter type to `{ rounds: IntakeRound[]; whereText?: string; feedback?: string }`; synthesis call becomes `this.deps.orchestrator.synthesize({ brief, ...answers })` (unchanged shape-wise since `SynthesisInput` now matches).
7. `recordAnsweredQuestionProduction`: `stage: string`; strategy ternary stays `input.stage === 'who' ? 'refine_intent' : 'surface_missing_detail'`; title fallback ternary becomes `input.stage === 'who' ? 'Who' : 'Follow-up'`; update its docblock (drop the "round-2 question genuinely not available" paragraph — prompts now travel with every round).
8. Production singleton: add `intakeConfig: getSignalIntakeConfig,` to the `new SignalIntakeService({...})` deps.
9. Fix the remaining four isolated suites mechanically: any `nextQuestion` mock → `generateFollowUps`; any `whoAnswer`/`bringAnswer` argument → `rounds: [{ prompt, answer }, ...]`; any synthesize expectation → `{ brief, rounds }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && NODE_ENV=test bun test src/services/tests/signal-intake.service.isolated.ts src/services/tests/signal-intake.writeback.isolated.ts src/services/tests/signal-intake.writeback-wiring.isolated.ts src/services/tests/signal-intake.confirm-seam.isolated.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/signal-intake.service.ts services/api/src/services/tests/
git commit -m "feat(api): rounds-based intake service with locked-plan follow-up delivery"
```

---

### Task 5: API — controller `rounds` schemas + batch question response

**Files:**
- Modify: `services/api/src/controllers/intent-intake.controller.ts`
- Test: `services/api/src/controllers/tests/intent-intake.controller.isolated.ts`

**Interfaces:**
- Consumes: service methods from Task 4.
- Produces (consumed by Task 6 — exact wire shapes):
  ```text
  POST /intents/intake/question { rounds: Round[], plannedTotal?: number }
    -> 200 { questions: IntakePackQuestion[], total: number }
  POST /intents/intake/prepare  { rounds: Round[] } -> 202 { runId }
  POST /intents/intake/proposal { runId, rounds: Round[], networkId?, whereText? } -> 200 IntakeProposal | 422 clarification
  POST /intents/intake/revise   { runId, feedback, rounds: Round[], networkId? } -> 200 IntakeProposal | 422 clarification
  Round = { prompt: string (1..400 chars, trimmed), answer: { selectedOptions: string[], freeText?: string } }
  ```

- [ ] **Step 1: Update the failing tests**

In `intent-intake.controller.isolated.ts`, update `makeService` (rename `nextQuestion` to `followUpQuestions: mock(async () => ({ questions: [question], total: 2 }))`) and replace the module-level `answers` fixture with:

```ts
const rounds = [
  { prompt: 'Who do you want to meet?', answer: { selectedOptions: ['A design partner'] } },
  { prompt: 'What do you bring?', answer: { selectedOptions: ['Engineering depth'] } },
];
```

Update request bodies everywhere: `/question` posts `{ rounds: [rounds[0]] }`, `/prepare` posts `{ rounds }`, `/proposal` and `/revise` post `{ runId: '...', rounds, ... }`. Assert the `/question` 200 body is exactly `{ questions: [question], total: 2 }`. Then add:

```ts
  it('passes a client-carried plannedTotal through to the service', async () => {
    const followUpQuestions = mock(async () => ({ questions: [question], total: 3 }));
    const controller = new IntentIntakeController({ service: makeService({ followUpQuestions }) as never });

    const response = await controller.question(request({ rounds, plannedTotal: 3 }), user);

    expect(response.status).toBe(200);
    expect(followUpQuestions).toHaveBeenCalledWith('u1', { rounds, plannedTotal: 3 });
  });

  it('rejects an empty rounds list', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });
    const response = await controller.question(request({ rounds: [] }), user);
    expect(response.status).toBe(400);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/api && NODE_ENV=test bun test src/controllers/tests/intent-intake.controller.isolated.ts`
Expected: FAIL — 400s against the old schemas / stub mismatches.

- [ ] **Step 3: Implement the controller changes**

In `intent-intake.controller.ts` replace the schemas:

```ts
const RoundSchema = z.object({
  prompt: z.string().trim().min(1).max(400),
  answer: AnswerSchema,
}).strict();
const RoundsSchema = z.array(RoundSchema).min(1).max(10);
const QuestionSchema = z.object({
  rounds: RoundsSchema,
  plannedTotal: z.number().int().min(1).max(10).optional(),
}).strict();
const PrepareSchema = z.object({ rounds: RoundsSchema }).strict();
const ProposalSchema = z.object({
  runId: z.string().uuid('runId must be a UUID'),
  rounds: RoundsSchema,
  networkId: z.string().uuid('networkId must be a UUID').optional(),
  whereText: z.string().trim().max(280).optional(),
}).strict();
const ReviseSchema = z.object({
  runId: z.string().uuid('runId must be a UUID'),
  feedback: z.string().trim().min(1).max(600),
  rounds: RoundsSchema,
  networkId: z.string().uuid('networkId must be a UUID').optional(),
}).strict();
```

Update the service `Pick` to `'getOrCreatePack' | 'followUpQuestions' | 'prepare' | 'resolveProposal' | 'revise'`, the `/question` handler to:

```ts
    const { questions, total } = await this.service.followUpQuestions(user.id, parsed.data);
    return Response.json({ questions, total });
```

and the `/prepare`, `/proposal`, `/revise` handlers to destructure/pass `rounds` instead of `whoAnswer`/`bringAnswer` (e.g. `answers: { whoAnswer, bringAnswer }` → `rounds`). Update handler docblocks (`/** Round 2: ... */` → `/** Follow-ups: planned batch or single question, with the locked total. */`).

- [ ] **Step 4: Run tests to verify they pass, then the full isolated suite**

Run: `cd services/api && NODE_ENV=test bun test src/controllers/tests/intent-intake.controller.isolated.ts`
Expected: PASS.
Run: `cd services/api && bun run test:isolated`
Expected: PASS (catches any consumer missed in Tasks 3–5; the manifest `.test-isolated` needs no new entries — all touched suites are already registered).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/controllers/intent-intake.controller.ts services/api/src/controllers/tests/intent-intake.controller.isolated.ts
git commit -m "feat(api): rounds-based intake endpoints with batched question responses"
```

---

### Task 6: Web — intake client + queue-stepping `FastSignalIntake`

**Files:**
- Modify: `apps/web/src/services/intake.ts`
- Modify: `apps/web/src/components/signals/FastSignalIntake.tsx`
- Test: `apps/web/tests/fast-signal-intake.test.tsx`

**Interfaces:**
- Consumes: Task 5 wire shapes.
- Produces:
  ```ts
  // services/intake.ts
  export interface IntakeRound { prompt: string; answer: IntakeAnswerBody }
  export interface IntakeFollowUpResponse { questions: QuestionPayload[]; total: number }
  intakeService.question(rounds: IntakeRound[], plannedTotal?: number): Promise<IntakeFollowUpResponse>
  intakeService.prepare(input: { rounds: IntakeRound[] }): Promise<{ runId: string }>
  intakeService.proposal(input: { runId: string; rounds: IntakeRound[]; networkId?: string; whereText?: string }): Promise<IntakeProposalResponse>
  intakeService.revise(input: { runId: string; rounds: IntakeRound[]; feedback: string; networkId?: string }): Promise<IntakeProposalResponse>
  ```

- [ ] **Step 1: Write the failing tests**

In `apps/web/tests/fast-signal-intake.test.tsx`, update the mock shapes: `mocks.start` resolves `{ question: question("Who do you want to meet?") }`; `mocks.question` resolves follow-up batches; `mocks.prepare` resolves `{ runId: "run-1" }`; `mocks.proposal` resolves the proposal fixture. Add the helper:

```ts
const followUpResponse = (prompts: string[], total: number) => ({
  questions: prompts.map((prompt) => question(prompt)),
  total,
});
```

Update every existing flow test to the rounds wire shape (e.g. `expect(mocks.prepare).toHaveBeenCalledWith({ rounds: [ { prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } }, ... ] })`). Then add:

```ts
test("singular mode: fetches the next question per turn and locks the total", async () => {
  mocks.start.mockResolvedValue({ question: question("Who do you want to meet?") });
  mocks.question
    .mockResolvedValueOnce(followUpResponse(["What would you bring?"], 3))
    .mockResolvedValueOnce(followUpResponse(["When do you need this?"], 3));
  mocks.prepare.mockResolvedValue({ runId: "run-1" });

  render(<MemoryRouter><FastSignalIntake onConfirmed={vi.fn()} /></MemoryRouter>);
  fireEvent.click(await screen.findByText("A design partner"));
  fireEvent.click(screen.getByText("Continue"));

  expect(await screen.findByText("What would you bring?")).toBeTruthy();
  fireEvent.click(screen.getByText("A design partner")); // option label shared by the fixture
  fireEvent.click(screen.getByText("Continue"));

  expect(await screen.findByText("When do you need this?")).toBeTruthy();
  expect(mocks.question).toHaveBeenCalledTimes(2);
  expect(mocks.question).toHaveBeenLastCalledWith(
    [
      { prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } },
      { prompt: "What would you bring?", answer: { selectedOptions: ["A design partner"] } },
    ],
    3,
  );
});

test("plural mode: steps through the batch client-side without extra calls", async () => {
  mocks.start.mockResolvedValue({ question: question("Who do you want to meet?") });
  mocks.question.mockResolvedValueOnce(followUpResponse(["What would you bring?", "When do you need this?"], 3));
  mocks.prepare.mockResolvedValue({ runId: "run-1" });

  render(<MemoryRouter><FastSignalIntake onConfirmed={vi.fn()} /></MemoryRouter>);
  fireEvent.click(await screen.findByText("A design partner"));
  fireEvent.click(screen.getByText("Continue"));

  expect(await screen.findByText("What would you bring?")).toBeTruthy();
  fireEvent.click(screen.getByText("A design partner"));
  fireEvent.click(screen.getByText("Continue"));

  expect(await screen.findByText("When do you need this?")).toBeTruthy();
  expect(mocks.question).toHaveBeenCalledTimes(1); // no refetch while the queue holds questions

  fireEvent.click(screen.getByText("A design partner"));
  fireEvent.click(screen.getByText("Continue"));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1));
});

test("sizes the progress bar to total + 2 once the plan is detected", async () => {
  mocks.start.mockResolvedValue({ question: question("Who do you want to meet?") });
  mocks.question.mockResolvedValueOnce(followUpResponse(["What would you bring?", "When do you need this?", "Budget?"], 4));

  const { container } = render(<MemoryRouter><FastSignalIntake onConfirmed={vi.fn()} /></MemoryRouter>);
  fireEvent.click(await screen.findByText("A design partner"));
  fireEvent.click(screen.getByText("Continue"));

  await screen.findByText("What would you bring?");
  expect(container.querySelectorAll('[aria-label="Signal progress"] > span')).toHaveLength(6); // 4 questions + where + confirm
});

test("advances straight to the where picker when the plan returns no follow-ups", async () => {
  mocks.start.mockResolvedValue({ question: question("Who do you want to meet?") });
  mocks.question.mockResolvedValueOnce({ questions: [], total: 1 });
  mocks.prepare.mockResolvedValue({ runId: "run-1" });

  render(<MemoryRouter><FastSignalIntake onConfirmed={vi.fn()} /></MemoryRouter>);
  fireEvent.click(await screen.findByText("A design partner"));
  fireEvent.click(screen.getByText("Continue"));

  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Everywhere")).toBeTruthy(); // WherePicker rendered
});
```

(If the fixture option labels collide between questions, give each mocked question distinct option labels via a parameterized `question()` helper.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && bun --bun vitest run tests/fast-signal-intake.test.tsx`
Expected: FAIL — new-batch mock shapes break the old two-round component.

- [ ] **Step 3: Rewrite the intake client**

`apps/web/src/services/intake.ts` — replace `IntakeAnswers`, `question`, `prepare`, `proposal`, `revise` (keep `IntakeAnswerBody`, `IntakeProposalResponse`, `IntakeVerificationRejection`, `unwrapVerificationRejection`, `start`):

```ts
/** One answered intake round, in order (round 1 first). */
export interface IntakeRound {
  prompt: string;
  answer: IntakeAnswerBody;
}

/** Follow-up batch plus the locked total interview length (round 1 included). */
export interface IntakeFollowUpResponse {
  questions: QuestionPayload[];
  total: number;
}

export const intakeService = {
  /** Round 1 from the precomputed pack. */
  start: () => apiClient.post<IntakeQuestionResponse>("/intents/intake/start", {}),

  /**
   * Next follow-up batch. `plannedTotal` echoes the locked total on
   * continuation calls; both answers and prompts travel with every call —
   * the server holds no funnel state.
   */
  question: (rounds: IntakeRound[], plannedTotal?: number) =>
    apiClient.post<IntakeFollowUpResponse>("/intents/intake/question", {
      rounds,
      ...(plannedTotal !== undefined ? { plannedTotal } : {}),
    }),

  /** Kick off speculative synthesis; returns immediately. */
  prepare: (input: { rounds: IntakeRound[] }) =>
    apiClient.post<{ runId: string }>("/intents/intake/prepare", input),

  /** Resolve the proposal once the user has chosen where to look. */
  proposal: (input: { runId: string; rounds: IntakeRound[]; networkId?: string; whereText?: string }) =>
    apiClient.post<IntakeProposalResponse>("/intents/intake/proposal", input)
      .catch(unwrapVerificationRejection),

  /**
   * Replace the visible draft from feedback.
   *
   * `networkId` travels with the revision because the replacement is a new
   * proposal row: `/intents/confirm` compares the posted network against the
   * stored one, so a revision that dropped it would 409 at confirm.
   */
  revise: (input: { runId: string; rounds: IntakeRound[]; feedback: string; networkId?: string }) =>
    apiClient.post<IntakeProposalResponse>("/intents/intake/revise", input)
      .catch(unwrapVerificationRejection),
};
```

- [ ] **Step 4: Rewrite `FastSignalIntake.tsx` state machine**

Replace the `Stage` union, the positional answer state, and the handlers:

```ts
type Stage = "who" | "followup" | "where" | "clarify" | "proposal";

// state (replacing whoAnswer/bringAnswer/bringQuestion):
const [rounds, setRounds] = useState<IntakeRound[]>([]);
const [currentQuestion, setCurrentQuestion] = useState<QuestionPayload | null>(null);
const [queue, setQueue] = useState<QuestionPayload[]>([]);
const [total, setTotal] = useState<number | null>(null);
```

New handlers (keep `resolve`, clarify, confirm, revise, skip, startOver shells; their bodies now use `rounds`):

```ts
// Fires speculation and advances to the community picker once the question
// budget is spent. Shared by the who-answer and follow-up-answer paths.
const startPrepare = useCallback((allRounds: IntakeRound[]) => {
  setStage("where");
  const prepared = intakeService.prepare({ rounds: allRounds });
  prepareRef.current = prepared;
  prepared
    .then(({ runId: preparedRunId }) => setRunId(preparedRunId))
    .catch(() => setError("Couldn't prepare your signal. Please try again."));
}, []);

// Consumes the queued batch; refetches only when the queue is empty and the
// locked total says more rounds remain.
const advance = useCallback(async (nextRounds: IntakeRound[], queueAfter: QuestionPayload[], knownTotal: number | null) => {
  if (queueAfter.length > 0) {
    setCurrentQuestion(queueAfter[0]);
    setQueue(queueAfter.slice(1));
    return;
  }
  if (knownTotal !== null && nextRounds.length >= knownTotal) {
    startPrepare(nextRounds);
    return;
  }
  try {
    const { questions, total: planTotal } = await intakeService.question(
      nextRounds,
      knownTotal ?? undefined,
    );
    setTotal(planTotal);
    if (questions.length === 0 || nextRounds.length >= planTotal) {
      startPrepare(nextRounds);
      return;
    }
    setCurrentQuestion(questions[0]);
    setQueue(questions.slice(1));
    setStage("followup");
  } catch {
    setError("Couldn't load the next question. Please try again.");
  }
}, [startPrepare]);

const handleWhoAnswer = useCallback(async (answer: IntakeAnswerBody) => {
  if (!whoQuestion) return;
  setError(null);
  const nextRounds = [{ prompt: whoQuestion.prompt, answer }];
  setRounds(nextRounds);
  setAnsweredSteps([{ prompt: whoQuestion.prompt, answer }]);
  await advance(nextRounds, [], null);
}, [whoQuestion, advance]);

const handleFollowupAnswer = useCallback(async (answer: IntakeAnswerBody) => {
  if (!currentQuestion) return;
  setError(null);
  const nextRounds = [...rounds, { prompt: currentQuestion.prompt, answer }];
  setRounds(nextRounds);
  setAnsweredSteps((current) => [...current, { prompt: currentQuestion.prompt, answer }]);
  await advance(nextRounds, queue, total);
}, [currentQuestion, rounds, queue, total, advance]);
```

Mechanical ripple updates:
- `resolve(choice, ...)`: `intakeService.proposal({ runId: effectiveRunId, rounds, ...choice })`; the `bringOverride` parameter becomes a `roundsOverride: IntakeRound[]` used by the clarification path.
- Clarification: merge into the **last** round:
  ```ts
  const mergedRounds = rounds.map((round, index) => index === rounds.length - 1
    ? { ...round, answer: {
        selectedOptions: round.answer.selectedOptions,
        ...((round.answer.freeText || clarificationText)
          ? { freeText: [round.answer.freeText, clarificationText].filter(Boolean).join(" — ") }
          : {}),
      } }
    : round);
  setRounds(mergedRounds);
  setClarification(null);
  await resolve(pendingChoice ?? {}, mergedRounds);
  ```
- `handleFeedback`: `intakeService.revise({ runId, rounds, feedback, ...(selectedNetworkId ? { networkId: selectedNetworkId } : {}) })`.
- Card fallbacks: `lookingFor = proposal?.lookingFor?.trim() ? undefined : (rounds[0] ? answerLabel(rounds[0].answer) : undefined)`; `youBring = ... rounds[1] ...`.
- Progress bar: `const progressSteps = total === null ? Math.max(4, answeredSteps.length + (stage === "proposal" ? 0 : 1)) : Math.max(total + 2, answeredSteps.length + (stage === "proposal" ? 0 : 1));` (the `Math.max` guard covers clarification steps, which do not count toward `total`).
- Render branch: `stage === "followup" && currentQuestion` renders `<GuidedQuestion question={toPendingQuestion(`followup-${rounds.length}`, currentQuestion)} onAnswer={handleFollowupAnswer} disabled={busy} />`; the old `"bring"` branch is deleted.
- `startOver`: also reset `rounds`, `currentQuestion`, `queue`, `total`.
- Update the component docblock: "Deterministic intake: a precomputed round 1, a locked plan of up to n-1 generated follow-ups (served one per turn or as one batch), a client-side community picker, and a proposal that synthesis has usually already prepared speculatively in the background."

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && bun --bun vitest run tests/fast-signal-intake.test.tsx`
Expected: PASS. Then the related suites:
Run: `cd apps/web && bun --bun vitest run tests/guided-signal-flow.test.tsx`
Expected: PASS (legacy flow untouched — if it mocks `@/services/intake`, update only the mock shapes).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/services/intake.ts apps/web/src/components/signals/FastSignalIntake.tsx apps/web/tests/fast-signal-intake.test.tsx
git commit -m "feat(web): queue-stepping intake client with locked-plan progress"
```

---

### Task 7: Final targeted validation

**Files:** none (verification only).

- [ ] **Step 1: Protocol suite + build**

Run: `cd packages/protocol && bun test src/signals/application/tests/ && bun run build`
Expected: PASS, clean build.

- [ ] **Step 2: API isolated suite + typecheck**

Run: `cd services/api && bun run test:isolated && bun run build`
Expected: PASS; `tsc` clean (this also rebuilds protocol).

- [ ] **Step 3: Web tests + lint + build**

Run: `cd apps/web && bun --bun vitest run tests/fast-signal-intake.test.tsx tests/guided-signal-flow.test.tsx && bun run lint && bun run build`
Expected: PASS, no new eslint errors, clean Vite build.

- [ ] **Step 4: API lint**

Run: `cd services/api && bun run lint`
Expected: no new errors.

- [ ] **Step 5: Manual sanity (optional, local dev)**

With dev servers running and `FAST_SIGNAL_INTAKE=true`: `/i/new` behaves exactly as before (defaults n=2, singular). Then set `SIGNAL_INTAKE_MAX_QUESTIONS=4` + `SIGNAL_INTAKE_QUESTION_MODE=plural` in `.env.development`, restart the API, and confirm one `/question` call returns the full batch and the UI steps through without refetching.

- [ ] **Step 6: Push**

```bash
git push -u origin feat/configurable-intake-questions
```
