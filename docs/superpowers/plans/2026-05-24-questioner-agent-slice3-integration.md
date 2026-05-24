# QuestionerAgent Slice 3: REST Endpoints + Events + Discovery Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add REST endpoints for question delivery and answer submission, create the `QuestionEvents` emitter, migrate the discovery graph from inline `QuestionGenerator` to the background `QuestionerQueue`, and deprecate the old question generator files. After this slice, the discovery mode works end-to-end through the new QuestionerAgent pipeline.

**Architecture:** A `QuestionController` exposes three endpoints (`GET /api/questions`, `POST /api/questions/:id/answer`, `POST /api/questions/:id/dismiss`). `QuestionEvents` emits `onCreated` and `onAnswered` events so other services can react. The discovery graph's inline `QuestionGenerator` call is replaced with a `questionerQueue.add()` call gated by `QUESTIONER_ENABLED`. Old files are deprecated with JSDoc `@deprecated` tags.

**Tech Stack:** TypeScript, Bun.serve, BullMQ, EventEmitter, `bun:test`

**Depends on:** Slice 1 (protocol agent + schemas) and Slice 2 (DB table + adapter + queue)

---

### Task 1: Create QuestionEvents emitter

**Files:**
- Create: `backend/src/events/question.event.ts`

- [ ] **Step 1: Implement the event emitter**

Create `backend/src/events/question.event.ts` following the pattern in existing event files (e.g. `backend/src/events/intent.event.ts`). The emitter should define:

```typescript
interface QuestionCreatedPayload {
  questionId: string;
  userId: string;
  mode: string;
  sourceType: string;
  sourceId: string;
}

interface QuestionAnsweredPayload {
  questionId: string;
  userId: string;
  mode: string;
  sourceType: string;
  sourceId: string;
  answer: QuestionAnswer;
}
```

And expose `QuestionEvents.onCreated(payload)` and `QuestionEvents.onAnswered(payload)` following the existing event pattern.

- [ ] **Step 2: Commit**

```bash
git add backend/src/events/question.event.ts
git commit -m "feat(backend): add QuestionEvents emitter for created and answered lifecycle"
```

---

### Task 2: Wire events into QuestionerQueue worker and adapter

**Files:**
- Modify: `backend/src/queues/questioner.queue.ts`
- Modify: `backend/src/adapters/questioner.adapter.ts`

- [ ] **Step 1: Emit `onCreated` in the queue worker after persist**

In `questioner.queue.ts`, after the worker calls `adapter.persist(questions)`, iterate the persisted questions and emit `QuestionEvents.onCreated(...)` for each one.

- [ ] **Step 2: Emit `onAnswered` in the adapter after answering**

In `questioner.adapter.ts`, after updating the question status to `answered`, fetch the row to get the detection fields and emit `QuestionEvents.onAnswered(...)`.

- [ ] **Step 3: Verify build**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/queues/questioner.queue.ts backend/src/adapters/questioner.adapter.ts
git commit -m "feat(backend): emit QuestionEvents on question creation and answer"
```

---

### Task 3: Create QuestionController with REST endpoints

**Files:**
- Create: `backend/src/controllers/question.controller.ts`

Consult `backend/src/controllers/controller.template.md` before implementing.

- [ ] **Step 1: Implement the controller**

Create `backend/src/controllers/question.controller.ts` following the controller template. The controller should define three endpoints:

1. `GET /api/questions` — requires auth. Query params: `status` (default `pending`), optional `mode`, `sourceType`, `sourceId`. Calls `adapter.findPending(userId, filters)` and returns the list.

2. `POST /api/questions/:id/answer` — requires auth. Body: `{ selectedOptions: string[], freeText?: string }`. Builds a `QuestionAnswer` with `answeredBy: userId` and `answeredAt: new Date().toISOString()`, calls `adapter.answer(id, answer)`.

3. `POST /api/questions/:id/dismiss` — requires auth. Calls `adapter.dismiss(id)`.

Apply `@UseGuards(RateLimit('read'), AuthGuard)` on GET, `@UseGuards(RateLimit('write'), AuthGuard)` on POST.

- [ ] **Step 2: Register the controller**

Register the new controller in the route registry (follow the pattern of other controllers in the codebase).

- [ ] **Step 3: Verify build**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/question.controller.ts
git commit -m "feat(backend): add QuestionController with list, answer, dismiss endpoints"
```

---

### Task 4: Migrate discovery graph from inline QuestionGenerator to QuestionerQueue

**Files:**
- Modify: Discovery graph call site (likely `backend/src/` — find where `QuestionGenerator` or `questionGenerator` is instantiated/called in the discovery flow)

- [ ] **Step 1: Identify the call site**

Search for where `QuestionGenerator` is instantiated or `questionGenerator.generate()` is called in the discovery flow. This is likely in `backend/src/services/` or in the graph invocation in a controller/service.

- [ ] **Step 2: Replace inline call with queue enqueue**

At the identified call site:
1. Check `process.env.QUESTIONER_ENABLED === "true"` (the env gate).
2. If enabled, build a `QuestionerInput` with `mode: "discovery"`, the user ID, source type/ID, and the `DiscoveryContext` (which is the same `DiscoveryQuestionInput` the old generator used).
3. Enqueue the job on `QuestionerQueue`.
4. Remove the inline `QuestionGenerator` instantiation and the `await questionGenerator.generate(...)` call.
5. The `decision_questions` stream event emission stays — but it will now be triggered by the queue worker completion (or by the frontend polling pending questions) rather than inline.

- [ ] **Step 3: Update any protocol-init wiring**

If the `QuestionGeneratorReader` was being injected into `ProtocolDeps` at the composition root, it can remain for now (backward compatibility). The discovery preset inside `QuestionerAgent` uses the prompt/builder directly, not the injected interface.

- [ ] **Step 4: Run existing discovery tests**

Run: `cd backend && bun test tests/` (target the discovery-related test files)
Expected: Tests pass (or need minor updates to reflect the async queue pattern).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(backend): migrate discovery question generation to QuestionerQueue"
```

---

### Task 5: Deprecate old QuestionGenerator files

**Files:**
- Modify: `packages/protocol/src/opportunity/question.generator.ts`
- Modify: `packages/protocol/src/opportunity/question.prompt.ts`
- Modify: `packages/protocol/src/opportunity/discovery-question.helper.ts`
- Modify: `packages/protocol/src/shared/interfaces/question-generator.interface.ts`

- [ ] **Step 1: Add `@deprecated` JSDoc tags**

Add `@deprecated Use QuestionerAgent instead. Will be removed in a future version.` to:
- The `QuestionGenerator` class in `question.generator.ts`
- The `SYSTEM_PROMPT` export and `buildQuestionPrompt` function in `question.prompt.ts`
- The `buildDiscoveryQuestionInput` function in `discovery-question.helper.ts`
- The `QuestionGeneratorReader` interface in `question-generator.interface.ts`

Do NOT delete the files — they may still be imported by other consumers. Deprecation allows a graceful migration.

- [ ] **Step 2: Verify build**

Run: `cd packages/protocol && bun run build`
Expected: Clean build with deprecation warnings (if TSConfig has `noUnusedLocals`).

- [ ] **Step 3: Run all existing question tests to confirm no regressions**

Run: `cd packages/protocol && bun test src/opportunity/tests/question.generator.spec.ts src/opportunity/tests/question.prompt.spec.ts src/opportunity/tests/discovery-question.helper.spec.ts`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/opportunity/question.generator.ts packages/protocol/src/opportunity/question.prompt.ts packages/protocol/src/opportunity/discovery-question.helper.ts packages/protocol/src/shared/interfaces/question-generator.interface.ts
git commit -m "chore(protocol): deprecate QuestionGenerator in favor of QuestionerAgent"
```
