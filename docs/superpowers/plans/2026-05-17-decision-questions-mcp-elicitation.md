# Decision-questions MCP elicitation — Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the `discover_opportunities` MCP tool returns a non-empty `questions[]`, append a structured JSON envelope to the tool result content (always), then if the client declared `elicitation` capability dispatch 1–3 sequential `elicitation/create` requests. Accepted responses are flattened and posted into the user's most-recent index.network chat session as a user message.

**Architecture:** Question generation is already wired (Slice 3) but currently gated to `context.sessionId`-only — Slice 5 loosens that to also enable for `context.isMcp`. A new `ChatMessageWriter` interface lets the protocol layer post a user message into the most-recent chat session without depending on backend services. `mcp.server.ts` is extended with a post-result hook that (a) appends the JSON envelope when `questions[]` is present, (b) detects elicitation capability via the captured `McpServer.server.getClientCapabilities()`, (c) dispatches `ctx.mcpReq.elicitInput(...)` sequentially per question, (d) on `accept` posts the flattened answer via `ChatMessageWriter`. `buildElicitationCreate(question)` and `flattenChoice(question, choice)` are pure helpers that live in `packages/protocol/src/mcp/`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/server@^2.0.0-alpha.2`, Bun runtime, Vitest-compatible `bun test`, Drizzle ORM (only via existing chat.service.addMessage call through the new adapter).

---

## Scope check

The spec is one tightly-coupled subsystem (MCP elicitation flow for one tool). One plan covers it.

---

## File map

**New protocol files:**
- `packages/protocol/src/shared/interfaces/chat-message-writer.interface.ts` — `ChatMessageWriter` interface
- `packages/protocol/src/mcp/elicitation.builder.ts` — pure `buildElicitationCreate(question)` + `flattenChoice(question, choice)` helpers
- `packages/protocol/src/mcp/elicitation.dispatcher.ts` — `dispatchElicitations` orchestration (capability check, sequential loop, accept-post)
- `packages/protocol/src/mcp/tests/elicitation.builder.spec.ts`
- `packages/protocol/src/mcp/tests/elicitation.dispatcher.spec.ts`

**Modified protocol files:**
- `packages/protocol/src/opportunity/opportunity.tools.ts:891` — loosen the `enableQuestions` gate to also fire when `context.isMcp`
- `packages/protocol/src/mcp/mcp.server.ts` — capture `McpServer.server` ref; in tool handler post-process the result for `discover_opportunities`: parse `questions[]`, append JSON envelope content block, dispatch elicitations
- `packages/protocol/src/shared/agent/tool.helpers.ts` — extend `ToolDeps` with optional `chatMessageWriter?: ChatMessageWriter`
- `packages/protocol/src/index.ts` — export `ChatMessageWriter` and the new helpers
- `packages/protocol/src/mcp/tests/mcp.server.spec.ts` — extend with envelope + elicitation behavior tests

**New backend files:**
- `backend/src/adapters/chat-message-writer.adapter.ts` — implements `ChatMessageWriter` using existing `ChatSessionService` (finds most-recent session via `listUserChatSessions` / `getUserChatSessions`; if none, returns `null`)
- `backend/src/adapters/tests/chat-message-writer.adapter.test.ts`

**Modified backend files:**
- `backend/src/controllers/mcp.controller.ts` — wire `ChatMessageWriterAdapter` into the `ProtocolDeps` / `ToolDeps` assembled at the composition root
- `backend/src/controllers/tests/mcp.handler.elicitation.spec.ts` — controller-level integration test (mocked MCP session records dispatched elicitations and feeds scripted replies; asserts envelope + posts + accept/decline/cancel semantics)

---

## Open assumption (surfaced in plan, decided by user prior)

**"Post into chat session" target:** the user's most-recently-updated chat session for `userId`. If they have no session, `ChatMessageWriter.addUserMessage` returns `null` and we **skip the post but still keep the JSON envelope on the tool result** — the LLM still sees the answer through that channel. No new session is created.

---

## Task 1: `ChatMessageWriter` interface (protocol)

**Files:**
- Create: `packages/protocol/src/shared/interfaces/chat-message-writer.interface.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Write the interface**

```ts
// packages/protocol/src/shared/interfaces/chat-message-writer.interface.ts

/**
 * Protocol-side contract for inserting a user message into the user's
 * most-recently-active chat session. The backend implementation finds
 * the session and persists the message via the existing chat-message
 * insertion path.
 */
export interface ChatMessageWriter {
  /**
   * Insert a user message into the user's most-recent chat session.
   *
   * @param userId - The owning user
   * @param content - The flattened user-message text
   * @returns The sessionId written to, or `null` if the user has no chat session
   */
  addUserMessage(
    userId: string,
    content: string,
  ): Promise<{ sessionId: string } | null>;
}
```

- [ ] **Step 2: Export from protocol public API**

In `packages/protocol/src/index.ts`, find the `// ─── Interfaces` section comment block and add:

```ts
export type { ChatMessageWriter } from "./shared/interfaces/chat-message-writer.interface.js";
```

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/shared/interfaces/chat-message-writer.interface.ts \
        packages/protocol/src/index.ts
git -c commit.gpgsign=false commit -m "feat(protocol): add ChatMessageWriter interface"
```

---

## Task 2: `buildElicitationCreate` + `flattenChoice` pure helpers (TDD)

**Files:**
- Create: `packages/protocol/src/mcp/elicitation.builder.ts`
- Test: `packages/protocol/src/mcp/tests/elicitation.builder.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/src/mcp/tests/elicitation.builder.spec.ts
import { describe, it, expect } from "bun:test";
import { buildElicitationCreate, flattenChoice } from "../elicitation.builder.js";
import type { Question } from "../../shared/schemas/question.schema.js";

const stageQ: Question = {
  title: "Stage",
  prompt: "Are you pre- or post-revenue?",
  options: [
    { label: "Pre-revenue (Recommended)", description: "No paying customers yet." },
    { label: "Post-revenue", description: "At least one paying customer." },
  ],
  multiSelect: false,
};

const priorityQ: Question = {
  title: "Priority",
  prompt: "Which traits matter most?",
  options: [
    { label: "Technical depth", description: "Engineering chops." },
    { label: "Domain expertise", description: "Industry context." },
  ],
  multiSelect: true,
};

describe("buildElicitationCreate", () => {
  it("emits a string enum schema for single-select questions", () => {
    const out = buildElicitationCreate(stageQ);
    expect(out.message).toBe("Stage: Are you pre- or post-revenue?");
    expect(out.requestedSchema).toEqual({
      type: "object",
      properties: {
        choice: {
          type: "string",
          enum: ["Pre-revenue (Recommended)", "Post-revenue"],
          description:
            "Pre-revenue (Recommended): No paying customers yet. | Post-revenue: At least one paying customer.",
        },
      },
      required: ["choice"],
    });
  });

  it("emits an array-of-enum schema for multi-select questions", () => {
    const out = buildElicitationCreate(priorityQ);
    expect(out.requestedSchema).toEqual({
      type: "object",
      properties: {
        choice: {
          type: "array",
          items: { type: "string", enum: ["Technical depth", "Domain expertise"] },
          description: "Technical depth: Engineering chops. | Domain expertise: Industry context.",
        },
      },
      required: ["choice"],
    });
  });
});

describe("flattenChoice", () => {
  it("formats a single-select string choice as `Title (prompt): Label`", () => {
    expect(flattenChoice(stageQ, "Pre-revenue (Recommended)")).toBe(
      "Stage (Are you pre- or post-revenue?): Pre-revenue (Recommended)",
    );
  });

  it("formats a multi-select array choice with comma-joined labels", () => {
    expect(flattenChoice(priorityQ, ["Technical depth", "Domain expertise"])).toBe(
      "Priority (Which traits matter most?): Technical depth, Domain expertise",
    );
  });

  it("returns null for an empty array choice (treat as unanswered)", () => {
    expect(flattenChoice(priorityQ, [])).toBeNull();
  });

  it("returns null for an undefined/missing choice", () => {
    expect(flattenChoice(stageQ, undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/protocol && bun test src/mcp/tests/elicitation.builder.spec.ts
```

Expected: FAIL with "Cannot find module '../elicitation.builder.js'".

- [ ] **Step 3: Write the helpers**

```ts
// packages/protocol/src/mcp/elicitation.builder.ts
import type { Question } from "../shared/schemas/question.schema.js";

/**
 * Translates a Question into an MCP `elicitation/create` request payload.
 * The schema has one property named `choice` — a string-with-enum for
 * single-select, an array-of-enum-strings for multi-select.
 *
 * Per-option `description` text is packed into the property `description`
 * joined by ` | ` (MCP `requestedSchema` has no slot for per-option
 * descriptions; this is the spec's accepted lossy mapping).
 */
export function buildElicitationCreate(q: Question): {
  message: string;
  requestedSchema: {
    type: "object";
    properties: { choice: ChoiceSchema };
    required: ["choice"];
  };
} {
  const propertyDescription = q.options
    .map((opt) => `${opt.label}: ${opt.description}`)
    .join(" | ");

  const labels = q.options.map((o) => o.label);

  const choiceSchema: ChoiceSchema = q.multiSelect
    ? {
        type: "array",
        items: { type: "string", enum: labels },
        description: propertyDescription,
      }
    : {
        type: "string",
        enum: labels,
        description: propertyDescription,
      };

  return {
    message: `${q.title}: ${q.prompt}`,
    requestedSchema: {
      type: "object",
      properties: { choice: choiceSchema },
      required: ["choice"],
    },
  };
}

type ChoiceSchema =
  | { type: "string"; enum: string[]; description: string }
  | {
      type: "array";
      items: { type: "string"; enum: string[] };
      description: string;
    };

/**
 * Flattens an accepted elicitation `choice` value into the user-message
 * format Slice 4 produces. Returns `null` when the choice is missing,
 * undefined, or an empty array (treat as unanswered — do not post).
 */
export function flattenChoice(
  q: Question,
  choice: unknown,
): string | null {
  const prefix = `${q.title} (${q.prompt})`;

  if (Array.isArray(choice)) {
    if (choice.length === 0) return null;
    return `${prefix}: ${choice.join(", ")}`;
  }
  if (typeof choice === "string" && choice.length > 0) {
    return `${prefix}: ${choice}`;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/protocol && bun test src/mcp/tests/elicitation.builder.spec.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Export from public API**

In `packages/protocol/src/index.ts`, find the section that re-exports MCP-related symbols (search for `mcp.server`); add:

```ts
export { buildElicitationCreate, flattenChoice } from "./mcp/elicitation.builder.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/mcp/elicitation.builder.ts \
        packages/protocol/src/mcp/tests/elicitation.builder.spec.ts \
        packages/protocol/src/index.ts
git -c commit.gpgsign=false commit -m "feat(protocol): add MCP elicitation builder + flattener"
```

---

## Task 3: `dispatchElicitations` orchestration (TDD)

**Files:**
- Create: `packages/protocol/src/mcp/elicitation.dispatcher.ts`
- Test: `packages/protocol/src/mcp/tests/elicitation.dispatcher.spec.ts`

Sequential loop with the spec's full state machine: capability check (caller's job to gate; this function takes a flag), per-question elicitInput, accept→post via `ChatMessageWriter`, `cancel` breaks the loop, `decline` is a no-op, transport throw breaks the loop with a logged warning.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/src/mcp/tests/elicitation.dispatcher.spec.ts
import { describe, it, expect, mock } from "bun:test";
import { dispatchElicitations } from "../elicitation.dispatcher.js";
import type { Question } from "../../shared/schemas/question.schema.js";
import type { ChatMessageWriter } from "../../shared/interfaces/chat-message-writer.interface.js";

const q1: Question = {
  title: "Stage",
  prompt: "Are you pre- or post-revenue?",
  options: [
    { label: "Pre-revenue (Recommended)", description: "No paying customers yet." },
    { label: "Post-revenue", description: "At least one paying customer." },
  ],
  multiSelect: false,
};

const q2: Question = {
  title: "Timing",
  prompt: "When do you need a co-founder in place?",
  options: [
    { label: "In the next month", description: "Urgent." },
    { label: "In the next quarter", description: "Soon." },
  ],
  multiSelect: false,
};

function makeWriter(): ChatMessageWriter & {
  calls: Array<{ userId: string; content: string }>;
} {
  const calls: Array<{ userId: string; content: string }> = [];
  return {
    calls,
    async addUserMessage(userId, content) {
      calls.push({ userId, content });
      return { sessionId: "session-1" };
    },
  };
}

describe("dispatchElicitations", () => {
  it("dispatches one elicitInput per question sequentially and posts accepts", async () => {
    const elicitations: unknown[] = [];
    const elicitInput = mock(async (params: unknown) => {
      elicitations.push(params);
      return { action: "accept" as const, content: { choice: "Pre-revenue (Recommended)" } };
    });
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1, q2],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(elicitInput).toHaveBeenCalledTimes(2);
    expect((elicitations[0] as { message: string }).message).toBe(
      "Stage: Are you pre- or post-revenue?",
    );
    expect((elicitations[1] as { message: string }).message).toBe(
      "Timing: When do you need a co-founder in place?",
    );
    expect(writer.calls).toHaveLength(2);
    expect(writer.calls[0].content).toBe(
      "Stage (Are you pre- or post-revenue?): Pre-revenue (Recommended)",
    );
  });

  it("decline is a no-op but continues to next question", async () => {
    const elicitInput = mock(async (_params: unknown, _opts?: unknown) => ({
      action: "decline" as const,
    }));
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1, q2],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(elicitInput).toHaveBeenCalledTimes(2);
    expect(writer.calls).toHaveLength(0);
  });

  it("cancel stops the loop", async () => {
    const elicitInput = mock(async (_params: unknown) => ({
      action: "cancel" as const,
    }));
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1, q2],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(elicitInput).toHaveBeenCalledTimes(1);
    expect(writer.calls).toHaveLength(0);
  });

  it("a transport throw stops the loop", async () => {
    let callCount = 0;
    const elicitInput = mock(async (_params: unknown) => {
      callCount += 1;
      throw new Error("transport-fail");
    });
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1, q2],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(callCount).toBe(1);
    expect(writer.calls).toHaveLength(0);
  });

  it("accept with empty multi-select array is treated as unanswered (no post)", async () => {
    const multiQ: Question = { ...q1, multiSelect: true };
    const elicitInput = mock(async (_params: unknown) => ({
      action: "accept" as const,
      content: { choice: [] },
    }));
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [multiQ],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(writer.calls).toHaveLength(0);
  });

  it("no-op when questions is empty", async () => {
    const elicitInput = mock(async (_params: unknown) => ({ action: "accept" as const }));
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(elicitInput).not.toHaveBeenCalled();
    expect(writer.calls).toHaveLength(0);
  });

  it("no-op when chatMessageWriter is undefined (elicitations still dispatched)", async () => {
    const elicitInput = mock(async (_params: unknown) => ({
      action: "accept" as const,
      content: { choice: "Pre-revenue (Recommended)" },
    }));

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1],
      elicitInput,
      chatMessageWriter: undefined,
    });

    expect(elicitInput).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/protocol && bun test src/mcp/tests/elicitation.dispatcher.spec.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the dispatcher**

```ts
// packages/protocol/src/mcp/elicitation.dispatcher.ts
import type { Question } from "../shared/schemas/question.schema.js";
import type { ChatMessageWriter } from "../shared/interfaces/chat-message-writer.interface.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { buildElicitationCreate, flattenChoice } from "./elicitation.builder.js";

const logger = protocolLogger("McpElicitation");

export type ElicitResultLike =
  | { action: "accept"; content?: { choice?: unknown } }
  | { action: "decline" }
  | { action: "cancel" };

export type ElicitInputFn = (
  params: ReturnType<typeof buildElicitationCreate>,
) => Promise<ElicitResultLike>;

export interface DispatchElicitationsParams {
  userId: string;
  questions: Question[];
  elicitInput: ElicitInputFn;
  chatMessageWriter: ChatMessageWriter | undefined;
}

/**
 * Sequentially dispatches one `elicitation/create` per question. On accept,
 * flattens the choice and posts it via the ChatMessageWriter. `cancel` breaks
 * the loop; `decline` is a no-op. A transport throw breaks the loop with a
 * warning. Empty `questions` is a no-op.
 *
 * Caller is responsible for the capability check — this function only knows
 * how to dispatch.
 */
export async function dispatchElicitations({
  userId,
  questions,
  elicitInput,
  chatMessageWriter,
}: DispatchElicitationsParams): Promise<void> {
  if (questions.length === 0) return;

  for (const question of questions) {
    const elicitation = buildElicitationCreate(question);
    let reply: ElicitResultLike;
    try {
      reply = await elicitInput(elicitation);
    } catch (err) {
      logger.warn("elicitation_failed", {
        title: question.title,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }

    if (reply.action === "cancel") break;
    if (reply.action === "decline") continue;

    const flat = flattenChoice(question, reply.content?.choice);
    if (flat === null) continue;
    if (!chatMessageWriter) continue;

    try {
      await chatMessageWriter.addUserMessage(userId, flat);
    } catch (err) {
      logger.warn("chat_message_write_failed", {
        title: question.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/protocol && bun test src/mcp/tests/elicitation.dispatcher.spec.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Export**

In `packages/protocol/src/index.ts`, alongside the builder export:

```ts
export { dispatchElicitations } from "./mcp/elicitation.dispatcher.js";
export type { ElicitResultLike, ElicitInputFn } from "./mcp/elicitation.dispatcher.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/mcp/elicitation.dispatcher.ts \
        packages/protocol/src/mcp/tests/elicitation.dispatcher.spec.ts \
        packages/protocol/src/index.ts
git -c commit.gpgsign=false commit -m "feat(protocol): add MCP elicitation dispatcher"
```

---

## Task 4: Loosen `enableQuestions` gate for MCP context

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.tools.ts` (line ~891)

Slice 3 gates `enableQuestions` to `!!context.sessionId`. MCP calls have no `sessionId`, so questions aren't generated for them today. Slice 5 needs them.

- [ ] **Step 1: Inspect the current line**

```bash
grep -n "enableQuestions:" packages/protocol/src/opportunity/opportunity.tools.ts
```

Current line (approximately 891):

```ts
        enableQuestions: process.env.ENABLE_DISCOVERY_QUESTIONS === "true" && !!context.sessionId,
```

- [ ] **Step 2: Replace with the MCP-inclusive gate**

In `packages/protocol/src/opportunity/opportunity.tools.ts`, replace the single line with:

```ts
        enableQuestions:
          process.env.ENABLE_DISCOVERY_QUESTIONS === "true" &&
          (!!context.sessionId || !!context.isMcp),
```

- [ ] **Step 3: Run the existing opportunity-tool tests to check no regressions**

```bash
cd packages/protocol && bun test src/opportunity/tests/ 2>&1 | tail -10
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.tools.ts
git -c commit.gpgsign=false commit -m "feat(protocol): enable decision questions for MCP discover_opportunities calls"
```

---

## Task 5: Extend `ToolDeps` with optional `ChatMessageWriter`

**Files:**
- Modify: `packages/protocol/src/shared/agent/tool.helpers.ts`

The dispatcher needs the writer; threading it through `ToolDeps` is the established pattern (matches how `chatSummaryReader` is injected for Slice 1).

- [ ] **Step 1: Locate the `ToolDeps` interface**

```bash
grep -n "interface ToolDeps\|export interface ToolDeps" packages/protocol/src/shared/agent/tool.helpers.ts
```

- [ ] **Step 2: Add the field**

Find the `ToolDeps` interface body. Add (alongside `chatSummaryReader` or similar optional deps):

```ts
import type { ChatMessageWriter } from "../interfaces/chat-message-writer.interface.js";
```

And inside the interface:

```ts
  /** Writes user messages into the user's most-recent chat session (Slice 5 MCP elicitation). */
  chatMessageWriter?: ChatMessageWriter;
```

If `ProtocolDeps` is derived from `ToolDeps` via `Omit<..., 'userId' | 'indexId' | 'sessionId' | ...>` (it is — see line ~174 of tool.helpers.ts), the new field is automatically part of `ProtocolDeps` since it's not in the omit list.

- [ ] **Step 3: Run protocol tests**

```bash
cd packages/protocol && bun test src/shared 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/shared/agent/tool.helpers.ts
git -c commit.gpgsign=false commit -m "feat(protocol): thread ChatMessageWriter through ToolDeps"
```

---

## Task 6: `ChatMessageWriterAdapter` (backend)

**Files:**
- Create: `backend/src/adapters/chat-message-writer.adapter.ts`
- Test: `backend/src/adapters/tests/chat-message-writer.adapter.test.ts`

Adapter implements the interface by finding the user's most-recent session via `ChatSessionService.listUserChatSessions(userId, 1)` and calling `addMessage`. If the user has zero sessions, returns `null`.

- [ ] **Step 1: Find the actual method name on ChatSessionService**

```bash
grep -n "listUserChatSessions\|getUserChatSessions\|listSessions" backend/src/services/chat.service.ts
```

Use whichever name is present — likely `getUserChatSessions(userId, limit)` per the earlier grep. The plan below uses `getUserChatSessions`; rename to match the codebase.

- [ ] **Step 2: Write the failing test**

```ts
// backend/src/adapters/tests/chat-message-writer.adapter.test.ts
import { describe, it, expect, mock } from "bun:test";
import { ChatMessageWriterAdapter } from "../chat-message-writer.adapter";

describe("ChatMessageWriterAdapter", () => {
  it("posts into the user's most-recent session and returns its sessionId", async () => {
    const chatSessionService = {
      getUserChatSessions: mock(async (_userId: string, _limit: number) => [
        { id: "session-recent", title: "x", updatedAt: new Date() },
        { id: "session-older", title: "y", updatedAt: new Date(0) },
      ]),
      addMessage: mock(
        async (_p: { sessionId: string; role: string; content: string }) => "msg-1",
      ),
    };

    const adapter = new ChatMessageWriterAdapter(
      // deliberately loose-typed cast: see adapter constructor
      chatSessionService as unknown as ConstructorParameters<
        typeof ChatMessageWriterAdapter
      >[0],
    );

    const result = await adapter.addUserMessage("user-1", "hello");

    expect(result).toEqual({ sessionId: "session-recent" });
    expect(chatSessionService.getUserChatSessions).toHaveBeenCalledWith("user-1", 1);
    expect(chatSessionService.addMessage).toHaveBeenCalledWith({
      sessionId: "session-recent",
      role: "user",
      content: "hello",
    });
  });

  it("returns null when the user has no chat sessions", async () => {
    const chatSessionService = {
      getUserChatSessions: mock(async () => []),
      addMessage: mock(async () => "msg-x"),
    };
    const adapter = new ChatMessageWriterAdapter(
      chatSessionService as unknown as ConstructorParameters<
        typeof ChatMessageWriterAdapter
      >[0],
    );

    const result = await adapter.addUserMessage("user-2", "hello");

    expect(result).toBeNull();
    expect(chatSessionService.addMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend && bun test src/adapters/tests/chat-message-writer.adapter.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 4: Write the adapter**

```ts
// backend/src/adapters/chat-message-writer.adapter.ts
import type { ChatMessageWriter } from "@indexnetwork/protocol";
import type { ChatSessionService } from "../services/chat.service";

interface ChatSessionServiceLike {
  getUserChatSessions: ChatSessionService["getUserChatSessions"];
  addMessage: ChatSessionService["addMessage"];
}

/**
 * Adapter implementation of ChatMessageWriter. Finds the user's most-recent
 * chat session and inserts a user message via the existing addMessage path.
 * Returns null if the user has no sessions (caller decides what to do).
 */
export class ChatMessageWriterAdapter implements ChatMessageWriter {
  constructor(private readonly chatSessionService: ChatSessionServiceLike) {}

  async addUserMessage(
    userId: string,
    content: string,
  ): Promise<{ sessionId: string } | null> {
    const sessions = await this.chatSessionService.getUserChatSessions(userId, 1);
    const mostRecent = sessions[0];
    if (!mostRecent) return null;

    await this.chatSessionService.addMessage({
      sessionId: mostRecent.id,
      role: "user",
      content,
    });

    return { sessionId: mostRecent.id };
  }
}
```

> If the actual `ChatSessionService.getUserChatSessions` return shape differs (e.g. the field is `sessionId` rather than `id`), update both the adapter and the test to match.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && bun test src/adapters/tests/chat-message-writer.adapter.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/chat-message-writer.adapter.ts \
        backend/src/adapters/tests/chat-message-writer.adapter.test.ts
git -c commit.gpgsign=false commit -m "feat(backend): add ChatMessageWriterAdapter"
```

---

## Task 7: Wire the adapter into the composition root

**Files:**
- Modify: `backend/src/controllers/mcp.controller.ts`

`mcp.controller.ts` is the composition root that assembles `ProtocolDeps` (per CLAUDE.md). Inject `ChatMessageWriterAdapter` into the assembled deps.

- [ ] **Step 1: Find where ToolDeps / ProtocolDeps is built**

```bash
grep -n "ProtocolDeps\|new McpServer\|createMcpServer\|chatSummaryReader" backend/src/controllers/mcp.controller.ts | head -20
```

- [ ] **Step 2: Import and inject**

At the top of `backend/src/controllers/mcp.controller.ts`, add the adapter import:

```ts
import { ChatMessageWriterAdapter } from "../adapters/chat-message-writer.adapter";
```

In the deps-assembly block (alongside other adapters like `chatSummaryReader`), add:

```ts
  chatMessageWriter: new ChatMessageWriterAdapter(chatSessionService),
```

`chatSessionService` should already be in scope (it's used by the existing chat path). If not, instantiate or import it the same way other services are obtained in this file.

- [ ] **Step 3: Type-check**

```bash
cd backend && bun run lint 2>&1 | tail -20
```

Expected: clean (or unchanged pre-existing warnings only).

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/mcp.controller.ts
git -c commit.gpgsign=false commit -m "feat(backend): inject ChatMessageWriterAdapter into protocol deps"
```

---

## Task 8: Hook elicitation into `mcp.server.ts` post-result

**Files:**
- Modify: `packages/protocol/src/mcp/mcp.server.ts`

After `sanitizeMcpResult(result)`, do the slice-specific post-processing **only for the `discover_opportunities` tool** and only when `parsedData.questions` is non-empty:

1. Always: append a JSON envelope content block.
2. If `server.server.getClientCapabilities()?.elicitation` is true: dispatch elicitations sequentially via `ctx.mcpReq.elicitInput`.

Capture the `McpServer` reference at factory time and close over it in the tool handler.

- [ ] **Step 1: Add imports + helper at the top of the file**

In `packages/protocol/src/mcp/mcp.server.ts`, near the existing imports, add:

```ts
import type { Question } from "../shared/schemas/question.schema.js";
import { dispatchElicitations } from "./elicitation.dispatcher.js";
```

Below `sanitizeMcpResult` (around line 122), add:

```ts
/**
 * Extracts decision questions from a parsed tool-result text, if present.
 * Returns null when the text isn't JSON, doesn't have data.questions, or the
 * array is empty.
 */
export function extractDecisionQuestions(text: string): Question[] | null {
  try {
    const parsed = JSON.parse(text);
    const qs = parsed?.data?.questions;
    if (Array.isArray(qs) && qs.length > 0) return qs as Question[];
    return null;
  } catch {
    return null;
  }
}

/**
 * Renders the JSON-envelope text block appended to the tool result content
 * when decision questions are present. The leading sentinel string lets the
 * LLM client recognize and surface the questions in prose for clients
 * without elicitation support.
 */
export function renderQuestionsEnvelope(questions: Question[]): string {
  return `Decision questions (structured): ${JSON.stringify({ questions })}`;
}
```

- [ ] **Step 2: Capture the McpServer reference and use it in the tool handler**

In `createMcpServer`, **after** `const server = new McpServer(...)`, the tool handler closure already has `server` in scope via JavaScript closure rules — so no extra capture needed.

Inside the `server.registerTool(toolName, ..., async (args, ctx) => { ... })` body, find the line:

```ts
          const { text: sanitizedText, isError: toolIsError } = sanitizeMcpResult(result);
          return {
            content: [{ type: 'text' as const, text: sanitizedText }],
            ...(toolIsError ? { isError: true } : {}),
          };
```

Replace with:

```ts
          const { text: sanitizedText, isError: toolIsError } = sanitizeMcpResult(result);

          // Slice 5: decision questions post-processing for discover_opportunities only.
          if (toolName === "discover_opportunities" && !toolIsError) {
            const questions = extractDecisionQuestions(sanitizedText);
            if (questions) {
              const envelopeBlock = {
                type: "text" as const,
                text: renderQuestionsEnvelope(questions),
              };

              const supportsElicitation =
                !!server.server.getClientCapabilities()?.elicitation;

              if (supportsElicitation && ctx.mcpReq?.elicitInput) {
                // Sequential — never parallel (day-one rule). We await the loop
                // before returning the tool result so test harnesses can observe
                // the dispatched calls deterministically.
                await dispatchElicitations({
                  userId,
                  questions,
                  elicitInput: (params) => ctx.mcpReq.elicitInput(params),
                  chatMessageWriter: deps.chatMessageWriter,
                });
              }

              return {
                content: [
                  { type: "text" as const, text: sanitizedText },
                  envelopeBlock,
                ],
                ...(toolIsError ? { isError: true } : {}),
              };
            }
          }

          return {
            content: [{ type: "text" as const, text: sanitizedText }],
            ...(toolIsError ? { isError: true } : {}),
          };
```

- [ ] **Step 3: Verify the existing mcp.server tests still pass**

```bash
cd packages/protocol && bun test src/mcp/tests/mcp.server.spec.ts 2>&1 | tail -10
```

Expected: green. If failing because the result-shape changed for non-discover tools, only `discover_opportunities` is touched — investigate, but it should be untouched.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/mcp/mcp.server.ts
git -c commit.gpgsign=false commit -m "feat(protocol): wire decision-question envelope + elicitation dispatch into MCP server"
```

---

## Task 9: Protocol-level integration test for the MCP server hook

**Files:**
- Create: `packages/protocol/src/mcp/tests/mcp.server.elicitation.spec.ts`

End-to-end test at the protocol layer: build an MCP server with a fake `discover_opportunities` tool that returns scripted `questions`, simulate calling the tool with a fake ServerContext, assert the resulting content array and the elicitation calls.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/src/mcp/tests/mcp.server.elicitation.spec.ts
import { describe, it, expect } from "bun:test";
import {
  extractDecisionQuestions,
  renderQuestionsEnvelope,
} from "../mcp.server.js";
import type { Question } from "../../shared/schemas/question.schema.js";

const sampleQ: Question = {
  title: "Stage",
  prompt: "Are you pre- or post-revenue?",
  options: [
    { label: "Pre-revenue (Recommended)", description: "No paying customers yet." },
    { label: "Post-revenue", description: "At least one paying customer." },
  ],
  multiSelect: false,
};

describe("mcp.server post-result helpers", () => {
  it("extractDecisionQuestions returns null when text is not JSON", () => {
    expect(extractDecisionQuestions("not-json")).toBeNull();
  });

  it("extractDecisionQuestions returns null when data.questions is missing or empty", () => {
    expect(
      extractDecisionQuestions(JSON.stringify({ data: { other: 1 } })),
    ).toBeNull();
    expect(
      extractDecisionQuestions(JSON.stringify({ data: { questions: [] } })),
    ).toBeNull();
  });

  it("extractDecisionQuestions returns the array when present", () => {
    const text = JSON.stringify({ data: { questions: [sampleQ] } });
    expect(extractDecisionQuestions(text)).toEqual([sampleQ]);
  });

  it("renderQuestionsEnvelope prefixes a sentinel string before JSON", () => {
    const out = renderQuestionsEnvelope([sampleQ]);
    expect(out.startsWith("Decision questions (structured): ")).toBe(true);
    const parsedTail = JSON.parse(out.slice("Decision questions (structured): ".length));
    expect(parsedTail).toEqual({ questions: [sampleQ] });
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/protocol && bun test src/mcp/tests/mcp.server.elicitation.spec.ts
```

Expected: PASS, 4 tests.

> A full end-to-end test of the elicitation loop driven through `createMcpServer` requires standing up a mock MCP transport and is substantially heavier — Task 10's controller-level test covers it instead.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/mcp/tests/mcp.server.elicitation.spec.ts
git -c commit.gpgsign=false commit -m "test(protocol): unit-test mcp.server decision-question post-result helpers"
```

---

## Task 10 (DEFERRED): Backend controller-level integration test

**Status:** Deferred from this slice. Task 3 (`elicitation.dispatcher.spec.ts`) already exercises the full accept / decline / cancel / throw state machine at the unit level, and Task 9 covers the post-result helpers. Driving the full `createMcpServer` stack with an in-memory transport pair is research-heavy; defer until after manual smoke (Task 12) flags a real integration gap.

The spec's request for a controller-level test stands, but moving it out of the day-one slice. Re-open via a follow-up issue if observed regressions warrant it.

**Files:**
- Create: `backend/src/controllers/tests/mcp.handler.elicitation.spec.ts`

This is the test the spec asks for. It exercises the post-result hook end-to-end with a mocked MCP session that records dispatched elicitations and returns scripted replies.

- [ ] **Step 1: Find an existing controller test to mirror style**

```bash
grep -rln "createMcpServer\|server.connect\|ServerContext" backend/src/controllers/tests/ | head
```

Use the closest existing pattern. If there's no existing MCP-controller test that drives a full request/response, model the test on Task 3's dispatcher test but with the full `createMcpServer`-built server invoked via the SDK's in-memory transport (`StdioServerTransport`-style or the in-process `Transport` interface).

- [ ] **Step 2: Write the failing test**

```ts
// backend/src/controllers/tests/mcp.handler.elicitation.spec.ts
//
// Drives the full createMcpServer-built MCP server and asserts:
//  (a) Tool result content includes a JSON envelope when questions are present.
//  (b) Sequential elicitation/create requests are dispatched when the client
//      capability includes elicitation.
//  (c) Accepted replies are posted via ChatMessageWriter; declines are no-ops;
//      cancel breaks the loop.
//  (d) When the client does NOT declare elicitation, zero elicitations are
//      dispatched, but the envelope is still in the result content.

import { describe, it, expect, mock } from "bun:test";
import { createMcpServer } from "@indexnetwork/protocol";
// ... plus an in-process transport pair from @modelcontextprotocol/server

// NOTE: The test must:
//  1. Build ToolDeps with a stub tool registry that returns the scripted
//     `discover_opportunities` result. The simplest path is to stub
//     `createToolRegistry` via a mock or to provide a custom McpAuthResolver
//     + scopedDepsFactory that route to a fake graph.
//  2. Build a fake McpServer-client pair connected via in-memory transport.
//  3. Capture client-side elicitation/create requests and reply with scripted
//     {action,content} objects.
//  4. Assert on dispatched params + ChatMessageWriter calls.
//
// Implementation tip: the @modelcontextprotocol/server package exports a
// `Transport` interface and an in-process pair pattern; consult the SDK's
// own tests for the minimal client+server pairing.

describe("MCP discover_opportunities elicitation post-result", () => {
  it.todo("dispatches two sequential elicitations when capability + 2 questions");
  it.todo(
    "embeds the JSON envelope in the tool result content regardless of capability",
  );
  it.todo("does not dispatch elicitations when capability is absent");
  it.todo("posts an accepted answer via ChatMessageWriter; decline is no-op");
  it.todo("cancel stops the loop");
  it.todo("elicitation transport throw stops the loop");
});
```

- [ ] **Step 3: Implement each todo case**

For each `it.todo`, replace with a full test. Driving signal:

- Build a stub `ToolDeps` where `createToolRegistry(deps)` returns a `Map` containing only a `discover_opportunities` entry with a fixed schema and a handler that returns `JSON.stringify({ success: true, data: { found: false, count: 0, questions: [sampleQ1, sampleQ2] } })`.

- Wrap `createMcpServer(deps, authResolver, scopedDepsFactory)` and connect it via the SDK's in-memory transport. Use the SDK's client (or a hand-rolled minimal client) to invoke the tool.

- Register an `elicitation/create` handler on the client side that pushes the params onto a shared array and replies with the next scripted reply from a queue.

- After the tool call resolves, assert:
  - `dispatchedElicitations.length === expectedCount`
  - The first dispatched message field is `"Stage: Are you pre- or post-revenue?"`
  - The result `content` array's last block matches `Decision questions (structured): {...}`
  - The `chatMessageWriter.addUserMessage` mock was called with the flattened content for accepted replies only

If standing up the in-memory transport is non-trivial, the fallback is a smaller-surface test that mocks `server.registerTool` at the SDK boundary and drives the tool handler closure directly — but this loses coverage of the full `createMcpServer` glue.

- [ ] **Step 4: Run test**

```bash
cd backend && bun test src/controllers/tests/mcp.handler.elicitation.spec.ts
```

Expected: all cases PASS once `.todo` is replaced.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/tests/mcp.handler.elicitation.spec.ts
git -c commit.gpgsign=false commit -m "test(backend): controller-level MCP elicitation flow tests"
```

---

## Task 11: Lint + cross-suite test pass

- [ ] **Step 1: Protocol lint**

```bash
cd packages/protocol && bun run lint
```

Expected: clean for all changed files.

- [ ] **Step 2: Backend lint**

```bash
cd backend && bun run lint
```

Expected: clean for all changed files.

- [ ] **Step 3: Protocol slice 5 tests**

```bash
cd packages/protocol && bun test src/mcp/tests/ src/opportunity/tests/ src/shared 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 4: Backend slice 5 tests**

```bash
cd backend && bun test src/adapters/tests/chat-message-writer.adapter.test.ts src/controllers/tests/mcp.handler.elicitation.spec.ts 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 5: If anything fails, fix and re-commit before moving on.**

---

## Task 12: Manual acceptance smoke

Per the spec's acceptance section. This is user-driven; agentic worker stops at Task 11 and hands back.

- [ ] **Step 1: Boot backend with the flag on**

```bash
cd backend && ENABLE_DISCOVERY_QUESTIONS=true bun run dev
```

- [ ] **Step 2: Connect Claude Desktop (or any MCP client with elicitation capability) to the MCP endpoint**

Verify in the client's MCP debug log that the initialize handshake declares `elicitation` capability.

- [ ] **Step 3: Run `discover_opportunities` against your account**

Expectations:
- Native elicitation dialogs appear, one per question, sequentially.
- Accepting an option produces a follow-up user message in the user's most-recent index.network chat session (visible on the index.network frontend next time you open it).
- Decline / cancel are no-ops; cancel stops the dialog series.

- [ ] **Step 4: Test the non-elicitation path**

Connect from a stub MCP client without the elicitation capability. Run `discover_opportunities`. Verify the tool result `content` array contains the `Decision questions (structured):` envelope and that the host LLM resurfaces the questions in prose.

---

## Risks / open questions (carried from spec)

- **Per-option description fidelity.** Joined with ` | ` into one property `description`. Host UIs may truncate; acceptable for v1.
- **Sequential timing under slow users.** Sequential is the spec's day-one rule. Parallel is a future iteration.
- **"Other" affordance missing in MCP.** Enums are closed. Day-one accepts only listed options on MCP clients.
- **Capability declaration accuracy.** We trust what the client declares at init. A client that declares elicitation but silently fails to render means we lose elicitations to the spec's `try/catch break` path; the envelope still survives in the tool result.
- **Most-recent session as target for posts.** The user picked "post into index.network chat session." If the user has multiple unrelated chat sessions, the answer lands in whichever was most-recently updated. If they have none, the answer is preserved only in the tool result envelope. This may be revisited if observed problematic.
