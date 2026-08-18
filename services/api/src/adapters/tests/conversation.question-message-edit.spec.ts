/**
 * The question-message content-update seam (conversational-questions edit
 * rule): `updateNewestAgentQuestionMessage` may only rewrite an agent-authored
 * message in the caller's ('negotiator-intent', intentId) session, and only
 * while that message is still the newest in its conversation — with every
 * guard enforced inside the UPDATE statement itself, against the real
 * database. A user reply racing the regeneration must flip the update into a
 * clean no-op so the caller falls back to appending a fresh message.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll as bunAfterAll, beforeAll as bunBeforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm/sql';

import { conversationDatabaseAdapter, UserDatabaseAdapter } from '../database.adapter';
import { chatSessionService } from '../../services/chat.service';
import db from '../../lib/drizzle/drizzle';
import { withMinimumDatabaseHookBudget } from '../../lib/testing/database-test-budget';
import { messages } from '../../schemas/conversation.schema';
import { intents } from '../../schemas/database.schema';

const EMAIL = 'test-question-message-edit@example.com';
const beforeAll = withMinimumDatabaseHookBudget(bunBeforeAll, 30_000);
const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 30_000);

describe('ConversationDatabaseAdapter question-message content update', () => {
  const users = new UserDatabaseAdapter();
  let userId: string;
  let intentId: string;
  let otherIntentId: string;
  const sessionIds = new Set<string>();

  async function createIntent(): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(intents).values({
      id,
      userId,
      payload: 'Find a collaborator',
      summary: 'Find a collaborator',
      status: 'ACTIVE',
    });
    return id;
  }

  async function pinnedSession(forIntentId: string): Promise<string> {
    const resolved = await chatSessionService.resolveNegotiatorIntentSession(userId, forIntentId);
    if ('error' in resolved) throw new Error(resolved.error);
    sessionIds.add(resolved.session.id);
    return resolved.session.id;
  }

  beforeAll(async () => {
    const existing = await users.findByEmail(EMAIL);
    if (existing) {
      await db.delete(intents).where(eq(intents.userId, existing.id));
      await users.deleteById(existing.id);
    }
    userId = (await users.create({ email: EMAIL, name: 'Edit Rule User' })).id;
    intentId = await createIntent();
    otherIntentId = await createIntent();
  });

  afterAll(async () => {
    for (const id of sessionIds) await conversationDatabaseAdapter.deleteChatSession(id).catch(() => {});
    await db.delete(intents).where(eq(intents.userId, userId)).catch(() => {});
    await users.deleteById(userId).catch(() => {});
  });

  test('rewrites the newest agent message in place and stamps regeneratedAt', async () => {
    const sessionId = await pinnedSession(intentId);
    expect(await conversationDatabaseAdapter.getNewestChatMessage(sessionId)).toBeNull();

    const messageId = await chatSessionService.addMessage({
      sessionId,
      role: 'assistant',
      content: 'The first rendering.',
    });

    const regeneratedAt = new Date();
    const updated = await conversationDatabaseAdapter.updateNewestAgentQuestionMessage({
      userId,
      intentId,
      messageId,
      content: 'The regenerated rendering.',
      regeneratedAt,
    });
    expect(updated).toBe(true);

    const newest = await conversationDatabaseAdapter.getNewestChatMessage(sessionId);
    expect(newest?.id).toBe(messageId);
    expect(newest?.role).toBe('assistant');
    expect(newest?.content).toBe('The regenerated rendering.');

    const [row] = await db.select({ metadata: messages.metadata }).from(messages).where(eq(messages.id, messageId));
    expect((row.metadata as { regeneratedAt?: string }).regeneratedAt).toBe(regeneratedAt.toISOString());
  });

  test('no-ops once a user reply is newer — the reply wins the race', async () => {
    const sessionId = await pinnedSession(intentId);
    const questionMessageId = await chatSessionService.addMessage({
      sessionId,
      role: 'assistant',
      content: 'Open question-message.',
    });
    await chatSessionService.addMessage({
      sessionId,
      role: 'user',
      content: 'A reply that must stay below unchanged text.',
    });

    const updated = await conversationDatabaseAdapter.updateNewestAgentQuestionMessage({
      userId,
      intentId,
      messageId: questionMessageId,
      content: 'A rewrite that would corrupt the thread.',
      regeneratedAt: new Date(),
    });
    expect(updated).toBe(false);

    const [row] = await db.select({ parts: messages.parts }).from(messages).where(eq(messages.id, questionMessageId));
    expect((row.parts as Array<{ text?: string }>)[0]?.text).toBe('Open question-message.');
  });

  test('refuses a user-authored message and a foreign intent scope', async () => {
    const sessionId = await pinnedSession(intentId);
    const userMessageId = await chatSessionService.addMessage({
      sessionId,
      role: 'user',
      content: 'User words are never rewritten.',
    });
    expect(await conversationDatabaseAdapter.updateNewestAgentQuestionMessage({
      userId,
      intentId,
      messageId: userMessageId,
      content: 'Rewritten.',
      regeneratedAt: new Date(),
    })).toBe(false);

    const agentMessageId = await chatSessionService.addMessage({
      sessionId,
      role: 'assistant',
      content: 'Newest agent message.',
    });
    // Same message, wrong scope: another intent's regeneration may not touch it.
    expect(await conversationDatabaseAdapter.updateNewestAgentQuestionMessage({
      userId,
      intentId: otherIntentId,
      messageId: agentMessageId,
      content: 'Rewritten from the wrong scope.',
      regeneratedAt: new Date(),
    })).toBe(false);

    const newest = await conversationDatabaseAdapter.getNewestChatMessage(sessionId);
    expect(newest?.content).toBe('Newest agent message.');
  });
});
