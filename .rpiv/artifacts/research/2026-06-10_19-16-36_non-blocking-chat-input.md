---
date: 2026-06-10T19:16:36+0300
author: Yankı Ekin Yüksel
commit: 9e7bf43d5e
branch: dev
repository: index
topic: "Non-blocking chat input with steering and queueing"
tags: [research, codebase, AIChatContext, ChatContent, chat-controller, chat-streamer, checkpointer, notification-events, conversation-schema]
status: ready
last_updated: 2026-06-10T19:16:36+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: Non-blocking chat input with steering and queueing

## Research Question

Chat input is currently blocked (disabled) while the orchestrator is streaming. Add support for steering (interrupt + restart) and queueing (buffer + drain) so input is never blocked. A small classifier embedded in the SSE stream decides steer vs. queue using the new message and current agent state.

## Summary

The block is 100% frontend-only — `ChatContent.tsx:925` sets `isBusy = isLoading || isUploadingFiles` and applies `disabled={isBusy}` to controls at 7 locations across 3 input form render paths. The SSE stream runs inside a `ReadableStream` closure keyed by `sessionId`; an in-process per-session `EventEmitter` (modelled on the existing `notification-events.ts` singleton pattern) is the clean mechanism for injecting a `steer_or_queue` event from a new `/chat/interrupt` endpoint. The LangGraph checkpointer uses `thread_id: sessionId` — a steered run must use a composite `sessionId:runId` thread_id to avoid resuming from partial mid-graph checkpoint state. The `messages` table has no status column but `metadata: jsonb` already exists and is already used for optional fields (`routingDecision`, `tokenCount`); adding `{ interrupted: true }` requires no migration. The classifier fits the existing model config pattern (`google/gemini-2.5-flash`, temperature 0.0, maxTokens ~10).

## Detailed Findings

### Frontend — Input Blocking

- `ChatContent.tsx:925` — `const isBusy = isLoading || isUploadingFiles` — the sole source of the block flag.
- `ChatContent.tsx:953` — `handleSubmit` guard: `if (!canSend || isBusy) return;` — prevents submission while busy.
- **Three separate input form render paths** all produced by a `renderInputForm()` function with internal conditional returns. Every path applies `disabled={isBusy}` identically:
  - Path 1 (home/empty chat): `1110` (file button), `1122` (MentionsTextInput)
  - Path 2 (active chat, panel variant): `1331` (file button), `1342` (MentionsTextInput)
  - Path 3 (active chat, bottom fixed input): `1506` (file button), `1517` (MentionsTextInput)
- `ChatContent.tsx:1867` — `SuggestionChips disabled={isBusy}` — seventh location.
- Each path renders a stop button when `isLoading` (`1127`, `1347`, `1522`), all calling `stopStream()`.
- `ChatContent.tsx:354-355` — `{ isLoading, stopStream }` are destructured from `useAIChat()`.

### Frontend — AIChatContext Stream Lifecycle

- `AIChatContext.tsx` — `isLoading` state: set `true` in `sendMessage` body, set `false` in `finally` block.
- `abortControllerRef: useRef<AbortController | null>` — new instance per `sendMessage` call; `stopStream()` calls `abortControllerRef.current.abort()`.
- `ChatMessage` interface has: `isStreaming`, `wasStoppedByUser`, `stoppedAt` — new `isPending`/`isQueued` fields can be added alongside these with the same optional pattern.
- `sendMessage` is a `useCallback` closure; a sibling `pendingQueueRef = useRef<QueuedMessage[]>([])` can hold queued messages without breaking the closure's dependency array.
- The SSE reader loop (inside `sendMessage`) processes events via a `switch(event.type)` at roughly line 280+. Adding `case "steer_or_queue"` here is the correct place to handle the classifier decision.
- `skipSessionUpdateForRequestRef` ref shows the pattern for per-request state that doesn't trigger re-renders.

### Backend — SSE Stream Architecture

- `chat.controller.ts:237` — `new ReadableStream({ start(controller) { ... } })` — the entire stream lifecycle is a closure. The `controller.enqueue` function is the injection point.
- `chat.controller.ts:272` — `req.signal` is passed directly to `factory.streamChatEventsWithContext()`.
- `chat.controller.ts:376` — `if (!req.signal.aborted)` — guards title/suggestions generation after streaming. When client aborts, this block is skipped and the stream closes cleanly without persistence of user/assistant message.
- `chat.controller.ts:407` — `controller.close()` in `finally` — always runs, ensuring SSE stream ends cleanly.
- `chat.controller.ts:319-335` — user + assistant messages persisted only after successful stream completion (not on abort). Interrupt/steer persistence requires a **new code path** before `controller.close()` when interrupted.

### Backend — Interrupt Bus Design

- `backend/src/lib/notification-events.ts:12` — `const notificationEmitter = new EventEmitter()` — singleton; `setMaxListeners(100)`. This is the canonical in-process cross-handler signaling pattern.
- `notification-events.ts:22-28` — `onOpportunityNotification(handler)` returns an unsubscribe function (`() => notificationEmitter.off(...)`). The stream handler must call the unsubscribe in its `finally` block to prevent listener leaks.
- New file: `backend/src/lib/chat-interrupt.events.ts` — a `chatInterruptEmitter = new EventEmitter()` keyed with session-scoped event names (`interrupt:<sessionId>`). The stream handler subscribes on start with `once` (one interrupt per stream lifetime), unsubscribes in `finally`.
- `chat.controller.ts` stream handler listens: `chatInterruptEmitter.once('interrupt:<sessionId>', (payload) => { controller.enqueue(steer_or_queue_event); internalAbortController.abort(); })`.
- The `/chat/interrupt` POST endpoint: validates session ownership, runs classifier, emits `chatInterruptEmitter.emit('interrupt:<sessionId>', { decision, messageId })`.

### Backend — LangGraph Checkpointer

- `chat.streamer.ts:180` — `configurable: { thread_id: sessionId, signal }` — the `thread_id` IS the `sessionId` verbatim.
- `checkpointer.adapter.ts` — singleton `PostgresSaver.fromConnString(DATABASE_URL)`. One shared instance per process. Checkpoints are written per LangGraph node boundary; a mid-node abort writes nothing, but a between-node abort leaves the last completed node's state.
- **Steer risk**: A new run with the same `thread_id: sessionId` immediately after a steered abort resumes from the last checkpoint, not from a clean initial state. This would mix old graph state with a fresh user message.
- **Resolution**: Pass `thread_id: \`${sessionId}:${runId}\`` where `runId` is a per-run UUID (generated at stream start in the controller). This gives each run a clean LangGraph thread while session memory still comes from `loadSessionContext()` (DB messages, not graph state). Normal non-steered runs can continue using `thread_id: sessionId` or also use the composite form — the latter is cleaner and consistent.

### Backend — Message Schema + Persistence

- `conversation.schema.ts:98-118` — `messages` table: `id`, `conversationId`, `taskId`, `senderId`, `role` (enum: 'user'|'agent'), `parts` (JSONB), `metadata` (JSONB), `extensions` (JSONB), `referenceTaskIds` (JSONB), `createdAt`. **No status column.**
- `database.adapter.ts:8676` — `createChatMessage`: assembles `msgMeta: ChatMessageMeta` from optional fields (`routingDecision`, `subgraphResults`, `tokenCount`), inserts into `messages` with `parts: [{ type: 'text', text: content }]`.
- **No migration needed** for interrupted flag: add `interrupted?: boolean` to `ChatMessageMeta` interface and pass it through `createChatMessage` → `metadata` JSONB. Same pattern as `routingDecision`.
- `chat.service.ts:156-184` — `addMessage(params)`: accepts `sessionId`, `role`, `content`, `routingDecision?`, `subgraphResults?`, `tokenCount?`. Add `interrupted?: boolean` here.
- `chat.controller.ts:319` — interrupted message persistence: call `chatSessionService.addMessage({ sessionId, role: 'assistant', content: partialContent, interrupted: true })` in the interrupt handler path before the stream closure ends.
- Frontend rehydration (`AIChatContext.tsx:loadSession`): messages loaded from DB are mapped to `ChatMessage` — the `interrupted` flag from metadata needs to flow through to render an "interrupted" visual marker.

### Backend — Classifier

- `model.config.ts:40-62` — all background/classification agents use `google/gemini-2.5-flash`. Pattern: add `interruptClassifier: { model: "google/gemini-2.5-flash", temperature: 0.0, maxTokens: 16 }` to `getModelConfig()`.
- The classifier runs inside the `/chat/interrupt` handler: receives the new message text + a summary of the last N trace events (what the agent is currently doing), returns `"steer"` or `"queue"`.
- Input: `{ message: string, agentState: string }` (agentState = last 3 trace event names from the frontend snapshot).
- Output: `"steer" | "queue"` — binary classification, no structured output needed, minimal tokens.

### Backend — Controller Pattern

- `controller.template.md` — layered pattern: Controllers → Services → Adapters. New endpoint follows `@Post("/interrupt")` + `@UseGuards(RateLimit('write'), AuthGuard)`.
- `chat.controller.ts` already imports `chatSessionService` as a module-level singleton. The interrupt endpoint can be a new method on the same controller class.

## Code References

- `frontend/src/components/ChatContent.tsx:925` — `isBusy = isLoading || isUploadingFiles`
- `frontend/src/components/ChatContent.tsx:953` — `handleSubmit` early return on `isBusy`
- `frontend/src/components/ChatContent.tsx:1110,1122,1331,1342,1506,1517` — `disabled={isBusy}` on file button + textarea across 3 paths
- `frontend/src/components/ChatContent.tsx:1867` — `SuggestionChips disabled={isBusy}`
- `frontend/src/components/ChatContent.tsx:354-355` — `{ isLoading, stopStream }` destructured from `useAIChat()`
- `frontend/src/contexts/AIChatContext.tsx:129` — `isLoading` state declaration
- `frontend/src/contexts/AIChatContext.tsx:~420` — `stopStream()`: `abortControllerRef.current.abort()`
- `frontend/src/contexts/AIChatContext.tsx:~280+` — SSE event `switch(event.type)` loop — add `case "steer_or_queue"` here
- `backend/src/lib/notification-events.ts:12-28` — singleton `EventEmitter` pattern (precedent for interrupt bus)
- `backend/src/controllers/chat.controller.ts:237` — `ReadableStream` closure start — subscribe to interrupt emitter here
- `backend/src/controllers/chat.controller.ts:272` — `req.signal` passed to `streamChatEventsWithContext`
- `backend/src/controllers/chat.controller.ts:319` — message persistence on stream success — new interrupted path forks here
- `backend/src/controllers/chat.controller.ts:376` — `req.signal.aborted` check — interrupted path also exits here
- `backend/src/controllers/chat.controller.ts:407` — `controller.close()` in `finally` — unsubscribe from interrupt emitter here
- `backend/src/services/chat.service.ts:156` — `addMessage(params)` — add `interrupted?: boolean` param
- `backend/src/adapters/database.adapter.ts:8676` — `createChatMessage` — add `interrupted` to `ChatMessageMeta`
- `backend/src/schemas/conversation.schema.ts:98-118` — `messages` table definition (no status col, `metadata: jsonb` exists)
- `packages/protocol/src/chat/chat.streamer.ts:180` — `configurable: { thread_id: sessionId, signal }` — change to `thread_id: \`${sessionId}:${runId}\``
- `packages/protocol/src/shared/agent/model.config.ts:40-62` — add `interruptClassifier` entry
- `backend/src/adapters/checkpointer.adapter.ts:39` — `getCheckpointer()` singleton — no change needed

## Integration Points

### Inbound References
- `frontend/src/components/ChatContent.tsx:354` — imports `isLoading`, `stopStream` from `useAIChat()` (AIChatContext)
- `frontend/src/app/chat/page.tsx` — renders `<ChatContent>` (primary chat path in scope)
- `frontend/src/app/chat/[conversationId]/page.tsx` — renders `<ChatContent sessionIdParam={...}>` (session-specific path)

### Outbound Dependencies
- `AIChatContext.tsx` → `apiClient.stream("/chat/stream", ...)` — existing SSE channel
- `AIChatContext.tsx` → new `apiClient.post("/chat/interrupt", ...)` — new endpoint
- `chat.controller.ts` → `factory.streamChatEventsWithContext(...)` — protocol graph
- `chat.controller.ts` → `chatSessionService.addMessage(...)` — message persistence
- `chat.streamer.ts` → `graph.stream(...)` with `configurable: { thread_id, signal }`

### Infrastructure Wiring
- `backend/src/lib/chat-interrupt.events.ts` (new) — singleton `EventEmitter`, `setMaxListeners(200)`, exports `emitChatInterrupt` / `onChatInterrupt` following `notification-events.ts` pattern
- `backend/src/controllers/chat.controller.ts` — new `@Post("/interrupt")` method on `ChatController`
- `packages/protocol/src/chat/chat.streamer.ts:180` — `thread_id` change to composite form
- `packages/protocol/src/shared/agent/model.config.ts` — new `interruptClassifier` model entry

## Architecture Insights

1. **Three input render paths** in `ChatContent.tsx` — all use the same `renderInputForm()` function with conditional branches. Any change to `disabled={isBusy}` must be applied to all three paths consistently. The `MentionsTextInput` component accepts a `disabled` prop; removing it allows typing regardless of `isLoading`.

2. **SSE stream is a closure** — `controller.enqueue` is not accessible outside the `ReadableStream.start()` callback. The interrupt emitter's listener closure captures `controller` naturally, so `chatInterruptEmitter.once('interrupt:<sessionId>', ({ decision }) => { controller.enqueue(...); internalAbort.abort(); })` works cleanly.

3. **`req.signal` vs internal abort** — `req.signal` fires when the HTTP client closes the connection. For steer, the backend needs to end the SSE stream from the server side (not wait for the client to close). This requires a **secondary `AbortController`** (call it `streamAbortController`) created per-stream and passed alongside `req.signal` as a combined signal to `streamChatEventsWithContext`. When the interrupt emitter fires, `streamAbortController.abort()` ends the LangGraph loop; the stream then persists the interrupted message and closes.

4. **Composite `thread_id`** — `streamChatEventsWithContext` receives `sessionId` but only uses it as `thread_id` for the checkpointer and for event attribution. Passing `runId` as a separate param and constructing `thread_id = \`${sessionId}:${runId}\`` in `streamChatEvents` keeps the change isolated to `chat.streamer.ts` without touching the public signature.

5. **No migration needed** — the `metadata: jsonb` column on `messages` (`conversation.schema.ts:108`) already accepts arbitrary fields. `interrupted: true` and `partialContent: true` can be stored there immediately. Frontend loadSession mapping just needs to check `(meta.interrupted === true)` to set a `wasInterrupted` flag on the `ChatMessage`.

6. **Queue is frontend-only** — queueing is entirely in `AIChatContext`: a `useRef<QueuedMessage[]>` holds pending messages. The `finally` block in `sendMessage` already sets `isLoading(false)`; adding a `dequeueAndSend()` call there auto-drains the queue. No backend changes needed for the queue path.

7. **5-second timeout fallback** — a `setTimeout(() => { if (isPending) defaultToSteer() }, 5000)` in the frontend, cleared on `steer_or_queue` SSE event, handles classifier failures gracefully.

## Precedents & Lessons

6 relevant commits on `chat.controller.ts`, 15 on `AIChatContext.tsx`, 5 on `chat.streamer.ts`. No steer/abort-path changes in history.

### Precedent: SSE event type additions
**Commits**: `55cbed07df`, `fce06ac634`, `5d9edf85d1`, `c07b541839` — adding new SSE event types (`phase_start/end`, `chat_summarizer_*`, `question_generator_*`)
**Pattern**: New event type added to `chat-streaming.types.ts` → emitted in `chat.streamer.ts` → forwarded in `chat.controller.ts` switch → handled in `AIChatContext.tsx` switch → reflected in `ChatContent.tsx` rendering.
**Takeaway**: Follow the same 4-file chain when adding `steer_or_queue` event type. Never add an event type in only some of the chain's stops.

### Precedent: wasStoppedByUser flag
**Commit**: present in `AIChatContext.tsx` (`wasStoppedByUser`, `stoppedAt` on `ChatMessage`)
**Pattern**: When abort fires, the `catch(AbortError)` block sets `wasStoppedByUser: true` on the assistant message. Same catch block is the right place to set `wasInterrupted: true` for steered messages.
**Takeaway**: The abort error path in `sendMessage` already has the right shape for interrupted-message state updates.

### Precedent: streamingDrafts persistence
**Commit**: `2834b7be75` — `persist orchestrator streamingDrafts across session reload`
**Pattern**: New optional data accumulated during stream → persisted via `POST /chat/message/:id/metadata` → rehydrated in `loadSession`.
**Takeaway**: The interrupted message doesn't use the metadata endpoint path (it's a separate `addMessage` call), but the rehydration pattern in `loadSession` (`AIChatContext.tsx`) is the right model for surfacing `wasInterrupted` to the UI on reload.

### Composite Lessons
- Every new SSE event type needs 4 coordinated changes: types → streamer → controller → frontend handler. Missing any one silently drops the event.
- The `finally` block in `sendMessage` is the single reliable cleanup point for all stream lifecycle state. Queue drain logic belongs here.
- `req.signal.aborted` in the controller gates title/suggestion generation — the interrupted path shares this check to avoid unnecessary work after steer.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-06-10_18-50-42_non-blocking-chat-input.md` — FRD defining the full feature scope: steering, queueing, classifier, pending UX, interrupted persistence

## Developer Context

**Q (discover: Frontend block is UI-only)**: Pre-resolved from codebase evidence — confirmed
A: Confirmed. `isBusy = isLoading || isUploadingFiles` at `ChatContent.tsx:925`; `disabled={isBusy}` at 7 locations; `sendMessage()` has no internal guard.

**Q (discover: stopStream() is reusable)**: Pre-resolved from codebase evidence — confirmed
A: Confirmed. `stopStream()` calls `abortControllerRef.current.abort()`. Steer composes on top: abort → wait for SSE confirmation → fire new `sendMessage`.

**Q (discover: Backend work is required)**: Is this a frontend-only change?
A: Backend work required — classifier endpoint, interrupt bus (EventEmitter per session), interrupted message persistence.

**Q (discover: Steer + queue both in scope)**: Which behavior?
A: Both.

**Q (discover: Classifier decides steer vs. queue)**: When user sends mid-stream?
A: Small model classifier on the message + current agent state (trace events snapshot).

**Q (discover: Classifier uses message + agent state)**: Classifier signals?
A: Message + last N trace event names (what tool/graph is active). Frontend sends snapshot with the interrupt request.

**Q (discover: Pending indicator on the message)**: UX while classified?
A: Subtle pending badge on the message in the chat list; resolves to "queued" or triggers steer on SSE event.

**Q (discover: Queue is visible and cancellable)**: Queue behavior?
A: Visible queue with per-message cancel controls. Frontend-only queue management.

**Q (discover: Classifier embedded in SSE stream)**: Where classifier runs?
A: Backend emits `steer_or_queue` SSE event on the active stream; frontend receives it on existing reader loop.

**Q (discover: Classify before acting)**: Optimistic abort?
A: No. Hold mid-stream message as `pending` until `steer_or_queue` SSE arrives; 5s timeout → default steer.

**Q (discover: Interrupted response persistence in scope)**: Persist partial messages?
A: Yes. Persist partial content with `interrupted: true` in `metadata` JSONB — no migration needed.

**Q (`backend/src/lib/notification-events.ts:12-28`)**: Which interrupt bus pattern?
A: EventEmitter keyed per-session — extend `notification-events.ts` pattern with a new `chat-interrupt.events.ts` module.

**Q (`packages/protocol/src/chat/chat.streamer.ts:180`)**: How to handle checkpointer stale state on steer?
A: Use composite `thread_id: \`${sessionId}:${runId}\`` — each run (especially steered runs) gets a fresh LangGraph thread. Session memory still loads from DB messages.

**Q (`backend/src/schemas/conversation.schema.ts:98`)**: Where to store interrupted flag?
A: `metadata: jsonb` on `messages` table — add `{ interrupted: true }` to `ChatMessageMeta`. No migration.

## Open Questions

- **Classifier model selection**: `google/gemini-2.5-flash` is confirmed as the right model (matches all existing classification agents in `model.config.ts:40-62`). Temperature 0.0, maxTokens 16 is appropriate for a binary "steer"|"queue" output.
- **Multi-instance interrupt bus**: The in-memory `EventEmitter` approach works for a single Bun process. For multi-instance deployments, the `chat-interrupt.events.ts` module should be designed with a replaceable backend (interface + in-memory default, Redis pub/sub upgrade path). Redis is already available when `REDIS_URL` is set — `cache.adapter.ts` and `lib/redis-env.ts` show the pattern.
- **Composite thread_id adoption for all runs**: Whether to use `sessionId:runId` for ALL runs (not just steered ones) or only for steered restarts. The former is cleaner and avoids special-casing but changes the checkpointer key for existing sessions on first use.
