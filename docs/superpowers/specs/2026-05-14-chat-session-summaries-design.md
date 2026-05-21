# Slice 1 — Chat-session summaries

**Status:** approved (brainstorm) — ready for plan
**Date:** 2026-05-14
**Parent:** [Discovery decision questions — master design](./2026-05-14-discovery-decision-questions-design.md)
**Depends on:** —
**Blocks:** Slice 2 (Question schema + generator)

## Scope

Rolling, incremental chat-session digest persisted in DB. First reusable summarizer pattern in the codebase (after the narrowly-scoped `chat.title.generator.ts`).

Delivers:

1. `chat_session_summaries` table + migration.
2. `ChatContextDigest` shared schema.
3. `ChatSummarizer` pure LLM pass in the protocol layer.
4. `ChatSummaryReader` interface + `ChatSummaryService` backend implementation orchestrating read → summarize → persist.
5. Wired into protocol composition root (`protocol-init.ts`).
6. Bundled rename: `negotiation.insights.generator.ts` → `negotiation/insight.generator.ts`.

This slice does **not** integrate the summarizer into any consumer. Slice 3 wires it into `opportunity.discover.ts`.

## Database

Table `chat_session_summaries`:

| column | type | constraint |
|---|---|---|
| `id` | uuid | pk default gen_random_uuid() |
| `chat_session_id` | uuid | not null, fk → `chat_sessions.id` on delete cascade |
| `from_message_id` | uuid | not null, fk → `messages.id` on delete restrict |
| `to_message_id` | uuid | not null, fk → `messages.id` on delete restrict |
| `digest` | jsonb | not null |
| `model` | varchar | not null |
| `created_at` | timestamptz | not null default now() |

Index: `idx_chat_session_summaries_session_latest (chat_session_id, to_message_id DESC)`.

Append-only. No update path. Cascade from chat session deletion; if a referenced message is deleted, the foreign key restrict-deletes — soft deletes on messages are expected anyway.

Migration file (post-rename per CLAUDE.md): `NNNN_add_chat_session_summaries.sql`. `_journal.json` `tag` updated to match.

## Shared schema

New file `packages/protocol/src/shared/schemas/chat-context.schema.ts`:

```ts
import { z } from "zod";

export const ChatContextDigestSchema = z.object({
  statedFacts: z.array(z.string()).max(20),
  openQuestions: z.array(z.string()).max(10),
  rejectionReasons: z.array(z.string()).max(10),
  surfacedFindings: z.array(z.string()).max(20),
});

export type ChatContextDigest = z.infer<typeof ChatContextDigestSchema>;
```

Each array bounded by Zod max; the summarizer's prompt enforces "drop stale entries overridden by newer messages."

## Summarizer (pure LLM pass)

New file `packages/protocol/src/chat/chat.summarizer.ts`:

```ts
export class ChatSummarizer {
  constructor() {
    const llm = createModel("chatContextSummarizer");
    this.model = llm.withStructuredOutput(ChatContextDigestSchema, { name: "chat_context_digest" });
  }

  @Timed()
  async summarize(input: {
    previousDigest: ChatContextDigest | null;
    newMessages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<ChatContextDigest | null> {
    if (input.newMessages.length === 0) return input.previousDigest;
    // build prompt; call model; return parsed digest, or null on failure
  }
}
```

- New `model.config.ts` slot: `chatContextSummarizer` (small/fast model).
- Messages truncated to 240 chars each before LLM input.
- System prompt extracts the four fields exactly; instructs the model to drop entries from `previousDigest` that newer messages override.
- Failure → `null`; logged via `protocolLogger("ChatSummarizer")`.

## Backend persistence

### Interface (protocol)

New file `packages/protocol/src/shared/interfaces/chat-summary.interface.ts`:

```ts
export interface ChatSummaryReader {
  /**
   * Returns the freshest digest for the session, running incremental
   * summarization if there are new messages. Returns null when the session
   * has no messages at all, or when summarization fails on a fresh session.
   */
  getDigest(sessionId: string): Promise<ChatContextDigest | null>;
}
```

### Adapter (backend)

New file `backend/src/adapters/chat-summary.database.adapter.ts`:

```ts
export class ChatSummaryDatabaseAdapter {
  getLatest(sessionId: string): Promise<ChatSummaryRow | null>;
  getMessagesAfter(sessionId: string, messageId: string | null): Promise<MessageRow[]>;
  insertSummary(input: {
    sessionId: string;
    fromMessageId: string;
    toMessageId: string;
    digest: ChatContextDigest;
    model: string;
  }): Promise<ChatSummaryRow>;
}
```

Drizzle-backed. No business logic; pure I/O. Belongs in `backend/` per layering rules.

### Service (backend)

New file `backend/src/services/chat-summary.service.ts`:

```ts
export class ChatSummaryService implements ChatSummaryReader {
  constructor(
    private adapter: ChatSummaryDatabaseAdapter,
    private summarizer: ChatSummarizer,
  ) {}

  async getDigest(sessionId: string): Promise<ChatContextDigest | null> {
    const prev = await this.adapter.getLatest(sessionId);
    const cursor = prev?.toMessageId ?? null;
    const newMessages = await this.adapter.getMessagesAfter(sessionId, cursor);
    if (newMessages.length === 0) return prev?.digest ?? null;
    const digest = await this.summarizer.summarize({
      previousDigest: prev?.digest ?? null,
      newMessages: newMessages.map(toSummarizerMessage),
    });
    if (!digest) return prev?.digest ?? null;
    await this.adapter.insertSummary({
      sessionId,
      fromMessageId: prev?.fromMessageId ?? newMessages[0].id,
      toMessageId: newMessages[newMessages.length - 1].id,
      digest,
      model: getModelName("chatContextSummarizer"),
    });
    return digest;
  }
}
```

Race-condition stance: two concurrent calls may produce overlapping rows; both are valid; latest-by-`to` wins. Add a session lock only if observed in practice.

### Composition

`backend/src/protocol-init.ts` instantiates `ChatSummaryDatabaseAdapter` + `ChatSummarizer` + `ChatSummaryService`, exposes the service as `ChatSummaryReader` in `createDefaultProtocolDeps()` so protocol consumers receive it via the existing dep-injection pattern.

## Bundled rename

Move `packages/protocol/src/negotiation/negotiation.insights.generator.ts` → `packages/protocol/src/negotiation/insight.generator.ts`. Class name unchanged.

Update imports:

- `packages/protocol/src/index.ts` (export)
- `backend/src/controllers/user.controller.ts` (import path)
- `packages/protocol/src/negotiation/tests/negotiation.insights.generator.spec.ts` → `insight.generator.spec.ts`

## Tests

### Unit (no LLM, no DB)

`packages/protocol/src/chat/tests/chat.summarizer.spec.ts`:

- No previous digest + N messages → produces digest from scratch.
- Previous digest + 0 messages → returns previousDigest, no LLM call (assert mocked model not invoked).
- Previous digest + new messages → prompt contains both; output is a fresh digest.
- LLM throws → returns `null`.
- LLM returns malformed structured output → Zod parse fails → returns `null`.

`packages/protocol/src/shared/schemas/tests/chat-context.schema.spec.ts`:

- Accepts well-formed digests with empty arrays.
- Rejects arrays exceeding max sizes.

### Service (real Postgres, LLM mocked)

`backend/src/services/tests/chat-summary.service.spec.ts`:

- Migration applied; table + index exist.
- `getDigest` with no prior rows + messages → inserts row, returns digest.
- `getDigest` with prior row + no new messages → returns persisted digest, summarizer not called.
- `getDigest` with prior row + new messages → calls summarizer with `(previousDigest, newMessages)`, inserts new row, both rows persist.
- `getDigest` on empty session → returns `null`.
- Cascade delete: removing the session removes summary rows.

## Acceptance criteria

- [ ] Migration applied; `bun run db:generate` reports "No schema changes" after.
- [ ] Unit tests pass (`bun test packages/protocol/src/chat/tests/chat.summarizer.spec.ts`).
- [ ] Service tests pass (`bun test backend/src/services/tests/chat-summary.service.spec.ts`).
- [ ] `bun run lint` clean.
- [ ] `tsc --noEmit` clean for both workspaces.
- [ ] `NegotiationInsightsGenerator` import path updated everywhere; rename PR builds and tests pass.

## Risks / open questions

- **Latency.** Summarization adds one LLM call on every orchestrator turn with new messages. Mitigations: small model slot; cache hit path skips the call entirely. Monitor `chat_summarizer_end.durationMs` in the trace events introduced in Slice 3.
- **Token budget under long sessions.** As `previousDigest` grows, the prompt size grows. The Zod max-array caps bound the digest at ~40 short strings (~4 KB serialized); within budget. The summarizer's prompt explicitly tells the model to drop overridden entries.
- **Append-only growth.** One row per orchestrator turn per session over time. Negligible for the foreseeable future; a GC maintenance script is left for later.
