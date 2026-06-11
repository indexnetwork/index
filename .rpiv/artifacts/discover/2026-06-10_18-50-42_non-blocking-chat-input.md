---
date: 2026-06-10T18:50:42+0300
author: Yankı Ekin Yüksel
commit: 3ab9385916
branch: dev
repository: index
topic: "Non-blocking chat input with steering and queueing"
tags: [intent, frd, chat, AIChatContext, ChatContent, streaming, steering, queueing]
status: ready
last_updated: 2026-06-10T18:50:42+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: Non-blocking chat input with steering and queueing

## Summary

Chat input is currently disabled while the orchestrator is streaming a response, which breaks the natural rhythm of a chat interface. This feature removes the block: users can type and submit at any time, with a small backend classifier (embedded in the SSE stream) deciding whether the new message should **steer** (interrupt the current run and restart) or **queue** (buffer for sequential processing). A persistent queue panel lets users see and cancel queued messages. Aborted runs persist their partial assistant response marked as "interrupted".

## Problem & Intent

Blocking the chat input while the orchestrator is processing feels unnatural. Users expect to type whenever they want — like iMessage or Slack — and the disabled input signals a broken UX rather than a thinking agent. The core friction isn't about power users or course-correction specifically: it's that the interface communicates "system is broken" instead of "agent is thinking".

## Goals

- Input (textarea + attachment controls) is never disabled due to an in-progress stream.
- Users can submit a message while the orchestrator is running.
- A small classifier — embedded in the SSE protocol — decides steer vs. queue using the new message content and the current agent state snapshot (trace events / what the agent is doing right now).
- Steered messages abort the current run and start a fresh one; the partial assistant response is persisted as an "interrupted" message.
- Queued messages are visible to the user with a badge; the queue drains sequentially after each run.
- Users can cancel any queued message before it fires.

## Non-Goals

- SharedChatView (`/s/[token]`) and `/u/[id]/chat` are not in scope for this change — non-blocking input is only for the primary chat path.
- No user-controlled steer-vs-queue override (Shift+Enter, split button, etc.) — the classifier decides.
- No multi-message FIFO queue collapsing logic — the queue panel handles ordering/cancellation explicitly.
- No backend-side per-session concurrency lock (existing behavior: no lock exists).

## Functional Requirements

1. The chat textarea and attachment button SHALL remain enabled while `isLoading` is true (i.e., `isBusy` no longer gates `disabled` on those controls in `ChatContent.tsx`).
2. When the user submits a message while `isLoading`, the frontend SHALL immediately display the message in the chat list with a "pending" badge and send a `POST /chat/interrupt` request to the backend carrying: (a) the new message text, (b) the current session ID, and (c) a snapshot of the active trace events from the running stream.
3. The backend `/chat/interrupt` endpoint SHALL receive the interrupt signal and, while the original SSE stream is still active, run a small classifier model using the new message + trace snapshot context to decide `steer` or `queue`.
4. The backend SHALL emit a `steer_or_queue` SSE event on the **running stream** (not a new stream) carrying `{ decision: "steer" | "queue", messageId }` so the frontend receives the decision on the existing channel.
5. On `decision: "steer"`: the running SSE stream SHALL self-terminate (via an internal per-session abort signal, e.g., an in-memory EventEmitter keyed by `sessionId`). The partial assistant content SHALL be persisted as a message with status `interrupted`. The frontend SHALL then immediately fire a new `/chat/stream` request with the steered message.
6. On `decision: "queue"`: the message SHALL be added to a frontend-managed queue. The message badge SHALL update from "pending" to "queued". After the current stream completes, the frontend SHALL automatically dequeue and send the next message.
7. The frontend SHALL display the active queue as visible entries (below the input or in a compact tray). Each queued entry SHALL have a cancel/dismiss button. Cancellation removes the entry from the queue before it fires.
8. The frontend SHALL hold the mid-stream message on the `pending` state until the `steer_or_queue` SSE event arrives — it SHALL NOT act on the message optimistically before the classifier responds.
9. If the `steer_or_queue` event does not arrive within a configurable timeout (default: 5 s), the frontend SHALL default to `steer` behavior (abort + restart) to avoid indefinite `pending` state.

## Non-Functional Requirements

- **Performance**: Classifier model call is on the hot path between user submit and action. Should use a small/fast model (e.g. `google/gemini-flash-1.5` or equivalent) targeting < 1 s P95 for the classify step. The `steer_or_queue` SSE event should reach the frontend before the user notices a delay.
- **Security**: `/chat/interrupt` requires the same auth as `/chat/stream` (session ownership validated). No new attack surface beyond what `/chat/stream` exposes.
- **UX / Accessibility**: The textarea must not flicker or lose focus when transitioning between `isLoading` states. The pending/queued badge must be visible but not disruptive. Queue panel must be keyboard-dismissible. Screen readers should announce queue state changes.
- **Reliability**: If the backend's per-session in-memory EventEmitter is not reachable (e.g., crash/restart mid-stream), the frontend's 5s timeout fallback handles graceful degradation to steer. Interrupted message persistence is best-effort — if the `POST /chat/stream` for the steered message is already in-flight, the interrupted message still persists.

## Constraints & Assumptions

- The SSE stream is one-directional (`server → client`), so the interrupt signal from the frontend travels as a separate HTTP request (`POST /chat/interrupt`), not on the existing stream.
- The per-session in-memory mechanism (EventEmitter/AbortController keyed by `sessionId`) must be scoped to the Bun process instance. In multi-instance deployments, this requires a shared pub/sub channel (e.g., Redis) to route interrupts to the correct instance. This is a constraint for production — the implementation should abstract behind a session-interrupt bus interface from day one.
- The existing `stopStream()` in `AIChatContext` (line ~420) aborts the `fetch` AbortController for the SSE stream. Steer behavior will compose on top of it: `stopStream()` → wait for `steer_or_queue` SSE confirmation → fire new stream. The existing abort does NOT need to change.
- LangGraph `PostgresSaver` checkpointer writes per session; a steered run starts a new LangGraph invocation on the same `sessionId`. The interrupted run's checkpoint state should not corrupt the next run — this needs verification during research (the checkpointer may need to be reset or a new thread started on steer).
- Persistence of the "interrupted" assistant message is a new DB operation. The backend currently persists user + assistant messages only on `done` (`chat.controller.ts:219`). A new code path is needed to persist the partial response on abort.

## Acceptance Criteria

- [ ] Typing in the chat textarea is possible at any point during a streaming response (textarea is never `disabled` due to `isLoading`).
- [ ] Submitting a message mid-stream renders that message in the chat list immediately with a visible "pending" indicator before any classifier response is received.
- [ ] After the `steer_or_queue` SSE event arrives: if `steer`, the running stream terminates and a new stream starts; if `queue`, the message badge changes to "queued" and appears in the queue panel.
- [ ] A queue panel (below input or as a tray) lists any queued messages; each has a dismiss/cancel control. Cancelling a queued message removes it before it fires.
- [ ] When the current stream finishes and a queued message exists, the frontend automatically sends the next queued message without user action.
- [ ] After a steer, the interrupted partial assistant response is persisted in the database and visible in the chat when the session is reloaded (with an "interrupted" or similar visual marker).
- [ ] If no `steer_or_queue` event arrives within 5 seconds, the frontend defaults to steer behavior: stream is aborted and new message is sent.
- [ ] Running `bun run lint` in `frontend/` passes with no new errors.
- [ ] Running `bun run lint` in `backend/` passes with no new errors.

## Recommended Approach

Introduce a per-session interrupt bus on the backend (in-memory EventEmitter abstracted behind an interface for future Redis upgrade), a new `/chat/interrupt` POST endpoint that runs the classifier and emits a `steer_or_queue` event on the active stream, and a frontend queue manager in `AIChatContext` that decouples the textarea enabled state from `isLoading`, holds mid-stream submissions as `pending` until classified, and drains the queue automatically after each run. Aborted run persistence is a separate code path in the stream close handler.

## Decisions

### Frontend block is UI-only
**Question**: Pre-resolved from codebase evidence — confirmed in Step 4
**Recommended**: n/a — pre-resolution
**Chosen**: The block is purely a UI concern in `ChatContent.tsx` (`isBusy = isLoading || isUploadingFiles`, line 925; `disabled={isBusy}` at lines 1110, 1122, 1331, 1342, 1506, 1517). `sendMessage()` in `AIChatContext.tsx` has no internal loading guard.
**Rationale**: evidence: `frontend/src/components/ChatContent.tsx:925` + confirmed

### stopStream() is reusable
**Question**: Pre-resolved from codebase evidence — confirmed in Step 4
**Recommended**: n/a — pre-resolution
**Chosen**: `stopStream()` (`AIChatContext.tsx:~420`) already calls `abortControllerRef.current.abort()`. Steer behavior composes on top of this without change.
**Rationale**: evidence: `frontend/src/contexts/AIChatContext.tsx` + confirmed

### Backend work is required
**Question**: Is this a frontend-only change, or does steering require backend involvement?
**Recommended**: Purely frontend (Recommended)
**Chosen**: Backend work is required — at minimum for the classifier (embedded in stream), the interrupt signaling mechanism, and persisting interrupted partial responses.
**Rationale**: Developer correction — steering involves aborting in-flight LangGraph execution and persisting state, which cannot be handled client-side.

### Steer + queue both in scope
**Question**: Which behavior should this feature support — steering, queueing, or both?
**Recommended**: Both steering + queueing
**Chosen**: Both
**Rationale**: Natural rhythm requires both: steering for course-correction, queueing for additive messages.

### Classifier decides steer vs. queue
**Question**: When user sends mid-stream, what happens by default?
**Recommended**: Always steer (interrupt + restart)
**Chosen**: A small model classifier decides based on the new message + what the agent is currently doing.
**Rationale**: Developer preference — more intelligent than a fixed rule; avoids discarding queued messages that are clearly additive.

### Classifier uses message + agent state
**Question**: What signals does the classifier use?
**Recommended**: Message content only
**Chosen**: Message + current agent state (trace events / what tool/graph is active at time of interrupt)
**Rationale**: Developer preference — agent state context improves accuracy (e.g., "wait" while mid-discovery vs. mid-writing has different implications).

### Pending indicator on the message
**Question**: What does the user see while a mid-stream message is being classified?
**Recommended**: Subtle pending indicator on the message
**Chosen**: Subtle pending indicator on the message (pending → queued or steering based on SSE event)
**Rationale**: Agreed — honest, message-level feedback without noise.

### Queue is visible and cancellable
**Question**: How does the queue behave if multiple messages are submitted while a run is in progress?
**Recommended**: Last message wins (collapse)
**Chosen**: User can see and cancel queued messages
**Rationale**: Developer preference — preserves user control and multi-message intent.

### Classifier embedded in SSE stream
**Question**: Where should the steer/queue classifier run?
**Recommended**: Backend endpoint (POST /chat/classify)
**Chosen**: Embedded in the stream protocol — backend emits a `steer_or_queue` SSE event on the active stream
**Rationale**: Developer preference — avoids a separate HTTP round-trip, decision travels on the existing channel.

### Classify before acting (no optimistic abort)
**Question**: Should the frontend act optimistically before receiving the classifier decision?
**Recommended**: Classify before accepting the message
**Chosen**: Hold mid-stream message as `pending` until `steer_or_queue` SSE event arrives; 5s timeout fallback to steer.
**Rationale**: Agreed — safer, no rollback complexity.

### Interrupted response persistence in scope
**Question**: Should aborted partial assistant responses be persisted?
**Recommended**: Neither — keep scope tight
**Chosen**: In scope — persist partial assistant message marked as "interrupted" when a steer occurs.
**Rationale**: Developer preference — conversation history should reflect what was shown.

## Open Questions

- **Checkpointer safety on steer**: LangGraph `PostgresSaver` writes checkpoint state per `sessionId`. When a steer interrupts a run mid-graph and a new run starts on the same `sessionId`, does the checkpointer state from the aborted run interfere? Research should verify whether the new run needs a fresh thread ID or whether the checkpointer handles partial-run cleanup automatically.
- **Multi-instance interrupt bus**: The in-memory EventEmitter approach for routing interrupts to the active SSE stream handler only works in a single-process deployment. The interface should be designed for a Redis pub/sub swap from day one, but the actual Redis implementation can be deferred.
- **Classifier model selection**: Which model to use for the steer/queue classifier is not decided. Research should identify the fastest available model on OpenRouter that can reliably distinguish "additive" from "corrective" intent from a short message + trace context summary.

## Suggested Follow-ups

- Shared chat view parity (`/s/[token]`, `/u/[id]/chat`) — not in scope here. Same blocking problem exists there: `frontend/src/app/s/[token]/page.tsx`, `frontend/src/app/u/[id]/chat/page.tsx`.
- Consider exposing a user-level preference to always queue or always steer (overriding the classifier) in chat settings.

## References

- Input text: "Currently we block chat input in frontend while talking with chat orchestrator and there is a process going on. Instead of blocking, we should support steering and/or queueing messages while a process is going on."
- `frontend/src/contexts/AIChatContext.tsx` — `isLoading`, `sendMessage`, `stopStream`, `abortControllerRef`
- `frontend/src/components/ChatContent.tsx:925` — `isBusy`, `disabled={isBusy}` wiring
- `backend/src/controllers/chat.controller.ts:219` — message persistence on stream done (not on abort)
- `backend/src/controllers/chat.controller.ts:261-272` — `streamChatEventsWithContext`, `req.signal` abort passthrough
