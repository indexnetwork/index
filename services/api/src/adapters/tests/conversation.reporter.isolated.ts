/** Reporter briefing TTL, atomic claim, and history-preservation coverage. */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, describe, expect, test } from 'bun:test';

import { ConversationDatabaseAdapter } from '../database.adapter';
import { db, eq, schema } from '../database.shared';

const adapter = new ConversationDatabaseAdapter();
const createdSessionIds = new Set<string>();

async function resolveReporter(
  userId: string,
  freshAfter: Date,
  forceNew = false,
) {
  const result = await adapter.resolveReporterChatSession({
    id: crypto.randomUUID(),
    userId,
    freshAfter,
    forceNew,
  });
  createdSessionIds.add(result.session.id);
  return result;
}

afterAll(async () => {
  for (const id of createdSessionIds) {
    await adapter.deleteChatSession(id).catch(() => {});
  }
});

describe('ConversationDatabaseAdapter reporter briefing claims', () => {
  test('reuses within TTL, expires by createdAt, and preserves stale history', async () => {
    const userId = `reporter-ttl-${crypto.randomUUID()}`;
    const first = await resolveReporter(userId, new Date(Date.now() - 60_000));
    expect(first.created).toBe(true);
    expect(first.session.persona).toBe('reporter');

    const reused = await resolveReporter(userId, new Date(Date.now() - 60_000));
    expect(reused.created).toBe(false);
    expect(reused.session.id).toBe(first.session.id);

    // Follow-up activity may move updatedAt, but cannot extend the opening
    // briefing lifetime because freshness is anchored to createdAt.
    await db.update(schema.conversations)
      .set({
        createdAt: new Date(Date.now() - (48 * 60 * 60 * 1000)),
        updatedAt: new Date(Date.now() + 60_000),
      })
      .where(eq(schema.conversations.id, first.session.id));

    const successor = await resolveReporter(
      userId,
      new Date(Date.now() - (24 * 60 * 60 * 1000)),
    );
    expect(successor.created).toBe(true);
    expect(successor.session.id).not.toBe(first.session.id);

    const history = await adapter.getUserChatSessions(userId, 20, 'reporter');
    expect(history.map((session) => session.id)).toEqual(
      expect.arrayContaining([first.session.id, successor.session.id]),
    );
  }, 15_000);

  test('serializes concurrent tabs so only one caller claims creation', async () => {
    const userId = `reporter-race-${crypto.randomUUID()}`;
    const freshAfter = new Date(Date.now() - 60_000);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => resolveReporter(userId, freshAfter)),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.session.id)).size).toBe(1);
  }, 15_000);
});
