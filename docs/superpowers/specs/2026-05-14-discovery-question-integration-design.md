# Slice 3 — Discovery integration

**Status:** approved (brainstorm) — ready for plan
**Date:** 2026-05-14
**Parent:** [Discovery decision questions — master design](./2026-05-14-discovery-decision-questions-design.md)
**Depends on:** Slice 1, Slice 2
**Blocks:** Slice 4, Slice 5

## Scope

Wires `ChatSummaryReader` (Slice 1) and `QuestionGenerator` (Slice 2) into `opportunity.discover.ts` and the chat streaming path, behind a single feature flag and a trigger gate. Extends the tool-result shape with the optional `questions` field. Adds trace events and `debugMeta`.

This slice does **not** render the questions on the frontend (Slice 4) or dispatch them via MCP elicitation (Slice 5). It produces and emits the payload.

## Configuration

Two env vars (master spec defaults restated):

| Env var | Type | Default |
|---|---|---|
| `ENABLE_DISCOVERY_QUESTIONS` | boolean | `false` |
| `DISCOVERY_QUESTIONS_INPUT_MODE` | `transcripts` \| `insights` | `transcripts` |

Day-one supports only `transcripts`. Code reads the env in `opportunity.discover.ts` (or via a config helper colocated there) — not in the generator or summarizer.

## Trigger gate

Single gate at the top of the questions branch in `opportunity.discover.ts`:

```ts
const questionsEnabled =
  process.env.ENABLE_DISCOVERY_QUESTIONS === "true" &&
  input.trigger === "orchestrator";
```

Background flows (`trigger: "ambient"`) skip generation entirely — no summarizer call, no generator call. The chat orchestrator and MCP `discover_opportunities` both already pass `trigger: "orchestrator"` per existing code.

## `opportunity.discover.ts` changes

### 1. Inject dependencies

`DiscoverInput` (existing) gains the dep through the surrounding composition. The `OpportunityGraphFactory` does not need changes; the new dep is consumed at the discover-orchestration level. Concretely:

- A new optional `chatSummary?: ChatSummaryReader` is passed via `DiscoverInput` (or via a wider `ProtocolDeps` slot already injected — pick whichever is least disruptive given the current composition root).
- A new optional `questionGenerator?: QuestionGenerator` is passed the same way.

When either is missing or `questionsEnabled === false`, the questions branch is skipped silently.

### 2. Branch after graph returns

```ts
const graphResult = await runOpportunityGraph(...);

let questions: Question[] | undefined;
let questionsDebug: DiscoveryQuestionsDebugMeta | null = null;

if (questionsEnabled && questionGenerator) {
  const [chatContext, _] = await Promise.all([
    input.chatSessionId
      ? chatSummary?.getDigest(input.chatSessionId).catch(() => null) ?? Promise.resolve(null)
      : Promise.resolve(null),
    // existing parallel work (presenter / card formatting) lives here too
  ]);

  const questionInput = buildDiscoveryQuestionInput({
    query: input.query,
    sourceProfile: graphResult.sourceProfile,
    negotiations: graphResult.negotiations,   // structured per master spec
    summary: graphResult.summary,
    chatContext: chatContext ?? undefined,
    now: new Date().toISOString(),
  });

  const result = await questionGenerator.generate(questionInput);
  if (result) {
    questions = result.questions;
    questionsDebug = {
      inputMode: getInputMode(),
      finalCount: result.questions.length,
      droppedCount: /* derived from generator's internal counters; expose via trace */ 0,
      strategies: result.strategies,
      durationMs: /* timed wrapper */ 0,
    };
  }
}
```

The `Promise.all` runs the digest fetch in parallel with whatever existing parallel work the discover step already performs (presenter, card formatting). This keeps wall-clock add ≤ `max(summarizer, generator)` instead of summing.

### 3. Trace event emission

Via the existing `requestContext.traceEmitter`:

```
chat_summarizer_start    { sessionId }
chat_summarizer_end      { newMessageCount, model, fromCached, durationMs }
question_generator_start { inputMode, negotiationCount, hasChatContext }
question_generator_end   { finalCount, droppedCount, strategies, durationMs, inputMode }
```

The summarizer and generator themselves emit `_start`/`_end` events; `opportunity.discover.ts` wraps them around its calls.

### 4. Truncation accounting

When the negotiation list is truncated to fit the 8-candidate cap, emit a trace event field `truncated: { originalCount, keptCount }` on `question_generator_start`.

## Tool result extension

`packages/protocol/src/opportunity/opportunity.tools.ts` — the `discover_opportunities` tool's result shape grows:

```ts
interface DiscoverOpportunitiesToolResult {
  candidates: FormattedDiscoveryCandidate[];
  questions?: Question[];   // public shape only; empty array suppressed
}
```

`FormattedDiscoveryCandidate[]` stays unchanged. Callers that ignore `questions` continue to work.

## Streamer extension

`packages/protocol/src/chat/chat.streamer.ts` gains a new typed block kind: `decisionQuestions`. Payload `{ questions: Question[] }`. Emitted only when the tool result includes a non-empty `questions` array, *after* the existing card emissions for that tool result.

Type added to `packages/protocol/src/chat/chat-streaming.types.ts`. Existing block kinds untouched.

## Chat prompt addendum

`packages/protocol/src/chat/chat.prompt.ts` — short paragraph appended near the opportunity-card guidance:

> "When `discover_opportunities` returns `questions`, do **not** rephrase or summarize them in your prose. The frontend renders them as an interactive card. In your text response, you may write a single short line referencing that there are decision prompts below; otherwise, leave them alone."

Same pattern as the existing opportunity-block guidance.

## `debugMeta` extension

Existing `debugMeta` shape (per CLAUDE.md trace notes) gains:

```ts
debugMeta.discoveryQuestions = {
  inputMode: "transcripts" | "insights";
  finalCount: number;
  droppedCount: number;
  strategies: QuestionStrategy[];
  durationMs: number;
} | null;
```

Populated only when the questions branch ran (regardless of generator success/failure). `null` when the flag is off or the trigger is non-orchestrator.

`debugMeta.llm.calls` increments by 1 (generator) plus 0/1 (summarizer when invoked) — existing counter, no schema change.

## Tests

### Integration (real LLM mocked; real DB if summarizer involved)

`packages/protocol/src/opportunity/tests/opportunity.discover.questions.spec.ts`:

- `trigger: "orchestrator"` + flag on + chatSessionId → `questions` populated; `debugMeta.discoveryQuestions.strategies` length matches; `chat_summarizer_*` + `question_generator_*` trace events emitted in correct order.
- `trigger: "ambient"` + flag on → no `questions`, no summarizer/generator calls (assert mocks unused).
- Flag off → no calls regardless of trigger.
- Generator returns `null` → tool result has no `questions` field; cards still return; `debugMeta.discoveryQuestions` reflects null/failure.
- No chatSessionId (orchestrator MCP one-shot) → generator runs without `chatContext`; `questions` populated.
- Summarizer fails → generator still runs with `chatContext: undefined`; warn logged.

### Streamer

`packages/protocol/src/chat/tests/chat.streamer.spec.ts` (extend existing tests):

- Tool result with `questions` → `decisionQuestions` block emitted after card blocks.
- Tool result without `questions` → no `decisionQuestions` block.
- Empty `questions: []` → no block.

## Acceptance criteria

- [ ] `ENABLE_DISCOVERY_QUESTIONS=true` + chat-driven discovery produces `questions` in the tool result and a streamed `decisionQuestions` block, end-to-end, against a real backend.
- [ ] `ENABLE_DISCOVERY_QUESTIONS=false` produces zero behavioral change (no new LLM calls, no new trace events except guard-skip).
- [ ] Ambient queue path verified untouched (smoke test: a queued ambient discovery completes with no `decisionQuestions` block and no summarizer/generator trace events).
- [ ] `bun run lint` clean; `tsc --noEmit` clean.
- [ ] No new tables, no schema migrations (Slice 1 handles those).

## Risks / open questions

- **Composition root wiring.** The cleanest place to pass `ChatSummaryReader` and `QuestionGenerator` depends on whether the current `OpportunityGraphFactory` constructor takes a `ProtocolDeps` bag or discrete deps. The plan should determine and reflect this — both options are mechanical.
- **Parallelism boundary.** The digest fetch + generator are sequential (generator needs the digest). The digest fetch runs in parallel with presenter/card formatting. If presenter is already heavily concurrent, careful placement is required to avoid double-counting time in benchmarks.
- **Prompt-bloat in chat agent.** The addendum is short, but the chat prompt is already large. Verify the addendum lands without bumping the prompt over current truncation thresholds (`MAX_CONTEXT_TOKENS` is enforced for messages, not the system prompt — should be safe).
