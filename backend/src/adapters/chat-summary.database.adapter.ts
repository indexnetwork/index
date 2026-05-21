/**
 * Drizzle-backed I/O for the chat_session_summaries table. Pure persistence;
 * no business logic. Wrapped by ChatSummaryService.
 */
import { and, asc, desc, eq, gt, ne, or } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';

/**
 * Upper bound on rows returned by a single `getMessagesAfter` call. Caps the
 * size of any one summarization pass so large sessions or bursty inserts
 * cannot blow the LLM context window. The service walks the cursor forward,
 * so multiple calls converge on a fully-summarized session.
 *
 * Sized conservatively: 200 messages × 240-char content cap ≈ 48 KB of raw
 * content, well within typical chat-model context budgets after JSON encoding.
 */
export const MAX_MESSAGES_PER_FETCH = 200;

/**
 * The digest payload shape stored in the `digest` jsonb column. Mirrors
 * the protocol-side `ChatContextDigest` but is declared locally per the
 * layering rule (adapters do not import protocol types).
 */
export interface SummaryDigestRow {
  statedFacts: string[];
  openQuestions: string[];
  rejectionReasons: string[];
  surfacedFindings: string[];
}

/** Adapter-side message shape; the protocol-side ChatSummarizerMessage maps onto this 1:1. */
export interface SummarizerMessageRow {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSummaryRow {
  id: string;
  conversationId: string;
  fromMessageId: string;
  toMessageId: string;
  digest: SummaryDigestRow;
  model: string;
  createdAt: Date;
}

export interface MessageForSummarizer extends SummarizerMessageRow {
  id: string;
  createdAt: Date;
}

export interface InsertChatSummaryInput {
  sessionId: string;
  fromMessageId: string;
  toMessageId: string;
  digest: SummaryDigestRow;
  model: string;
}

/**
 * Drizzle-backed adapter for chat session summary rows. Pure I/O over the
 * `chat_session_summaries` table; consumed by ChatSummaryService.
 */
export class ChatSummaryDatabaseAdapter {
  /**
   * Returns the most recent summary for a session, or null if none exists.
   *
   * @param sessionId - The conversation (chat session) id.
   * @returns The latest row (ordered by createdAt desc) or null.
   */
  async getLatest(sessionId: string): Promise<ChatSummaryRow | null> {
    const rows = await db
      .select()
      .from(schema.chatSessionSummaries)
      .where(eq(schema.chatSessionSummaries.conversationId, sessionId))
      // Order by createdAt (not toMessageId): toMessageId is a text UUID, so DESC sorts
      // lexicographically rather than chronologically.
      .orderBy(desc(schema.chatSessionSummaries.createdAt))
      .limit(1);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      conversationId: r.conversationId,
      fromMessageId: r.fromMessageId,
      toMessageId: r.toMessageId,
      digest: r.digest as SummaryDigestRow,
      model: r.model,
      createdAt: r.createdAt,
    };
  }

  /**
   * Returns session messages strictly after a cursor message (ordered by createdAt asc).
   *
   * @param sessionId - The conversation (chat session) id.
   * @param cursorMessageId - Cursor message id (exclusive). Null returns all session messages.
   * @returns Ordered messages with role normalized to `'user' | 'assistant'`.
   */
  async getMessagesAfter(sessionId: string, cursorMessageId: string | null): Promise<MessageForSummarizer[]> {
    let cursorCreatedAt: Date | null = null;
    if (cursorMessageId) {
      // Scope cursor lookup by (id, conversationId): a foreign cursor (one whose
      // message belongs to a different conversation) is treated as null, so we
      // return all session messages rather than filtering by an unrelated time.
      const cursorRow = await db
        .select({ createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(and(
          eq(schema.messages.id, cursorMessageId),
          eq(schema.messages.conversationId, sessionId),
        ))
        .limit(1);
      cursorCreatedAt = cursorRow[0]?.createdAt ?? null;
    }

    const baseConds = [eq(schema.messages.conversationId, sessionId)];
    if (cursorCreatedAt && cursorMessageId) {
      // Keyset cursor over (createdAt, id): a row is "strictly after" the cursor
      // when its tuple sorts after the cursor's tuple under (createdAt asc, id asc).
      //   gt-branch:  createdAt > X  (and id != cursorId, to defend against the
      //               cursor row leaking through when PG microsecond precision
      //               vs JS millisecond precision causes its PG createdAt to
      //               compare strictly greater than the round-tripped X).
      //   eq-branch:  createdAt = X AND id > cursorId  (proper tuple ordering —
      //               same-createdAt siblings with id < cursorId sort BEFORE the
      //               cursor and must NOT be returned).
      const tupleAfter = or(
        and(
          gt(schema.messages.createdAt, cursorCreatedAt),
          ne(schema.messages.id, cursorMessageId),
        ),
        and(
          eq(schema.messages.createdAt, cursorCreatedAt),
          gt(schema.messages.id, cursorMessageId),
        ),
      );
      if (tupleAfter) baseConds.push(tupleAfter);
    }

    // Cap the batch size so a long-running session or a large burst can't blow
    // the LLM context. Incremental cursor advancement converges across calls:
    // each pass summarizes up to MAX_MESSAGES_PER_FETCH rows and the next call
    // picks up where this one left off.
    const rows = await db
      .select({
        id: schema.messages.id,
        createdAt: schema.messages.createdAt,
        role: schema.messages.role,
        parts: schema.messages.parts,
      })
      .from(schema.messages)
      .where(and(...baseConds))
      // Deterministic secondary sort by id breaks ties when same-timestamp rows
      // are returned, so callers see a stable order across runs.
      .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
      .limit(MAX_MESSAGES_PER_FETCH);

    return rows.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      role: m.role === 'agent' ? 'assistant' : 'user',
      content: extractTextContent(m.parts as Array<{ type?: string; text?: string }>),
    }));
  }

  /**
   * Inserts a new chat summary row and returns the persisted shape.
   *
   * @param input - Summary fields. `sessionId` maps to the `conversation_id` column.
   * @returns The inserted row, including server-generated id and createdAt.
   */
  async insertSummary(input: InsertChatSummaryInput): Promise<ChatSummaryRow> {
    const [inserted] = await db
      .insert(schema.chatSessionSummaries)
      .values({
        conversationId: input.sessionId,
        fromMessageId: input.fromMessageId,
        toMessageId: input.toMessageId,
        digest: input.digest,
        model: input.model,
      })
      .returning();
    return {
      id: inserted.id,
      conversationId: inserted.conversationId,
      fromMessageId: inserted.fromMessageId,
      toMessageId: inserted.toMessageId,
      digest: inserted.digest as SummaryDigestRow,
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
