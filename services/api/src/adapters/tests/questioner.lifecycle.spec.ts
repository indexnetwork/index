import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm/sql';

import { QuestionerAdapter, type AdapterPersistableQuestion } from '../questioner.adapter';
import { UserDatabaseAdapter } from '../database.adapter';
import db from '../../lib/drizzle/drizzle';
import { intents, opportunities, questions } from '../../schemas/database.schema';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { isPoolArtifactFresh } from '../../queues/pool/poolquestions.constants';
import { dedupDiscriminators } from '../../queues/pool/question.shared';

function discriminator(label: string, opportunityIds = [crypto.randomUUID()]) {
  return {
    label,
    questionSeed: `Which ${label}?`,
    sides: ['Builder', 'Advisor'],
    sideCounts: { Builder: opportunityIds.length, Advisor: 0 },
    voi: 0.8,
    evidenceRate: 1,
    assignments: opportunityIds.map((opportunityId) => ({ opportunityId, side: 'Builder' })),
  };
}

describe('QuestionerAdapter material intent lifecycle', () => {
  const users = new UserDatabaseAdapter();
  const adapter = new QuestionerAdapter(db);
  let userId: string;
  let intentId: string;
  const questionIds: string[] = [];
  const opportunityIds: string[] = [];

  async function createQuestion(
    label: string,
    status: 'pending' | 'answered' | 'dismissed',
    fingerprint: string | undefined,
    assignmentIds = [crypto.randomUUID()],
  ): Promise<string> {
    const question: AdapterPersistableQuestion = {
      detection: {
        mode: 'pool_discovery',
        sourceType: 'intent',
        sourceId: intentId,
        triggeredBy: intentId,
        timestamp: new Date().toISOString(),
        pool: {
          poolSize: Math.max(5, assignmentIds.length),
          opportunityIds: assignmentIds,
          minedAt: new Date().toISOString(),
          ...(fingerprint ? { intentFingerprint: fingerprint } : {}),
          discriminator: discriminator(label, assignmentIds),
          alternates: [],
        },
      },
      actors: [{ userId, role: 'subject' }],
      payload: {
        title: label,
        prompt: `Which ${label}?`,
        options: [
          { label: 'Builder', description: 'Builder' },
          { label: 'Advisor', description: 'Advisor' },
        ],
        multiSelect: false,
      },
      strategy: 'refine_intent',
    };
    const [id] = await adapter.persist([question]);
    if (status !== 'pending') await db.update(questions).set({ status }).where(eq(questions.id, id));
    questionIds.push(id);
    return id;
  }

  beforeAll(async () => {
    userId = (await users.create({
      email: `questioner-lifecycle-${crypto.randomUUID()}@example.com`,
      name: 'Lifecycle Owner',
    })).id;
    intentId = crypto.randomUUID();
    await db.insert(intents).values({
      id: intentId,
      userId,
      payload: 'Find builders',
      summary: 'Prototype collaborators',
      status: 'ACTIVE',
    });
  });

  afterAll(async () => {
    if (questionIds.length) await db.delete(questions).where(inArray(questions.id, questionIds)).catch(() => {});
    if (opportunityIds.length) await db.delete(opportunities).where(inArray(opportunities.id, opportunityIds)).catch(() => {});
    await db.delete(intents).where(eq(intents.id, intentId)).catch(() => {});
    await users.deleteById(userId).catch(() => {});
  });

  test('reconciles pending questions below 0.7 or on fingerprint drift and accepts exactly 0.7', async () => {
    const currentFingerprint = computeIntentFingerprint('Find builders', 'Prototype collaborators');
    const currentIds = Array.from({ length: 10 }, () => crypto.randomUUID());
    const below = await createQuestion('below', 'pending', currentFingerprint, currentIds.slice(0, 6));
    const boundary = await createQuestion('boundary', 'pending', currentFingerprint, currentIds.slice(0, 7));
    const changed = await createQuestion('changed', 'pending', 'old-fingerprint', currentIds.slice(0, 7));

    expect(await adapter.reconcilePendingPoolQuestions(
      userId,
      intentId,
      currentFingerprint,
      currentIds,
      isPoolArtifactFresh,
    ))
      .toEqual(expect.arrayContaining([below, changed]));
    const rows = await db.select({ id: questions.id, status: questions.status, detection: questions.detection })
      .from(questions).where(inArray(questions.id, [below, boundary, changed]));
    expect(rows.find((row) => row.id === boundary)?.status).toBe('pending');
    for (const id of [below, changed]) {
      const row = rows.find((candidate) => candidate.id === id);
      expect(row?.status).toBe('dismissed');
      expect(row?.detection.voidedReason).toBe('pool_drift');
    }
    await db.update(questions).set({
      status: 'dismissed',
      detection: sql`jsonb_set(${questions.detection}::jsonb, '{voidedReason}', '"test_cleanup"'::jsonb, true)`,
    }).where(eq(questions.id, boundary));
  }, 30_000);

  test('voids every non-current pending question and stales only non-current exact-scope adjustments idempotently', async () => {
    const oldFingerprint = computeIntentFingerprint('Find builders', 'Prototype collaborators');
    const newFingerprint = computeIntentFingerprint('Find advisors', 'Prototype collaborators');
    const pendingId = await createQuestion('void old', 'pending', oldFingerprint);
    const missingFingerprintId = await createQuestion('void missing', 'pending', undefined);
    const preservedPendingId = await createQuestion('preserve current', 'pending', newFingerprint);
    await createQuestion('ordinary dismissal', 'dismissed', oldFingerprint);
    await db.update(intents).set({ payload: 'Find advisors' }).where(eq(intents.id, intentId));

    const opportunityId = crypto.randomUUID();
    opportunityIds.push(opportunityId);
    const originalUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
    const poolAdjustments = [
      'malformed',
      { questionId: 'legacy', factor: 0.6 },
      { questionId: 'half', recipientUserId: userId, factor: 0.6 },
      { recipientUserId: userId, intentId, factor: 'malformed' },
      { questionId: 'exact-legacy', recipientUserId: userId, intentId, factor: 0.6, custom: 'keep' },
      { questionId: 'exact-old', recipientUserId: userId, intentId, intentFingerprint: oldFingerprint, factor: 0.6 },
      { questionId: 'exact-current', recipientUserId: userId, intentId, intentFingerprint: newFingerprint, factor: 0.6 },
      { questionId: 'other-intent', recipientUserId: userId, intentId: crypto.randomUUID(), factor: 0.6 },
      { questionId: 'other-user', recipientUserId: crypto.randomUUID(), intentId, factor: 0.6 },
    ];
    await db.insert(opportunities).values({
      id: opportunityId,
      detection: { source: 'opportunity_graph', triggeredBy: intentId, timestamp: new Date().toISOString() },
      actors: [{ userId, role: 'peer', intent: intentId, networkId: crypto.randomUUID() }],
      interpretation: { category: 'test', reasoning: 'test', confidence: 0.8 },
      context: {},
      confidence: '0.8',
      status: 'accepted',
      updatedAt: originalUpdatedAt,
      metadata: { poolAdjustments },
    });

    const first = await adapter.handleMaterialIntentUpdate({ intentId, userId, oldFingerprint, newFingerprint });
    const second = await adapter.handleMaterialIntentUpdate({ intentId, userId, oldFingerprint, newFingerprint });
    expect(first).toEqual({ voidedQuestions: 2, staledAdjustments: 2 });
    expect(second).toEqual({ voidedQuestions: 0, staledAdjustments: 0 });

    const lifecycleRows = await db.select({ id: questions.id, status: questions.status, detection: questions.detection })
      .from(questions).where(inArray(questions.id, [pendingId, missingFingerprintId, preservedPendingId]));
    for (const id of [pendingId, missingFingerprintId]) {
      const row = lifecycleRows.find((candidate) => candidate.id === id);
      expect(row?.status).toBe('dismissed');
      expect(row?.detection.voidedReason).toBe('intent_edit');
    }
    expect(lifecycleRows.find((row) => row.id === preservedPendingId)?.status).toBe('pending');

    const [opportunity] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId));
    expect(opportunity.updatedAt.toISOString()).toBe(originalUpdatedAt.toISOString());
    expect(opportunity.metadata?.poolAdjustments).toEqual([
      'malformed',
      { questionId: 'legacy', factor: 0.6 },
      { questionId: 'half', recipientUserId: userId, factor: 0.6 },
      { recipientUserId: userId, intentId, factor: 'malformed' },
      { questionId: 'exact-legacy', recipientUserId: userId, intentId, factor: 0.6, custom: 'keep', stale: true },
      { questionId: 'exact-old', recipientUserId: userId, intentId, intentFingerprint: oldFingerprint, factor: 0.6, stale: true },
      { questionId: 'exact-current', recipientUserId: userId, intentId, intentFingerprint: newFingerprint, factor: 0.6 },
      poolAdjustments[7],
      poolAdjustments[8],
    ]);

    await db.update(questions).set({
      status: 'dismissed',
      detection: sql`jsonb_set(${questions.detection}::jsonb, '{voidedReason}', '"test_cleanup"'::jsonb, true)`,
    }).where(eq(questions.id, preservedPendingId));
    expect(await adapter.listPoolQuestionLabels(userId, intentId, {
      currentIntentFingerprint: oldFingerprint,
      currentIntentText: 'Find builders (Prototype collaborators)',
    })).toEqual(['ordinary dismissal']);
    expect((await adapter.listResolvedPoolAxes(userId, intentId, {
      currentIntentFingerprint: oldFingerprint,
      currentIntentText: 'Find builders (Prototype collaborators)',
    })).map((axis) => axis.label)).toEqual(['ordinary dismissal']);
  }, 30_000);

  test('does nothing when a delayed material-update event is superseded by authoritative intent state', async () => {
    const eventOldFingerprint = computeIntentFingerprint('Find advisors', 'Prototype collaborators');
    const delayedNewFingerprint = computeIntentFingerprint('Find local advisors', 'Prototype collaborators');
    const authoritativeFingerprint = computeIntentFingerprint('Find trusted local advisors', 'Prototype collaborators');
    await db.update(intents).set({ payload: 'Find trusted local advisors' }).where(eq(intents.id, intentId));
    const pendingId = await createQuestion('delayed event question', 'pending', eventOldFingerprint);
    const opportunityId = crypto.randomUUID();
    opportunityIds.push(opportunityId);
    await db.insert(opportunities).values({
      id: opportunityId,
      detection: { source: 'opportunity_graph', triggeredBy: intentId, timestamp: new Date().toISOString() },
      actors: [{ userId, role: 'peer', intent: intentId, networkId: crypto.randomUUID() }],
      interpretation: { category: 'test', reasoning: 'test', confidence: 0.8 },
      context: {},
      confidence: '0.8',
      status: 'accepted',
      metadata: { poolAdjustments: [{
        questionId: 'delayed-adjustment', recipientUserId: userId, intentId,
        intentFingerprint: authoritativeFingerprint, factor: 0.6,
      }] },
    });

    expect(await adapter.handleMaterialIntentUpdate({
      intentId,
      userId,
      oldFingerprint: eventOldFingerprint,
      newFingerprint: delayedNewFingerprint,
    })).toEqual({ voidedQuestions: 0, staledAdjustments: 0 });
    expect((await db.select({ status: questions.status }).from(questions).where(eq(questions.id, pendingId)))[0]?.status)
      .toBe('pending');
    expect((await db.select({ metadata: opportunities.metadata }).from(opportunities).where(eq(opportunities.id, opportunityId)))[0]?.metadata?.poolAdjustments)
      .toEqual([{ questionId: 'delayed-adjustment', recipientUserId: userId, intentId, intentFingerprint: authoritativeFingerprint, factor: 0.6 }]);
  }, 30_000);

  test('allows an external-edit re-ask, then dedups the newly persisted current-fingerprint axis', async () => {
    const oldFingerprint = computeIntentFingerprint('Find trusted local advisors', 'Prototype collaborators');
    const newPayload = 'Find trusted local advisors for healthcare';
    const newFingerprint = computeIntentFingerprint(newPayload, 'Prototype collaborators');
    await createQuestion('External edit axis', 'answered', oldFingerprint);
    await db.update(intents).set({ payload: newPayload }).where(eq(intents.id, intentId));
    await adapter.handleMaterialIntentUpdate({ intentId, userId, oldFingerprint, newFingerprint });

    const axis = discriminator('External edit axis');
    const labelsAfterEdit = await adapter.listPoolQuestionLabels(userId, intentId, {
      currentIntentFingerprint: newFingerprint,
      currentIntentText: `${newPayload} (Prototype collaborators)`,
    });
    expect(labelsAfterEdit).not.toContain('External edit axis');
    expect(dedupDiscriminators([axis], labelsAfterEdit)).toEqual([axis]);

    await createQuestion('External edit axis', 'pending', newFingerprint);
    const labelsAfterReask = await adapter.listPoolQuestionLabels(userId, intentId, {
      currentIntentFingerprint: newFingerprint,
      currentIntentText: `${newPayload} (Prototype collaborators)`,
    });
    expect(labelsAfterReask).toContain('External edit axis');
    expect(dedupDiscriminators([axis], labelsAfterReask)).toEqual([]);
  }, 30_000);

  test('keeps the just-answered axis fresh when answer refinement stamps the new fingerprint', async () => {
    const oldFingerprint = computeIntentFingerprint('Find trusted local advisors for healthcare', 'Prototype collaborators');
    const refinedPayload = 'Find trusted local healthcare advisors with operating experience';
    const refinedFingerprint = computeIntentFingerprint(refinedPayload, 'Prototype collaborators');
    const answeredId = await createQuestion('Answer-refined axis', 'answered', oldFingerprint);
    await db.update(intents).set({ payload: refinedPayload }).where(eq(intents.id, intentId));
    expect(await adapter.updateAnsweredPoolIntentFingerprint(answeredId, userId, refinedFingerprint)).toBe(true);

    const axis = discriminator('Answer-refined axis');
    const labels = await adapter.listPoolQuestionLabels(userId, intentId, {
      currentIntentFingerprint: refinedFingerprint,
      currentIntentText: `${refinedPayload} (Prototype collaborators)`,
    });
    expect(labels).toContain('Answer-refined axis');
    expect(dedupDiscriminators([axis], labels)).toEqual([]);
  }, 30_000);
});
