/**
 * createNegotiationMessage against real Postgres.
 *
 * The fake-host E2E spec (negotiations.e2e.spec.ts) can never catch a
 * connection-pool deadlock: its fake database has no pool, no advisory
 * locks, no second connection to contend on. `createNegotiationMessage`'s
 * CAS transaction takes `pg_advisory_xact_lock('conversation-session:...')`
 * and used to await `this.createMessage`, which opened a SECOND
 * `db.transaction` (a second pooled connection) requesting the exact same
 * lock — every real turn persist hung until the pool exhausted. This spec
 * drives the real adapter against a real database so a regression here
 * fails by timeout, not by review.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { ConversationDatabaseAdapter } from '../conversation.database.adapter';
import { conversations, messages, tasks } from '../../schemas/conversation.schema';

// A regression here hangs forever (self-deadlock on the advisory lock), not
// merely slowly — a short bound turns that hang into a fast, loud failure
// instead of a stuck CI job.
setDefaultTimeout(10_000);

const adapter = new ConversationDatabaseAdapter();
const cleanupConversationIds: string[] = [];

afterAll(async () => {
  if (cleanupConversationIds.length === 0) return;
  await db.delete(messages).where(inArray(messages.conversationId, cleanupConversationIds));
  await db.delete(tasks).where(inArray(tasks.conversationId, cleanupConversationIds));
  await db.delete(conversations).where(inArray(conversations.id, cleanupConversationIds));
});

async function seedTask() {
  const conversation = await adapter.createConversation([
    { participantId: `agent:${crypto.randomUUID()}`, participantType: 'agent' },
    { participantId: `agent:${crypto.randomUUID()}`, participantType: 'agent' },
  ]);
  cleanupConversationIds.push(conversation.id);
  const task = await adapter.createTask(conversation.id, { type: 'negotiation' });
  return { conversationId: conversation.id, taskId: task.id };
}

describe('createNegotiationMessage against real Postgres', () => {
  test('persists without deadlocking on its own advisory lock', async () => {
    const { conversationId, taskId } = await seedTask();
    const senderId = `agent:${crypto.randomUUID()}`;

    const first = await adapter.createNegotiationMessage({
      conversationId,
      taskId,
      senderId,
      parts: [{ kind: 'data', data: { action: 'outreach' } }],
      expectedMessageCount: 0,
    });
    expect(first).not.toBeNull();
    expect(first!.senderId).toBe(senderId);

    const second = await adapter.createNegotiationMessage({
      conversationId,
      taskId,
      senderId,
      parts: [{ kind: 'data', data: { action: 'counter' } }],
      expectedMessageCount: 1,
    });
    expect(second).not.toBeNull();

    const rows = await db.select({ id: messages.id }).from(messages).where(and(
      eq(messages.taskId, taskId),
    ));
    expect(rows.length).toBe(2);
  });

  test('a stale expectedMessageCount is fenced, not applied', async () => {
    const { conversationId, taskId } = await seedTask();
    const senderId = `agent:${crypto.randomUUID()}`;

    await adapter.createNegotiationMessage({
      conversationId,
      taskId,
      senderId,
      parts: [{ kind: 'data', data: { action: 'outreach' } }],
      expectedMessageCount: 0,
    });

    // A second submission that read the count before the first landed.
    const stale = await adapter.createNegotiationMessage({
      conversationId,
      taskId,
      senderId,
      parts: [{ kind: 'data', data: { action: 'counter' } }],
      expectedMessageCount: 0,
    });
    expect(stale).toBeNull();

    const rows = await db.select({ id: messages.id }).from(messages).where(eq(messages.taskId, taskId));
    expect(rows.length).toBe(1);
  });
});
