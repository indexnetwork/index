import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm/sql';

import { QuestionerAdapter, type AdapterQuestionMode } from '../questioner.adapter';
import db from '../../lib/drizzle/drizzle';
import { questions } from '../../schemas/database.schema';

/**
 * Integration coverage for getAnsweredNegotiationQuestionsForOpportunity
 * (IND-465 slice 2 — Lens C owner_answer evidence). Every fail-closed SQL
 * constraint is exercised against real rows: status, subject-actor scoping,
 * negotiation-family mode restriction, opportunity binding, answeredBy
 * authority, and capture-time fingerprint tolerance/equality.
 */
describe('QuestionerAdapter.getAnsweredNegotiationQuestionsForOpportunity', () => {
  const adapter = new QuestionerAdapter(db);
  const recipientUserId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const opportunityId = crypto.randomUUID();
  const otherOpportunityId = crypto.randomUUID();
  const fingerprint = 'fp-current';
  const questionIds: string[] = [];

  async function createAnsweredQuestion(options: {
    mode?: AdapterQuestionMode;
    sourceType?: string;
    sourceId?: string;
    actorUserId?: string;
    actorRole?: string;
    status?: 'pending' | 'answered' | 'dismissed';
    answeredBy?: string;
    selectedOptions?: string[];
    freeText?: string;
    detectionIntentFingerprint?: string;
    createdAt?: Date;
  } = {}): Promise<string> {
    const id = crypto.randomUUID();
    questionIds.push(id);
    await db.insert(questions).values({
      id,
      detection: {
        mode: options.mode ?? 'negotiation',
        sourceType: options.sourceType ?? 'opportunity',
        sourceId: options.sourceId ?? opportunityId,
        timestamp: new Date().toISOString(),
        ...(options.detectionIntentFingerprint !== undefined
          ? { intentFingerprint: options.detectionIntentFingerprint }
          : {}),
      } as (typeof questions.$inferInsert)['detection'],
      actors: [{
        userId: options.actorUserId ?? recipientUserId,
        role: (options.actorRole ?? 'subject') as 'subject',
      }],
      payload: {
        title: 'Negotiation question',
        prompt: 'Share your preference?',
        options: [
          { label: 'Yes', description: 'Yes' },
          { label: 'No', description: 'No' },
        ],
        multiSelect: false,
      },
      status: options.status ?? 'answered',
      answer: (options.status ?? 'answered') === 'answered'
        ? {
            selectedOptions: options.selectedOptions ?? ['Yes'],
            ...(options.freeText !== undefined ? { freeText: options.freeText } : {}),
            answeredBy: options.answeredBy ?? recipientUserId,
            answeredAt: new Date().toISOString(),
          }
        : null,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    });
    return id;
  }

  afterAll(async () => {
    if (questionIds.length) await db.delete(questions).where(inArray(questions.id, questionIds)).catch(() => {});
  });

  test('returns only answeredBy-verified negotiation-family answers bound to the opportunity, newest first', async () => {
    const negotiationId = await createAnsweredQuestion({
      selectedOptions: ['Yes'],
      freeText: 'Prefer async collaboration',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const inflightId = await createAnsweredQuestion({
      mode: 'negotiation_inflight',
      selectedOptions: [],
      freeText: 'Share my timezone only',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    // Excluded rows — each violates exactly one fail-closed constraint.
    await createAnsweredQuestion({ status: 'pending' });
    await createAnsweredQuestion({ status: 'dismissed' });
    await createAnsweredQuestion({ answeredBy: otherUserId });
    await createAnsweredQuestion({ actorUserId: otherUserId });
    await createAnsweredQuestion({ actorRole: 'observer' });
    await createAnsweredQuestion({ sourceId: otherOpportunityId });
    await createAnsweredQuestion({ mode: 'pool_discovery', sourceType: 'intent', sourceId: crypto.randomUUID() });
    await createAnsweredQuestion({ mode: 'pool_discovery' });
    await createAnsweredQuestion({ mode: 'chat' });
    await createAnsweredQuestion({ mode: 'enrichment' });
    await createAnsweredQuestion({ detectionIntentFingerprint: 'fp-drifted' });
    await createAnsweredQuestion({ selectedOptions: [] }); // empty content

    const results = await adapter.getAnsweredNegotiationQuestionsForOpportunity(
      recipientUserId,
      opportunityId,
      fingerprint,
    );

    expect(results.map((result) => result.questionId)).toEqual([inflightId, negotiationId]);
    expect(results.map((result) => ({
      answeredBy: result.answeredBy,
      selectedOptions: result.selectedOptions,
      freeText: result.freeText,
    }))).toEqual([
      { answeredBy: recipientUserId, selectedOptions: [], freeText: 'Share my timezone only' },
      { answeredBy: recipientUserId, selectedOptions: ['Yes'], freeText: 'Prefer async collaboration' },
    ]);
    // Answer content only — never question text or detection payloads.
    expect(JSON.stringify(results)).not.toContain('Share your preference?');
  }, 30_000);

  test('tolerates an absent capture-time fingerprint and requires equality when present', async () => {
    const localOpportunityId = crypto.randomUUID();
    const matchingId = await createAnsweredQuestion({
      sourceId: localOpportunityId,
      detectionIntentFingerprint: fingerprint,
      selectedOptions: ['Fresh'],
    });
    const absentId = await createAnsweredQuestion({
      sourceId: localOpportunityId,
      selectedOptions: ['Tolerated'],
    });
    await createAnsweredQuestion({
      sourceId: localOpportunityId,
      detectionIntentFingerprint: 'fp-drifted',
      selectedOptions: ['Stale'],
    });

    const results = await adapter.getAnsweredNegotiationQuestionsForOpportunity(
      recipientUserId,
      localOpportunityId,
      fingerprint,
    );

    expect(results.map((result) => result.questionId).sort()).toEqual([matchingId, absentId].sort());
    expect(results.find((result) => result.questionId === matchingId)?.capturedIntentFingerprint).toBe(fingerprint);
    expect(results.find((result) => result.questionId === absentId)?.capturedIntentFingerprint).toBeUndefined();
    expect(JSON.stringify(results)).not.toContain('Stale');
  }, 30_000);
});
