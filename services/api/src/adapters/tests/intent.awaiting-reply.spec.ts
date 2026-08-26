/**
 * Decision questions and the your-move badge, against the real database.
 *
 * Two derived reads, one fact. An agent question carries its questions in the
 * message's own metadata (no new table, no new column), and a signal is
 * "your move" exactly while the newest message in its ('negotiator-intent',
 * intentId) DM is such a question. Nothing records that it was answered:
 * the owner's reply — typed or tapped — is a newer message, and that is what
 * clears the badge.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll as bunAfterAll, beforeAll as bunBeforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm/sql';

import { conversationDatabaseAdapter, intentDatabaseAdapter, UserDatabaseAdapter } from '../database.adapter';
import { chatSessionService } from '../../services/chat.service';
import db from '../../lib/drizzle/drizzle';
import { withMinimumDatabaseHookBudget } from '../../lib/testing/database-test-budget';
import { intents } from '../../schemas/database.schema';

const EMAIL = 'test-intent-awaiting-reply@example.com';
const OTHER_EMAIL = 'test-intent-awaiting-reply-other@example.com';
const beforeAll = withMinimumDatabaseHookBudget(bunBeforeAll, 30_000);
const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 30_000);

describe('agent decision questions and the per-signal your-move flag', () => {
  const users = new UserDatabaseAdapter();
  let userId: string;
  let otherUserId: string;
  const sessionIds = new Set<string>();

  async function createIntent(ownerId: string): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(intents).values({
      id,
      userId: ownerId,
      payload: 'Find a hiring partner',
      summary: 'Find a hiring partner',
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

  async function awaitingReplyFor(ownerId: string, forIntentId: string): Promise<boolean> {
    const { rows } = await intentDatabaseAdapter.listIntents(ownerId, { page: 1, limit: 100, archived: false });
    const row = rows.find((candidate) => candidate.id === forIntentId);
    expect(row).toBeDefined();
    return row!.awaitingReply;
  }

  async function resetUser(email: string): Promise<string> {
    const existing = await users.findByEmail(email);
    if (existing) {
      await db.delete(intents).where(eq(intents.userId, existing.id));
      await users.deleteById(existing.id);
    }
    return (await users.create({ email, name: 'Awaiting Reply User' })).id;
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

  test('an agent question keeps its structure, and the signal reads as your move until the owner answers', async () => {
    const intentId = await createIntent(userId);
    const sessionId = await pinnedSession(userId, intentId);
    expect(await awaitingReplyFor(userId, intentId)).toBe(false);

    const questions = [{
      title: 'Priority',
      prompt: 'What should I push hardest on when I talk to her?',
      options: [
        { label: 'Hiring speed', description: 'Prioritize time to hire.' },
        { label: 'Comp banding', description: 'Prioritize compensation.' },
        { label: 'Team shape', description: 'Prioritize organization design.' },
      ],
      multiSelect: false,
    }];
    await chatSessionService.addMessage({
      sessionId,
      role: 'assistant',
      content: 'What should I push hardest on when I talk to her?',
      questions,
    });

    // The question survives the round trip on the message itself.
    const history = await chatSessionService.getConversationSessionHistory(sessionId);
    const asked = history.messages[history.messages.length - 1]!;
    expect(asked.role).toBe('assistant');
    expect(asked.decisionQuestions).toEqual(questions);

    expect(await awaitingReplyFor(userId, intentId)).toBe(true);

    // A submitted answer is an ordinary user message — and that is what answers.
    await chatSessionService.addMessage({ sessionId, role: 'user', content: 'Hiring speed' });
    expect(await awaitingReplyFor(userId, intentId)).toBe(false);
  });

  test('an agent message that merely reports never claims the owner move', async () => {
    const intentId = await createIntent(userId);
    const sessionId = await pinnedSession(userId, intentId);

    await chatSessionService.addMessage({
      sessionId,
      role: 'assistant',
      content: 'I passed your timing along; nothing needs you right now.',
    });

    const history = await chatSessionService.getConversationSessionHistory(sessionId);
    expect(history.messages[history.messages.length - 1]!.decisionQuestions).toBeNull();
    expect(await awaitingReplyFor(userId, intentId)).toBe(false);
  });

  test('another owner\'s waiting question never lands on this owner\'s signals', async () => {
    const foreignIntentId = await createIntent(otherUserId);
    const foreignSessionId = await pinnedSession(otherUserId, foreignIntentId);
    await chatSessionService.addMessage({
      sessionId: foreignSessionId,
      role: 'assistant',
      content: 'Which of these matters more to you?',
      questions: [{
        title: 'Priority',
        prompt: 'Which of these matters more to you?',
        options: [
          { label: 'Speed', description: 'Move quickly.' },
          { label: 'Reach', description: 'Maximize distribution.' },
        ],
        multiSelect: false,
      }],
    });

    expect(await awaitingReplyFor(otherUserId, foreignIntentId)).toBe(true);
    const { rows } = await intentDatabaseAdapter.listIntents(userId, { page: 1, limit: 100, archived: false });
    expect(rows.some((row) => row.id === foreignIntentId)).toBe(false);
    expect(rows.every((row) => row.awaitingReply === false)).toBe(true);
  });
});
