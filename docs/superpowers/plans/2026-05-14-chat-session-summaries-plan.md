# Chat-session summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a rolling, append-only chat-session digest persisted in DB, fronted by a `ChatSummaryReader` interface, so future consumers (Slice 2's question generator) can read a structured `ChatContextDigest` for any session.

**Architecture:** Pure-LLM summarizer (`packages/protocol/src/chat/chat.summarizer.ts`) takes `(previousDigest, newMessages) → ChatContextDigest`. A backend service (`backend/src/services/chat-summary.service.ts`) wraps it with read-from-DB and write-to-DB calls against a new `chat_session_summaries` table, exposing the protocol's `ChatSummaryReader` interface. The composition root in `mcp.controller.ts` instantiates everything and adds `chatSummary` to `protocolDeps`. Append-only: every summarization run inserts a new row; readers take the latest by `to_message_id DESC`.

**Tech Stack:** TypeScript (strict), Bun runtime, Drizzle ORM, PostgreSQL, LangChain/OpenAI (`createModel`), Zod, `bun:test`.

**Linear:** IND-297 (parent IND-296). **Spec:** `docs/superpowers/specs/2026-05-14-chat-session-summaries-design.md`.

---

## Spec corrections (applied throughout this plan)

The spec was written against an outdated mental model of the composition root. The plan uses the actual paths and types:

- **Composition root** is in `backend/src/controllers/mcp.controller.ts` lines 48–105 (header `COMPOSITION ROOT (was protocol-init.ts)`). The wire-in step targets the `protocolDeps` object literal there, not a separate `protocol-init.ts` file.
- **Chat sessions** in this codebase are `conversations` rows; messages are in the `messages` table from `backend/src/schemas/conversation.schema.ts`. There is no `chat_sessions` table.
- **Message IDs** are `text` columns (defaulted to `crypto.randomUUID()` at insertion), not `uuid`. The new table's `from_message_id` / `to_message_id` columns are `text` to match.
- **Session ID** for the FK is `text` (references `conversations.id`), not `uuid`.

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `packages/protocol/src/shared/schemas/chat-context.schema.ts` | Create | Zod `ChatContextDigestSchema` + inferred type, exported. |
| `packages/protocol/src/shared/schemas/tests/chat-context.schema.spec.ts` | Create | Schema validation tests. |
| `packages/protocol/src/shared/interfaces/chat-summary.interface.ts` | Create | `ChatSummaryReader` interface. |
| `packages/protocol/src/shared/agent/model.config.ts` | Modify (line ~58–60) | Add `chatContextSummarizer` model slot. |
| `packages/protocol/src/chat/chat.summarizer.ts` | Create | Pure LLM pass: `(previousDigest, newMessages) → ChatContextDigest \| null`. |
| `packages/protocol/src/chat/tests/chat.summarizer.spec.ts` | Create | Mocked-LLM tests for summarizer behavior. |
| `packages/protocol/src/index.ts` | Modify | Export new schema, interface, summarizer class. |
| `packages/protocol/src/negotiation/negotiation.insights.generator.ts` | Move → `negotiation/insight.generator.ts` | Bundled rename (class unchanged). |
| `packages/protocol/src/negotiation/tests/negotiation.insights.generator.spec.ts` | Move → `tests/insight.generator.spec.ts` | Test file follows the rename. |
| `backend/src/schemas/database.schema.ts` | Modify | Add `chatSessionSummaries` Drizzle table definition + relations. |
| `backend/drizzle/migrations/NNNN_add_chat_session_summaries.sql` | Create (via `db:generate` + rename) | DDL for the new table. |
| `backend/drizzle/meta/_journal.json` | Modify | Update `tag` for the renamed migration. |
| `backend/src/adapters/chat-summary.database.adapter.ts` | Create | Drizzle-backed I/O: `getLatest`, `getMessagesAfter`, `insertSummary`. |
| `backend/src/adapters/tests/chat-summary.database.adapter.spec.ts` | Create | Adapter tests against real Postgres. |
| `backend/src/services/chat-summary.service.ts` | Create | Orchestrates adapter + summarizer; implements `ChatSummaryReader`. |
| `backend/src/services/tests/chat-summary.service.spec.ts` | Create | Integration tests against real Postgres + mocked summarizer. |
| `backend/src/controllers/mcp.controller.ts` | Modify (lines 72–105) | Instantiate adapter + summarizer + service; add `chatSummary` to `protocolDeps`. |
| `backend/src/controllers/user.controller.ts` | Modify (line 10) | Update `NegotiationInsightsGenerator` import path post-rename. |

---

## Setup (before Task 1)

Implementation MUST happen in a dedicated worktree per CLAUDE.md (`Always use worktrees for features and fixes`). The subagent-driven-development sub-skill creates the worktree at execution time via the `superpowers:using-git-worktrees` skill. Recommended worktree name and branch: `feat-decision-questions` (single worktree for all 5 slices per the parent design).

Confirm before starting:

```bash
bun run worktree:list                            # verify the worktree exists
ls .worktrees/feat-decision-questions/.env       # verify .env symlinked
ls .worktrees/feat-decision-questions/backend/.env  # verify backend .env symlinked
```

If absent:

```bash
git worktree add .worktrees/feat-decision-questions dev -b feat/decision-questions
bun run worktree:setup feat-decision-questions
cd .worktrees/feat-decision-questions
```

All subsequent steps run inside that worktree.

---

## Task 1: Add `ChatContextDigest` shared schema + tests

**Files:**
- Create: `packages/protocol/src/shared/schemas/chat-context.schema.ts`
- Create: `packages/protocol/src/shared/schemas/tests/chat-context.schema.spec.ts`
- Modify: `packages/protocol/src/index.ts` (add export)

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/shared/schemas/tests/chat-context.schema.spec.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { ChatContextDigestSchema } from "../chat-context.schema.js";

describe("ChatContextDigestSchema", () => {
  it("accepts an empty digest with all four arrays empty", () => {
    const parsed = ChatContextDigestSchema.parse({
      statedFacts: [],
      openQuestions: [],
      rejectionReasons: [],
      surfacedFindings: [],
    });
    expect(parsed.statedFacts).toEqual([]);
    expect(parsed.openQuestions).toEqual([]);
    expect(parsed.rejectionReasons).toEqual([]);
    expect(parsed.surfacedFindings).toEqual([]);
  });

  it("accepts a fully-populated digest", () => {
    const parsed = ChatContextDigestSchema.parse({
      statedFacts: ["Pre-revenue", "Based in Berlin"],
      openQuestions: ["What stage?"],
      rejectionReasons: ["All US-based candidates"],
      surfacedFindings: ["District X venues book out 6 weeks ahead"],
    });
    expect(parsed.statedFacts).toHaveLength(2);
  });

  it("rejects statedFacts longer than 20 entries", () => {
    const oversized = Array.from({ length: 21 }, (_, i) => `fact-${i}`);
    expect(() =>
      ChatContextDigestSchema.parse({
        statedFacts: oversized,
        openQuestions: [],
        rejectionReasons: [],
        surfacedFindings: [],
      }),
    ).toThrow();
  });

  it("rejects openQuestions longer than 10 entries", () => {
    const oversized = Array.from({ length: 11 }, (_, i) => `q-${i}`);
    expect(() =>
      ChatContextDigestSchema.parse({
        statedFacts: [],
        openQuestions: oversized,
        rejectionReasons: [],
        surfacedFindings: [],
      }),
    ).toThrow();
  });

  it("rejects missing fields", () => {
    expect(() =>
      ChatContextDigestSchema.parse({
        statedFacts: [],
        openQuestions: [],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/protocol
bun test src/shared/schemas/tests/chat-context.schema.spec.ts
```

Expected: FAIL with `Cannot find module '../chat-context.schema.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/protocol/src/shared/schemas/chat-context.schema.ts`:

```ts
/**
 * ChatContextDigest — distilled view of a chat session used as anti-duplication
 * input for the decision-question generator. Each field is bounded so the
 * digest stays compact even as sessions grow.
 */
import { z } from "zod";

export const ChatContextDigestSchema = z.object({
  /** Facts the user volunteered (stage, location, role, timing, scope, …). */
  statedFacts: z.array(z.string()).max(20),
  /** Questions the assistant asked that the user has not yet answered. */
  openQuestions: z.array(z.string()).max(10),
  /** User pushback / negative signals on prior cards. */
  rejectionReasons: z.array(z.string()).max(10),
  /** Facts the assistant has already surfaced from prior negotiation turns. */
  surfacedFindings: z.array(z.string()).max(20),
});

export type ChatContextDigest = z.infer<typeof ChatContextDigestSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/shared/schemas/tests/chat-context.schema.spec.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Export from protocol index**

Edit `packages/protocol/src/index.ts`. Find the existing exports block and add:

```ts
export {
  ChatContextDigestSchema,
  type ChatContextDigest,
} from "./shared/schemas/chat-context.schema.js";
```

Place it alongside the existing `shared/schemas/*` exports if any (search for `shared/schemas` in the file). If no group exists, place it under a clear section comment.

- [ ] **Step 6: Run typecheck**

```bash
cd packages/protocol
bun x tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/shared/schemas/chat-context.schema.ts \
        packages/protocol/src/shared/schemas/tests/chat-context.schema.spec.ts \
        packages/protocol/src/index.ts
git commit -m "feat(protocol): add ChatContextDigest shared schema (IND-297)"
```

---

## Task 2: Add `chatContextSummarizer` model slot

**Files:**
- Modify: `packages/protocol/src/shared/agent/model.config.ts` (line ~58–60)

- [ ] **Step 1: Add the model slot**

Open `packages/protocol/src/shared/agent/model.config.ts`. Locate the existing slot definitions around line 58:

```ts
    chatTitleGenerator:   { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 32 },
    negotiationInsights:  { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 512 },
```

Add a new slot directly after `negotiationInsights`:

```ts
    chatContextSummarizer: { model: "google/gemini-2.5-flash", temperature: 0.2, maxTokens: 512 },
```

Lower temperature than insights because the summarizer is extractive (facts), not narrative.

- [ ] **Step 2: Verify typecheck**

```bash
cd packages/protocol
bun x tsc --noEmit
```

Expected: no errors. The slot's key becomes part of `keyof ReturnType<typeof getModelConfig>`, available to `createModel("chatContextSummarizer")`.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/shared/agent/model.config.ts
git commit -m "feat(protocol): add chatContextSummarizer model slot (IND-297)"
```

---

## Task 3: Add `ChatSummarizer` pure LLM pass + tests

**Files:**
- Create: `packages/protocol/src/chat/chat.summarizer.ts`
- Create: `packages/protocol/src/chat/tests/chat.summarizer.spec.ts`
- Modify: `packages/protocol/src/index.ts` (add export)

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/chat/tests/chat.summarizer.spec.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect, mock } from "bun:test";
import { ChatSummarizer } from "../chat.summarizer.js";
import type { ChatContextDigest } from "../../shared/schemas/chat-context.schema.js";

const sampleDigest: ChatContextDigest = {
  statedFacts: ["Pre-revenue"],
  openQuestions: [],
  rejectionReasons: [],
  surfacedFindings: [],
};

function makeSummarizer(invokeImpl: (input: unknown) => Promise<unknown>) {
  const summarizer = new ChatSummarizer();
  // Replace the internal model with a mock; the production code's `this.model.invoke` call must use this.
  (summarizer as unknown as { model: { invoke: typeof invokeImpl } }).model = { invoke: invokeImpl };
  return summarizer;
}

describe("ChatSummarizer", () => {
  it("returns previousDigest unchanged when no new messages", async () => {
    const invokeMock = mock(async () => sampleDigest);
    const summarizer = makeSummarizer(invokeMock);

    const result = await summarizer.summarize({
      previousDigest: sampleDigest,
      newMessages: [],
    });

    expect(result).toEqual(sampleDigest);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns null when no previousDigest and no new messages", async () => {
    const invokeMock = mock(async () => sampleDigest);
    const summarizer = makeSummarizer(invokeMock);

    const result = await summarizer.summarize({
      previousDigest: null,
      newMessages: [],
    });

    expect(result).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("calls the LLM with new messages and returns parsed digest", async () => {
    const fresh: ChatContextDigest = {
      statedFacts: ["Pre-revenue", "Based in Berlin"],
      openQuestions: [],
      rejectionReasons: [],
      surfacedFindings: [],
    };
    const invokeMock = mock(async () => fresh);
    const summarizer = makeSummarizer(invokeMock);

    const result = await summarizer.summarize({
      previousDigest: null,
      newMessages: [
        { role: "user", content: "I'm pre-revenue and based in Berlin." },
      ],
    });

    expect(result).toEqual(fresh);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the LLM throws", async () => {
    const invokeMock = mock(async () => {
      throw new Error("model timeout");
    });
    const summarizer = makeSummarizer(invokeMock);

    const result = await summarizer.summarize({
      previousDigest: null,
      newMessages: [{ role: "user", content: "hi" }],
    });

    expect(result).toBeNull();
  });

  it("truncates messages to 240 chars before sending to the LLM", async () => {
    let capturedInput: unknown = null;
    const invokeMock = mock(async (input: unknown) => {
      capturedInput = input;
      return sampleDigest;
    });
    const summarizer = makeSummarizer(invokeMock);
    const longContent = "x".repeat(500);

    await summarizer.summarize({
      previousDigest: null,
      newMessages: [{ role: "user", content: longContent }],
    });

    // The captured input is a LangChain message array; the user content should be ≤240 chars.
    expect(JSON.stringify(capturedInput)).not.toContain("x".repeat(500));
    expect(JSON.stringify(capturedInput)).toContain("x".repeat(240));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/protocol
bun test src/chat/tests/chat.summarizer.spec.ts
```

Expected: FAIL with `Cannot find module '../chat.summarizer.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/protocol/src/chat/chat.summarizer.ts`:

```ts
/**
 * ChatSummarizer — rolling, incremental digest of a chat session. Takes the
 * previous persisted digest (if any) plus messages added since, returns a
 * structured ChatContextDigest. Pure: no DB, no events. Persistence is the
 * caller's responsibility (see backend ChatSummaryService).
 *
 * The model is instructed to drop entries in the previous digest that newer
 * messages override, keeping the digest bounded as the session grows.
 */
import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
  ChatContextDigestSchema,
  type ChatContextDigest,
} from "../shared/schemas/chat-context.schema.js";
import { createModel } from "../shared/agent/model.config.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";

const logger = protocolLogger("ChatSummarizer");

const MESSAGE_CONTENT_CAP = 240;

const SYSTEM_PROMPT = `You distill chat sessions into a compact structured digest used to keep an assistant from asking obvious questions.

Output four arrays:
- statedFacts: facts the user volunteered (stage, location, role, timing, scope, budget, …).
- openQuestions: questions the assistant asked that the user has not yet answered.
- rejectionReasons: pushback the user gave on prior assistant proposals (e.g. "none of these fit — all US-based").
- surfacedFindings: facts the assistant has already shared with the user from prior negotiation results.

Rules:
- Drop entries from the previous digest that newer messages override or contradict.
- Keep each entry short (≤140 chars), specific, and standalone.
- Bound the digest: at most 20 statedFacts, 10 openQuestions, 10 rejectionReasons, 20 surfacedFindings. Drop the least relevant when over.
- Never invent facts. If the digest is empty for a category, output an empty array.`;

export interface ChatSummarizerMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSummarizerInput {
  previousDigest: ChatContextDigest | null;
  newMessages: ChatSummarizerMessage[];
}

/** Pure LLM summarizer; no DB, no events. */
export class ChatSummarizer {
  private model: ReturnType<ChatOpenAI["withStructuredOutput"]>;

  constructor() {
    const llm = createModel("chatContextSummarizer");
    this.model = llm.withStructuredOutput(ChatContextDigestSchema, {
      name: "chat_context_digest",
    });
  }

  @Timed()
  async summarize(input: ChatSummarizerInput): Promise<ChatContextDigest | null> {
    if (input.newMessages.length === 0) {
      return input.previousDigest;
    }

    const truncated = input.newMessages.map((m) => ({
      role: m.role,
      content: m.content.length > MESSAGE_CONTENT_CAP
        ? m.content.slice(0, MESSAGE_CONTENT_CAP)
        : m.content,
    }));

    const user = [
      input.previousDigest
        ? `Previous digest:\n${JSON.stringify(input.previousDigest, null, 2)}`
        : "Previous digest: (none — this is the first summarization for this session)",
      "",
      "New messages (since previous digest):",
      ...truncated.map((m) => `  [${m.role}] ${m.content}`),
      "",
      "Produce the updated digest now.",
    ].join("\n");

    try {
      const response = await this.model.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(user),
      ]);
      const parsed = ChatContextDigestSchema.safeParse(response);
      if (!parsed.success) {
        logger.warn("ChatSummarizer parse failed", { error: parsed.error.message });
        return null;
      }
      return parsed.data;
    } catch (err) {
      logger.warn("ChatSummarizer LLM call failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/chat/tests/chat.summarizer.spec.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Export from protocol index**

Edit `packages/protocol/src/index.ts`. Find the chat exports section (search for `chat/`) and add:

```ts
export { ChatSummarizer } from "./chat/chat.summarizer.js";
export type { ChatSummarizerInput, ChatSummarizerMessage } from "./chat/chat.summarizer.js";
```

- [ ] **Step 6: Typecheck**

```bash
cd packages/protocol
bun x tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/chat/chat.summarizer.ts \
        packages/protocol/src/chat/tests/chat.summarizer.spec.ts \
        packages/protocol/src/index.ts
git commit -m "feat(protocol): add ChatSummarizer pure LLM pass (IND-297)"
```

---

## Task 4: Add `ChatSummaryReader` protocol interface

**Files:**
- Create: `packages/protocol/src/shared/interfaces/chat-summary.interface.ts`
- Modify: `packages/protocol/src/index.ts` (add export)

This is a pure interface definition — no test needed; consumers in later tasks test against it.

- [ ] **Step 1: Create the interface**

Create `packages/protocol/src/shared/interfaces/chat-summary.interface.ts`:

```ts
/**
 * Protocol-side contract for reading a chat session's current digest. The
 * backend implementation (ChatSummaryService) handles persistence and
 * incremental summarization; the protocol layer only sees this shape.
 */
import type { ChatContextDigest } from "../schemas/chat-context.schema.js";

export interface ChatSummaryReader {
  /**
   * Returns the freshest digest for the session, running incremental
   * summarization if there are new messages.
   *
   * @returns the digest, or `null` when the session has no messages or
   *   when summarization fails on a session that has no prior digest.
   */
  getDigest(sessionId: string): Promise<ChatContextDigest | null>;
}
```

- [ ] **Step 2: Export from protocol index**

Edit `packages/protocol/src/index.ts`. Search for `shared/interfaces` exports; add:

```ts
export type { ChatSummaryReader } from "./shared/interfaces/chat-summary.interface.js";
```

- [ ] **Step 3: Typecheck**

```bash
cd packages/protocol
bun x tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/shared/interfaces/chat-summary.interface.ts \
        packages/protocol/src/index.ts
git commit -m "feat(protocol): add ChatSummaryReader interface (IND-297)"
```

---

## Task 5: Add `chat_session_summaries` table + migration

**Files:**
- Modify: `backend/src/schemas/database.schema.ts` (or `conversation.schema.ts`)
- Create: `backend/drizzle/migrations/NNNN_add_chat_session_summaries.sql` (via `db:generate` then rename)
- Modify: `backend/drizzle/meta/_journal.json` (update tag for the renamed migration)

The conversations + messages tables live in `backend/src/schemas/conversation.schema.ts` (re-exported from `database.schema.ts`). The new table belongs with them.

- [ ] **Step 1: Add the table definition**

Open `backend/src/schemas/conversation.schema.ts`. Locate the existing `messages` table definition (search for `export const messages = pgTable(`). Add after the `messages` table (before its `relations` block):

```ts
/**
 * Append-only rolling digest of a chat session (a conversation). Each row covers
 * messages from `fromMessageId` (earliest in the chain) through `toMessageId`
 * (latest at write time). Readers take the latest row by `toMessageId DESC` for
 * a session. New rows are inserted as the session grows; old rows are retained
 * for debug/replay.
 */
export const chatSessionSummaries = pgTable(
  'chat_session_summaries',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    chatSessionId: text('chat_session_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    fromMessageId: text('from_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'restrict' }),
    toMessageId: text('to_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'restrict' }),
    digest: jsonb('digest').notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionLatestIdx: index('chat_session_summaries_session_latest_idx').on(
      table.chatSessionId,
      table.toMessageId,
    ),
  }),
);

export const chatSessionSummariesRelations = relations(chatSessionSummaries, ({ one }) => ({
  chatSession: one(conversations, {
    fields: [chatSessionSummaries.chatSessionId],
    references: [conversations.id],
  }),
  fromMessage: one(messages, {
    fields: [chatSessionSummaries.fromMessageId],
    references: [messages.id],
  }),
  toMessage: one(messages, {
    fields: [chatSessionSummaries.toMessageId],
    references: [messages.id],
  }),
}));

export type ChatSessionSummary = typeof chatSessionSummaries.$inferSelect;
export type NewChatSessionSummary = typeof chatSessionSummaries.$inferInsert;
```

The `index` (not `uniqueIndex`) supports the latest-row lookup; uniqueness is not required because append-only rows for the same session legitimately share a `chat_session_id`.

- [ ] **Step 2: Generate the migration**

```bash
cd backend
bun run db:generate
```

Expected output: one new file under `backend/drizzle/migrations/` with a random Drizzle-generated name (e.g. `0067_quick_otto_otto.sql`).

- [ ] **Step 3: Rename the migration per CLAUDE.md convention**

Determine the next sequence number by listing existing migrations:

```bash
ls backend/drizzle/migrations/ | sort | tail -5
```

The new file's prefix matches its `_journal.json` sequence number — keep that prefix; only the descriptive suffix changes. Example: if `db:generate` produced `0067_quick_otto_otto.sql`, rename to `0067_add_chat_session_summaries.sql`.

```bash
# Replace OLDNAME with the actual generated filename
mv backend/drizzle/migrations/0067_quick_otto_otto.sql \
   backend/drizzle/migrations/0067_add_chat_session_summaries.sql
```

- [ ] **Step 4: Update `_journal.json`**

Edit `backend/drizzle/meta/_journal.json`. Find the most recent entry (the one with the highest `idx`). Its `tag` field still references the old random name. Replace the `tag` value with the new name (without `.sql`):

```json
{
  "idx": 67,
  "version": "7",
  "when": <timestamp>,
  "tag": "0067_add_chat_session_summaries",
  "breakpoints": true
}
```

(Snapshot files are not renamed.)

- [ ] **Step 5: Apply the migration**

```bash
cd backend
bun run db:migrate
```

Expected: the migration applies cleanly to the local dev DB.

- [ ] **Step 6: Verify no drift**

```bash
bun run db:generate
```

Expected output: `No schema changes` (Drizzle reports the schema is in sync with migrations).

- [ ] **Step 7: Typecheck**

```bash
bun x tsc --noEmit
```

Expected: no errors. The new `chatSessionSummaries` symbol is automatically exported via the `export * from './conversation.schema'` in `database.schema.ts`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/schemas/conversation.schema.ts \
        backend/drizzle/migrations/0067_add_chat_session_summaries.sql \
        backend/drizzle/meta/_journal.json \
        backend/drizzle/meta/0067_snapshot.json
git commit -m "feat(db): add chat_session_summaries table (IND-297)"
```

(Replace `0067` with the actual sequence number from your machine.)

---

## Task 6: Add `ChatSummaryDatabaseAdapter` + tests

**Files:**
- Create: `backend/src/adapters/chat-summary.database.adapter.ts`
- Create: `backend/src/adapters/tests/chat-summary.database.adapter.spec.ts`

Per CLAUDE.md: adapters are named by concept, not tech (`chat-summary.database.adapter.ts`, not `chat-summary.drizzle.adapter.ts`).

- [ ] **Step 1: Write the failing test**

Create `backend/src/adapters/tests/chat-summary.database.adapter.spec.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../lib/drizzle/drizzle.js";
import * as schema from "../../schemas/database.schema.js";
import { ChatSummaryDatabaseAdapter } from "../chat-summary.database.adapter.js";

const adapter = new ChatSummaryDatabaseAdapter();

async function makeConversationWithMessages(messageCount: number): Promise<{ sessionId: string; messageIds: string[] }> {
  const sessionId = crypto.randomUUID();
  await db.insert(schema.conversations).values({ id: sessionId });
  const ids: string[] = [];
  for (let i = 0; i < messageCount; i++) {
    const mid = crypto.randomUUID();
    await db.insert(schema.messages).values({
      id: mid,
      conversationId: sessionId,
      senderId: 'sender-1',
      role: i % 2 === 0 ? 'user' : 'agent',
      parts: [{ type: 'text', text: `msg-${i}` }],
    });
    ids.push(mid);
    // Tiny stagger so createdAt orders deterministically (timestamps default to now()).
    await new Promise((r) => setTimeout(r, 5));
  }
  return { sessionId, messageIds: ids };
}

const createdSessions: string[] = [];

afterAll(async () => {
  for (const id of createdSessions) {
    await db.delete(schema.conversations).where(eq(schema.conversations.id, id)).catch(() => {});
  }
});

describe("ChatSummaryDatabaseAdapter", () => {
  it("getLatest returns null for a session with no summaries", async () => {
    const { sessionId } = await makeConversationWithMessages(0);
    createdSessions.push(sessionId);
    const latest = await adapter.getLatest(sessionId);
    expect(latest).toBeNull();
  });

  it("getMessagesAfter returns all messages when cursor is null", async () => {
    const { sessionId, messageIds } = await makeConversationWithMessages(3);
    createdSessions.push(sessionId);
    const msgs = await adapter.getMessagesAfter(sessionId, null);
    expect(msgs).toHaveLength(3);
    expect(msgs.map((m) => m.id)).toEqual(messageIds);
  });

  it("getMessagesAfter returns only messages strictly after the cursor", async () => {
    const { sessionId, messageIds } = await makeConversationWithMessages(4);
    createdSessions.push(sessionId);
    const msgs = await adapter.getMessagesAfter(sessionId, messageIds[1]);
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.id)).toEqual([messageIds[2], messageIds[3]]);
  });

  it("insertSummary persists a row and getLatest returns it", async () => {
    const { sessionId, messageIds } = await makeConversationWithMessages(2);
    createdSessions.push(sessionId);
    await adapter.insertSummary({
      sessionId,
      fromMessageId: messageIds[0],
      toMessageId: messageIds[1],
      digest: {
        statedFacts: ["Pre-revenue"],
        openQuestions: [],
        rejectionReasons: [],
        surfacedFindings: [],
      },
      model: "google/gemini-2.5-flash",
    });
    const latest = await adapter.getLatest(sessionId);
    expect(latest).not.toBeNull();
    expect(latest!.toMessageId).toBe(messageIds[1]);
    expect(latest!.digest.statedFacts).toEqual(["Pre-revenue"]);
  });

  it("getLatest returns the row with the most recent toMessageId after multiple inserts", async () => {
    const { sessionId, messageIds } = await makeConversationWithMessages(4);
    createdSessions.push(sessionId);
    await adapter.insertSummary({
      sessionId,
      fromMessageId: messageIds[0],
      toMessageId: messageIds[1],
      digest: { statedFacts: ["a"], openQuestions: [], rejectionReasons: [], surfacedFindings: [] },
      model: "google/gemini-2.5-flash",
    });
    await adapter.insertSummary({
      sessionId,
      fromMessageId: messageIds[0],
      toMessageId: messageIds[3],
      digest: { statedFacts: ["a", "b"], openQuestions: [], rejectionReasons: [], surfacedFindings: [] },
      model: "google/gemini-2.5-flash",
    });
    const latest = await adapter.getLatest(sessionId);
    expect(latest!.toMessageId).toBe(messageIds[3]);
    expect(latest!.digest.statedFacts).toEqual(["a", "b"]);
  });

  it("cascade: deleting the conversation removes summary rows", async () => {
    const { sessionId, messageIds } = await makeConversationWithMessages(1);
    await adapter.insertSummary({
      sessionId,
      fromMessageId: messageIds[0],
      toMessageId: messageIds[0],
      digest: { statedFacts: [], openQuestions: [], rejectionReasons: [], surfacedFindings: [] },
      model: "google/gemini-2.5-flash",
    });
    await db.delete(schema.conversations).where(eq(schema.conversations.id, sessionId));
    const rows = await db
      .select()
      .from(schema.chatSessionSummaries)
      .where(eq(schema.chatSessionSummaries.chatSessionId, sessionId));
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
bun test src/adapters/tests/chat-summary.database.adapter.spec.ts
```

Expected: FAIL with `Cannot find module '../chat-summary.database.adapter.js'`.

- [ ] **Step 3: Write the adapter**

Create `backend/src/adapters/chat-summary.database.adapter.ts`:

```ts
/**
 * Drizzle-backed I/O for the chat_session_summaries table. Pure persistence;
 * no business logic. Wrapped by ChatSummaryService.
 */
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import type { ChatContextDigest } from '@indexnetwork/protocol';
import type { ChatSummarizerMessage } from '@indexnetwork/protocol';

export interface ChatSummaryRow {
  id: string;
  chatSessionId: string;
  fromMessageId: string;
  toMessageId: string;
  digest: ChatContextDigest;
  model: string;
  createdAt: Date;
}

export interface MessageForSummarizer extends ChatSummarizerMessage {
  id: string;
  createdAt: Date;
}

export interface InsertChatSummaryInput {
  sessionId: string;
  fromMessageId: string;
  toMessageId: string;
  digest: ChatContextDigest;
  model: string;
}

export class ChatSummaryDatabaseAdapter {
  /** Latest summary row for the session, or null. */
  async getLatest(sessionId: string): Promise<ChatSummaryRow | null> {
    const rows = await db
      .select()
      .from(schema.chatSessionSummaries)
      .where(eq(schema.chatSessionSummaries.chatSessionId, sessionId))
      .orderBy(desc(schema.chatSessionSummaries.toMessageId), desc(schema.chatSessionSummaries.createdAt))
      .limit(1);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      chatSessionId: r.chatSessionId,
      fromMessageId: r.fromMessageId,
      toMessageId: r.toMessageId,
      digest: r.digest as ChatContextDigest,
      model: r.model,
      createdAt: r.createdAt,
    };
  }

  /**
   * Messages strictly after the cursor (by createdAt). Cursor null = all session messages.
   */
  async getMessagesAfter(sessionId: string, cursorMessageId: string | null): Promise<MessageForSummarizer[]> {
    let cursorCreatedAt: Date | null = null;
    if (cursorMessageId) {
      const cursorRow = await db
        .select({ createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(eq(schema.messages.id, cursorMessageId))
        .limit(1);
      cursorCreatedAt = cursorRow[0]?.createdAt ?? null;
    }

    const baseConds = [eq(schema.messages.conversationId, sessionId)];
    if (cursorCreatedAt) baseConds.push(gt(schema.messages.createdAt, cursorCreatedAt));

    const rows = await db
      .select()
      .from(schema.messages)
      .where(and(...baseConds))
      .orderBy(asc(schema.messages.createdAt));

    return rows.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      role: m.role === 'agent' ? 'assistant' : 'user',
      content: extractTextContent(m.parts as Array<{ type?: string; text?: string }>),
    }));
  }

  async insertSummary(input: InsertChatSummaryInput): Promise<ChatSummaryRow> {
    const [inserted] = await db
      .insert(schema.chatSessionSummaries)
      .values({
        chatSessionId: input.sessionId,
        fromMessageId: input.fromMessageId,
        toMessageId: input.toMessageId,
        digest: input.digest,
        model: input.model,
      })
      .returning();
    return {
      id: inserted.id,
      chatSessionId: inserted.chatSessionId,
      fromMessageId: inserted.fromMessageId,
      toMessageId: inserted.toMessageId,
      digest: inserted.digest as ChatContextDigest,
      model: inserted.model,
      createdAt: inserted.createdAt,
    };
  }
}

function extractTextContent(parts: Array<{ type?: string; text?: string }> | null | undefined): string {
  if (!parts) return '';
  const text = parts.find((p) => p?.type === 'text' && typeof p.text === 'string')?.text
    ?? parts.find((p) => typeof p?.text === 'string')?.text
    ?? '';
  return text ?? '';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
bun test src/adapters/tests/chat-summary.database.adapter.spec.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

```bash
bun x tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/chat-summary.database.adapter.ts \
        backend/src/adapters/tests/chat-summary.database.adapter.spec.ts
git commit -m "feat(backend): add ChatSummaryDatabaseAdapter (IND-297)"
```

---

## Task 7: Add `ChatSummaryService` + integration tests

**Files:**
- Create: `backend/src/services/chat-summary.service.ts`
- Create: `backend/src/services/tests/chat-summary.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/tests/chat-summary.service.spec.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../lib/drizzle/drizzle.js";
import * as schema from "../../schemas/database.schema.js";
import { ChatSummaryDatabaseAdapter } from "../../adapters/chat-summary.database.adapter.js";
import { ChatSummaryService } from "../chat-summary.service.js";
import type { ChatContextDigest } from "@indexnetwork/protocol";

const sampleDigest: ChatContextDigest = {
  statedFacts: ["Pre-revenue"],
  openQuestions: [],
  rejectionReasons: [],
  surfacedFindings: [],
};

async function makeConversationWithMessages(messageCount: number): Promise<{ sessionId: string; messageIds: string[] }> {
  const sessionId = crypto.randomUUID();
  await db.insert(schema.conversations).values({ id: sessionId });
  const ids: string[] = [];
  for (let i = 0; i < messageCount; i++) {
    const mid = crypto.randomUUID();
    await db.insert(schema.messages).values({
      id: mid,
      conversationId: sessionId,
      senderId: 'sender-1',
      role: i % 2 === 0 ? 'user' : 'agent',
      parts: [{ type: 'text', text: `msg-${i}` }],
    });
    ids.push(mid);
    await new Promise((r) => setTimeout(r, 5));
  }
  return { sessionId, messageIds: ids };
}

const created: string[] = [];
afterAll(async () => {
  for (const id of created) {
    await db.delete(schema.conversations).where(eq(schema.conversations.id, id)).catch(() => {});
  }
});

function makeService(summarizeImpl: (input: unknown) => Promise<ChatContextDigest | null>) {
  const adapter = new ChatSummaryDatabaseAdapter();
  const fakeSummarizer = { summarize: mock(summarizeImpl) };
  return {
    service: new ChatSummaryService(adapter, fakeSummarizer as unknown as { summarize: typeof summarizeImpl }),
    summarizeMock: fakeSummarizer.summarize,
  };
}

describe("ChatSummaryService", () => {
  it("getDigest returns null for an empty session", async () => {
    const { sessionId } = await makeConversationWithMessages(0);
    created.push(sessionId);
    const { service, summarizeMock } = makeService(async () => sampleDigest);

    const result = await service.getDigest(sessionId);

    expect(result).toBeNull();
    expect(summarizeMock).not.toHaveBeenCalled();
  });

  it("getDigest runs summarizer on first call and persists a row", async () => {
    const { sessionId, messageIds } = await makeConversationWithMessages(2);
    created.push(sessionId);
    const { service, summarizeMock } = makeService(async () => sampleDigest);

    const result = await service.getDigest(sessionId);

    expect(result).toEqual(sampleDigest);
    expect(summarizeMock).toHaveBeenCalledTimes(1);

    const rows = await db
      .select()
      .from(schema.chatSessionSummaries)
      .where(eq(schema.chatSessionSummaries.chatSessionId, sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0].fromMessageId).toBe(messageIds[0]);
    expect(rows[0].toMessageId).toBe(messageIds[1]);
  });

  it("getDigest returns persisted digest without calling summarizer when no new messages", async () => {
    const { sessionId, messageIds } = await makeConversationWithMessages(2);
    created.push(sessionId);
    const { service: first } = makeService(async () => sampleDigest);
    await first.getDigest(sessionId);

    const { service: second, summarizeMock } = makeService(async () => sampleDigest);
    const result = await second.getDigest(sessionId);

    expect(result).toEqual(sampleDigest);
    expect(summarizeMock).not.toHaveBeenCalled();
  });

  it("getDigest runs summarizer incrementally with previous digest + new messages", async () => {
    const { sessionId, messageIds } = await makeConversationWithMessages(2);
    created.push(sessionId);
    const { service: first } = makeService(async () => sampleDigest);
    await first.getDigest(sessionId);

    // Add 2 more messages
    const newMid1 = crypto.randomUUID();
    const newMid2 = crypto.randomUUID();
    await db.insert(schema.messages).values({ id: newMid1, conversationId: sessionId, senderId: 's', role: 'user', parts: [{ type: 'text', text: 'new1' }] });
    await new Promise((r) => setTimeout(r, 5));
    await db.insert(schema.messages).values({ id: newMid2, conversationId: sessionId, senderId: 's', role: 'agent', parts: [{ type: 'text', text: 'new2' }] });

    const updatedDigest: ChatContextDigest = {
      statedFacts: ["Pre-revenue", "Updated fact"],
      openQuestions: [],
      rejectionReasons: [],
      surfacedFindings: [],
    };
    let capturedInput: unknown = null;
    const { service: second, summarizeMock } = makeService(async (input) => {
      capturedInput = input;
      return updatedDigest;
    });

    const result = await second.getDigest(sessionId);

    expect(result).toEqual(updatedDigest);
    expect(summarizeMock).toHaveBeenCalledTimes(1);
    expect((capturedInput as { previousDigest: ChatContextDigest }).previousDigest).toEqual(sampleDigest);
    expect((capturedInput as { newMessages: Array<{ content: string }> }).newMessages.map((m) => m.content)).toEqual(['new1', 'new2']);

    // Both rows should exist (append-only).
    const rows = await db
      .select()
      .from(schema.chatSessionSummaries)
      .where(eq(schema.chatSessionSummaries.chatSessionId, sessionId));
    expect(rows).toHaveLength(2);
  });

  it("getDigest returns previousDigest unchanged when summarizer returns null", async () => {
    const { sessionId, messageIds } = await makeConversationWithMessages(2);
    created.push(sessionId);
    const { service: first } = makeService(async () => sampleDigest);
    await first.getDigest(sessionId);

    const newMid = crypto.randomUUID();
    await db.insert(schema.messages).values({ id: newMid, conversationId: sessionId, senderId: 's', role: 'user', parts: [{ type: 'text', text: 'new' }] });

    const { service: second } = makeService(async () => null);
    const result = await second.getDigest(sessionId);

    expect(result).toEqual(sampleDigest);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
bun test src/services/tests/chat-summary.service.spec.ts
```

Expected: FAIL with `Cannot find module '../chat-summary.service.js'`.

- [ ] **Step 3: Write the service**

Create `backend/src/services/chat-summary.service.ts`:

```ts
/**
 * ChatSummaryService — implements the protocol's ChatSummaryReader contract.
 * Orchestrates read-from-DB → summarize → write-to-DB on every call so callers
 * always get an up-to-date digest (or null if the session has no content yet).
 */
import { ChatSummaryDatabaseAdapter, type ChatSummaryRow } from '../adapters/chat-summary.database.adapter';
import { ChatSummarizer } from '@indexnetwork/protocol';
import type { ChatContextDigest, ChatSummaryReader } from '@indexnetwork/protocol';
import { getModelName } from '@indexnetwork/protocol';
import { log } from '../lib/observability/log';

const logger = log.service.from('ChatSummaryService');

/** Minimal summarizer shape — used as the constructor type so tests can inject a fake. */
export interface ChatSummarizerLike {
  summarize(input: {
    previousDigest: ChatContextDigest | null;
    newMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<ChatContextDigest | null>;
}

export class ChatSummaryService implements ChatSummaryReader {
  constructor(
    private readonly adapter: ChatSummaryDatabaseAdapter,
    private readonly summarizer: ChatSummarizerLike = new ChatSummarizer(),
  ) {}

  async getDigest(sessionId: string): Promise<ChatContextDigest | null> {
    let prev: ChatSummaryRow | null = null;
    try {
      prev = await this.adapter.getLatest(sessionId);
    } catch (err) {
      logger.warn('chat-summary getLatest failed', { sessionId, error: errString(err) });
      return null;
    }

    let newMessages: Awaited<ReturnType<ChatSummaryDatabaseAdapter['getMessagesAfter']>>;
    try {
      newMessages = await this.adapter.getMessagesAfter(sessionId, prev?.toMessageId ?? null);
    } catch (err) {
      logger.warn('chat-summary getMessagesAfter failed', { sessionId, error: errString(err) });
      return prev?.digest ?? null;
    }

    if (newMessages.length === 0) {
      return prev?.digest ?? null;
    }

    const digest = await this.summarizer.summarize({
      previousDigest: prev?.digest ?? null,
      newMessages: newMessages.map((m) => ({ role: m.role, content: m.content })),
    });

    if (!digest) {
      return prev?.digest ?? null;
    }

    try {
      await this.adapter.insertSummary({
        sessionId,
        fromMessageId: prev?.fromMessageId ?? newMessages[0].id,
        toMessageId: newMessages[newMessages.length - 1].id,
        digest,
        model: getModelName('chatContextSummarizer'),
      });
    } catch (err) {
      logger.warn('chat-summary insertSummary failed', { sessionId, error: errString(err) });
      // Still return the fresh digest — caller benefits even if persistence fails.
    }

    return digest;
  }
}

function errString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

Note: this imports `getModelName` from `@indexnetwork/protocol`. Verify the function is exported there. If not, add the export in `packages/protocol/src/index.ts`:

```ts
export { getModelName } from "./shared/agent/model.config.js";
```

(That function exists at `packages/protocol/src/shared/agent/model.config.ts` line 74-ish — used by the opportunity graph already.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
bun test src/services/tests/chat-summary.service.spec.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

```bash
bun x tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/chat-summary.service.ts \
        backend/src/services/tests/chat-summary.service.spec.ts
# If the protocol export was added:
git add packages/protocol/src/index.ts
git commit -m "feat(backend): add ChatSummaryService implementing ChatSummaryReader (IND-297)"
```

---

## Task 8: Wire `chatSummary` into the composition root

**Files:**
- Modify: `backend/src/controllers/mcp.controller.ts` (lines 72–105, the `protocolDeps` object)

Slice 1 does not yet have a consumer in the protocol layer — the wire-in happens here so Slice 3 (discovery integration) can read it from `protocolDeps`. After this task, `protocolDeps.chatSummary` is available but unused by any graph.

- [ ] **Step 1: Add instantiation + property**

Open `backend/src/controllers/mcp.controller.ts`. Locate the existing instantiation block around line 50–55:

```ts
const integration = new ComposioIntegrationAdapter();
const integrationImporter = new IntegrationService(integration, contactService);
const agentDispatcher = new AgentDispatcherImpl(agentService, negotiationTimeoutQueue);
```

Add after these lines:

```ts
const chatSummaryAdapter = new ChatSummaryDatabaseAdapter();
const chatSummaryService = new ChatSummaryService(chatSummaryAdapter);
```

And add the corresponding imports at the top of the file. Locate the existing `import { ChatGraphFactory } from "@indexnetwork/protocol";` line (or whichever protocol-import line is closest); add nearby:

```ts
import { ChatSummaryDatabaseAdapter } from "../adapters/chat-summary.database.adapter";
import { ChatSummaryService } from "../services/chat-summary.service";
```

In the `protocolDeps` object literal (lines 72–105), add a new property. Insert immediately after `chatSession: chatSessionAdapter,` (around line 81):

```ts
  chatSession: chatSessionAdapter,
  chatSummary: chatSummaryService,
```

- [ ] **Step 2: Extend the `ProtocolDeps` type**

The protocol's `ProtocolDeps` type lives in `packages/protocol/src/shared/agent/tool.helpers.ts` (or similar — search for `interface ProtocolDeps` if not there).

```bash
grep -rn "interface ProtocolDeps\|type ProtocolDeps" packages/protocol/src --include="*.ts" | head -5
```

Open the file that defines it. Add an optional field:

```ts
  /** Read-through chat-session digest. Optional; consumers fall back to undefined `chatContext`. */
  chatSummary?: ChatSummaryReader;
```

Import `ChatSummaryReader` at the top of that file:

```ts
import type { ChatSummaryReader } from "../interfaces/chat-summary.interface.js";
```

- [ ] **Step 3: Typecheck both workspaces**

```bash
cd packages/protocol && bun x tsc --noEmit
cd ../../backend && bun x tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Boot-smoke**

```bash
cd backend
bun run dev &     # start the dev server in the background
BOOT_PID=$!
sleep 5
kill $BOOT_PID
```

Expected: server starts without errors before being killed. Check the log output — no missing-dep crashes.

If `bun run dev` blocks the shell, run it in another terminal and verify it starts; then `Ctrl-C` it.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/mcp.controller.ts \
        packages/protocol/src/shared/agent/tool.helpers.ts
git commit -m "feat(backend): wire chatSummary into protocolDeps composition root (IND-297)"
```

---

## Task 9: Bundled rename — `negotiation.insights.generator.ts` → `negotiation/insight.generator.ts`

**Files:**
- Move: `packages/protocol/src/negotiation/negotiation.insights.generator.ts` → `negotiation/insight.generator.ts`
- Move: `packages/protocol/src/negotiation/tests/negotiation.insights.generator.spec.ts` → `negotiation/tests/insight.generator.spec.ts`
- Modify: `packages/protocol/src/index.ts` (import path)
- Modify: `backend/src/controllers/user.controller.ts` (line 10: import path)

Class name `NegotiationInsightsGenerator` is **unchanged**; only filenames + import paths change.

- [ ] **Step 1: Move the source file**

```bash
git mv packages/protocol/src/negotiation/negotiation.insights.generator.ts \
       packages/protocol/src/negotiation/insight.generator.ts
```

- [ ] **Step 2: Move the test file**

```bash
git mv packages/protocol/src/negotiation/tests/negotiation.insights.generator.spec.ts \
       packages/protocol/src/negotiation/tests/insight.generator.spec.ts
```

- [ ] **Step 3: Update the import inside the moved test**

Open `packages/protocol/src/negotiation/tests/insight.generator.spec.ts`. Find:

```ts
import { NegotiationInsightsGenerator } from "../negotiation.insights.generator.js";
```

Change to:

```ts
import { NegotiationInsightsGenerator } from "../insight.generator.js";
```

- [ ] **Step 4: Update protocol index export**

Open `packages/protocol/src/index.ts`. Search for `negotiation.insights.generator`:

```bash
grep -n "negotiation.insights.generator" packages/protocol/src/index.ts
```

Update the export path from `./negotiation/negotiation.insights.generator.js` to `./negotiation/insight.generator.js`.

- [ ] **Step 5: Update backend user controller**

Open `backend/src/controllers/user.controller.ts`. The import on line 10 is from `@indexnetwork/protocol`, so it should NOT need a change (it imports the symbol, not the path). Verify:

```bash
grep -n "NegotiationInsightsGenerator" backend/src/controllers/user.controller.ts
```

If the import is `import { NegotiationInsightsGenerator } from '@indexnetwork/protocol';`, no change needed (the rename is internal to the protocol package). If it uses a deep path, update the path.

- [ ] **Step 6: Run the renamed test**

```bash
cd packages/protocol
bun test src/negotiation/tests/insight.generator.spec.ts
```

Expected: PASS (the existing 3 tests, unchanged). Note that test 2 and 3 hit a real LLM (per the original spec file) and require `OPENROUTER_API_KEY`; skip those locally if no key is set by running only the empty-history test:

```bash
bun test src/negotiation/tests/insight.generator.spec.ts -t "returns null for empty negotiation history"
```

Expected: PASS.

- [ ] **Step 7: Typecheck both workspaces**

```bash
cd packages/protocol && bun x tsc --noEmit
cd ../../backend && bun x tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/protocol/src/negotiation/insight.generator.ts \
        packages/protocol/src/negotiation/tests/insight.generator.spec.ts \
        packages/protocol/src/index.ts \
        backend/src/controllers/user.controller.ts
git commit -m "refactor(protocol): rename negotiation.insights.generator.ts to insight.generator.ts (IND-297)"
```

---

## Task 10: Final lint + typecheck + slice acceptance

**Files:**
- (none — verification only)

- [ ] **Step 1: Lint protocol package**

```bash
cd packages/protocol
bun run lint
```

Expected: clean. Fix any issues; commit per offending file with `style: lint` if needed.

- [ ] **Step 2: Lint backend**

```bash
cd ../../backend
bun run lint
```

Expected: clean.

- [ ] **Step 3: Typecheck protocol**

```bash
cd ../packages/protocol
bun x tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Typecheck backend**

```bash
cd ../../backend
bun x tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run the slice's test suite**

```bash
cd ../packages/protocol
bun test src/shared/schemas/tests/chat-context.schema.spec.ts \
         src/chat/tests/chat.summarizer.spec.ts \
         src/negotiation/tests/insight.generator.spec.ts -t "returns null for empty"

cd ../../backend
bun test src/adapters/tests/chat-summary.database.adapter.spec.ts \
         src/services/tests/chat-summary.service.spec.ts
```

Expected: all tests pass.

- [ ] **Step 6: Drift check**

```bash
cd backend
bun run db:generate
```

Expected: `No schema changes`.

- [ ] **Step 7: Mark Linear IND-297 in-progress with a status comment**

Per the CLAUDE.md `feedback_linear_comments` memory: don't modify the issue description — comment instead.

```bash
# Use gh/Linear CLI or the Linear MCP to add a comment to IND-297:
# "Slice 1 complete on branch feat/decision-questions: schema, summarizer, table, adapter, service, composition wire-in, and bundled rename landed. Ready for review."
```

(If using subagent-driven-development, the orchestrator may handle this comment via the Linear MCP after final review.)

- [ ] **Step 8: Final commit if any lint fixes**

If steps 1–4 required fixes, commit them under one message:

```bash
git add -A
git commit -m "style: lint cleanup after IND-297 slice"
```

---

## Acceptance summary (matches spec)

- [x] `chat_session_summaries` table created via Drizzle; index `(chat_session_id, to_message_id DESC)` present.
- [x] `bun run db:generate` reports `No schema changes` after the migration applies.
- [x] `ChatContextDigest` Zod schema + type exported from `@indexnetwork/protocol`.
- [x] `ChatSummarizer` pure LLM pass exported; tests covering: no-new-messages no-op, fresh LLM call, LLM-throw → null, content truncation.
- [x] `ChatSummaryReader` interface exported from protocol.
- [x] `ChatSummaryDatabaseAdapter` integration-tested against real Postgres.
- [x] `ChatSummaryService` integration-tested: empty-session → null, first-call → insert, no-new-messages → cached return, incremental call → both rows append, summarizer-null → previousDigest returned.
- [x] `protocolDeps.chatSummary` wired into the composition root in `mcp.controller.ts`.
- [x] `NegotiationInsightsGenerator` import path updated; tests still pass.
- [x] `bun run lint` + `tsc --noEmit` clean for both workspaces.

---

## Execution

After saving the plan, the user wants subagent-driven development per slice with testing in between. Slice 1 is the first slice; once it's implemented and accepted, Slice 2's plan will be written.

REQUIRED SUB-SKILL for execution: `superpowers:subagent-driven-development` with `superpowers:using-git-worktrees` to ensure the `.worktrees/feat-decision-questions` worktree exists before Task 1.
