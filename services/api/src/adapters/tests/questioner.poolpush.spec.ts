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
    sourceId?: string;
    triggeredBy?: string | null;
  }): Promise<string> {
    const tiedIntentId = input?.intentId ?? intentId;
    const question: AdapterPersistableQuestion = {
      detection: {
        mode: 'pool_discovery',
        sourceType: 'intent',
        sourceId: input?.sourceId ?? tiedIntentId,
        ...(input?.triggeredBy === null
          ? {}
          : { triggeredBy: input?.triggeredBy ?? tiedIntentId }),
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

  async function updateDetection(
    questionId: string,
    update: (detection: AdapterPersistableQuestion['detection']) => AdapterPersistableQuestion['detection'],
  ): Promise<void> {
    const [row] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, questionId));
    await db.update(questions).set({ detection: update(row.detection) }).where(eq(questions.id, questionId));
  }

  async function expectSuppressedRequest(questionId: string, expectedReason: string): Promise<void> {
    expect(reason(await adapter.claimPoolQuestionPush(questionId, userId))).toBe(expectedReason);
    const [row] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, questionId));
    expect(row.detection.pushRequestStatus).toBe('suppressed');
    expect(row.detection.pushRequestReason).toBe(expectedReason);
    expect(row.detection.pushRequestSuppressedAt).toBeString();
    expect((await adapter.listRecoverablePoolQuestionPushRequests()).some((request) => request.questionId === questionId)).toBe(false);
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
      if (!existing) continue;
      await db.delete(questions).where(
        sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: existing.id }])}::jsonb`,
      );
      await db.delete(intents).where(eq(intents.userId, existing.id));
      await users.deleteById(existing.id);
    }
    userId = (await users.create({ email: EMAIL, name: 'Pool Push Owner' })).id;
    otherUserId = (await users.create({ email: OTHER_EMAIL, name: 'Other Owner' })).id;
  }, 30_000);

  beforeEach(async () => {
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`);
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: otherUserId }])}::jsonb`);
    await db.delete(intents).where(and(
      sql`${intents.userId} IN (${userId}, ${otherUserId})`,
    ));
    intentId = await createIntent();
  }, 30_000);

  afterAll(async () => {
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`).catch(() => {});
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: otherUserId }])}::jsonb`).catch(() => {});
    await db.delete(intents).where(sql`${intents.userId} IN (${userId}, ${otherUserId})`).catch(() => {});
    await users.deleteById(userId).catch(() => {});
    await users.deleteById(otherUserId).catch(() => {});
  }, 30_000);

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
  }, 60_000);

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
  }, 60_000);

  test('lifecycle-voided dismissals do not contribute to dismissal decay', async () => {
    const voided = await createPoolQuestion({ voi: 0.1 });
    await resolveQuestion(voided, 'dismissed', new Date(Date.now() - 10_000));
    await updateDetection(voided, (detection) => ({ ...detection, voidedReason: 'pool_drift' }));

    const candidate = await createPoolQuestion({ voi: 0.61 });
    expect((await adapter.claimPoolQuestionPush(candidate, userId)).kind).toBe('claimed');
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
  }, 60_000);

  test('allowNewClaim=false resumes an existing claim but leaves an unclaimed request recoverable', async () => {
    const unclaimed = await createPoolQuestion({ voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(unclaimed, userId)).toBe(true);
    expect(reason(await adapter.claimPoolQuestionPush(unclaimed, userId, { allowNewClaim: false }))).toBe('new_claim_disabled');
    const [before] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, unclaimed));
    expect(before.detection.push).toBeUndefined();
    expect(before.detection.pushRequestStatus).toBe('requested');
    expect(await adapter.listRecoverablePoolQuestionPushRequests()).toContainEqual({
      questionId: unclaimed,
      userId,
      claimed: false,
    });

    expect((await adapter.claimPoolQuestionPush(unclaimed, userId, { allowNewClaim: true })).kind).toBe('claimed');
    expect((await adapter.claimPoolQuestionPush(unclaimed, userId, { allowNewClaim: false })).kind).toBe('claimed');
  }, 30_000);

  test('existing claims become durably suppressed when lifecycle eligibility changes', async () => {
    const assertSuppressed = async (mutate: (questionId: string) => Promise<void>) => {
      const questionId = await createPoolQuestion({ voi: 0.9 });
      expect((await adapter.claimPoolQuestionPush(questionId, userId)).kind).toBe('claimed');
      await mutate(questionId);
      expect((await adapter.claimPoolQuestionPush(questionId, userId, { allowNewClaim: false })).kind).toBe('ineligible');
      const [row] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, questionId));
      expect(row.detection.push?.deliveryStatus).toBe('suppressed');
      expect(row.detection.push?.suppressedAt).toBeString();
      await db.delete(questions).where(eq(questions.id, questionId));
    };

    await assertSuppressed(async (questionId) => {
      await db.update(questions).set({ status: 'dismissed' }).where(eq(questions.id, questionId));
    });
    await assertSuppressed(async (questionId) => {
      await db.update(questions).set({ expiresAt: new Date(0) }).where(eq(questions.id, questionId));
    });
    await assertSuppressed(async () => {
      await db.update(intents).set({ status: 'PAUSED' }).where(eq(intents.id, intentId));
    });
    await db.update(intents).set({ status: 'ACTIVE' }).where(eq(intents.id, intentId));
    await assertSuppressed(async () => {
      await db.update(intents).set({ lastVisitedAt: new Date(Date.now() + 60_000) }).where(eq(intents.id, intentId));
    });
    await db.update(intents).set({ lastVisitedAt: null }).where(eq(intents.id, intentId));
    await assertSuppressed(async () => {
      await db.update(intents).set({ userId: otherUserId }).where(eq(intents.id, intentId));
    });
  }, 90_000);

  test('durable request markers recover only pending nonterminal rows', async () => {
    const requested = await createPoolQuestion({ voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(requested, userId)).toBe(true);
    const [marked] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, requested));
    expect(marked.detection.pushRequestStatus).toBe('requested');
    expect(await adapter.listRecoverablePoolQuestionPushRequests()).toContainEqual({
      questionId: requested,
      userId,
      claimed: false,
    });

    expect((await adapter.claimPoolQuestionPush(requested, userId)).kind).toBe('claimed');
    expect(await adapter.listRecoverablePoolQuestionPushRequests()).toContainEqual({
      questionId: requested,
      userId,
      claimed: true,
    });

    await adapter.markPoolQuestionPushFailed(requested, userId, 'terminal');
    const [failed] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, requested));
    expect(failed.detection.push?.deliveryStatus).toBe('failed');
    // Successful terminal bookkeeping excludes failed claims from recovery.
    expect((await adapter.listRecoverablePoolQuestionPushRequests()).some((row) => row.questionId === requested)).toBe(false);
  }, 30_000);

  test('permanent unclaimed rejections terminalize the request and leave recovery', async () => {
    const poolSize = await createPoolQuestion({ poolSize: 7, voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(poolSize, userId)).toBe(true);
    await expectSuppressedRequest(poolSize, 'pool_size');

    const lowVoi = await createPoolQuestion({ voi: 0.6 });
    expect(await adapter.markPoolQuestionPushRequested(lowVoi, userId)).toBe(true);
    await expectSuppressedRequest(lowVoi, 'voi');

    const visited = await createPoolQuestion({ voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(visited, userId)).toBe(true);
    await db.update(intents).set({ lastVisitedAt: new Date(Date.now() + 60_000) }).where(eq(intents.id, intentId));
    await expectSuppressedRequest(visited, 'visited');
    await db.update(intents).set({ lastVisitedAt: null }).where(eq(intents.id, intentId));

    const resolved = await createPoolQuestion({ voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(resolved, userId)).toBe(true);
    await db.update(questions).set({ status: 'dismissed' }).where(eq(questions.id, resolved));
    await expectSuppressedRequest(resolved, 'question_lifecycle');

    const pausedIntent = await createIntent();
    const paused = await createPoolQuestion({ intentId: pausedIntent, voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(paused, userId)).toBe(true);
    await db.update(intents).set({ status: 'PAUSED' }).where(eq(intents.id, pausedIntent));
    await expectSuppressedRequest(paused, 'intent_lifecycle');

    const firstCycle = await createPoolQuestion({ runId: 'terminal-cycle', voi: 0.9 });
    expect((await adapter.claimPoolQuestionPush(firstCycle, userId)).kind).toBe('claimed');
    const duplicateCycle = await createPoolQuestion({ runId: 'terminal-cycle', voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(duplicateCycle, userId)).toBe(true);
    await expectSuppressedRequest(duplicateCycle, 'cycle_budget');
  }, 90_000);

  test('malformed source, actor, pool, and cycle terminalize unclaimed requests', async () => {
    const source = await createPoolQuestion({ voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(source, userId)).toBe(true);
    await updateDetection(source, (detection) => ({ ...detection, sourceType: 'opportunity' }));
    await expectSuppressedRequest(source, 'malformed_source');

    const actor = await createPoolQuestion({ voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(actor, userId)).toBe(true);
    await db.update(questions).set({ actors: [] }).where(eq(questions.id, actor));
    await expectSuppressedRequest(actor, 'malformed_actor');

    const pool = await createPoolQuestion({ voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(pool, userId)).toBe(true);
    await updateDetection(pool, (detection) => ({ ...detection, pool: undefined }));
    await expectSuppressedRequest(pool, 'malformed_pool');

    const cycle = await createPoolQuestion({ voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(cycle, userId)).toBe(true);
    await updateDetection(cycle, (detection) => ({
      ...detection,
      pool: detection.pool ? { ...detection.pool, runId: '', minedAt: '' } : undefined,
    }));
    await expectSuppressedRequest(cycle, 'malformed_cycle');
  }, 60_000);

  test('job recipient mismatch cannot suppress a valid authoritative claim', async () => {
    const questionId = await createPoolQuestion({ voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(questionId, userId)).toBe(true);
    expect((await adapter.claimPoolQuestionPush(questionId, userId)).kind).toBe('claimed');

    expect(reason(await adapter.claimPoolQuestionPush(questionId, otherUserId, { allowNewClaim: false }))).toBe('recipient_mismatch');
    const [row] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, questionId));
    expect(row.detection.push?.recipientId).toBe(userId);
    expect(row.detection.push?.deliveryStatus).toBe('claimed');
  }, 30_000);

  test('claim recipient conflict is durably suppressed against actor[0] even for a mismatched job user', async () => {
    const questionId = await createPoolQuestion({ voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(questionId, userId)).toBe(true);
    expect((await adapter.claimPoolQuestionPush(questionId, userId)).kind).toBe('claimed');
    await updateDetection(questionId, (detection) => ({
      ...detection,
      push: detection.push ? { ...detection.push, recipientId: otherUserId } : undefined,
    }));

    expect(reason(await adapter.claimPoolQuestionPush(questionId, userId, { allowNewClaim: false }))).toBe('conflicting_claim');
    const [row] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, questionId));
    expect(row.detection.push?.deliveryStatus).toBe('suppressed');
    expect(row.detection.push?.suppressedAt).toBeString();
    expect((await adapter.listRecoverablePoolQuestionPushRequests()).some((request) => request.questionId === questionId)).toBe(false);
  }, 30_000);

  test('missing or mismatched triggeredBy terminalizes requests and suppresses existing claims', async () => {
    for (const triggeredBy of [null, crypto.randomUUID()] as const) {
      const unclaimed = await createPoolQuestion({ voi: 0.9 });
      expect(await adapter.markPoolQuestionPushRequested(unclaimed, userId)).toBe(true);
      await updateDetection(unclaimed, (detection) => {
        const updated = { ...detection, triggeredBy: triggeredBy ?? undefined };
        if (triggeredBy === null) delete updated.triggeredBy;
        return updated;
      });
      await expectSuppressedRequest(unclaimed, 'malformed_source');
    }

    const claimed = await createPoolQuestion({ voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(claimed, userId)).toBe(true);
    expect((await adapter.claimPoolQuestionPush(claimed, userId)).kind).toBe('claimed');
    await updateDetection(claimed, (detection) => ({ ...detection, triggeredBy: crypto.randomUUID() }));
    expect(reason(await adapter.claimPoolQuestionPush(claimed, userId, { allowNewClaim: false }))).toBe('malformed_source');
    const [row] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, claimed));
    expect(row.detection.push?.deliveryStatus).toBe('suppressed');
  }, 60_000);

  test('resolved claims count toward the UTC daily cap across intents', async () => {
    for (const status of ['answered', 'dismissed'] as const) {
      const tiedIntent = await createIntent();
      const q = await createPoolQuestion({ intentId: tiedIntent, voi: 0.9 });
      expect((await adapter.claimPoolQuestionPush(q, userId)).kind).toBe('claimed');
      await db.update(questions).set({ status }).where(eq(questions.id, q));
    }
    const thirdIntent = await createIntent();
    const third = await createPoolQuestion({ intentId: thirdIntent, voi: 0.9 });
    expect(await adapter.markPoolQuestionPushRequested(third, userId)).toBe(true);
    expect(reason(await adapter.claimPoolQuestionPush(third, userId))).toBe('daily_budget');
    const [row] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, third));
    expect(row.detection.pushRequestStatus).toBe('requested');
    expect(await adapter.listRecoverablePoolQuestionPushRequests()).toContainEqual({
      questionId: third,
      userId,
      claimed: false,
    });
  }, 60_000);

  test('same cycle claims once while different cycles can claim', async () => {
    const first = await createPoolQuestion({ runId: 'cycle-a', voi: 0.9 });
    const same = await createPoolQuestion({ runId: 'cycle-a', voi: 0.9 });
    const different = await createPoolQuestion({ runId: 'cycle-b', voi: 0.9 });
    expect((await adapter.claimPoolQuestionPush(first, userId)).kind).toBe('claimed');
    expect(reason(await adapter.claimPoolQuestionPush(same, userId))).toBe('cycle_budget');
    expect((await adapter.claimPoolQuestionPush(different, userId)).kind).toBe('claimed');
  }, 30_000);

  test('same-cycle lookup uses stamped push identity after outer triggeredBy mutates', async () => {
    const first = await createPoolQuestion({ runId: 'stamped-cycle', voi: 0.9 });
    expect((await adapter.claimPoolQuestionPush(first, userId)).kind).toBe('claimed');
    await updateDetection(first, (detection) => ({ ...detection, triggeredBy: crypto.randomUUID() }));

    const duplicate = await createPoolQuestion({ runId: 'stamped-cycle', voi: 0.9 });
    expect(reason(await adapter.claimPoolQuestionPush(duplicate, userId))).toBe('cycle_budget');
  }, 30_000);

  test('foreign, expired, resolved, and conversation-bound rows are ineligible', async () => {
    const foreignActor = await createPoolQuestion({ actorId: otherUserId, voi: 0.9 });
    expect(reason(await adapter.claimPoolQuestionPush(foreignActor, userId))).toBe('recipient_mismatch');

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
  }, 60_000);
});
