/**
 * Post-stall retry admission (conversational-questions answer wiring).
 *
 * Answering a parked negotiation's question resumes it through
 * negotiate-existing, which reads the CURRENT opportunity row and claims a
 * fresh attempt with `expectedStatus: opportunity.status` — 'stalled' for a
 * post-stall park. `NEGOTIATION_START_STATUSES` therefore admits 'stalled';
 * this spec proves the retry claims a fresh attempt against the real
 * database, and that widening the set opened no other start path: terminal
 * statuses stay refused, the exact status+updatedAt CAS still governs, and
 * the constant still has exactly one consumer (the attempt claim).
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { ConversationDatabaseAdapter } from '../conversation.database.adapter';
import { opportunities } from '../../schemas/database.schema';
import { conversations, messages, tasks } from '../../schemas/conversation.schema';

setDefaultTimeout(30_000);

const conversationAdapter = new ConversationDatabaseAdapter();

const createdOpportunityIds: string[] = [];
const createdConversationIds: string[] = [];

afterAll(async () => {
  if (createdConversationIds.length > 0) {
    await db.delete(messages).where(inArray(messages.conversationId, createdConversationIds));
    await db.delete(tasks).where(inArray(tasks.conversationId, createdConversationIds));
    await db.delete(conversations).where(inArray(conversations.id, createdConversationIds));
  }
  if (createdOpportunityIds.length > 0) {
    await db.delete(opportunities).where(inArray(opportunities.id, createdOpportunityIds));
  }
});

async function seedOpportunity(status: typeof opportunities.$inferSelect['status']) {
  const [opportunity] = await db.insert(opportunities).values({
    detection: { kind: 'test', summary: 'stalled retry fixture' } as never,
    actors: [
      { userId: randomUUID(), networkId: randomUUID(), role: 'peer' },
      { userId: randomUUID(), networkId: randomUUID(), role: 'peer' },
    ] as never,
    interpretation: { reasoning: 'fixture', category: 'test' } as never,
    context: {} as never,
    confidence: '0.8',
    status,
  }).returning();
  createdOpportunityIds.push(opportunity.id);
  return opportunity;
}

async function createConversation(): Promise<string> {
  const [conversation] = await db.insert(conversations).values({}).returning();
  createdConversationIds.push(conversation.id);
  return conversation.id;
}

function graphOpenInput(opportunity: typeof opportunities.$inferSelect) {
  const [source, candidate] = opportunity.actors as Array<{ userId: string; networkId: string }>;
  return {
    opportunityId: opportunity.id,
    sourceUserId: source!.userId,
    candidateUserId: candidate!.userId,
    brief: 'Atomic open fixture brief.',
    seats: {
      [`intent-${source!.userId}`]: { userId: source!.userId, round: 1 },
      [`intent-${candidate!.userId}`]: { userId: candidate!.userId, round: 0 },
    },
    networkId: source!.networkId,
  };
}

function attemptInput(opportunity: typeof opportunities.$inferSelect, conversationId: string) {
  return {
    conversationId,
    opportunityId: opportunity.id,
    expectedStatus: opportunity.status,
    expectedUpdatedAt: opportunity.updatedAt,
    metadata: {
      type: 'negotiation',
      opportunityId: opportunity.id,
      intentSnapshots: [],
    },
  };
}

describe('post-stall retry attempt claim', () => {
  test('concurrent graph opens atomically create one live task and return it to the loser', async () => {
    const opportunity = await seedOpportunity('negotiating');
    const input = graphOpenInput(opportunity);

    const [first, second] = await Promise.all([
      conversationAdapter.openNegotiationTask(input),
      conversationAdapter.openNegotiationTask(input),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect([first, second].map((open) => open!.disposition).sort()).toEqual(['created', 'raced']);
    expect(first!.task.id).toBe(second!.task.id);
    createdConversationIds.push(first!.task.conversationId);

    const persisted = await db.select({ id: tasks.id }).from(tasks)
      .where(sql`${tasks.metadata}->>'opportunityId' = ${opportunity.id}`);
    expect(persisted).toHaveLength(1);
    const [promoted] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(promoted!.status).toBe('negotiating');
  });

  test("a stalled opportunity with a completed park task resumes into exactly one fresh attempt", async () => {
    // Mimic production ordering: the park task completes FIRST, then finalize
    // stamps the opportunity 'stalled' — so the completed task predates the
    // opportunity's updatedAt and does not qualify as an owner of the retry.
    const opportunity = await seedOpportunity('negotiating');
    const conversationId = await createConversation();
    const parkTask = await conversationAdapter.createTask(conversationId, {
      type: 'negotiation',
      opportunityId: opportunity.id,
      intentSnapshots: [],
    });
    await db.update(tasks).set({ state: 'completed' }).where(eq(tasks.id, parkTask.id));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await db.update(opportunities)
      .set({ status: 'stalled', updatedAt: new Date() })
      .where(eq(opportunities.id, opportunity.id));
    const [stalled] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));

    const attempt = await conversationAdapter.createNegotiationTaskForAttempt(attemptInput(stalled, conversationId));
    expect(attempt).not.toBeNull();

    const [promoted] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(promoted.status).toBe('negotiating');

    const persistedTasks = await db.select({ id: tasks.id, state: tasks.state }).from(tasks)
      .where(sql`${tasks.metadata}->>'opportunityId' = ${opportunity.id}`);
    expect(persistedTasks).toHaveLength(2);

    // Concurrent retries race the claim; the second observer of the stalled
    // row loses to the exact status+updatedAt CAS.
    const rematch = await conversationAdapter.createNegotiationTaskForAttempt(
      attemptInput(stalled, await createConversation()),
    );
    expect(rematch).toBeNull();
  });

  test('terminal statuses stay refused even when the caller expects them exactly', async () => {
    for (const status of ['accepted', 'rejected', 'expired'] as const) {
      const opportunity = await seedOpportunity(status);
      const attempt = await conversationAdapter.createNegotiationTaskForAttempt(
        attemptInput(opportunity, await createConversation()),
      );
      expect(attempt).toBeNull();
      const [unchanged] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
      expect(unchanged.status).toBe(status);
    }
  });

  test('a stale stalled expectation is refused once the row has moved on', async () => {
    const opportunity = await seedOpportunity('stalled');
    const input = attemptInput(opportunity, await createConversation());
    await db.update(opportunities)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(opportunities.id, opportunity.id));

    const attempt = await conversationAdapter.createNegotiationTaskForAttempt(input);
    expect(attempt).toBeNull();
    const [unchanged] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(unchanged.status).toBe('accepted');
  });

  test('NEGOTIATION_START_STATUSES still has exactly one consumer — the attempt claim guard', () => {
    // Widening the set must not silently open a start path for another
    // caller: the constant is module-private, and its only reference beyond
    // the declaration is the guard inside
    // createNegotiationTaskForAttemptInTransaction.
    const source = readFileSync('src/adapters/conversation.database.adapter.ts', 'utf8');
    const references = source.match(/NEGOTIATION_START_STATUSES/g) ?? [];
    expect(references).toHaveLength(2);
    expect(source).not.toContain('export const NEGOTIATION_START_STATUSES');
  });
});
