import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm/sql';

import { UserDatabaseAdapter } from '../database.adapter';
import { QuestionerAdapter, type AdapterPersistableQuestion, type PoolPushClaimResult } from '../questioner.adapter';
import db from '../../lib/drizzle/drizzle';
import { intents, questions } from '../../schemas/database.schema';

const EMAIL = 'test-pool-push-claim@example.com';
const OTHER_EMAIL = 'test-pool-push-claim-other@example.com';

function discriminator(voi: number) {
  return {
    label: 'Role',
    questionSeed: 'Which role matters?',
    sides: ['Builder', 'Advisor'],
    sideCounts: { Builder: 5, Advisor: 4 },
    voi,
    evidenceRate: 0.9,
    assignments: [{ opportunityId: crypto.randomUUID(), side: 'Builder' }],
  };
}

describe('QuestionerAdapter pool push claim transaction', () => {
  const users = new UserDatabaseAdapter();
  const adapter = new QuestionerAdapter(db);
  let userId: string;
  let otherUserId: string;
  let intentId: string;

  async function createIntent(ownerId = userId, overrides?: {
    status?: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED';
    archivedAt?: Date | null;
    lastVisitedAt?: Date | null;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(intents).values({
      id,
      userId: ownerId,
      payload: `Intent payload ${id}`,
      summary: 'Find reliable collaborators',
      status: overrides?.status ?? 'ACTIVE',
      archivedAt: overrides?.archivedAt ?? null,
      lastVisitedAt: overrides?.lastVisitedAt ?? null,
    });
    return id;
  }

  async function createPoolQuestion(input?: {
    intentId?: string;
    actorId?: string;
    voi?: number;
    poolSize?: number;
    runId?: string;
    minedAt?: string;
    conversationId?: string;
  }): Promise<string> {
    const tiedIntentId = input?.intentId ?? intentId;
    const question: AdapterPersistableQuestion = {
      detection: {
        mode: 'pool_discovery',
        sourceType: 'intent',
        sourceId: tiedIntentId,
        triggeredBy: tiedIntentId,
        timestamp: new Date().toISOString(),
        pool: {
          poolSize: input?.poolSize ?? 8,
          minedAt: input?.minedAt ?? new Date().toISOString(),
          ...(input?.runId === undefined ? { runId: crypto.randomUUID() } : { runId: input.runId }),
          discriminator: discriminator(input?.voi ?? 0.61),
          alternates: [],
        },
      },
      actors: [{ userId: input?.actorId ?? userId, role: 'subject' }],
      payload: {
        title: 'Role',
        prompt: 'Which role matters most?',
        options: [
          { label: 'Builder', description: 'Prioritize hands-on builders' },
          { label: 'Advisor', description: 'Prioritize strategic advisors' },
        ],
        multiSelect: false,
      },
      strategy: 'refine_intent',
      ...(input?.conversationId ? { conversationId: input.conversationId } : {}),
    };
    const [id] = await adapter.persist([question]);
    return id;
  }

  async function resolveQuestion(questionId: string, status: 'answered' | 'dismissed', createdAt: Date): Promise<void> {
    await db.update(questions)
      .set({ status, createdAt })
      .where(eq(questions.id, questionId));
  }

  function reason(result: PoolPushClaimResult): string {
    return result.kind === 'ineligible' ? result.reason : result.kind;
  }

  beforeAll(async () => {
    for (const email of [EMAIL, OTHER_EMAIL]) {
      const existing = await users.findByEmail(email);
      if (existing) await users.deleteByEmail(email);
    }
    userId = (await users.create({ email: EMAIL, name: 'Pool Push Owner' })).id;
    otherUserId = (await users.create({ email: OTHER_EMAIL, name: 'Other Owner' })).id;
  });

  beforeEach(async () => {
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`);
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: otherUserId }])}::jsonb`);
    await db.delete(intents).where(and(
      sql`${intents.userId} IN (${userId}, ${otherUserId})`,
    ));
    intentId = await createIntent();
  });

  afterAll(async () => {
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`).catch(() => {});
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: otherUserId }])}::jsonb`).catch(() => {});
    await db.delete(intents).where(sql`${intents.userId} IN (${userId}, ${otherUserId})`).catch(() => {});
    await users.deleteById(userId).catch(() => {});
    await users.deleteById(otherUserId).catch(() => {});
  });

  test('VoI is strict and pool size boundary is 8', async () => {
    for (const [voi, expected] of [[0.6, 'voi'], [0.59, 'voi'], [0.600001, 'claimed']] as const) {
      const id = await createPoolQuestion({ voi });
      expect(reason(await adapter.claimPoolQuestionPush(id, userId))).toBe(expected);
      await db.delete(questions).where(eq(questions.id, id));
    }
    const seven = await createPoolQuestion({ poolSize: 7, voi: 0.9 });
    expect(reason(await adapter.claimPoolQuestionPush(seven, userId))).toBe('pool_size');
    await db.delete(questions).where(eq(questions.id, seven));
    const eight = await createPoolQuestion({ poolSize: 8, voi: 0.9 });
    expect((await adapter.claimPoolQuestionPush(eight, userId)).kind).toBe('claimed');
  }, 30_000);

  test('dismissal streak raises the threshold and a later answer resets it', async () => {
    const base = Date.now() - 60_000;
    const dismissed1 = await createPoolQuestion({ voi: 0.1 });
    await resolveQuestion(dismissed1, 'dismissed', new Date(base));
    const oneDismissal = await createPoolQuestion({ voi: 0.69 });
    expect(reason(await adapter.claimPoolQuestionPush(oneDismissal, userId))).toBe('voi');
    await db.delete(questions).where(eq(questions.id, oneDismissal));

    const dismissed2 = await createPoolQuestion({ voi: 0.1 });
    await resolveQuestion(dismissed2, 'dismissed', new Date(base + 10_000));
    const twoDismissals = await createPoolQuestion({ voi: 0.7935 });
    expect(reason(await adapter.claimPoolQuestionPush(twoDismissals, userId))).toBe('voi');
    await db.delete(questions).where(eq(questions.id, twoDismissals));

    const answered = await createPoolQuestion({ voi: 0.1 });
    await resolveQuestion(answered, 'answered', new Date(base + 20_000));
    const reset = await createPoolQuestion({ voi: 0.61 });
    expect((await adapter.claimPoolQuestionPush(reset, userId)).kind).toBe('claimed');
  }, 30_000);

  test('visit and active lifecycle checks use question creation time', async () => {
    const beforeVisit = new Date(Date.now() - 60_000);
    await db.update(intents).set({ lastVisitedAt: beforeVisit }).where(eq(intents.id, intentId));
    const eligible = await createPoolQuestion({ voi: 0.9 });
    expect((await adapter.claimPoolQuestionPush(eligible, userId)).kind).toBe('claimed');
    await db.delete(questions).where(eq(questions.id, eligible));

    const blocked = await createPoolQuestion({ voi: 0.9 });
    await db.update(intents).set({ lastVisitedAt: new Date(Date.now() + 60_000) }).where(eq(intents.id, intentId));
    expect(reason(await adapter.claimPoolQuestionPush(blocked, userId))).toBe('visited');

    for (const state of [
      { status: 'PAUSED' as const, archivedAt: null },
      { status: 'ACTIVE' as const, archivedAt: new Date() },
    ]) {
      const lifecycleIntent = await createIntent(userId, state);
      const q = await createPoolQuestion({ intentId: lifecycleIntent, voi: 0.9 });
      expect(reason(await adapter.claimPoolQuestionPush(q, userId))).toBe('intent_lifecycle');
    }
  }, 30_000);

  test('resolved claims count toward the UTC daily cap across intents', async () => {
    for (const status of ['answered', 'dismissed'] as const) {
      const tiedIntent = await createIntent();
      const q = await createPoolQuestion({ intentId: tiedIntent, voi: 0.9 });
      expect((await adapter.claimPoolQuestionPush(q, userId)).kind).toBe('claimed');
      await db.update(questions).set({ status }).where(eq(questions.id, q));
    }
    const thirdIntent = await createIntent();
    const third = await createPoolQuestion({ intentId: thirdIntent, voi: 0.9 });
    expect(reason(await adapter.claimPoolQuestionPush(third, userId))).toBe('daily_budget');
  }, 30_000);

  test('same cycle claims once while different cycles can claim', async () => {
    const first = await createPoolQuestion({ runId: 'cycle-a', voi: 0.9 });
    const same = await createPoolQuestion({ runId: 'cycle-a', voi: 0.9 });
    const different = await createPoolQuestion({ runId: 'cycle-b', voi: 0.9 });
    expect((await adapter.claimPoolQuestionPush(first, userId)).kind).toBe('claimed');
    expect(reason(await adapter.claimPoolQuestionPush(same, userId))).toBe('cycle_budget');
    expect((await adapter.claimPoolQuestionPush(different, userId)).kind).toBe('claimed');
  }, 30_000);

  test('foreign, expired, resolved, and conversation-bound rows are ineligible', async () => {
    const foreignActor = await createPoolQuestion({ actorId: otherUserId, voi: 0.9 });
    expect(reason(await adapter.claimPoolQuestionPush(foreignActor, userId))).toBe('question_lifecycle');

    const foreignIntent = await createIntent(otherUserId);
    const foreign = await createPoolQuestion({ intentId: foreignIntent, actorId: userId, voi: 0.9 });
    expect(reason(await adapter.claimPoolQuestionPush(foreign, userId))).toBe('intent_lifecycle');

    const expired = await createPoolQuestion({ voi: 0.9 });
    await db.update(questions).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(questions.id, expired));
    expect(reason(await adapter.claimPoolQuestionPush(expired, userId))).toBe('question_lifecycle');

    const resolved = await createPoolQuestion({ voi: 0.9 });
    await db.update(questions).set({ status: 'dismissed' }).where(eq(questions.id, resolved));
    expect(reason(await adapter.claimPoolQuestionPush(resolved, userId))).toBe('question_lifecycle');

    const bound = await createPoolQuestion({ conversationId: crypto.randomUUID(), voi: 0.9 });
    expect(reason(await adapter.claimPoolQuestionPush(bound, userId))).toBe('question_lifecycle');
  }, 30_000);

  test('concurrent claims enforce daily max two and same-cycle exactly one', async () => {
    const dailyQuestions = await Promise.all([0, 1, 2].map(async () => {
      const tiedIntent = await createIntent();
      return createPoolQuestion({ intentId: tiedIntent, runId: `daily-${tiedIntent}`, voi: 0.9 });
    }));
    const dailyResults = await Promise.all(dailyQuestions.map((id) => adapter.claimPoolQuestionPush(id, userId)));
    expect(dailyResults.filter((result) => result.kind === 'claimed')).toHaveLength(2);

    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`);
    const sameCycle = await Promise.all([0, 1, 2].map(() => createPoolQuestion({ runId: 'one-cycle', voi: 0.9 })));
    const cycleResults = await Promise.all(sameCycle.map((id) => adapter.claimPoolQuestionPush(id, userId)));
    expect(cycleResults.filter((result) => result.kind === 'claimed')).toHaveLength(1);
  }, 30_000);
});
