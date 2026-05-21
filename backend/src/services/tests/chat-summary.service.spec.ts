import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect, afterAll, mock } from "bun:test";
import { eq } from "drizzle-orm";
import db from "../../lib/drizzle/drizzle";
import * as schema from "../../schemas/database.schema";
import { ChatSummaryDatabaseAdapter } from "../../adapters/chat-summary.database.adapter";
import { ChatSummaryService } from "../chat-summary.service";
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
  // Explicit, monotonically-increasing createdAt values so ordering is
  // deterministic regardless of clock resolution.
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
      .where(eq(schema.chatSessionSummaries.conversationId, sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0].fromMessageId).toBe(messageIds[0]);
    expect(rows[0].toMessageId).toBe(messageIds[1]);
  });

  it("getDigest returns persisted digest without calling summarizer when no new messages", async () => {
    const { sessionId } = await makeConversationWithMessages(2);
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

    // Add 2 more messages, each at an explicit time strictly after the seed batch
    // (seed batch uses baseTime..baseTime + 1s; pad with +10s and +11s to be safe).
    const newMid1 = crypto.randomUUID();
    const newMid2 = crypto.randomUUID();
    const padBase = Date.now() + 10_000;
    await db.insert(schema.messages).values({ id: newMid1, conversationId: sessionId, senderId: 's', role: 'user', parts: [{ type: 'text', text: 'new1' }], createdAt: new Date(padBase) });
    await db.insert(schema.messages).values({ id: newMid2, conversationId: sessionId, senderId: 's', role: 'agent', parts: [{ type: 'text', text: 'new2' }], createdAt: new Date(padBase + 1000) });

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
      .where(eq(schema.chatSessionSummaries.conversationId, sessionId));
    expect(rows).toHaveLength(2);
    // Sort by createdAt so we can index deterministically (rows[0] = original, rows[1] = incremental)
    const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(sorted[0].fromMessageId).toBe(messageIds[0]);
    expect(sorted[0].toMessageId).toBe(messageIds[1]);
    expect(sorted[1].fromMessageId).toBe(messageIds[0]);   // chain carry-over from prev
    expect(sorted[1].toMessageId).toBe(newMid2);
  });

  it("getDigest returns previousDigest unchanged when summarizer returns null", async () => {
    const { sessionId } = await makeConversationWithMessages(2);
    created.push(sessionId);
    const { service: first } = makeService(async () => sampleDigest);
    await first.getDigest(sessionId);

    const newMid = crypto.randomUUID();
    await db.insert(schema.messages).values({ id: newMid, conversationId: sessionId, senderId: 's', role: 'user', parts: [{ type: 'text', text: 'new' }] });

    const { service: second } = makeService(async () => null);
    const result = await second.getDigest(sessionId);

    expect(result).toEqual(sampleDigest);
  });

  it("getDigest does not throw when summarizer throws; falls back to previous digest", async () => {
    const { sessionId } = await makeConversationWithMessages(2);
    created.push(sessionId);
    const { service: first } = makeService(async () => sampleDigest);
    await first.getDigest(sessionId);

    const newMid = crypto.randomUUID();
    await db.insert(schema.messages).values({ id: newMid, conversationId: sessionId, senderId: 's', role: 'user', parts: [{ type: 'text', text: 'new' }] });

    const { service: second } = makeService(async () => {
      throw new Error("summarizer crash");
    });

    // Must not throw — contract is `getDigest` never throws.
    const result = await second.getDigest(sessionId);
    expect(result).toEqual(sampleDigest);
  });

  it("getDigest treats a malformed persisted digest as 'no previous summary' (fresh re-summarization from message 0)", async () => {
    const { sessionId, messageIds } = await makeConversationWithMessages(2);
    created.push(sessionId);

    // Insert a row whose digest violates the schema (wrong shape).
    await db.insert(schema.chatSessionSummaries).values({
      conversationId: sessionId,
      fromMessageId: messageIds[0],
      toMessageId: messageIds[1],
      digest: { not_a_digest_field: 123 } as unknown as ChatContextDigest,
      model: 'google/gemini-2.5-flash',
    });

    // The summarizer should receive previousDigest = null AND newMessages
    // covering both seeded messages (cursor reset because prev digest was
    // unusable). Without the reset, the cursor would still point at messageIds[1]
    // and the summarizer would see zero new messages.
    let captured: { previousDigest: unknown; newMessages: Array<{ content: string }> } | null = null;
    const { service } = makeService(async (input) => {
      captured = input as typeof captured;
      return sampleDigest;
    });

    const result = await service.getDigest(sessionId);
    expect(result).toEqual(sampleDigest);
    expect(captured!.previousDigest).toBeNull();
    expect(captured!.newMessages.map((m) => m.content)).toEqual(['msg-0', 'msg-1']);
  });
});
