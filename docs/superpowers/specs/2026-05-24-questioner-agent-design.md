# QuestionerAgent Design

Standalone, mode-driven agent that generates structured decision questions from arbitrary protocol contexts. Runs as a background job, persists questions to a dedicated table, and lets originating processes react to answers independently.

## Motivation

The current `QuestionGenerator` is tightly coupled to opportunity discovery: it accepts `DiscoveryQuestionInput`, lives in `opportunity/`, and runs inline during the discovery graph. Other protocol processes (intent creation, profile enrichment, negotiation) would also benefit from structured question generation, but there is no reusable mechanism for it. Additionally, the inline execution model blocks the discovery graph on an LLM call that the user may not answer for hours.

The QuestionerAgent extracts the concept into a modular, background-driven agent with preset modes.

## Architecture

### Protocol layer (`packages/protocol`)

**QuestionerAgent** (`src/questioner/questioner.agent.ts`)
- Stateless class following the `IndexNegotiator` pattern.
- Constructor takes optional config (model override).
- Single public method: `invoke(input: QuestionerInput): Promise<QuestionGenerationResult | null>`.
- Uses `createModel("questioner")` from `model.config.ts`.
- Applies the existing guardrail pipeline: dedup by title, strategy diversity cap (max 2 same-strategy).

**Presets** (`src/questioner/questioner.presets.ts`)
- Map from mode name to `{ systemPrompt, strategies, buildPrompt }`.
- Initial modes:
  - `discovery` — migrated from the current `question.prompt.ts` SYSTEM_PROMPT and `buildQuestionPrompt`. Accepts discovery negotiation digests + chat context.
  - `intent` — generates questions to sharpen a newly created or updated intent. Accepts intent payload, user profile, and existing signals.
  - `profile` — generates questions to fill profile gaps. Accepts profile data and gap analysis.
  - `negotiation` — generates questions after a negotiation stalls or hits a turn cap. Accepts negotiation context and outcome.
- Each preset defines its own `*Context` type and prompt builder. The agent selects the preset by `input.mode` and delegates.

**Input envelope** — `QuestionerInput`:
```typescript
interface QuestionerInput {
  mode: "discovery" | "intent" | "profile" | "negotiation";
  userId: string;
  sourceType: string;
  sourceId: string;
  context: DiscoveryContext | IntentContext | ProfileContext | NegotiationContext;
}
```

**Schemas** (`src/shared/schemas/question.schema.ts`)
- Existing `Question`, `QuestionWithStrategy`, `QuestionGenerationResult` remain unchanged.
- New types added:

```typescript
interface QuestionDetection {
  mode: "discovery" | "intent" | "profile" | "negotiation";
  sourceType: string;
  sourceId: string;
  triggeredBy?: string;   // optional intent ID that was the root cause
  timestamp: string;
}

interface QuestionActor {
  userId: string;
  networkId?: string;
  role: "subject";        // the person the question is about/for
}

interface QuestionAnswer {
  selectedOptions: string[];
  freeText?: string;
  answeredBy: string;
  answeredAt: string;
}
```

**Interface** (`src/shared/interfaces/questioner.interface.ts`)
```typescript
interface QuestionerDatabase {
  persist(questions: PersistableQuestion[]): Promise<void>;
  findPending(userId: string, filters?: { mode?: string; sourceType?: string; sourceId?: string }): Promise<PersistedQuestion[]>;
  answer(questionId: string, answer: QuestionAnswer): Promise<void>;
  dismiss(questionId: string): Promise<void>;
}
```

### Backend layer (`backend`)

**DB table** — `questions` in `database.schema.ts`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `detection` | jsonb | `QuestionDetection` |
| `actors` | jsonb | `QuestionActor[]` |
| `payload` | jsonb | `Question` (title, prompt, options, multiSelect) |
| `status` | text enum | `pending` / `answered` / `dismissed` |
| `answer` | jsonb | `QuestionAnswer`, null until answered |
| `createdAt` | timestamp | |

Follows the opportunity table pattern: self-contained records with typed jsonb columns for composability and node portability.

**Adapter** — `src/adapters/questioner.adapter.ts`
- Implements `QuestionerDatabase` using Drizzle.
- Injected into `ProtocolDeps`.

**Queue** — `src/queues/questioner.queue.ts`
- BullMQ job definition: `QuestionerJob` with payload matching `QuestionerInput`.
- Worker: instantiates `QuestionerAgent`, calls `invoke()`, persists results via adapter.
- 3 retries, exponential backoff, completed jobs removed after 24h.

**Env gate** — `QUESTIONER_ENABLED=true|false` (default `false`).
- Checked at the call site before enqueuing. When false, callers skip question generation entirely.

**Events** — `src/events/question.event.ts`
- `QuestionEvents.onCreated({ questionId, userId, mode, sourceType, sourceId })`
- `QuestionEvents.onAnswered({ questionId, userId, mode, sourceType, sourceId, answer })`

**REST endpoints**:
- `GET /api/questions?status=pending` — list pending questions for the authenticated user.
- `POST /api/questions/:id/answer` — submit an answer.
- `POST /api/questions/:id/dismiss` — dismiss a question.

## Answer lifecycle

1. **Generation**: A protocol process (discovery, intent, profile, negotiation graph) enqueues a job on `QuestionerQueue` with the relevant mode and context snapshot.
2. **Persistence**: The queue worker runs `QuestionerAgent.invoke()`, persists 0-3 questions with `status: pending`, emits `QuestionEvents.onCreated`.
3. **Delivery**: The frontend fetches pending questions via REST (or receives them via SSE push). The MCP layer can also surface them via elicitation.
4. **Answer**: The user selects options or provides free text. The backend updates the record (`status: answered`, fills `answer` jsonb), emits `QuestionEvents.onAnswered`.
5. **Reaction**: The originating process listens for `QuestionEvents.onAnswered` and decides how to incorporate the answer:
   - Intent mode: re-runs intent refinement with the new information.
   - Profile mode: updates the user's profile with the new data, re-generates embeddings.
   - Discovery mode: folds the answer into `ChatContextDigest` for the next discovery run.
   - Negotiation mode: injects the answer as context for the next negotiation turn.
6. **Expiry**: Unanswered questions can be dismissed by the user or expired by a maintenance job after a configurable TTL.

## Migration from existing QuestionGenerator

1. The `QuestionGenerator` class in `opportunity/question.generator.ts` is replaced by the `discovery` preset in `QuestionerAgent`. The guardrail functions (dedup, strategy diversity) move to the agent class since they apply to all modes.
2. The `SYSTEM_PROMPT` and `buildQuestionPrompt` from `question.prompt.ts` become the discovery preset's prompt and builder.
3. The `QuestionGeneratorReader` interface is deprecated. Callers switch to enqueuing on `QuestionerQueue`.
4. The inline `QuestionGenerator` call in the discovery graph is replaced with a `questionerQueue.add()` call.
5. The `decision_questions` stream event in `ChatAgent` can still fire — the backend emits it when the queue job completes and a chat session is active.
6. Existing schemas (`Question`, `QuestionWithStrategy`, etc.) remain unchanged. New detection/actor/answer types are added alongside them.

## File inventory

### New files

**Protocol (`packages/protocol/src/`):**
- `questioner/questioner.agent.ts` — QuestionerAgent class
- `questioner/questioner.presets.ts` — mode presets (prompt, strategies, builder per mode)
- `questioner/questioner.types.ts` — QuestionerInput, *Context types
- `shared/interfaces/questioner.interface.ts` — QuestionerDatabase interface

**Backend (`backend/src/`):**
- `adapters/questioner.adapter.ts` — Drizzle implementation of QuestionerDatabase
- `queues/questioner.queue.ts` — BullMQ job + worker
- `events/question.event.ts` — QuestionEvents emitter
- `controllers/question.controller.ts` — REST endpoints

### Modified files

- `packages/protocol/src/shared/schemas/question.schema.ts` — add QuestionDetection, QuestionActor, QuestionAnswer types
- `packages/protocol/src/index.ts` — export new modules
- `backend/src/schemas/database.schema.ts` — add questions table
- `backend/src/protocol-init.ts` — inject QuestionerDatabase into ProtocolDeps
- `backend/src/shared/agent/tool.helpers.ts` — add questionerDatabase to ProtocolDeps type
- Discovery graph call site — replace inline QuestionGenerator with queue.add()

### Deprecated files (remove after migration)

- `packages/protocol/src/opportunity/question.generator.ts` — logic absorbed into QuestionerAgent
- `packages/protocol/src/opportunity/question.prompt.ts` — content moves to discovery preset
- `packages/protocol/src/opportunity/discovery-question.helper.ts` — extraction logic moves into preset builder
- `packages/protocol/src/shared/interfaces/question-generator.interface.ts` — replaced by QuestionerDatabase interface
