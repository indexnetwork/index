/**
 * Reopening a dead pairing (POST /api/opportunities/:id/reopen).
 *
 * Pins the write against the real database: which statuses may be reopened,
 * that a live negotiation task blocks the reopen with its task id, and — the
 * part that broke by hand on 2026-08-19 — that `updated_at` lands on a whole
 * millisecond. The attempt CAS in
 * `createNegotiationTaskForAttemptInTransaction` compares that column with a JS
 * `Date`, which carries milliseconds only; a bare `now()` writes microseconds
 * and the queued re-run dies as "stale or already claimed". The last test
 * closes that loop by actually claiming the attempt after a reopen.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { OpportunityDatabaseAdapter, REOPENABLE_OPPORTUNITY_STATUSES } from '../opportunity.database.adapter';
import { ConversationDatabaseAdapter } from '../conversation.database.adapter';
import { opportunities } from '../../schemas/database.schema';
import { conversations, messages, tasks } from '../../schemas/conversation.schema';

setDefaultTimeout(30_000);

const adapter = new OpportunityDatabaseAdapter();
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
    detection: { source: 'opportunity_graph' } as never,
    actors: [
      { userId: randomUUID(), networkId: randomUUID(), role: 'patient' },
      { userId: randomUUID(), networkId: randomUUID(), role: 'agent' },
    ] as never,
    interpretation: { reasoning: 'reopen fixture', category: 'collaboration' } as never,
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

async function readRow(id: string) {
  const [row] = await db.select().from(opportunities).where(eq(opportunities.id, id));
  return row;
}

/** The database's own view of the precision actually stored. */
async function updatedAtIsWholeMilliseconds(id: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT date_part('microseconds', updated_at)::int % 1000 = 0 AS whole
    FROM opportunities WHERE id = ${id}
  `);
  const rows = (result as unknown as { rows?: Array<{ whole: boolean }> }).rows
    ?? (result as unknown as Array<{ whole: boolean }>);
  return rows[0].whole;
}

describe('reopenOpportunityForRerun', () => {
  test.each([...REOPENABLE_OPPORTUNITY_STATUSES])(
    'a %s match reopens to stalled with a millisecond-truncated updated_at',
    async (status) => {
      const opportunity = await seedOpportunity(status);

      const result = await adapter.reopenOpportunityForRerun(opportunity.id);

      expect(result).toBeTruthy();
      expect(result && 'reopened' in result && result.reopened.status).toBe('stalled');
      expect((await readRow(opportunity.id)).status).toBe('stalled');
      expect(await updatedAtIsWholeMilliseconds(opportunity.id)).toBe(true);
    },
  );

  test.each(['pending', 'accepted', 'negotiating', 'latent', 'draft'] as const)(
    'a %s match is refused — a live or won match is not reopenable',
    async (status) => {
      const opportunity = await seedOpportunity(status);

      const result = await adapter.reopenOpportunityForRerun(opportunity.id);

      expect(result).toEqual({ conflict: 'not_reopenable', status });
      const after = await readRow(opportunity.id);
      expect(after.status).toBe(status);
      expect(after.updatedAt.getTime()).toBe(opportunity.updatedAt.getTime());
    },
  );

  test('a live negotiation task blocks the reopen and names the task', async () => {
    const opportunity = await seedOpportunity('stalled');
    const conversationId = await createConversation();
    const task = await conversationAdapter.createTask(conversationId, {
      type: 'negotiation',
      opportunityId: opportunity.id,
      intentSnapshots: [],
    });
    await db.update(tasks).set({ state: 'working' }).where(eq(tasks.id, task.id));

    const result = await adapter.reopenOpportunityForRerun(opportunity.id);

    expect(result).toEqual({ conflict: 'active_negotiation', taskId: task.id });
    expect((await readRow(opportunity.id)).updatedAt.getTime())
      .toBe(opportunity.updatedAt.getTime());
  });

  test('an unknown opportunity answers null', async () => {
    expect(await adapter.reopenOpportunityForRerun(randomUUID())).toBeNull();
  });

  test('the reopened row can immediately claim a fresh negotiation attempt', async () => {
    // The load-bearing end of the millisecond truncation: the re-run reads the
    // row it just reopened and claims an attempt against its exact updated_at.
    const opportunity = await seedOpportunity('rejected');
    await adapter.reopenOpportunityForRerun(opportunity.id);
    const reopened = await readRow(opportunity.id);

    const attempt = await conversationAdapter.createNegotiationTaskForAttempt({
      conversationId: await createConversation(),
      opportunityId: reopened.id,
      expectedStatus: reopened.status,
      expectedUpdatedAt: reopened.updatedAt,
      metadata: { type: 'negotiation', opportunityId: reopened.id, intentSnapshots: [] },
    });

    expect(attempt).not.toBeNull();
    expect((await readRow(opportunity.id)).status).toBe('negotiating');
  });
});
