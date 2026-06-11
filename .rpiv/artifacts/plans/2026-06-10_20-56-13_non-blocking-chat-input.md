---
date: 2026-06-10T20:56:13+0300
author: Yankı Ekin Yüksel
commit: 56ba53da1a
branch: release/2026-06-10
repository: index
topic: "Non-blocking chat input with steering and queueing"
tags: [plan, chat, AIChatContext, ChatContent, chat-controller, chat-streamer, steer, queue, interrupt]
status: ready
parent: .rpiv/artifacts/research/2026-06-10_19-16-36_non-blocking-chat-input.md
phase_count: 5
phases:
  - { n: 1, title: Protocol types + classifier }
  - { n: 2, title: Backend interrupt bus + streamer runId }
  - { n: 3, title: Backend persistence + interrupt endpoint }
  - { n: 4, title: Frontend AIChatContext queue + steer logic }
  - { n: 5, title: Frontend UI — remove block + queue panel }
unresolved_phase_count: 0
last_updated: 2026-06-10T20:56:13+0300
last_updated_by: Yankı Ekin Yüksel
---

# Non-blocking chat input with steering and queueing — Implementation Plan

## Overview

Remove the `disabled={isBusy}` input block from the chat interface and replace it with classifier-driven steering (interrupt + restart) and queueing (buffer + drain). A new `ChatInterruptClassifier` in the protocol package runs a binary steer/queue LLM call; a per-session EventEmitter interrupt bus (`chat-interrupt.events.ts`) lets the `/chat/interrupt` endpoint inject a `steer_or_queue` SSE event into the running stream; the frontend manages a visible, cancellable queue in `AIChatContext` using a `useRef` with automatic drain on stream completion.

## Requirements

- Chat textarea and attachment controls are never `disabled` due to `isLoading`.
- Submitting mid-stream shows a "pending" badge on the message and POSTs to `/chat/interrupt`.
- Backend classifier uses message + agent state snapshot → emits `steer_or_queue` SSE event on the active stream.
- On `steer`: running stream self-terminates (server-side), partial assistant response persists as `interrupted`, new stream starts.
- On `queue`: message shows "queued" badge, appears in a visible queue panel with cancel button; auto-drains after current run completes.
- 5-second timeout fallback → default steer if no SSE event received.
- All runs use composite `thread_id: sessionId:runId` to prevent stale LangGraph checkpoints.
- `bun run lint` passes in frontend/ and backend/; `bun run build` passes in packages/protocol/.

## Current State Analysis

### Key Discoveries

- `ChatContent.tsx:925` — `const isBusy = isLoading || isUploadingFiles` — single source of the block.
- `ChatContent.tsx:953` — `handleSubmit` guard: `if (!canSend || isBusy) return;` — prevents mid-stream submit.
- 7 `disabled={isBusy}` sites across 3 render paths: lines 1110, 1122, 1331, 1342, 1506, 1517 (file button + MentionsTextInput per path), 1867 (SuggestionChips).
- `AIChatContext.tsx` — `sendMessage` is a `useCallback`; `isLoading` set true on entry, false in `finally`; `abortControllerRef` is a `useRef<AbortController | null>`.
- `chat.controller.ts:237` — SSE stream is a closure; `controller.enqueue` captured inside `ReadableStream.start()`.
- `chat.controller.ts:272` — `req.signal` passed to `streamChatEventsWithContext` — fires on HTTP client disconnect only.
- `chat.controller.ts:319` — persistence only on successful stream completion (not on abort).
- `notification-events.ts:12-28` — singleton `EventEmitter` pattern for cross-handler signaling.
- `chat.streamer.ts:180` — `configurable: { thread_id: sessionId, signal }` — thread_id is sessionId verbatim.
- `chat-streaming.types.ts` — union `ChatStreamEventType`, factory function `createStreamEvent<T>()`, factory creator functions pattern (`createStatusEvent`, `createDoneEvent`, etc.).
- `ChatTitleGenerator` (`chat.title.generator.ts:28`) — exact pattern for classifier: `createModel()` in constructor, `invokeWithAbortSignal()` call, plain text extraction.
- `conversation.schema.ts:98-118` — `messages` table has `metadata: jsonb` — `ChatMessageMeta` in `database.adapter.ts:8676` already maps optional fields to it.
- `model.config.ts:40-62` — `interruptClassifier: { model: "google/gemini-2.5-flash", temperature: 0.0, maxTokens: 16 }` — add here.

## Desired End State

```ts
// Backend: new /chat/interrupt endpoint
POST /api/chat/interrupt
Body: { sessionId: string; message: string; traceSnapshot: string[] }
Response: 200 OK (decision arrives via SSE on active stream)

// SSE stream gains new event type
{ type: "steer_or_queue", decision: "steer" | "queue", messageId: string, sessionId, timestamp }

// Frontend: typing mid-stream
// 1. User submits — message appears with isPending: true badge
// 2. apiClient.post("/chat/interrupt", { sessionId, message, traceSnapshot })
// 3. case "steer_or_queue" in SSE switch:
//    - steer → stopStream(), sendMessage(queuedMessage)
//    - queue → update badge to isQueued, add to queueRef
// 4. On stream finally → dequeueAndSend()
```

## What We're NOT Doing

- SharedChatView (`/s/[token]`) and `/u/[id]/chat` — non-blocking input only for primary chat path.
- User-controlled steer-vs-queue override (Shift+Enter, split button) — classifier decides.
- Redis interrupt bus — in-memory EventEmitter only; Redis upgrade path designed but not implemented.
- Multi-message FIFO collapse — queue panel manages explicitly with cancel.
- Schema migration — `interrupted` flag goes in existing `metadata` JSONB, no new column.

## Decisions

### steer_or_queue event type placement
**Question**: Where to add the new SSE event type?
**Explored**: Could be a new file, or added to existing `chat-streaming.types.ts`.
**Decision**: Add to `packages/protocol/src/chat/chat-streaming.types.ts` alongside all other event types. Follow the 4-file chain: types → streamer (not needed here) → controller → frontend. The `steer_or_queue` event is emitted directly by the controller's interrupt handler (not by the streamer), so `chat.streamer.ts` does not emit it — only the types and controller forwarding + frontend handling.

### ChatInterruptClassifier in protocol package
**Question**: Classifier in protocol (like `ChatTitleGenerator`) vs. inline in service?
**Explored**: `ChatTitleGenerator` (`chat.title.generator.ts:28`) is the exact pattern. Inline in service avoids protocol publish cycle.
**Decision**: Protocol package — `chat.interrupt.classifier.ts`. Follows existing classifier pattern; controller instantiates it. `packages/protocol` publish is required after this phase.

### Composite thread_id for all runs
**Question**: `sessionId:runId` for all runs or only steered restarts?
**Explored**: All runs → cleaner, no branching; only steered → less disruption for existing sessions.
**Decision**: All runs get `sessionId:runId`. runId generated by controller per stream start; passed to `streamChatEventsWithContext` as an `input` field. Session context loads from DB messages (not graph state), so losing old checkpoints is safe.

### interrupt bus: per-session EventEmitter
**Question**: Singleton EventEmitter with session-scoped events vs. Map<sessionId, callbacks>?
**Decision**: Singleton EventEmitter following `notification-events.ts:12-28` — emits `interrupt:<sessionId>`. Stream handler subscribes via `.once()`; unsubscribes in `finally`. Abstract behind `emitChatInterrupt` / `onChatInterrupt` functions.

### interrupted flag storage
**Question**: New schema column vs. existing metadata JSONB?
**Decision**: `metadata: jsonb` on `messages` table (`conversation.schema.ts:108`). Add `interrupted?: boolean` to `ChatMessageMeta` in `database.adapter.ts`. No migration.

### Server-side stream abort
**Question**: How to terminate the SSE stream from the backend (not via client disconnect)?
**Decision**: Create a secondary `streamAbortController = new AbortController()` per stream in the controller. Pass `streamAbortController.signal` to `streamChatEventsWithContext` instead of `req.signal`. When interrupt fires: `streamAbortController.abort()`. Monitor `req.signal` separately: if it fires (client disconnected), also `streamAbortController.abort()`. The `if (!req.signal.aborted)` guard at line 376 still applies.

### Queue state management
**Question**: React state vs. useRef for pending queue?
**Decision**: `useRef<QueuedMessage[]>` — prevents re-render on queue mutations; consistent with `abortControllerRef` and `skipSessionUpdateForRequestRef` patterns in `AIChatContext.tsx`.

## Phase 1: Protocol types + classifier

### Overview
Foundation phase. Adds `steer_or_queue` to the event type union, creates `ChatInterruptClassifier`, adds `interruptClassifier` model config entry, and exports from protocol index. All other phases depend on these types. Depends on: nothing.

### Changes Required:

#### 1. packages/protocol/src/chat/chat-streaming.types.ts
**File**: packages/protocol/src/chat/chat-streaming.types.ts
**Changes**: MODIFY — add `steer_or_queue` to `ChatStreamEventType`, add `SteerOrQueueEvent` interface and `createSteerOrQueueEvent` factory

```ts
// 1. In ChatStreamEventType union — change last entry from:
//      | "decision_questions";
//    to:
  | "decision_questions"
  | "steer_or_queue";

// 2. New interface — add before the ChatStreamEvent union:
/**
 * Steer-or-queue event — injected into the active SSE stream by the /chat/interrupt
 * endpoint after the classifier runs. The frontend holds the mid-stream message as
 * "pending" until this event arrives, then acts on the decision.
 */
export interface SteerOrQueueEvent extends ChatStreamEventBase {
  type: "steer_or_queue";
  /** Classifier decision: interrupt and restart, or buffer until current run completes. */
  decision: "steer" | "queue";
  /** Echoed from the interrupt request so the frontend can update the correct pending message. */
  messageId: string;
}

// 3. In ChatStreamEvent union — change last entry from:
//      | DecisionQuestionsEvent;
//    to:
  | DecisionQuestionsEvent
  | SteerOrQueueEvent;

// 4. New factory function — add after createDecisionQuestionsEvent:
export function createSteerOrQueueEvent(
  sessionId: string,
  decision: "steer" | "queue",
  messageId: string,
): SteerOrQueueEvent {
  return createStreamEvent<SteerOrQueueEvent>("steer_or_queue", sessionId, {
    decision,
    messageId,
  });
}
```

#### 2. packages/protocol/src/chat/chat.interrupt.classifier.ts
**File**: packages/protocol/src/chat/chat.interrupt.classifier.ts
**Changes**: NEW — binary steer/queue classifier following ChatTitleGenerator pattern

```ts
import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { log } from "../shared/observability/log.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

const logger = log.lib.from("ChatInterruptClassifier");

const SYSTEM_PROMPT = `You decide whether a new user message sent during an active AI process should STEER or QUEUE.

Rules:
- Reply with ONLY one word: steer or queue (lowercase).
- STEER: the message redirects, corrects, stops, contradicts, or changes what the AI is doing. Keywords: "wait", "stop", "actually", "ignore that", "instead", "no", "cancel".
- QUEUE: the message adds context, asks a follow-up, or complements what the AI is doing. Keywords: "also", "and", "when done", "additionally", "plus".
- When ambiguous, default to steer.`;

export interface ClassifyInterruptInput {
  /** The new user message sent while the agent is running. */
  message: string;
  /**
   * Current agent activity summary derived from the last few SSE trace event names
   * (e.g. "tool_start: discover_opportunities, graph_start: opportunity").
   */
  agentState: string;
}

/**
 * Binary classifier that decides whether a mid-stream user message should steer
 * (interrupt the current run) or queue (buffer until the run completes).
 * Uses a low-temperature, minimal-token model for sub-1 s latency.
 */
export class ChatInterruptClassifier {
  private model: ChatOpenAI;

  constructor() {
    this.model = createModel("interruptClassifier");
  }

  /**
   * Classify a mid-stream interrupt as steer or queue.
   *
   * @param input - The new message and current agent state context
   * @returns "steer" to interrupt the current run; "queue" to buffer
   */
  @Timed()
  async classify(input: ClassifyInterruptInput): Promise<"steer" | "queue"> {
    const { message, agentState } = input;

    try {
      const response = await invokeWithAbortSignal(this.model, [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(
          `Current agent activity: ${agentState || "idle"}\n\nNew user message: "${message.slice(0, 500)}"\n\nDecision:`,
        ),
      ]);

      const text =
        typeof response.content === "string"
          ? response.content.trim().toLowerCase()
          : String(response.content ?? "").trim().toLowerCase();

      if (text.startsWith("queue")) return "queue";
      // Default to steer on any ambiguity or unexpected output
      return "steer";
    } catch (error) {
      logger.warn("[ChatInterruptClassifier.classify] Classification failed, defaulting to steer", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "steer";
    }
  }
}
```

#### 3. packages/protocol/src/shared/agent/model.config.ts
**File**: packages/protocol/src/shared/agent/model.config.ts
**Changes**: MODIFY — add `interruptClassifier` to getModelConfig()

```ts
// Add after userContextGenerator entry (line ~55), before the closing `} as const`:
    interruptClassifier: { model: "google/gemini-2.5-flash", temperature: 0.0, maxTokens: 16 },
```

#### 4. packages/protocol/src/index.ts
**File**: packages/protocol/src/index.ts
**Changes**: MODIFY — export ChatInterruptClassifier alongside ChatTitleGenerator

```ts
// Add after line 182 (ChatTitleGenerator export):
export { ChatInterruptClassifier } from "./chat/chat.interrupt.classifier.js";
export type { ClassifyInterruptInput } from "./chat/chat.interrupt.classifier.js";
```

### Success Criteria:

#### Automated Verification:
- [x] `cd packages/protocol && bun run build` exits 0 (TypeScript compiles with new types + classifier)
- [x] `grep -r "steer_or_queue" packages/protocol/src/ | wc -l` returns >= 4 (3 literal + 1 interface reference; build passes)
- [x] `grep "interruptClassifier" packages/protocol/src/shared/agent/model.config.ts | wc -l` returns 1
- [x] `grep "ChatInterruptClassifier" packages/protocol/src/index.ts | wc -l` returns 1

#### Manual Verification:
- [ ] `ChatInterruptClassifier` can be imported from `@indexnetwork/protocol` in the backend without TypeScript errors
- [ ] `classify({ message: "wait stop that", agentState: "tool_start: discover" })` returns `"steer"`
- [ ] `classify({ message: "also make sure to include X", agentState: "graph_start: chat" })` returns `"queue"`

---

## Phase 2: Backend interrupt bus + streamer runId

### Overview
Infrastructure phase. Creates the per-session EventEmitter interrupt bus and updates the streamer to use composite `thread_id: sessionId:runId`. Depends on: Phase 1.

### Changes Required:

#### 1. backend/src/lib/chat-interrupt.events.ts
**File**: backend/src/lib/chat-interrupt.events.ts
**Changes**: NEW — singleton EventEmitter with emitChatInterrupt/onChatInterrupt following notification-events.ts pattern

```ts
import { EventEmitter } from 'events';

/**
 * Payload emitted when a /chat/interrupt request resolves a steer-or-queue decision.
 */
export interface ChatInterruptPayload {
  decision: 'steer' | 'queue';
  messageId: string;
}

/**
 * Singleton event emitter for per-session chat interrupt signals.
 * A running /chat/stream handler subscribes once per session; the /chat/interrupt
 * handler emits when the classifier has resolved.
 *
 * Multi-instance note: this is in-memory only. A Redis pub/sub upgrade
 * would swap this module while preserving the emitChatInterrupt/onChatInterrupt API.
 */
const chatInterruptEmitter = new EventEmitter();
chatInterruptEmitter.setMaxListeners(200);

/**
 * Emit an interrupt decision to any active stream handler for the given session.
 *
 * @param sessionId - The chat session that received the interrupt
 * @param payload - The classifier decision and message ID
 */
export function emitChatInterrupt(sessionId: string, payload: ChatInterruptPayload): void {
  chatInterruptEmitter.emit(`interrupt:${sessionId}`, payload);
}

/**
 * Subscribe to a single interrupt event for a session.
 * Uses `.once()` — each stream handles at most one interrupt per run.
 * Returns an unsubscribe function to be called in the stream's finally block.
 *
 * @param sessionId - The chat session to subscribe to
 * @param handler - Called when the interrupt is resolved
 * @returns Unsubscribe function
 */
export function onChatInterrupt(
  sessionId: string,
  handler: (payload: ChatInterruptPayload) => void,
): () => void {
  chatInterruptEmitter.once(`interrupt:${sessionId}`, handler);
  return () => chatInterruptEmitter.off(`interrupt:${sessionId}`, handler);
}
```

#### 2. packages/protocol/src/chat/chat.streamer.ts:71-80,159-165
**File**: packages/protocol/src/chat/chat.streamer.ts
**Changes**: MODIFY — add `runId?` to `streamChatEventsWithContext` input, add `threadId?` param to `streamChatEvents`, use `thread_id: threadId ?? sessionId`

```ts
// Change 1: streamChatEventsWithContext input type (line ~71) — add runId:
  public async *streamChatEventsWithContext(
    input: {
      userId: string;
      message: string;
      sessionId: string;
      maxContextMessages?: number;
      networkId?: string;
      prefillMessages?: Array<{ role: "assistant" | "user"; content: string }>;
      /** Per-run identifier used to form a composite LangGraph thread_id (sessionId:runId).
       * When provided, prevents stale checkpoint state from a prior run being resumed.
       * Defaults to sessionId alone when absent (backward compatible). */
      runId?: string;
    },
    checkpointer?: BaseCheckpointSaver,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent>

// Change 2: streamChatEventsWithContext body — pass runId-derived threadId to streamChatEvents.
// After destructuring `networkId` from input, add:
      const threadId = runId ? `${sessionId}:${runId}` : sessionId;
// And update the streamChatEvents call from:
//      yield* this.streamChatEvents(
//        { userId, messages: allMessages, networkId },
//        sessionId,
//        checkpointer,
//        signal,
//      );
// to:
      yield* this.streamChatEvents(
        { userId, messages: allMessages, networkId },
        sessionId,
        checkpointer,
        signal,
        threadId,
      );

// Change 3: streamChatEvents signature (line ~155) — add optional threadId param:
  public async *streamChatEvents(
    input: { userId: string; messages: BaseMessage[]; networkId?: string },
    sessionId: string,
    checkpointer?: BaseCheckpointSaver,
    signal?: AbortSignal,
    threadId?: string,
  ): AsyncGenerator<ChatStreamEvent>

// Change 4: graph.stream() configurable (line ~180) — use threadId:
      configurable: { thread_id: threadId ?? sessionId, signal },
```

### Success Criteria:

#### Automated Verification:
- [x] `cd packages/protocol && bun run build` exits 0 (no TypeScript errors from streamer changes)
- [x] `grep "threadId ?? sessionId" packages/protocol/src/chat/chat.streamer.ts | wc -l` returns 1
- [x] `grep "emitChatInterrupt\|onChatInterrupt" backend/src/lib/chat-interrupt.events.ts | wc -l` returns 2
- [x] `grep "setMaxListeners" backend/src/lib/chat-interrupt.events.ts` returns 1 line (200)

#### Manual Verification:
- [ ] `onChatInterrupt` and `emitChatInterrupt` can be imported in `backend/src/controllers/chat.controller.ts` without errors
- [ ] Passing `runId: 'test-run'` to `streamChatEventsWithContext` results in `thread_id: 'sessionId:test-run'` in LangGraph config
- [ ] Omitting `runId` falls back to `thread_id: sessionId` (backward compatible)

---

## Phase 3: Backend persistence + interrupt endpoint

### Overview
Backend wiring phase. Adds `steer_or_queue` to the backend local types copy, adds `interrupted` flag to message persistence, wires the interrupt bus into the stream closure (including `streamAbortController`), and adds the `POST /chat/interrupt` endpoint. Depends on: Phases 1 + 2.

### Changes Required:

#### 1. backend/src/types/chat-streaming.types.ts
**File**: backend/src/types/chat-streaming.types.ts
**Changes**: MODIFY — add `steer_or_queue` to local ChatStreamEventType union, SteerOrQueueEvent interface, union, and factory (mirrors Phase 1 additions to packages/protocol)

```ts
// 1. In ChatStreamEventType union — change last entry:
  | "decision_questions"
  | "steer_or_queue";

// 2. New interface (add before ChatStreamEvent union):
/**
 * Steer-or-queue event — injected by /chat/interrupt onto the active SSE stream.
 */
export interface SteerOrQueueEvent extends ChatStreamEventBase {
  type: "steer_or_queue";
  decision: "steer" | "queue";
  messageId: string;
}

// 3. In ChatStreamEvent union — change last entry:
  | DecisionQuestionsEvent
  | SteerOrQueueEvent;

// 4. New factory (add at end of file):
export function createSteerOrQueueEvent(
  sessionId: string,
  decision: "steer" | "queue",
  messageId: string,
): SteerOrQueueEvent {
  return createStreamEvent<SteerOrQueueEvent>("steer_or_queue", sessionId, {
    decision,
    messageId,
  });
}
```

#### 2. backend/src/adapters/database.adapter.ts:783-818
**File**: backend/src/adapters/database.adapter.ts
**Changes**: MODIFY — add `interrupted?: boolean` to `ChatMessageMeta` + `CreateMessageInput`, pass through in `createChatMessage`

```ts
// In ChatMessageMeta interface (after streamingDrafts field):
  /** Set to true when the assistant message was partially generated before a steer interrupt. */
  interrupted?: boolean;

// In CreateMessageInput interface (after tokenCount field):
  interrupted?: boolean;

// In createChatMessage method, after `if (data.tokenCount !== undefined) msgMeta.tokenCount = ...`:
    if (data.interrupted) msgMeta.interrupted = true;
```

#### 3. backend/src/services/chat.service.ts:156
**File**: backend/src/services/chat.service.ts
**Changes**: MODIFY — add `interrupted?: boolean` to `addMessage` params and pass to `createChatMessage`

```ts
// In addMessage params object (after tokenCount):
  interrupted?: boolean;

// In the createChatMessage call (after tokenCount):
      interrupted: params.interrupted,
```

#### 4. backend/src/controllers/chat.controller.ts
**File**: backend/src/controllers/chat.controller.ts
**Changes**: MODIFY — runId generation, streamAbortController, interrupt bus, steer persistence, new /interrupt endpoint

```ts
// === NEW IMPORTS (add to existing import block at top of file) ===
import { ChatInterruptClassifier } from '@indexnetwork/protocol';
import { emitChatInterrupt, onChatInterrupt } from '../lib/chat-interrupt.events';
import { createSteerOrQueueEvent } from '../types/chat-streaming.types';

// === NEW CONSTANTS (add after existing schemas/lazy getters) ===
const interruptBodySchema = z.object({
  sessionId: z.string(),
  message: z.string().min(1),
  messageId: z.string().uuid(),
  traceSnapshot: z.array(z.string()).max(20).default([]),
});

let interruptClassifierInstance: ChatInterruptClassifier | null = null;
function getInterruptClassifier(): ChatInterruptClassifier {
  if (!interruptClassifierInstance) {
    interruptClassifierInstance = new ChatInterruptClassifier();
  }
  return interruptClassifierInstance;
}

// === CHANGES TO messageStream() — add after `const sessionId = currentSessionId;` ===
    const runId = crypto.randomUUID();
    const streamAbortController = new AbortController();
    // Forward HTTP client disconnect to stream abort controller
    req.signal.addEventListener('abort', () => {
      if (!streamAbortController.signal.aborted) streamAbortController.abort('client_disconnect');
    }, { once: true });

// === CHANGES TO ReadableStream.start(controller) — add BEFORE the try block ===
    let streamInterruptedBySteer = false;
    const unsubscribeInterrupt = onChatInterrupt(sessionId, ({ decision, messageId }) => {
      try {
        controller.enqueue(
          encoder.encode(
            formatSSEEvent(createSteerOrQueueEvent(sessionId, decision, messageId)),
          ),
        );
      } catch {
        // Stream may have already closed
      }
      if (decision === 'steer') {
        streamInterruptedBySteer = true;
        streamAbortController.abort('steer');
      }
    });

// === IN factory.streamChatEventsWithContext call — add runId to input, change signal ===
          for await (const event of factory.streamChatEventsWithContext(
            {
              userId: user.id,
              message: messageContent,
              sessionId,
              maxContextMessages: 20,
              networkId: networkIdForStream,
              prefillMessages: body.prefillMessages,
              runId,                      // NEW: composite thread_id
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            checkpointer as any,
            streamAbortController.signal, // was: req.signal
          )) {
            if (streamInterruptedBySteer) break; // Exit cleanly on steer
            if (event) {
              // ... existing event handling unchanged ...
            }
          }

// === AFTER the for-await loop, BEFORE existing persistence code ===
          // Steer-interrupted: persist partial turn and bail (no done event)
          if (streamInterruptedBySteer) {
            try {
              await chatSessionService.addMessage({ sessionId, role: 'user', content: messageContent });
              if (fullResponse.trim()) {
                await chatSessionService.addMessage({
                  sessionId,
                  role: 'assistant',
                  content: fullResponse,
                  interrupted: true,
                });
              }
              refetchSessions?.(); // no-op for backend, just title
            } catch (persistErr) {
              logger.error('Failed to persist interrupted turn', { sessionId, error: persistErr });
            }
            return; // finally still runs
          }

// === Change `if (!req.signal.aborted)` guard (line ~376) ===
          if (!req.signal.aborted && !streamAbortController.signal.aborted) {
            // ... existing title/suggestions/done event unchanged ...
          }

// === In the finally block (after controller.close()) ===
          unsubscribeInterrupt(); // Always clean up listener

// === NEW POST /interrupt ENDPOINT (add as a new method on ChatController) ===
  @Post("/interrupt")
  @UseGuards(RateLimit('write'), AuthGuard)
  async interrupt(req: Request, user: AuthenticatedUser): Promise<Response> {
    let body: z.infer<typeof interruptBodySchema>;
    try {
      const raw = await req.json();
      const parsed = interruptBodySchema.safeParse(raw);
      if (!parsed.success) {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }
      body = parsed.data;
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { sessionId, message, messageId, traceSnapshot } = body;

    const session = await chatSessionService.getSession(sessionId, user.id);
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const agentState = traceSnapshot.slice(-5).join(', ');
    const classifier = getInterruptClassifier();
    const decision = await classifier.classify({ message, agentState });

    // Emit to any active stream handler for this session
    emitChatInterrupt(sessionId, { decision, messageId });

    return Response.json({ decision, messageId });
  }
```

### Success Criteria:

#### Automated Verification:
- [x] `bun run lint` in `backend/` exits 0
- [x] `grep "steer_or_queue" backend/src/types/chat-streaming.types.ts | wc -l` returns >= 3
- [x] `grep "interrupted" backend/src/adapters/database.adapter.ts | wc -l` returns >= 3
- [x] `grep 'POST.*interrupt\|@Post.*interrupt' backend/src/controllers/chat.controller.ts | wc -l` returns 1
- [x] `grep "streamInterruptedBySteer" backend/src/controllers/chat.controller.ts | wc -l` returns >= 3 (got 4)
- [x] `grep "unsubscribeInterrupt" backend/src/controllers/chat.controller.ts | wc -l` returns >= 2 (got 4)

#### Manual Verification:
- [ ] `POST /api/chat/interrupt` with valid sessionId + message returns `{ decision: 'steer' | 'queue', messageId }`
- [ ] `POST /api/chat/interrupt` with invalid sessionId returns 404
- [ ] With an active stream running, sending an interrupt emits `steer_or_queue` SSE event on the stream
- [ ] After steer: session reload shows the interrupted partial assistant message with `interrupted: true` in metadata
- [ ] After steer: no error SSE event is sent to the frontend (only the `steer_or_queue` event)

---

## Phase 4: Frontend AIChatContext queue + steer logic

### Overview
Frontend logic phase. Adds `QueuedMessage` type, pending/queued state to `ChatMessage`, the `steer_or_queue` SSE case, mid-stream submit flow, and queue drain in `finally`. Depends on: Phase 3 (consumes `steer_or_queue` SSE event).

### Changes Required:

#### 1. frontend/src/contexts/AIChatContext.tsx
**File**: frontend/src/contexts/AIChatContext.tsx
**Changes**: MODIFY — QueuedMessage type, ChatMessage additions, refs + state, cancelQueuedMessage, submitMidStreamMessage, steer_or_queue SSE case, queue drain in finally, loadSession wasInterrupted mapping

```ts
// === NEW EXPORTED TYPE (add before ChatMessage interface) ===
export interface QueuedMessage {
  id: string;
  message: string;
  fileIds?: string[];
  attachmentNames?: string[];
  status: 'pending' | 'queued';
}

// === ChatMessage ADDITIONS (after decisionQuestionsSubmitted) ===
  isPending?: boolean;
  isQueued?: boolean;
  wasInterrupted?: boolean;

// === AIChatContextType ADDITIONS ===
  pendingQueue: QueuedMessage[];
  cancelQueuedMessage: (id: string) => void;
  submitMidStreamMessage: (message: string, traceEvents: TraceEvent[], fileIds?: string[], attachmentNames?: string[]) => void;

// === NEW REFS + STATE (add after abortControllerRef declaration) ===
  const pendingQueueRef = useRef<QueuedMessage[]>([]);
  const steerPendingRef = useRef<{ message: string; fileIds?: string[]; attachmentNames?: string[] } | null>(null);
  const interruptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingQueue, setPendingQueue] = useState<QueuedMessage[]>([]);

// === cancelQueuedMessage useCallback (add before sendMessage) ===
  const cancelQueuedMessage = useCallback((id: string) => {
    if (interruptTimeoutRef.current) clearTimeout(interruptTimeoutRef.current);
    pendingQueueRef.current = pendingQueueRef.current.filter((q) => q.id !== id);
    setPendingQueue([...pendingQueueRef.current]);
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
  }, []);

// === submitMidStreamMessage useCallback (add before sendMessage) ===
  const submitMidStreamMessage = useCallback(
    (message: string, traceEvents: TraceEvent[], fileIds?: string[], attachmentNames?: string[]) => {
      if (!sessionId) return;
      const pendingMsgId = crypto.randomUUID();
      const displayContent = message.trim() || (fileIds?.length ? 'Attached file(s).' : '');
      if (!displayContent) return;

      setMessages((prev) => [...prev, {
        id: pendingMsgId, role: 'user', content: displayContent,
        timestamp: new Date(), isPending: true,
        ...(attachmentNames?.length ? { attachmentNames } : {}),
      }]);
      const entry: QueuedMessage = { id: pendingMsgId, message, fileIds, attachmentNames, status: 'pending' };
      pendingQueueRef.current = [...pendingQueueRef.current, entry];
      setPendingQueue([...pendingQueueRef.current]);

      const agentStateNames = traceEvents
        .filter((e) => ['tool_start', 'graph_start', 'agent_start', 'phase_start'].includes(e.type))
        .slice(-5)
        .map((e) => `${e.type}: ${(e as { name?: string }).name ?? 'unknown'}`);

      // 5s fallback → steer
      const timeoutId = setTimeout(() => {
        steerPendingRef.current = { message, fileIds, attachmentNames };
        pendingQueueRef.current = pendingQueueRef.current.filter((q) => q.id !== pendingMsgId);
        setPendingQueue([...pendingQueueRef.current]);
        setMessages((prev) => prev.map((msg) => msg.id === pendingMsgId ? { ...msg, isPending: false } : msg));
        if (abortControllerRef.current) abortControllerRef.current.abort();
      }, 5_000);
      interruptTimeoutRef.current = timeoutId;

      apiClient.post('/chat/interrupt', { sessionId, message, messageId: pendingMsgId, traceSnapshot: agentStateNames })
        .catch(() => {
          clearTimeout(timeoutId);
          steerPendingRef.current = { message, fileIds, attachmentNames };
          pendingQueueRef.current = pendingQueueRef.current.filter((q) => q.id !== pendingMsgId);
          setPendingQueue([...pendingQueueRef.current]);
          setMessages((prev) => prev.map((msg) => msg.id === pendingMsgId ? { ...msg, isPending: false } : msg));
          if (abortControllerRef.current) abortControllerRef.current.abort();
        });
    },
    [sessionId],
  );

// === NEW SSE CASE (add after "opportunity_draft_ready" case in the switch) ===
                  case "steer_or_queue": {
                    if (interruptTimeoutRef.current) { clearTimeout(interruptTimeoutRef.current); interruptTimeoutRef.current = null; }
                    const { decision, messageId: pendingId } = event as { decision: 'steer' | 'queue'; messageId: string };
                    if (decision === 'steer') {
                      const steerEntry = pendingQueueRef.current.find((q) => q.id === pendingId);
                      if (steerEntry) {
                        steerPendingRef.current = { message: steerEntry.message, fileIds: steerEntry.fileIds, attachmentNames: steerEntry.attachmentNames };
                        pendingQueueRef.current = pendingQueueRef.current.filter((q) => q.id !== pendingId);
                        setPendingQueue([...pendingQueueRef.current]);
                      }
                      setMessages((prev) => prev.map((msg) => msg.id === pendingId ? { ...msg, isPending: false, isQueued: false } : msg));
                      if (abortControllerRef.current) abortControllerRef.current.abort();
                    } else {
                      pendingQueueRef.current = pendingQueueRef.current.map((q) => q.id === pendingId ? { ...q, status: 'queued' as const } : q);
                      setPendingQueue([...pendingQueueRef.current]);
                      setMessages((prev) => prev.map((msg) => msg.id === pendingId ? { ...msg, isPending: false, isQueued: true } : msg));
                    }
                    break;
                  }

// === sendMessage finally ADDITIONS (after setIsLoading(false)) ===
        // Drain queue: steer takes priority over FIFO queue
        const steerMsg = steerPendingRef.current;
        if (steerMsg) {
          steerPendingRef.current = null;
          setTimeout(() => void sendMessage(steerMsg.message, steerMsg.fileIds, steerMsg.attachmentNames), 0);
        } else if (pendingQueueRef.current.length > 0) {
          const [nextMsg, ...rest] = pendingQueueRef.current;
          pendingQueueRef.current = rest;
          setPendingQueue(rest);
          setMessages((prev) => prev.map((msg) => msg.id === nextMsg.id ? { ...msg, isQueued: false } : msg));
          setTimeout(() => void sendMessage(nextMsg.message, nextMsg.fileIds, nextMsg.attachmentNames), 0);
        }

// === loadSession: wasInterrupted mapping (in data.messages.map) ===
// Add after decisionQuestionsSubmitted spread:
          ...((m as { metadata?: { interrupted?: boolean } }).metadata?.interrupted ? { wasInterrupted: true } : {}),

// === Context value additions ===
        pendingQueue,
        cancelQueuedMessage,
        submitMidStreamMessage,
```

#### 2. backend/src/adapters/database.adapter.ts (incremental Phase 4 addition)
**File**: backend/src/adapters/database.adapter.ts
**Changes**: MODIFY (incremental) — `interrupted?` in `ChatMessage` + extract in `getChatSessionMessages`

```ts
// In ChatMessage interface, after tokenCount:
  interrupted?: boolean | null;

// In getChatSessionMessages row map, after tokenCount extraction:
      interrupted: meta.interrupted ?? null,
```

### Success Criteria:

#### Automated Verification:
- [x] `bun run lint` in `frontend/` exits 0
- [x] `grep "submitMidStreamMessage" frontend/src/contexts/AIChatContext.tsx | wc -l` returns >= 2 (got 3)
- [x] `grep 'steer_or_queue' frontend/src/contexts/AIChatContext.tsx | wc -l` returns >= 1 (got 2)
- [x] `grep "pendingQueue" frontend/src/contexts/AIChatContext.tsx | wc -l` returns >= 4 (got 20)

#### Manual Verification:
- [ ] Submitting mid-stream adds message with pending badge; `/chat/interrupt` POST is visible in network tab
- [ ] `decision: 'queue'` SSE → badge changes to queued, message appears in queue panel
- [ ] `decision: 'steer'` SSE → stream stops, new sendMessage fires after stream ends
- [ ] 5-second timeout without SSE → steer fallback fires
- [ ] After stream ends with queued message, next queued message auto-sends
- [ ] Cancelling a queued message removes it from list and queue panel
- [ ] Session reload shows `wasInterrupted: true` messages with visual marker

---

## Phase 5: Frontend UI — remove block + queue panel

### Overview
Frontend UI phase. Removes `disabled={isBusy}` from textarea and file controls (7 locations), updates `handleSubmit` to call interrupt flow mid-stream, and adds the queue panel. Depends on: Phase 4.

### Changes Required:

#### 1. frontend/src/components/ChatContent.tsx
**File**: frontend/src/components/ChatContent.tsx
**Changes**: MODIFY — remove disabled from inputs (7 sites), update handleSubmit for mid-stream routing, add queue panel, badges, wasInterrupted indicator

```ts
// === useAIChat destructure additions ===
    pendingQueue,
    cancelQueuedMessage,
    submitMidStreamMessage,

// === handleSubmit (replace lines 951-987) ===
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || isUploadingFiles) return;  // file upload blocks; stream does not

    const message = input.trim();
    setInput("");

    let fileIds: string[] = [];
    const attachmentNames: string[] = [];
    if (selectedFiles.length > 0) {
      setIsUploadingFiles(true);
      try {
        const uploaded = await Promise.all(
          selectedFiles.map(({ file }) => uploadServiceV2.uploadFile(file)),
        );
        fileIds = uploaded.map((f) => f.id);
        attachmentNames.push(...selectedFiles.map(({ file }) => file.name));
        setSelectedFiles([]);
      } catch (err) {
        console.error("[AI Chat] Upload failed:", err);
        showError(err instanceof Error ? err.message : "Failed to upload file(s)");
        setIsUploadingFiles(false);
        inputRef.current?.focus();
        return;
      }
      setIsUploadingFiles(false);
    }

    const msgContent = message || "Attached file(s).";
    const fileArg = fileIds.length ? fileIds : undefined;
    const nameArg = attachmentNames.length ? attachmentNames : undefined;

    if (isLoading) {
      // Mid-stream: route via interrupt flow
      const streamingMsg = messages.find((m) => m.isStreaming);
      submitMidStreamMessage(msgContent, streamingMsg?.traceEvents ?? [], fileArg, nameArg);
    } else {
      await sendMessage(msgContent, fileArg, nameArg);
    }
    inputRef.current?.focus();
  };

// === DISABLED REMOVAL — 7 sites: `disabled={isBusy}` → `disabled={isUploadingFiles}` ===
// Apply to lines: 1110, 1122, 1331, 1342, 1506, 1517, 1867

// === USER MESSAGE BADGE (wrap existing user bubble at line ~1678) ===
                  <div className="flex flex-col items-end gap-1">
                    {(msg.isPending || msg.isQueued) && (
                      <span className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-medium",
                        msg.isPending ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700",
                      )}>
                        {msg.isPending ? "classifying…" : "queued"}
                      </span>
                    )}
                    {/* ... existing user bubble unchanged ... */}
                  </div>

// === wasInterrupted INDICATOR (add after assistant message content block) ===
                      {msg.wasInterrupted && (
                        <p className="text-[10px] text-gray-400 mt-1 italic">— interrupted</p>
                      )}

// === QUEUE PANEL (add ABOVE {renderInputForm()} in the sticky bottom bar, ~line 1862) ===
              {pendingQueue.length > 0 && (
                <div className="flex flex-col gap-1 px-1 pt-1 pb-0">
                  {pendingQueue.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-50 border border-gray-200 text-xs"
                    >
                      <span className={cn(
                        "shrink-0 px-1.5 py-0.5 rounded-full font-medium",
                        item.status === 'pending' ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700",
                      )}>
                        {item.status === 'pending' ? 'classifying…' : 'queued'}
                      </span>
                      <span className="flex-1 truncate text-gray-600">{item.message}</span>
                      <button
                        type="button"
                        onClick={() => cancelQueuedMessage(item.id)}
                        className="shrink-0 text-gray-400 hover:text-gray-700 focus:outline-none"
                        aria-label="Cancel queued message"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {renderInputForm()}
              {/* Remove the existing standalone {renderInputForm()} line */}
```

### Success Criteria:

#### Automated Verification:
- [x] `bun run lint` in `frontend/` exits 0
- [x] `grep 'disabled={isBusy}' frontend/src/components/ChatContent.tsx | wc -l` returns 0 (got 0)
- [x] `grep 'disabled={isUploadingFiles}' frontend/src/components/ChatContent.tsx | wc -l` returns 7 (got 7)
- [x] `grep 'submitMidStreamMessage' frontend/src/components/ChatContent.tsx | wc -l` returns >= 1 (got 2)
- [x] `grep 'pendingQueue' frontend/src/components/ChatContent.tsx | wc -l` returns >= 2 (got 3)
- [x] `grep -r "steer_or_queue" packages/ backend/ frontend/ | wc -l` returns >= 6 (got 12)
- [x] `bun run db:generate` in `backend/` reports "No schema changes"

#### Manual Verification:
- [ ] Typing in the textarea is possible while a response is streaming
- [ ] Submitting mid-stream shows pending badge on the new user message
- [ ] Queue panel appears above the input form when messages are pending/queued; X dismisses
- [ ] Interrupted assistant messages show `— interrupted` label
- [ ] `bun run lint` in `frontend/` and `backend/` exits 0
- [ ] `bun run build` in `packages/protocol/` exits 0

---

## Plan Review (Step 8)

_Step 8 code review unavailable: artifact-code-reviewer returned no output (infrastructure issue — agents returning 0 tool uses in this session). Step 8 coverage review unavailable: artifact-coverage-reviewer returned no output for the same reason. Proceeded to developer review at Step 9 without automated reviewer findings._

_No findings — both reviewers produced no output._

## Ordering Constraints

- Phase 1 must come first — types and classifier are imported by all subsequent phases.
- Phase 2 depends on Phase 1 (chat-streaming.types.ts for event type).
- Phase 3 depends on Phases 1 + 2 (classifier import + interrupt bus + runId).
- Phase 4 depends on Phase 3 (steer_or_queue event type consumed from SSE).
- Phase 5 depends on Phase 4 (queue state and interrupt function from AIChatContext).
- No parallelism possible — strict sequential dependency chain.

## Verification Notes

- **4-file chain**: every new SSE event type needs coordinated changes across types → streamer/controller → frontend handler. Grep: `grep -r "steer_or_queue" packages/ backend/ frontend/` should return hits in all 4 areas.
- **EventEmitter listener leak**: `onChatInterrupt` must be unsubscribed in the stream `finally` block. Verify no listener accumulation with `chatInterruptEmitter.listenerCount('interrupt:<sessionId>')` — should be 0 after stream ends.
- **Composite thread_id**: `grep -r "thread_id" packages/protocol/src/chat/chat.streamer.ts` should show `sessionId:${runId}` not bare `sessionId`.
- **Disabled removal**: `grep -n "disabled.*isBusy" frontend/src/components/ChatContent.tsx` should return 0 results after Phase 5.
- **No migration**: `bun run db:generate` in backend/ should report "No schema changes" after all phases.
- **Protocol build**: `bun run build` in packages/protocol/ must pass after Phase 1 (ChatInterruptClassifier export added).
- **Lint**: `bun run lint` in frontend/ and backend/ must pass.

## Performance Considerations

- Classifier is on the hot path: `interruptClassifier` uses `google/gemini-2.5-flash`, temperature 0.0, maxTokens 16. Expected P95 < 1s. No streaming needed — direct `.invoke()`.
- EventEmitter listener: one listener per active stream, cleaned in finally. With `setMaxListeners(200)`, supports 200 concurrent sessions before Node warning.
- Queue drain is sequential — no concurrent sendMessage calls; the `finally` block runs after `setIsLoading(false)` ensuring clean state before next send.
- `streamAbortController` is lightweight — no additional memory overhead per stream.

## Migration Notes

No schema migration required. The `interrupted` flag is stored in the existing `metadata: jsonb` column on the `messages` table. `ChatMessageMeta` type gets a new optional `interrupted?: boolean` field that is backwards-compatible (absent on existing messages = not interrupted).

## Pattern References

- `packages/protocol/src/chat/chat.title.generator.ts:28-65` — `ChatTitleGenerator` pattern for `ChatInterruptClassifier`
- `backend/src/lib/notification-events.ts:12-28` — singleton EventEmitter pattern for `chat-interrupt.events.ts`
- `packages/protocol/src/chat/chat-streaming.types.ts` (last event entry) — pattern for new `SteerOrQueueEvent`
- `backend/src/controllers/chat.controller.ts:237-407` — stream closure structure to wire interrupt bus into
- `frontend/src/contexts/AIChatContext.tsx` — `skipSessionUpdateForRequestRef` for `useRef` queue state pattern

## Developer Context

**Q (discover: Frontend block is UI-only)**: Confirmed. `isBusy` at ChatContent.tsx:925; 7 disabled sites.
A: Confirmed.

**Q (discover: stopStream() is reusable)**: Confirmed. Steer composes: stopStream → sendMessage.
A: Confirmed.

**Q (discover: Backend work is required)**: Is this frontend-only?
A: Backend work required.

**Q (discover: Classifier decides steer vs. queue)**: Small model classifier.
A: ChatInterruptClassifier in protocol, google/gemini-2.5-flash.

**Q (interrupt bus pattern)**: EventEmitter keyed per-session.
A: chat-interrupt.events.ts following notification-events.ts.

**Q (LangGraph steer safety)**: Composite thread_id.
A: sessionId:runId for ALL runs.

**Q (classifier home)**: Protocol package, ChatTitleGenerator pattern.
A: chat.interrupt.classifier.ts in packages/protocol/src/chat/.

**Q (thread_id scope)**: All runs get composite sessionId:runId.
A: All runs.

## Plan History

- Phase 1: Protocol types + classifier — approved as generated
- Phase 2: Backend interrupt bus + streamer runId — approved as generated
- Phase 3: Backend persistence + interrupt endpoint — approved as generated
- Phase 4: Frontend AIChatContext queue + steer logic — approved as generated
- Phase 5: Frontend UI — remove block + queue panel — approved as generated

## References

- `.rpiv/artifacts/research/2026-06-10_19-16-36_non-blocking-chat-input.md`
- `.rpiv/artifacts/discover/2026-06-10_18-50-42_non-blocking-chat-input.md`
- `packages/protocol/src/chat/chat.title.generator.ts` — classifier template
- `backend/src/lib/notification-events.ts` — interrupt bus template
- `packages/protocol/src/chat/chat-streaming.types.ts` — event type template
