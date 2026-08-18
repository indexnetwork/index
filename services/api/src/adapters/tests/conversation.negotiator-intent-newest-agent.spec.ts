/**
 * The notification snapshot's anchor read against the real database
 * (conversational questions): `getNewestAgentMessagesForNegotiatorIntents`
 * returns the newest AGENT message in each of a user's ('negotiator-intent',
 * intentId) DMs — one row per signal, never another user's, and never the
 * client's own reply.
 *
 * "Newest agent message" rather than "newest message" on purpose: a client
 * reply does not un-ask the question it answers. Only consumption and the
 * regeneration that follows it close a question-message, and both land as new
 * agent messages.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll as bunAfterAll, beforeAll as bunBeforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm/sql';

import { conversationDatabaseAdapter, UserDatabaseAdapter } from '../database.adapter';
import { chatSessionService } from '../../services/chat.service';
import db from '../../lib/drizzle/drizzle';
import { withMinimumDatabaseHookBudget } from '../../lib/testing/database-test-budget';
import { intents } from '../../schemas/database.schema';

const EMAIL = 'test-negotiator-intent-newest-agent@example.com';
const OTHER_EMAIL = 'test-negotiator-intent-newest-agent-other@example.com';
const beforeAll = withMinimumDatabaseHookBudget(bunBeforeAll, 30_000);
const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 30_000);

describe('ConversationDatabaseAdapter newest agent message per negotiator DM', () => {
  const users = new UserDatabaseAdapter();
  let userId: string;
  let otherUserId: string;
  const sessionIds = new Set<string>();

  async function createIntent(ownerId: string): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(intents).values({
      id,
      userId: ownerId,
      payload: 'Find a collaborator',
      summary: 'Find a collaborator',
      status: 'ACTIVE',
    });
    return id;
  }

  async function pinnedSession(ownerId: string, forIntentId: string): Promise<string> {
    const resolved = await chatSessionService.resolveNegotiatorIntentSession(ownerId, forIntentId);
    if ('error' in resolved) throw new Error(resolved.error);
    sessionIds.add(resolved.session.id);
    return resolved.session.id;
  }

  async function resetUser(email: string): Promise<string> {
    const existing = await users.findByEmail(email);
    if (existing) {
      await db.delete(intents).where(eq(intents.userId, existing.id));
      await users.deleteById(existing.id);
    }
    return (await users.create({ email, name: 'Snapshot Anchor User' })).id;
  }

  beforeAll(async () => {
    userId = await resetUser(EMAIL);
    otherUserId = await resetUser(OTHER_EMAIL);
  });

  afterAll(async () => {
    for (const id of sessionIds) await conversationDatabaseAdapter.deleteChatSession(id).catch(() => {});
    for (const id of [userId, otherUserId]) {
      await db.delete(intents).where(eq(intents.userId, id)).catch(() => {});
      await users.deleteById(id).catch(() => {});
    }
  });

  test('returns one row per signal, holding that DM newest agent message', async () => {
    const firstIntentId = await createIntent(userId);
    const secondIntentId = await createIntent(userId);
    const firstSessionId = await pinnedSession(userId, firstIntentId);
    await pinnedSession(userId, secondIntentId);

    await chatSessionService.addMessage({ sessionId: firstSessionId, role: 'assistant', content: 'An older question.' });
    const newestAgentId = await chatSessionService.addMessage({
      sessionId: firstSessionId,
      role: 'assistant',
      content: 'The current question.',
    });

    const rows = await conversationDatabaseAdapter.getNewestAgentMessagesForNegotiatorIntents(userId);

    // The second signal DM has no agent message yet, so it contributes nothing.
    expect(rows).toEqual([{
      intentId: firstIntentId,
      sessionId: firstSessionId,
      messageId: newestAgentId,
      content: 'The current question.',
    }]);
  });

  test('a client reply does not displace the agent message it answers', async () => {
    const intentId = await createIntent(userId);
    const sessionId = await pinnedSession(userId, intentId);

    const questionId = await chatSessionService.addMessage({
      sessionId,
      role: 'assistant',
      content: 'Two questions about your search.',
    });
    await chatSessionService.addMessage({ sessionId, role: 'user', content: 'Ten to fifteen percent.' });

    const rows = await conversationDatabaseAdapter.getNewestAgentMessagesForNegotiatorIntents(userId);
    const row = rows.find((candidate) => candidate.intentId === intentId);

    expect(await conversationDatabaseAdapter.getNewestChatMessage(sessionId)).toMatchObject({ role: 'user' });
    expect(row).toEqual({ intentId, sessionId, messageId: questionId, content: 'Two questions about your search.' });
  });

  test('never reaches another user DMs, and reads nothing for an empty user id', async () => {
    const foreignIntentId = await createIntent(otherUserId);
    const foreignSessionId = await pinnedSession(otherUserId, foreignIntentId);
    await chatSessionService.addMessage({ sessionId: foreignSessionId, role: 'assistant', content: 'Their question.' });

    const rows = await conversationDatabaseAdapter.getNewestAgentMessagesForNegotiatorIntents(userId);
    expect(rows.map(({ intentId }) => intentId)).not.toContain(foreignIntentId);

    expect(await conversationDatabaseAdapter.getNewestAgentMessagesForNegotiatorIntents('')).toEqual([]);
  });
});
