/**
 * P4.0 personafication — conversations.persona column + session-listing filter.
 *
 * Verifies the additive migration semantics end-to-end against the test DB:
 * - sessions created without a persona read back as 'orchestrator' (DB default,
 *   which is also what every pre-migration row reads via the column default)
 * - CreateSessionInput.persona is persisted
 * - getUserChatSessions: no filter → all sessions (today's behavior);
 *   persona filter → only matching sessions
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, afterAll } from 'bun:test';
import { ConversationDatabaseAdapter } from '../database.adapter';

const adapter = new ConversationDatabaseAdapter();

const USER_ID = `persona-test-user-${Date.now()}`;
const ORCH_SESSION_ID = crypto.randomUUID();
const STUB_SESSION_ID = crypto.randomUUID();

afterAll(async () => {
  for (const id of [ORCH_SESSION_ID, STUB_SESSION_ID]) {
    try { await adapter.deleteChatSession(id); } catch { /* best effort */ }
  }
});

describe('conversations.persona column', () => {
  it('defaults to orchestrator when persona is omitted at creation', async () => {
    await adapter.createChatSession({ id: ORCH_SESSION_ID, userId: USER_ID });

    const session = await adapter.getChatSession(ORCH_SESSION_ID);
    expect(session).not.toBeNull();
    expect(session!.persona).toBe('orchestrator');
  }, 15000);

  it('persists an explicit persona from CreateSessionInput', async () => {
    await adapter.createChatSession({
      id: STUB_SESSION_ID,
      userId: USER_ID,
      persona: 'stub-persona',
    });

    const session = await adapter.getChatSession(STUB_SESSION_ID);
    expect(session).not.toBeNull();
    expect(session!.persona).toBe('stub-persona');
  }, 15000);
});

describe('getUserChatSessions persona filter', () => {
  it('returns all sessions when no persona filter is given (default behavior)', async () => {
    const sessions = await adapter.getUserChatSessions(USER_ID, 10);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(ORCH_SESSION_ID);
    expect(ids).toContain(STUB_SESSION_ID);
  }, 15000);

  it('returns only matching sessions when a persona filter is given', async () => {
    const orchSessions = await adapter.getUserChatSessions(USER_ID, 10, 'orchestrator');
    expect(orchSessions.map((s) => s.id)).toContain(ORCH_SESSION_ID);
    expect(orchSessions.map((s) => s.id)).not.toContain(STUB_SESSION_ID);
    expect(orchSessions.every((s) => s.persona === 'orchestrator')).toBe(true);

    const stubSessions = await adapter.getUserChatSessions(USER_ID, 10, 'stub-persona');
    expect(stubSessions.map((s) => s.id)).toEqual([STUB_SESSION_ID]);
  }, 15000);

  it('returns no sessions for an unknown persona', async () => {
    const sessions = await adapter.getUserChatSessions(USER_ID, 10, 'does-not-exist');
    expect(sessions).toEqual([]);
  }, 15000);
});
