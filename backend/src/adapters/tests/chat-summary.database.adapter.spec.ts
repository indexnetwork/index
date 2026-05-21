import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import db from "../../lib/drizzle/drizzle.js";
import * as schema from "../../schemas/database.schema.js";

import { ChatSummaryDatabaseAdapter } from "../chat-summary.database.adapter.js";

const adapter = new ChatSummaryDatabaseAdapter();

async function makeConversationWithMessages(messageCount: number): Promise<{ sessionId: string; messageIds: string[] }> {
  const sessionId = crypto.randomUUID();
  await db.insert(schema.conversations).values({ id: sessionId });
  const ids: string[] = [];
  // Use explicit, monotonically-increasing createdAt values (1s apart) so the
  // order is deterministic regardless of clock resolution. Relying on the
  // server-side default + setTimeout is flaky when PG `now()` doesn't advance
  // between rapid inserts.
  const baseTime = Date.now();
  for (let i = 0; i < messageCount; i++) {
    const mid = crypto.randomUUID();
    await db.insert(schema.messages).values({
      id: mid,
      conversationId: sessionId,
      senderId: 'sender-1',
      role: i % 2 === 0 ? 'user' : 'agent',
      parts: [{ type: 'text', text: `msg-${i}` }],
      createdAt: new Date(baseTime + i * 1000),
    });
    ids.push(mid);
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

  it("getMessagesAfter treats a foreign cursor (different conversation) as null", async () => {
    const { sessionId: sessionA, messageIds: idsA } = await makeConversationWithMessages(3);
    const { sessionId: sessionB } = await makeConversationWithMessages(2);
    createdSessions.push(sessionA, sessionB);
    // Pass a cursor from sessionA while querying sessionB — must not compute a
    // wrong timestamp from sessionA's row; should return all of sessionB's messages.
    const msgs = await adapter.getMessagesAfter(sessionB, idsA[1]);
    expect(msgs).toHaveLength(2);
  });

  it("getMessagesAfter returns same-createdAt siblings (tuple cursor)", async () => {
    const sessionId = crypto.randomUUID();
    createdSessions.push(sessionId);
    await db.insert(schema.conversations).values({ id: sessionId });

    // Two messages sharing the exact same createdAt (cursor + sibling).
    // 'aaa' sorts before 'bbb' lexicographically, so 'aaa' is the cursor and
    // 'bbb' must be returned after — the gt-only predicate would have dropped it.
    const shared = new Date('2026-05-15T10:00:00.000Z');
    await db.insert(schema.messages).values({
      id: 'aaa-' + crypto.randomUUID(),
      conversationId: sessionId,
      senderId: 's',
      role: 'user',
      parts: [{ type: 'text', text: 'cursor' }],
      createdAt: shared,
    });
    await db.insert(schema.messages).values({
      id: 'bbb-' + crypto.randomUUID(),
      conversationId: sessionId,
      senderId: 's',
      role: 'agent',
      parts: [{ type: 'text', text: 'sibling' }],
      createdAt: shared,
    });

    const all = await adapter.getMessagesAfter(sessionId, null);
    expect(all).toHaveLength(2);
    const [cursor, sibling] = all;
    const afterCursor = await adapter.getMessagesAfter(sessionId, cursor.id);
    expect(afterCursor.map((m) => m.id)).toEqual([sibling.id]);
  });

  it("getMessagesAfter excludes same-createdAt rows with id sorting before the cursor (keyset order)", async () => {
    const sessionId = crypto.randomUUID();
    createdSessions.push(sessionId);
    await db.insert(schema.conversations).values({ id: sessionId });

    // Two messages share the same createdAt. 'aaa' sorts BEFORE 'mmm', so when
    // we ask for messages after 'mmm', 'aaa' is "before" mmm in (createdAt, id)
    // tuple order and must NOT be returned. A predicate of `id != cursorId` only
    // would incorrectly include 'aaa'.
    const shared = new Date('2026-05-15T11:00:00.000Z');
    const aaaId = 'aaa-' + crypto.randomUUID();
    const mmmId = 'mmm-' + crypto.randomUUID();
    await db.insert(schema.messages).values([
      { id: aaaId, conversationId: sessionId, senderId: 's', role: 'user', parts: [{ type: 'text', text: 'earlier-id' }], createdAt: shared },
      { id: mmmId, conversationId: sessionId, senderId: 's', role: 'user', parts: [{ type: 'text', text: 'cursor' }], createdAt: shared },
    ]);

    const afterMmm = await adapter.getMessagesAfter(sessionId, mmmId);
    expect(afterMmm).toEqual([]);
  });

  it("getMessagesAfter caps the batch at MAX_MESSAGES_PER_FETCH (200)", async () => {
    const sessionId = crypto.randomUUID();
    createdSessions.push(sessionId);
    await db.insert(schema.conversations).values({ id: sessionId });

    // Batch-insert 250 messages with explicit, monotonic createdAt so ordering
    // is deterministic and we hit the 200-row cap.
    const baseTime = Date.now();
    const rows = Array.from({ length: 250 }, (_, i) => ({
      id: crypto.randomUUID(),
      conversationId: sessionId,
      senderId: 's',
      role: 'user' as const,
      parts: [{ type: 'text', text: `m-${i}` }],
      createdAt: new Date(baseTime + i),
    }));
    await db.insert(schema.messages).values(rows);

    const all = await adapter.getMessagesAfter(sessionId, null);
    expect(all).toHaveLength(200);
    // First 200 are returned (oldest), in createdAt-ascending order.
    expect(all[0].content).toBe('m-0');
    expect(all[199].content).toBe('m-199');
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

  it("getLatest returns the most recently inserted row (ordered by createdAt) after multiple inserts", async () => {
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
      .where(eq(schema.chatSessionSummaries.conversationId, sessionId));
    expect(rows).toEqual([]);
  });
});
