# Discovery decision questions — master design

**Status:** approved (brainstorm) — ready to slice
**Date:** 2026-05-14
**Branch:** TBD (single worktree to be created)

## Context

When the orchestrator (chat or MCP `discover_opportunities`) calls the opportunity graph, the graph runs negotiations between the seeker's agent and candidate agents. Each negotiation produces a transcript (turns with `action`, `assessment.reasoning`, `suggestedRoles`) and an outcome (`hasOpportunity`, `reasoning`, `agreedRoles`, optional `reason: turn_cap | timeout`). Today these signals power card rendering and are then discarded. They contain rich evidence about *why* connections did or did not form — evidence the user could act on if it were surfaced.

`NegotiationInsightsGenerator` already mines a user's entire negotiation history into a second-person prose summary, but it is invoked on-demand by a separate insights endpoint and is scoped to history aggregation, not to a single discovery turn.

## Feature

A **decision questions** generator runs after each orchestrator-triggered discovery. It reads the just-completed negotiations and emits 0–3 structured questions designed to enhance the user's outlook on their intent and let them decide with more knowledge at hand. The model picks contextually from five strategies:

| Strategy | Direction |
|---|---|
| `refine_intent` | Ask the user to sharpen or pivot their original signal. |
| `surface_missing_detail` | Ask for one concrete missing input (stage, location, timing). |
| `open_adjacent_thread` | Offer a pivot suggested by recurring counterparty signals. |
| `reflective_summary` | Mirror what the negotiations revealed and ask the user to decide. |
| `surface_emergent_knowledge` | Share a fact learned from negotiations and ask the user to decide in light of it. |

Multiple questions are allowed (capped at 3) and may mix strategies. The default is one question; second and third only when distinct strategies genuinely complement.

Each question shape mirrors the brainstorming `AskUserQuestion` skill — `title` (≤12 chars), `prompt`, 2–4 `options` with `label` + `description`, and a `multiSelect` flag. "Other" is implicit; renderers add a free-text fallback automatically. `strategy` is captured by the LLM for guardrails and `debugMeta`, then stripped from the public payload — users never see strategy labels.

## Surfaces

One generator, one payload shape, three rendering paths:

1. **index.network frontend (orchestrator chat).** The chat streamer emits a new typed block `decisionQuestions` alongside opportunity cards. A new React component renders the same UX as brainstorming's AskUserQuestion: stacked cards with title chip, prompt, selectable options with descriptions, automatic "Other" free-text. Submission flattens answers into a plain user message; orchestrator reads it as a normal chat turn.
2. **MCP clients with `elicitation` capability.** After the tool result returns, the MCP handler dispatches 1–3 sequential `elicitation/create` requests. Each carries `prompt` as `message` and options as `enum` in a single-property `requestedSchema`. `multiSelect: true` translates to `type: array`. Accept → answer flattened into next user message; decline/cancel → no-op.
3. **MCP clients without elicitation.** Tool result `content` carries a structured JSON envelope. The client's LLM reads the questions and may resurface them in prose.

Background flows (ambient queue, daily digest, accepted-opportunity notifications) never invoke the generator — the existing `DiscoverInput.trigger` field gates the path. Only `trigger === 'orchestrator'` triggers question generation.

## Architecture

### Layer placement

```
packages/protocol/
├── shared/schemas/
│   ├── question.schema.ts                ← public Question + internal QuestionWithStrategy
│   └── chat-context.schema.ts            ← ChatContextDigest
├── chat/
│   └── chat.summarizer.ts                ← pure LLM pass (input → digest)
├── negotiation/
│   └── insight.generator.ts              ← renamed from negotiation.insights.generator.ts
├── opportunity/
│   ├── question.generator.ts             ← pure LLM pass
│   └── opportunity.discover.ts           ← wires summarizer + generator behind ENABLE flag
└── shared/interfaces/
    └── chat-summary.interface.ts         ← ChatSummaryReader.getDigest(sessionId)

backend/
├── src/schemas/database.schema.ts        ← chat_session_summaries table
├── src/adapters/
│   └── chat-summary.database.adapter.ts  ← Drizzle adapter
├── src/services/
│   └── chat-summary.service.ts           ← orchestrates read → summarize → write
└── src/controllers/
    └── mcp.handler.ts                    ← elicitation dispatch after tool result

frontend/
└── src/components/DecisionQuestions/     ← AskUserQuestion-style renderer
```

### Data flow

```
orchestrator turn (chat or MCP)
   ↓
opportunity.discover(input, trigger: "orchestrator")
   ↓
opportunity graph runs → candidates, negotiations
   ↓                                  ↘ (parallel)
chatSummary.getDigest(sessionId)       cards/presenter formatting
   ↓
buildDiscoveryQuestionInput(query, profile, negotiations, summary, chatContext, now)
   ↓
questionGenerator.generate(input) → { questions: Question[], strategies: [] } | null
   ↓
opportunity.discover returns { candidates, questions? }
   ↓                                    ↘ debugMeta.discoveryQuestions
chat path:                               mcp path:
  chat.streamer emits                     tool result content includes
  decisionQuestions block.                JSON envelope of questions.
  Frontend renders.                       If elicitation capability:
                                          handler dispatches 1–3
                                          elicitation/create after return.
```

### Chat-summary persistence (rolling, incremental)

New table `chat_session_summaries` keeps a rolling, append-only chain of digests per session:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `chat_session_id` | uuid fk → chat_sessions.id, cascade | |
| `from_message_id` | uuid fk → messages.id | Earliest message in the chain. |
| `to_message_id` | uuid fk → messages.id | Latest message covered. |
| `digest` | jsonb (`ChatContextDigest`) | Structured 4-field digest. |
| `model` | varchar | Model slot that produced the row. |
| `created_at` | timestamptz default now() | |

Index: `(chat_session_id, to_message_id desc)`.

Each summarization pass:

1. Loads the latest summary row for the session (if any) → `previousDigest`.
2. Loads all messages with `id > previousDigest.to_message_id` (or all session messages if none) → `newMessages`.
3. If `newMessages.length === 0`, returns `previousDigest.digest` without an LLM call.
4. Otherwise invokes `chat.summarizer` with `(previousDigest, newMessages)`, persists a new row with `from = previousDigest.from_message_id ?? newMessages[0].id` and `to = newMessages.last().id`, returns the new digest.

Append-only retains debug/replay value. A GC pass for digests older than N days is out of scope.

### `ChatContextDigest` shape

```ts
interface ChatContextDigest {
  statedFacts: string[];       // facts the user volunteered (stage, location, role, …)
  openQuestions: string[];     // questions the assistant asked, no user answer yet
  rejectionReasons: string[];  // pushback on prior cards ("none of these fit — all US-based")
  surfacedFindings: string[];  // facts the assistant shared from prior negotiations
}
```

Each array is bounded by prompt rule (keep ~20 most relevant); the summarizer drops stale entries that are overridden by newer messages.

### `Question` schemas

```ts
// Public — what callers, frontend, tool-result, elicitation see.
export const QuestionOptionSchema = z.object({
  label: z.string().min(1).max(120),       // "(Recommended)" suffix on safest path; safest first
  description: z.string().min(1).max(280), // consequence, not definition
});

export const QuestionSchema = z.object({
  title: z.string().min(1).max(12),        // noun of decision domain
  prompt: z.string().min(1).max(400),      // ≤2 sentences, ends with "?"
  options: z.array(QuestionOptionSchema).min(2).max(4),
  multiSelect: z.boolean(),
});

// Internal — generator output, never crosses generator boundary.
export const QuestionStrategySchema = z.enum([
  "refine_intent",
  "surface_missing_detail",
  "open_adjacent_thread",
  "reflective_summary",
  "surface_emergent_knowledge",
]);

const QuestionWithStrategySchema = QuestionSchema.extend({
  strategy: QuestionStrategySchema,
});
const QuestionGeneratorResponseSchema = z.object({
  questions: z.array(QuestionWithStrategySchema).max(3),
});

export interface QuestionGenerationResult {
  questions: Question[];           // public
  strategies: QuestionStrategy[];  // parallel, debug-only
}
```

### `DiscoveryQuestionInput`

```ts
interface DiscoveryQuestionInput {
  query: string;                              // original seeker query
  sourceProfile: {
    name?: string; bio?: string; location?: string;
    skills?: string[]; interests?: string[];
  };
  negotiations: Array<{
    counterpartyId: string;                   // opaque, never surfaced
    counterpartyHint: string;                 // abstract profile slice
    indexContext: string;                     // network prompt
    turns: Array<{
      action: "propose" | "accept" | "reject" | "counter" | "question";
      reasoning: string;                       // ≤200 chars
      suggestedRoles: { ownUser: Role; otherUser: Role };
    }>;                                        // last 6 per negotiation
    outcome: {
      hasOpportunity: boolean;
      reasoning: string;                       // ≤300 chars
      agreedRoles?: Array<{ userId: string; role: Role }>;
      reason?: "turn_cap" | "timeout";
    };
  }>;
  summary: {
    totalCandidates: number;
    opportunitiesFound: number;
    noOpportunityCount: number;
    timeoutCount: number;
    roleDistribution: Record<Role, number>;
  };
  chatContext?: ChatContextDigest;             // when sessionId in scope
  now: string;                                  // ISO timestamp
}
```

Truncation: max 8 negotiations × 6 turns × ~200 char reasoning → ~10 KB prompt cap. If more candidates exist, keep the 4 most-recent-turn-rich plus the 4 with highest seed-assessment scores; drop the rest. Truncation count is recorded in trace events.

## Configuration

| Env var | Type | Default | Purpose |
|---|---|---|---|
| `ENABLE_DISCOVERY_QUESTIONS` | boolean | `false` | Master kill switch. Day-one default is off. |
| `DISCOVERY_QUESTIONS_INPUT_MODE` | `transcripts` \| `insights` | `transcripts` | Day-one supports only `transcripts`. `insights` mode is reserved for a future sibling spec (background insights pipeline). |

New `model.config.ts` slots:

- `chatContextSummarizer` — small/fast model.
- `discoveryQuestionGenerator` — medium-tier model.

## Observability

Trace events (kebab-case, via `requestContext.traceEmitter`):

```
discover_start
  opportunity_graph_start  →  opportunity_graph_end
  chat_summarizer_start    →  chat_summarizer_end    { newMessageCount, model, fromCached, durationMs }
  question_generator_start →  question_generator_end { finalCount, droppedCount, strategies, durationMs, inputMode }
discover_end
```

`debugMeta.discoveryQuestions`:

```ts
{
  inputMode: "transcripts" | "insights";
  finalCount: number;
  droppedCount: number;
  strategies: QuestionStrategy[];
  durationMs: number;
} | null
```

`debugMeta.llm.calls` increments by 1 (generator) + 0/1 (summarizer when invoked).

## Error handling

All failures degrade gracefully; discovery cards always return.

| Failure | Response | Log |
|---|---|---|
| Flag off / non-orchestrator trigger | No-op | none |
| `ChatSummaryReader.getDigest` throws | Continue with `chatContext: undefined` | warn |
| Summarizer LLM/parse fails | Returns `null`, no row written | warn |
| Question generator LLM/parse fails | Returns `null`, tool result omits `questions` | warn |
| All questions filtered by guardrails | Returns `null` | info |
| Elicitation rejected mid-loop | Stop loop; remaining questions only in tool-result JSON | warn |
| Client without elicitation capability | Skip dispatch silently | none |
| Frontend partial submission | Only answered questions flattened | (n/a) |

Latency: summarizer p95 < 1.5 s, generator p95 < 4 s. Both run in parallel with card formatting/presenter so wall-clock add is `max()`, not `sum()`.

## Vertical slices

This master design ships as five slices, each with its own design doc and Linear subissue. Slices are sequenced by dependency; later slices import types and behavior introduced earlier.

| Slice | Title | Depends on |
|---|---|---|
| 1 | Chat-session summaries (table, summarizer, service) | — |
| 2 | Question schema + generator | 1 (digest type) |
| 3 | Discovery integration (wire-in, gate, debug, traces) | 2 |
| 4 | Frontend decision-questions renderer | 3 |
| 5 | MCP elicitation dispatch | 3 |

Slice 1 also bundles the rename of `packages/protocol/src/negotiation/negotiation.insights.generator.ts` → `negotiation/insight.generator.ts`.

Slices 4 and 5 are technically orthogonal but are executed serially in a shared worktree per the team's chosen workflow.

## Non-goals (this spec)

- Persisting questions or user answers beyond the chat-message record.
- Auto-refining discovery on accept (the user's reply goes back as a chat message; the LLM decides whether to re-call `discover_opportunities`).
- `insights` input mode (depends on a sibling background-insights pipeline spec, not yet written).
- Strategy-typed visual affordances in MCP elicitation dialogs (the MCP `requestedSchema` vocabulary has no slot; v1 keeps strategy debug-only and renders all questions identically across MCP clients).
- Question generation for non-orchestrator flows (ambient, digest, accepted-notification).

## Out-of-scope but referenced

- **Sibling spec — Background Insights Pipeline.** Event-driven writer (`negotiation.resolved`) producing per-turn insight digests in a new `negotiation_insights` table; the existing `GET /users/:userId/negotiations/insights` becomes a read-through. Enables this spec's `insights` mode. Written separately when prioritized.

## Related cleanup (bundled into Slice 1)

Rename `packages/protocol/src/negotiation/negotiation.insights.generator.ts` → `packages/protocol/src/negotiation/insight.generator.ts`. Class name `NegotiationInsightsGenerator` is unchanged; only filename + import paths in `packages/protocol/src/index.ts` and `backend/src/controllers/user.controller.ts`.
