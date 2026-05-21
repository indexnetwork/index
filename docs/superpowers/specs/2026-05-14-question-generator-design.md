# Slice 2 — Question schema + generator

**Status:** approved (brainstorm) — ready for plan
**Date:** 2026-05-14
**Parent:** [Discovery decision questions — master design](./2026-05-14-discovery-decision-questions-design.md)
**Depends on:** Slice 1 (`ChatContextDigest` type)
**Blocks:** Slice 3 (Discovery integration)

## Scope

Pure protocol-layer generator that turns a structured input — discovery query, profile, per-negotiation transcripts + outcomes, summary counters, optional chat digest, current time — into 0–3 decision questions. No DB access, no events, no callers wired yet.

Delivers:

1. Shared `Question` schema + `QuestionStrategy` enum.
2. `DiscoveryQuestionInput` type definition.
3. `QuestionGenerator` class with system prompt, structured output, guardrails.
4. New `discoveryQuestionGenerator` model slot.
5. Unit tests covering schema validation, guardrails, and generator behavior (LLM mocked).

Slice 3 consumes this generator; Slice 4 renders its output; Slice 5 dispatches it via MCP. None are in this slice.

## Shared schema

New file `packages/protocol/src/shared/schemas/question.schema.ts`:

```ts
import { z } from "zod";

export const QuestionOptionSchema = z.object({
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(280),
});

export const QuestionSchema = z.object({
  title: z.string().min(1).max(12),
  prompt: z.string().min(1).max(400),
  options: z.array(QuestionOptionSchema).min(2).max(4),
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

export type Question = z.infer<typeof QuestionSchema>;
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type QuestionStrategy = z.infer<typeof QuestionStrategySchema>;
export type QuestionWithStrategy = z.infer<typeof QuestionWithStrategySchema>;

export interface QuestionGenerationResult {
  questions: Question[];
  strategies: QuestionStrategy[];   // parallel to questions; debug-only
}
```

Exported from `packages/protocol/src/index.ts`.

## Generator

New file `packages/protocol/src/opportunity/question.generator.ts`:

```ts
export class QuestionGenerator {
  private model: ReturnType<ChatOpenAI["withStructuredOutput"]>;

  constructor() {
    const llm = createModel("discoveryQuestionGenerator");
    this.model = llm.withStructuredOutput(QuestionGeneratorResponseSchema, {
      name: "clarifying_questions",
    });
  }

  @Timed()
  async generate(input: DiscoveryQuestionInput): Promise<QuestionGenerationResult | null> {
    // 1. Build user prompt from input
    // 2. Call model with system prompt
    // 3. Zod parse → on failure return null
    // 4. Apply guardrails (drop invalid, dedup by title, soft strategy diversity)
    // 5. If empty, return null
    // 6. Split into public Question[] + parallel QuestionStrategy[]
  }
}
```

New `model.config.ts` slot: `discoveryQuestionGenerator` (medium-tier model).

### System prompt structure

(Full text written in code; outlined here.)

1. **Role.** "You sit between a human and a discovery protocol that just ran negotiations on their behalf. Surface the minimum set of decision questions the human must answer to make the next discovery turn sharper."
2. **Strategy palette.** Five named strategies (see master spec). The model picks one per question; mixing is allowed.
3. **When to ask.** Adapted gist gate: (a) agent cannot resolve autonomously from negotiation evidence, (b) answer materially changes what surfaces next, (c) not already in `chatContext.statedFacts`/`openQuestions`/`surfacedFindings`.
4. **Cardinality rule.** Default one question. Second only when a different strategy genuinely complements. Third only when ≥3 candidates with substantive transcripts and three distinct strategies each unblock. Avoid stacking three pulls; balance with pushes.
5. **Ordering.** Most-unblocking first; then highest-impact; then ambiguity-clarifying. Timed-out negotiations (`outcome.reason === "turn_cap" | "timeout"`) signal under-specification — prioritize.
6. **Option construction.** Each option = a meaningfully different outcome. Safest path suffixed `(Recommended)`, listed first. `description` states the **consequence** of choosing this option (not its definition). 2–4 options; no explicit "Other." For `surface_emergent_knowledge` questions, anchor `prompt` in the cited fact ("Multiple candidates flagged…"); options represent decisions in light of that fact.
7. **Title rules.** ≤12 chars; noun of decision domain. Discovery examples: "Stage", "Timing", "Role", "Location", "Stack", "Budget", "Scope".
8. **Anti-patterns.** No procedural confirmations, no hypotheticals, no questions about candidate identity, no repeats of `openQuestions`, no re-surfacing of `surfacedFindings`, no asks for `statedFacts`.
9. **Output quality checklist.** Applied before final output (from gist).

### User prompt assembled by `buildQuestionPrompt(input)`

```
## Seeker's query
${input.query}

## Seeker profile
${profileSummary}

## This discovery turn
- ${summary.totalCandidates} candidates evaluated
- ${summary.opportunitiesFound} opportunities found
- ${summary.noOpportunityCount} ended without opportunity (${summary.timeoutCount} hit turn-cap/timeout)
- Role distribution across outcomes: ${roleDistribution}

## Negotiation evidence
${perNegotiationBlocks}

## What the user has already said in this session
${chatContext ? renderDigest(chatContext) : "(no chat context available)"}

## Now
${input.now}

## Your task
Identify the minimum set of decision questions the seeker must answer to make
the next discovery turn sharper. Apply every rule from your system prompt
before outputting. Return an empty `questions` array if nothing is worth asking.
```

`perNegotiationBlocks` truncation: max 8 negotiations × last 6 turns × ≤200 char reasoning. If more candidates exist, keep the 4 with most turns plus the 4 with highest seed-assessment scores. Drop the rest.

## Guardrails

Applied in `QuestionGenerator.generate` after the LLM call:

1. **Zod parse.** Failure → return `null` (logged).
2. **Per-question validation.** Drop any question with `title.length > 12` or `options.length < 2 || > 4` or `options[*].label.length > 120` etc. (defensive — Zod should already block, but double-guard against model coercion).
3. **Dedup by `title`.** Keep first occurrence.
4. **Soft strategy diversity.** If two of three questions share a strategy and a third candidate with a distinct strategy was filtered, prefer the distinct one. Allow 2 of the same strategy max; never 3.
5. **Final check.** If 0 questions remain → return `null`.

Split into public `Question[]` and parallel `QuestionStrategy[]` before returning.

## Tests

### Unit (LLM mocked)

`packages/protocol/src/shared/schemas/tests/question.schema.spec.ts`:

- Accepts well-formed payloads (2 and 4 options, single/multi-select).
- Rejects `title > 12`, `options.length < 2`, `options.length > 4`, missing `prompt`, prompt > 400 chars.
- `QuestionWithStrategySchema` accepts all five strategy values, rejects unknown.

`packages/protocol/src/opportunity/tests/question.generator.spec.ts`:

- LLM throws → `null`.
- LLM returns malformed output → Zod parse fails → `null`.
- Guardrails drop invalid questions; if all dropped → `null`.
- Dedup by `title` keeps the first.
- Strategy diversity: 2-of-3 same-strategy + 1 distinct candidate → distinct kept, duplicate dropped.
- Result `strategies` array is parallel (same length, same order) to `questions`.
- Public output never contains `strategy` field.
- `null` returned when `LLM` outputs `questions: []`.

Tests use a hand-built `DiscoveryQuestionInput` fixture; no real opportunity-graph dependency.

## Acceptance criteria

- [ ] Schema and generator exported from `packages/protocol/src/index.ts`.
- [ ] All unit tests pass.
- [ ] `bun run lint` clean.
- [ ] `tsc --noEmit` clean.
- [ ] System prompt + user-prompt builder code-reviewable in isolation; no implicit dependencies on Slice-3-only types.

## Risks / open questions

- **Prompt drift.** Five strategies + brainstorming-style format + gist-derived quality rules is a dense prompt. Easy to bloat. Mitigation: keep system prompt under ~2000 chars, move examples into the user-prompt builder when needed.
- **Model choice.** `discoveryQuestionGenerator` slot defaults to a medium-tier model; if real-world quality is lacking, bump the slot via env without code change.
- **Strategy enum churn.** Adding a sixth strategy later requires updating the Zod enum + prompt + tests. The enum is exported, so external consumers (frontend) seeing it would need a versioning consideration — for now it's debug-only and stripped from public output, so no external surface depends on the values.
