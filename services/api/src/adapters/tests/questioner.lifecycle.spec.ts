import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm/sql';

import { QuestionerAdapter, type AdapterPersistableQuestion } from '../questioner.adapter';
import { UserDatabaseAdapter } from '../database.adapter';
import db from '../../lib/drizzle/drizzle';
import { intents, opportunities, questions } from '../../schemas/database.schema';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { isPoolArtifactFresh } from '../../queues/pool/poolquestions.constants';

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
    status: 'pending' | 'dismissed',
    fingerprint: string,
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
          intentFingerprint: fingerprint,
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
    if (status === 'dismissed') await db.update(questions).set({ status }).where(eq(questions.id, id));
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
  }, 30_000);

  test('voids old pending questions and stales only exact scoped adjustments idempotently', async () => {
    const oldFingerprint = computeIntentFingerprint('Find builders', 'Prototype collaborators');
    const newFingerprint = computeIntentFingerprint('Find advisors', 'Prototype collaborators');
    const pendingId = await createQuestion('void me', 'pending', oldFingerprint);
    await createQuestion('ordinary dismissal', 'dismissed', oldFingerprint);

    const opportunityId = crypto.randomUUID();
    opportunityIds.push(opportunityId);
    const originalUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
    const poolAdjustments = [
      'malformed',
      { questionId: 'legacy', factor: 0.6 },
      { questionId: 'half', recipientUserId: userId, factor: 0.6 },
      { questionId: 'exact', recipientUserId: userId, intentId, factor: 0.6, custom: 'keep' },
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

    const first = await adapter.handleMaterialIntentUpdate({
      intentId,
      userId,
      oldFingerprint,
      newFingerprint,
    });
    const second = await adapter.handleMaterialIntentUpdate({
      intentId,
      userId,
      oldFingerprint,
      newFingerprint,
    });
    expect(first).toEqual({ voidedQuestions: 1, staledAdjustments: 1 });
    expect(second).toEqual({ voidedQuestions: 0, staledAdjustments: 0 });

    const [voided] = await db.select().from(questions).where(eq(questions.id, pendingId));
    expect(voided.status).toBe('dismissed');
    expect(voided.detection.voidedReason).toBe('intent_edit');

    const [opportunity] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId));
    expect(opportunity.updatedAt.toISOString()).toBe(originalUpdatedAt.toISOString());
    expect(opportunity.metadata?.poolAdjustments).toEqual([
      'malformed',
      { questionId: 'legacy', factor: 0.6 },
      { questionId: 'half', recipientUserId: userId, factor: 0.6 },
      { questionId: 'exact', recipientUserId: userId, intentId, factor: 0.6, custom: 'keep', stale: true },
      poolAdjustments[4],
      poolAdjustments[5],
    ]);

    expect(await adapter.listPoolQuestionLabels(userId, intentId, {
      currentIntentFingerprint: oldFingerprint,
      currentIntentText: 'Find builders (Prototype collaborators)',
    })).toEqual(['ordinary dismissal']);
    expect((await adapter.listResolvedPoolAxes(userId, intentId, {
      currentIntentFingerprint: oldFingerprint,
      currentIntentText: 'Find builders (Prototype collaborators)',
    })).map((axis) => axis.label)).toEqual(['ordinary dismissal']);
  }, 30_000);
});
