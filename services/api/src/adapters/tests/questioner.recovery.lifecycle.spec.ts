import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll as bunAfterAll, beforeAll as bunBeforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm/sql';

import { QuestionEvents } from '../../events/question.event';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { withMinimumDatabaseHookBudget } from '../../lib/testing/database-test-budget';
import db from '../../lib/drizzle/drizzle';
import { intents, opportunities, questions } from '../../schemas/database.schema';
import { UserDatabaseAdapter } from '../database.adapter';
import { QuestionerAdapter, type AdapterPersistableQuestion } from '../questioner.adapter';

const beforeAll = withMinimumDatabaseHookBudget(bunBeforeAll, 30_000);
const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 30_000);

function recoveryQuestion(userId: string, intentId: string, fingerprint: string): AdapterPersistableQuestion {
  return {
    detection: {
      mode: 'intent', purpose: 'recovery', sourceType: 'intent', sourceId: intentId,
      triggeredBy: intentId, timestamp: new Date().toISOString(),
      recovery: { version: 1, intentFingerprint: fingerprint, completionSource: 'from_intent' },
    },
    actors: [{ userId, role: 'subject' }],
    payload: {
      title: 'Timing',
      prompt: 'For your climate collaborator goal, when should the work begin?',
      options: [
        { label: 'Now', description: 'Prioritizes collaborators available immediately.' },
        { label: 'Later', description: 'Prioritizes fit over immediate availability.' },
      ],
      multiSelect: false,
    },
    strategy: 'surface_missing_detail',
    underspecificationType: 'missing_constraint',
  };
}

describe('QuestionerAdapter recovery lifecycle', () => {
  const users = new UserDatabaseAdapter();
  const adapter = new QuestionerAdapter(db);
  const questionIds: string[] = [];
  const opportunityIds: string[] = [];
  let userId: string;
  let intentId: string;
  let payload = 'Find a climate analytics collaborator';
  const summary = 'Climate collaboration';

  beforeAll(async () => {
    userId = (await users.create({
      email: `questioner-recovery-${crypto.randomUUID()}@example.com`,
      name: 'Recovery Owner',
    })).id;
    intentId = crypto.randomUUID();
    await db.insert(intents).values({ id: intentId, userId, payload, summary, status: 'ACTIVE' });
  });

  afterAll(async () => {
    QuestionEvents.onAnswered = () => {};
    if (questionIds.length) await db.delete(questions).where(inArray(questions.id, questionIds)).catch(() => {});
    if (opportunityIds.length) await db.delete(opportunities).where(inArray(opportunities.id, opportunityIds)).catch(() => {});
    await db.delete(intents).where(eq(intents.id, intentId)).catch(() => {});
    await users.deleteById(userId).catch(() => {});
  });

  test('prepares only an exact recipient-owned active intent and exact-trigger opportunities', async () => {
    expect(await adapter.prepareRecoveryRefinement(userId, crypto.randomUUID())).toBeNull();
    expect(await adapter.prepareRecoveryRefinement(crypto.randomUUID(), intentId)).toBeNull();
    await db.update(intents).set({ status: 'PAUSED' }).where(eq(intents.id, intentId));
    expect(await adapter.prepareRecoveryRefinement(userId, intentId)).toBeNull();
    await db.update(intents).set({ status: 'ACTIVE', archivedAt: new Date() }).where(eq(intents.id, intentId));
    expect(await adapter.prepareRecoveryRefinement(userId, intentId)).toBeNull();
    await db.update(intents).set({ archivedAt: null }).where(eq(intents.id, intentId));

    const exactId = crypto.randomUUID();
    const foreignTriggerId = crypto.randomUUID();
    const sharedNetworkId = crypto.randomUUID();
    opportunityIds.push(exactId, foreignTriggerId);
    const baseOpportunity = {
      actors: [
        { userId, role: 'peer' as const, networkId: sharedNetworkId },
        { userId: crypto.randomUUID(), role: 'peer' as const, networkId: sharedNetworkId },
      ],
      interpretation: { category: 'test', reasoning: 'private', confidence: 0.8 },
      context: {}, confidence: '0.8', status: 'rejected' as const,
    };
    await db.insert(opportunities).values([
      {
        ...baseOpportunity, id: exactId,
        detection: { source: 'opportunity_graph', triggeredBy: intentId, timestamp: new Date().toISOString() },
      },
      {
        ...baseOpportunity, id: foreignTriggerId,
        detection: { source: 'opportunity_graph', triggeredBy: crypto.randomUUID(), timestamp: new Date().toISOString() },
      },
    ]);
    const prepared = await adapter.prepareRecoveryRefinement(userId, intentId);
    expect(prepared?.opportunities.map((opportunity) => opportunity.id)).toEqual([exactId]);
  }, 30_000);

  test('serializes repeated/concurrent completions and keeps every status/expiry as a cadence anchor', async () => {
    const fingerprint = computeIntentFingerprint(payload, summary);
    const question = recoveryQuestion(userId, intentId, fingerprint);
    const concurrent = await Promise.all([
      adapter.persistFreshRecoveryQuestion(question, userId, fingerprint),
      adapter.persistFreshRecoveryQuestion(question, userId, fingerprint),
    ]);
    const winner = concurrent.find((id): id is string => typeof id === 'string');
    expect(winner).toBeDefined();
    expect(concurrent.filter(Boolean)).toHaveLength(1);
    questionIds.push(winner!);

    for (const state of [
      { status: 'pending' as const, expiresAt: new Date(Date.now() + 60_000) },
      { status: 'pending' as const, expiresAt: new Date(Date.now() - 60_000) },
      { status: 'answered' as const, expiresAt: new Date(Date.now() - 60_000) },
      { status: 'dismissed' as const, expiresAt: null },
    ]) {
      await db.update(questions).set(state).where(eq(questions.id, winner!));
      expect((await adapter.prepareRecoveryRefinement(userId, intentId))?.hasCadenceAnchor).toBe(true);
      expect(await adapter.persistFreshRecoveryQuestion(
        question, userId, fingerprint,
      )).toBeNull();
    }

    payload = 'Find a climate analytics collaborator for an October pilot';
    await db.update(intents).set({ payload }).where(eq(intents.id, intentId));
    const changedFingerprint = computeIntentFingerprint(payload, summary);
    const changedId = await adapter.persistFreshRecoveryQuestion(
      recoveryQuestion(userId, intentId, changedFingerprint),
      userId,
      changedFingerprint,
    );
    expect(changedId).toBeString();
    questionIds.push(changedId!);
  }, 30_000);

  test('fails the final gate on lifecycle or fingerprint drift but not on actionable opportunities', async () => {
    payload = 'Find a carbon accounting advisor';
    await db.update(intents).set({ payload, status: 'ACTIVE' }).where(eq(intents.id, intentId));
    const fingerprint = computeIntentFingerprint(payload, summary);
    const question = recoveryQuestion(userId, intentId, fingerprint);

    await db.update(intents).set({ status: 'PAUSED' }).where(eq(intents.id, intentId));
    expect(await adapter.persistFreshRecoveryQuestion(question, userId, fingerprint)).toBeNull();
    await db.update(intents).set({ status: 'ACTIVE', payload: `${payload} in Europe` }).where(eq(intents.id, intentId));
    expect(await adapter.persistFreshRecoveryQuestion(question, userId, fingerprint)).toBeNull();

    await db.update(intents).set({ payload }).where(eq(intents.id, intentId));
    const opportunityId = crypto.randomUUID();
    const opportunityNetworkId = crypto.randomUUID();
    opportunityIds.push(opportunityId);
    await db.insert(opportunities).values({
      id: opportunityId,
      detection: { source: 'opportunity_graph', triggeredBy: intentId, timestamp: new Date().toISOString() },
      actors: [
        { userId, role: 'peer', networkId: opportunityNetworkId },
        { userId: crypto.randomUUID(), role: 'peer', networkId: opportunityNetworkId },
      ],
      interpretation: { category: 'test', reasoning: 'unsafe raw reasoning', confidence: 0.8 },
      context: {}, confidence: '0.8', status: 'latent',
    });
    const inserted = await adapter.persistFreshRecoveryQuestion(question, userId, fingerprint);
    expect(inserted).toBeString();
    questionIds.push(inserted!);
  }, 30_000);

  test('material intent edits void stale pending recovery rows without erasing cadence history', async () => {
    payload = 'Find a packaging designer';
    await db.update(intents).set({ payload, status: 'ACTIVE' }).where(eq(intents.id, intentId));
    const oldFingerprint = computeIntentFingerprint(payload, summary);
    const staleId = await adapter.persistFreshRecoveryQuestion(
      recoveryQuestion(userId, intentId, oldFingerprint), userId, oldFingerprint,
    );
    expect(staleId).toBeString();
    questionIds.push(staleId!);

    const nextPayload = `${payload} for reusable food systems`;
    const newFingerprint = computeIntentFingerprint(nextPayload, summary);
    await db.update(intents).set({ payload: nextPayload }).where(eq(intents.id, intentId));
    const result = await adapter.handleMaterialIntentUpdate({
      intentId, userId, oldFingerprint, newFingerprint,
    });
    expect(result.voidedQuestions).toBeGreaterThanOrEqual(1);
    const [row] = await db.select({ status: questions.status, detection: questions.detection })
      .from(questions).where(eq(questions.id, staleId!));
    expect(row.status).toBe('dismissed');
    expect(row.detection.voidedReason).toBe('intent_edit');
    payload = nextPayload;
  }, 30_000);

  test('answer and material-update reconciliation cannot deadlock or emit a drifted answer', async () => {
    payload = 'Find a circular-economy manufacturing partner';
    await db.update(intents).set({ payload, status: 'ACTIVE' }).where(eq(intents.id, intentId));
    const oldFingerprint = computeIntentFingerprint(payload, summary);
    const questionId = await adapter.persistFreshRecoveryQuestion(
      recoveryQuestion(userId, intentId, oldFingerprint), userId, oldFingerprint,
    );
    expect(questionId).toBeString();
    questionIds.push(questionId!);

    const events: unknown[] = [];
    QuestionEvents.onAnswered = (event) => { events.push(event); };
    const nextPayload = `${payload} for small-batch production`;
    const newFingerprint = computeIntentFingerprint(nextPayload, summary);
    await db.update(intents).set({ payload: nextPayload }).where(eq(intents.id, intentId));

    const [answered] = await Promise.all([
      adapter.answer(questionId!, userId, {
        selectedOptions: ['Now'], answeredBy: userId, answeredAt: new Date().toISOString(),
      }),
      adapter.handleMaterialIntentUpdate({ intentId, userId, oldFingerprint, newFingerprint }),
    ]);
    expect(answered).toBe(false);
    const [voided] = await db.select({ status: questions.status, detection: questions.detection })
      .from(questions).where(eq(questions.id, questionId!));
    expect(voided.status).toBe('dismissed');
    expect(['intent_edit', 'recovery_drift']).toContain(voided.detection.voidedReason);
    expect(events).toHaveLength(0);
    payload = nextPayload;
  }, 30_000);

  test('system-voids a drifted recovery answer without an event and admits a current answer', async () => {
    payload = 'Find an industrial design collaborator';
    await db.update(intents).set({ payload, status: 'ACTIVE' }).where(eq(intents.id, intentId));
    const oldFingerprint = computeIntentFingerprint(payload, summary);
    const oldId = await adapter.persistFreshRecoveryQuestion(
      recoveryQuestion(userId, intentId, oldFingerprint), userId, oldFingerprint,
    );
    expect(oldId).toBeString();
    questionIds.push(oldId!);

    const events: unknown[] = [];
    QuestionEvents.onAnswered = (event) => { events.push(event); };
    payload = `${payload} for medical devices`;
    await db.update(intents).set({ payload }).where(eq(intents.id, intentId));
    expect(await adapter.answer(oldId!, userId, {
      selectedOptions: ['Now'], answeredBy: userId, answeredAt: new Date().toISOString(),
    })).toBe(false);
    const [voided] = await db.select({ status: questions.status, detection: questions.detection })
      .from(questions).where(eq(questions.id, oldId!));
    expect(voided.status).toBe('dismissed');
    expect(voided.detection.voidedReason).toBe('recovery_drift');
    expect(events).toHaveLength(0);

    const currentFingerprint = computeIntentFingerprint(payload, summary);
    const currentId = await adapter.persistFreshRecoveryQuestion(
      recoveryQuestion(userId, intentId, currentFingerprint), userId, currentFingerprint,
    );
    expect(currentId).toBeString();
    questionIds.push(currentId!);
    const foreignUserId = crypto.randomUUID();
    expect(await adapter.answer(currentId!, foreignUserId, {
      selectedOptions: ['Now'], answeredBy: foreignUserId, answeredAt: new Date().toISOString(),
    })).toBe(false);
    expect((await adapter.getById(currentId!))?.status).toBe('pending');
    expect(events).toHaveLength(0);

    expect(await adapter.answer(currentId!, userId, {
      selectedOptions: ['Now'], answeredBy: userId, answeredAt: new Date().toISOString(),
    })).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      questionId: currentId, userId, mode: 'intent', purpose: 'recovery',
      sourceType: 'intent', sourceId: intentId, recoveryIntentFingerprint: currentFingerprint,
    });
  }, 30_000);
});
