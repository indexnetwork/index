import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm/sql';

import { conversationDatabaseAdapter, UserDatabaseAdapter } from '../database.adapter';
import { QuestionerAdapter, type AdapterPersistableQuestion, type PoolPushClaim } from '../questioner.adapter';
import { chatSessionService } from '../../services/chat.service';
import db from '../../lib/drizzle/drizzle';
import { conversationParticipants, conversations, messages } from '../../schemas/conversation.schema';
import { intents, questions } from '../../schemas/database.schema';

const EMAIL = 'test-conversation-pool-push@example.com';

describe('ConversationDatabaseAdapter pool push delivery transaction', () => {
  const users = new UserDatabaseAdapter();
  const questioner = new QuestionerAdapter(db);
  let userId: string;
  let intentId: string;
  const sessionIds = new Set<string>();

  async function createClaim(): Promise<PoolPushClaim> {
    const question: AdapterPersistableQuestion = {
      detection: {
        mode: 'pool_discovery',
        sourceType: 'intent',
        sourceId: intentId,
        triggeredBy: intentId,
        timestamp: new Date().toISOString(),
        pool: {
          poolSize: 8,
          minedAt: new Date().toISOString(),
          runId: crypto.randomUUID(),
          discriminator: {
            label: 'Role',
            questionSeed: 'Which role?',
            sides: ['Builder', 'Advisor'],
            sideCounts: { Builder: 4, Advisor: 4 },
            voi: 0.9,
            evidenceRate: 1,
            assignments: [{ opportunityId: crypto.randomUUID(), side: 'Builder' }],
          },
          alternates: [],
        },
      },
      actors: [{ userId, role: 'subject' }],
      payload: {
        title: 'Role',
        prompt: 'Builder or advisor?',
        options: [
          { label: 'Builder', description: 'Hands-on' },
          { label: 'Advisor', description: 'Strategic' },
        ],
        multiSelect: false,
      },
      strategy: 'refine_intent',
    };
    const [id] = await questioner.persist([question]);
    const result = await questioner.claimPoolQuestionPush(id, userId);
    if (result.kind !== 'claimed') throw new Error(`Expected claim, got ${result.kind}`);
    return result;
  }

  beforeAll(async () => {
    const existing = await users.findByEmail(EMAIL);
    if (existing) {
      await db.delete(questions).where(
        sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: existing.id }])}::jsonb`,
      );
      await db.delete(intents).where(eq(intents.userId, existing.id));
      await users.deleteById(existing.id);
    }
    userId = (await users.create({ email: EMAIL, name: 'Delivery User' })).id;
  });

  beforeEach(async () => {
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`);
    await db.delete(intents).where(eq(intents.userId, userId));
    intentId = crypto.randomUUID();
    await db.insert(intents).values({
      id: intentId,
      userId,
      payload: 'Find a collaborator',
      summary: 'Find a collaborator',
      status: 'ACTIVE',
    });
  });

  afterAll(async () => {
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`).catch(() => {});
    await db.delete(intents).where(eq(intents.userId, userId)).catch(() => {});
    for (const id of sessionIds) await conversationDatabaseAdapter.deleteChatSession(id).catch(() => {});
    await users.deleteById(userId).catch(() => {});
  });

  async function stableDm(): Promise<string> {
    const resolved = await chatSessionService.resolveNegotiatorSession(userId, 'Personal Agent');
    if ('error' in resolved) throw new Error(resolved.error);
    sessionIds.add(resolved.session.id);
    return resolved.session.id;
  }

  test('inserts or verifies one deterministic message and stamps pushedAt atomically', async () => {
    const claim = await createClaim();
    const conversationId = await stableDm();
    const input = {
      questionId: claim.questionId,
      recipientId: claim.recipientId,
      intentId: claim.intentId,
      cycleKey: claim.cycleKey,
      conversationId,
      messageText: 'Quick one about [Find a collaborator](/i/' + intentId + '): Builder or advisor?',
    };

    await db.update(conversationParticipants)
      .set({ hiddenAt: new Date() })
      .where(and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.participantId, userId),
      ));
    expect(await conversationDatabaseAdapter.deliverClaimedPoolQuestionPush(input)).toEqual({ status: 'delivered', inserted: true });
    const [afterFirst] = await db.select({
      lastMessageAt: conversations.lastMessageAt,
      updatedAt: conversations.updatedAt,
    }).from(conversations).where(eq(conversations.id, conversationId));
    expect(afterFirst.updatedAt?.toISOString()).toBe(afterFirst.lastMessageAt?.toISOString());
    const [participant] = await db.select({ hiddenAt: conversationParticipants.hiddenAt })
      .from(conversationParticipants)
      .where(and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.participantId, userId),
      ));
    expect(participant.hiddenAt).toBeNull();

    await db.update(messages).set({
      parts: [{ text: input.messageText, type: 'text' }],
      metadata: {
        cycleKey: claim.cycleKey,
        intentId: claim.intentId,
        recipientId: claim.recipientId,
        questionId: claim.questionId,
        source: 'pool_question_push',
      },
    }).where(eq(messages.id, claim.questionId));
    expect(await conversationDatabaseAdapter.deliverClaimedPoolQuestionPush(input)).toEqual({ status: 'delivered', inserted: false });
    const [afterRetry] = await db.select({ lastMessageAt: conversations.lastMessageAt })
      .from(conversations).where(eq(conversations.id, conversationId));
    expect(afterRetry.lastMessageAt?.toISOString()).toBe(afterFirst.lastMessageAt?.toISOString());

    const [message] = await db.select().from(messages).where(eq(messages.id, claim.questionId));
    expect(message.conversationId).toBe(conversationId);
    expect(message.parts).toEqual([{ type: 'text', text: input.messageText }]);
    expect(JSON.stringify(message)).not.toContain('assignments');
    expect(JSON.stringify(message)).not.toContain('embedding');
    expect(JSON.stringify(message)).not.toContain('reasoning');

    const [question] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, claim.questionId));
    expect(question.detection.pushedAt).toBeString();
    expect(question.detection.push?.deliveryStatus).toBe('delivered');
    expect(question.detection.push?.conversationId).toBe(conversationId);
  }, 30_000);

  test('suppresses a question resolved before delivery without a message or pushedAt', async () => {
    const claim = await createClaim();
    const conversationId = await stableDm();
    await db.update(questions).set({ status: 'dismissed' }).where(eq(questions.id, claim.questionId));

    const result = await conversationDatabaseAdapter.deliverClaimedPoolQuestionPush({
      questionId: claim.questionId,
      recipientId: claim.recipientId,
      intentId: claim.intentId,
      cycleKey: claim.cycleKey,
      conversationId,
      messageText: 'must not send',
    });
    expect(result).toEqual({ status: 'suppressed' });
    expect(await db.select().from(messages).where(eq(messages.id, claim.questionId))).toHaveLength(0);
    const [row] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, claim.questionId));
    expect(row.detection.pushedAt).toBeUndefined();
    expect(row.detection.push?.deliveryStatus).toBe('suppressed');
  }, 30_000);

  test('suppresses when the intent becomes paused or is visited after question creation', async () => {
    for (const invalidation of ['paused', 'visited'] as const) {
      const claim = await createClaim();
      const conversationId = await stableDm();
      if (invalidation === 'paused') {
        await db.update(intents).set({ status: 'PAUSED' }).where(eq(intents.id, intentId));
      } else {
        await db.update(intents).set({ lastVisitedAt: new Date(Date.now() + 60_000) }).where(eq(intents.id, intentId));
      }
      expect(await conversationDatabaseAdapter.deliverClaimedPoolQuestionPush({
        questionId: claim.questionId,
        recipientId: claim.recipientId,
        intentId: claim.intentId,
        cycleKey: claim.cycleKey,
        conversationId,
        messageText: 'must not send',
      })).toEqual({ status: 'suppressed' });
      expect(await db.select().from(messages).where(eq(messages.id, claim.questionId))).toHaveLength(0);
      const [row] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, claim.questionId));
      expect(row.detection.push?.deliveryStatus).toBe('suppressed');
      await db.delete(questions).where(eq(questions.id, claim.questionId));
      await db.update(intents).set({ status: 'ACTIVE', lastVisitedAt: null }).where(eq(intents.id, intentId));
    }
  }, 30_000);

  test('fails loudly when the deterministic message id belongs to another session/source', async () => {
    const claim = await createClaim();
    const conversationId = await stableDm();
    const conflictSessionId = await chatSessionService.createSession(userId, 'Conflict');
    sessionIds.add(conflictSessionId);
    await db.insert(messages).values({
      id: claim.questionId,
      conversationId: conflictSessionId,
      senderId: 'system-agent',
      role: 'agent',
      parts: [{ type: 'text', text: 'conflict' }],
      metadata: { source: 'other', recipientId: userId },
    });

    await expect(conversationDatabaseAdapter.deliverClaimedPoolQuestionPush({
      questionId: claim.questionId,
      recipientId: claim.recipientId,
      intentId: claim.intentId,
      cycleKey: claim.cycleKey,
      conversationId,
      messageText: 'expected',
    })).rejects.toThrow('conflicts with existing data');
    const [row] = await db.select({ detection: questions.detection }).from(questions).where(eq(questions.id, claim.questionId));
    expect(row.detection.pushedAt).toBeUndefined();
  }, 30_000);
});
