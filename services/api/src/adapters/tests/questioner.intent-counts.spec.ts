import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm/sql';

import { QuestionerAdapter, type AdapterPersistableQuestion, type AdapterQuestionDetection } from '../questioner.adapter';
import { UserDatabaseAdapter } from '../database.adapter';
import db from '../../lib/drizzle/drizzle';
import { opportunities, questions } from '../../schemas/database.schema';

const EMAIL = `question-intent-counts-${Date.now()}@example.com`;
const NETWORK_A = '00000000-0000-4000-8000-00000000000a';
const NETWORK_B = '00000000-0000-4000-8000-00000000000b';

describe('QuestionerAdapter.countPendingByIntent', () => {
  const users = new UserDatabaseAdapter();
  const adapter = new QuestionerAdapter(db);
  const questionIds: string[] = [];
  const opportunityIds: string[] = [];
  const includedIntentOneQuestionIds: string[] = [];
  const excludedIntentOneQuestionIds: string[] = [];
  let userId: string;
  let intentOneId: string;
  let intentTwoId: string;
  let intentTwoQuestionId: string;
  let networkAQuestionId: string;
  let networkANegotiationQuestionId: string;
  let malformedActorQuestionId: string;

  async function persistQuestion(
    detection: AdapterQuestionDetection,
    actor: { userId: string; networkId?: string } = { userId },
  ): Promise<string> {
    const question: AdapterPersistableQuestion = {
      detection,
      actors: [{ ...actor, role: 'subject' }],
      payload: {
        title: 'Focused question',
        prompt: 'Which constraint matters?',
        options: [{ label: 'One', description: 'First option' }],
        multiSelect: false,
      },
      strategy: 'surface_missing_detail',
    };
    const [id] = await adapter.persist([question]);
    questionIds.push(id);
    return id;
  }

  function directDetection(intentId: string): AdapterQuestionDetection {
    return {
      mode: 'intent',
      sourceType: 'intent',
      sourceId: intentId,
      timestamp: new Date().toISOString(),
    };
  }

  beforeAll(async () => {
    const user = await users.create({ email: EMAIL, name: 'Question Count User' });
    userId = user.id;
    intentOneId = crypto.randomUUID();
    intentTwoId = crypto.randomUUID();
    // Keep this focused integration test compatible with a test database that
    // may lag optional intent columns while still exercising the live tables.
    await db.execute(sql`
      INSERT INTO intents (id, payload, user_id)
      VALUES
        (${intentOneId}, 'Find collaborators for an academic grounding project', ${userId}),
        (${intentTwoId}, 'Find a second independent collaboration', ${userId})
    `);

    const detectionOpportunityId = crypto.randomUUID();
    const actorOpportunityId = crypto.randomUUID();
    const malformedActorOpportunityId = crypto.randomUUID();
    opportunityIds.push(detectionOpportunityId, actorOpportunityId, malformedActorOpportunityId);
    await db.insert(opportunities).values([
      {
        id: detectionOpportunityId,
        detection: {
          source: 'opportunity_graph',
          triggeredBy: intentOneId,
          timestamp: new Date().toISOString(),
        },
        actors: [{ networkId: NETWORK_A, userId, role: 'initiator' }],
        interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.9 },
        context: { networkId: NETWORK_A },
        confidence: '0.9',
      },
      {
        id: actorOpportunityId,
        detection: {
          source: 'opportunity_graph',
          timestamp: new Date().toISOString(),
        },
        actors: [{ networkId: NETWORK_A, userId, intent: intentOneId, role: 'initiator' }],
        interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.9 },
        context: { networkId: NETWORK_A },
        confidence: '0.9',
      },
      {
        id: malformedActorOpportunityId,
        detection: {
          source: 'opportunity_graph',
          timestamp: new Date().toISOString(),
        },
        actors: [],
        interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.9 },
        context: { networkId: NETWORK_A },
        confidence: '0.9',
      },
    ]);
    await db.execute(sql`
      UPDATE opportunities
      SET actors = '{"corrupt":true}'::jsonb
      WHERE id = ${malformedActorOpportunityId}
    `);

    includedIntentOneQuestionIds.push(await persistQuestion(directDetection(intentOneId)));
    includedIntentOneQuestionIds.push(await persistQuestion({
      mode: 'discovery',
      sourceType: 'discovery',
      sourceId: crypto.randomUUID(),
      triggeredBy: intentOneId,
      timestamp: new Date().toISOString(),
    }));
    includedIntentOneQuestionIds.push(await persistQuestion({
      mode: 'negotiation',
      sourceType: 'opportunity',
      sourceId: detectionOpportunityId,
      timestamp: new Date().toISOString(),
    }));
    includedIntentOneQuestionIds.push(await persistQuestion({
      mode: 'negotiation',
      sourceType: 'opportunity',
      sourceId: actorOpportunityId,
      timestamp: new Date().toISOString(),
    }));
    malformedActorQuestionId = await persistQuestion({
      mode: 'negotiation',
      sourceType: 'opportunity',
      sourceId: malformedActorOpportunityId,
      timestamp: new Date().toISOString(),
    });
    excludedIntentOneQuestionIds.push(malformedActorQuestionId);
    networkAQuestionId = await persistQuestion(
      directDetection(intentOneId),
      { userId, networkId: NETWORK_A },
    );
    includedIntentOneQuestionIds.push(networkAQuestionId);
    networkANegotiationQuestionId = await persistQuestion(
      {
        mode: 'negotiation',
        sourceType: 'opportunity',
        sourceId: detectionOpportunityId,
        timestamp: new Date().toISOString(),
      },
      { userId, networkId: NETWORK_A },
    );
    includedIntentOneQuestionIds.push(networkANegotiationQuestionId);
    includedIntentOneQuestionIds.push(await persistQuestion(
      directDetection(intentOneId),
      { userId, networkId: NETWORK_B },
    ));
    intentTwoQuestionId = await persistQuestion(directDetection(intentTwoId));

    const expiredId = await persistQuestion(directDetection(intentOneId));
    const answeredId = await persistQuestion(directDetection(intentOneId));
    const dismissedId = await persistQuestion(directDetection(intentOneId));
    const foreignRecipientId = await persistQuestion(
      directDetection(intentOneId),
      { userId: crypto.randomUUID() },
    );
    excludedIntentOneQuestionIds.push(expiredId, answeredId, dismissedId, foreignRecipientId);
    await db.update(questions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(questions.id, expiredId));
    await db.update(questions)
      .set({ status: 'answered', answer: {
        selectedOptions: ['One'],
        answeredBy: userId,
        answeredAt: new Date().toISOString(),
      } })
      .where(eq(questions.id, answeredId));
    await db.update(questions)
      .set({ status: 'dismissed' })
      .where(eq(questions.id, dismissedId));
  }, 30_000);

  afterAll(async () => {
    if (questionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, questionIds)).catch(() => {});
    }
    if (opportunityIds.length > 0) {
      await db.delete(opportunities).where(inArray(opportunities.id, opportunityIds)).catch(() => {});
    }
    if (userId) {
      await db.execute(sql`DELETE FROM intents WHERE user_id = ${userId}`).catch(() => {});
      await users.deleteById(userId).catch(() => {});
    }
  }, 30_000);

  test('bulk counts exactly match canonical intent-scope visibility', async () => {
    const counts = await adapter.countPendingByIntent(userId, [intentOneId, intentTwoId]);
    const intentOnePending = await adapter.findPending(userId, {
      scopeType: 'intent',
      scopeId: intentOneId,
    });
    const intentTwoPending = await adapter.findPending(userId, {
      scopeType: 'intent',
      scopeId: intentTwoId,
    });

    const intentOnePendingIds = intentOnePending.map((question) => question.id);
    const intentTwoPendingIds = intentTwoPending.map((question) => question.id);
    expect(counts.get(intentOneId)).toBe(7);
    expect(counts.get(intentTwoId)).toBe(1);
    expect(counts.get(intentOneId)).toBe(intentOnePending.length);
    expect(counts.get(intentTwoId)).toBe(intentTwoPending.length);
    expect(intentOnePendingIds).toEqual(expect.arrayContaining(includedIntentOneQuestionIds));
    for (const excludedId of excludedIntentOneQuestionIds) {
      expect(intentOnePendingIds).not.toContain(excludedId);
    }
    expect(intentTwoPendingIds).toEqual([intentTwoQuestionId]);
  }, 30_000);

  test('network scope uses the same recipient actor ownership as findPending', async () => {
    const counts = await adapter.countPendingByIntent(
      userId,
      [intentOneId, intentTwoId],
      { networkId: NETWORK_A, modes: ['enrichment', 'intent', 'discovery'] },
    );
    const visible = await adapter.findPending(userId, {
      scopeType: 'intent',
      scopeId: intentOneId,
      networkId: NETWORK_A,
      modes: ['enrichment', 'intent', 'discovery'],
    });

    expect(counts.get(intentOneId)).toBe(1);
    expect(counts.get(intentOneId)).toBe(visible.length);
    expect(visible.map((question) => question.id)).toEqual([networkAQuestionId]);
    expect(visible.map((question) => question.id)).not.toContain(networkANegotiationQuestionId);
    expect(counts.get(intentTwoId)).toBe(0);
  }, 30_000);

  test('malformed opportunity actors neither crash nor link a pending question', async () => {
    const visible = await adapter.findPending(userId, {
      scopeType: 'intent',
      scopeId: intentOneId,
    });
    const counts = await adapter.countPendingByIntent(userId, [intentOneId]);

    expect(visible.map((question) => question.id)).not.toContain(malformedActorQuestionId);
    expect(counts.get(intentOneId)).toBe(visible.length);
  }, 30_000);

  test('unknown intent ids fail closed to zero without extra queries', async () => {
    const unknownId = crypto.randomUUID();
    const counts = await adapter.countPendingByIntent(userId, [unknownId]);
    expect(counts).toEqual(new Map([[unknownId, 0]]));
  }, 30_000);
});
