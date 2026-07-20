/**
 * P4.0 personafication — conversations.persona column + session-listing filter.
 *
 * Verifies the additive migration semantics end-to-end against the test DB:
 * - sessions created without a persona read back as 'orchestrator' (DB default,
 *   which is also what every pre-migration row reads via the column default)
 * - CreateSessionInput.persona is persisted
 * - orchestrator and Signal sessions use distinct intent registry keys
 * - compatibility history defaults to orchestrator-only
 * - web history can explicitly request orchestrator + Signal
 * - generic summary history remains orchestrator-only
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, afterAll } from 'bun:test';
import { ConversationDatabaseAdapter } from '../database.adapter';

const adapter = new ConversationDatabaseAdapter();

const USER_ID = `persona-test-user-${Date.now()}`;
const ORCH_SESSION_ID = crypto.randomUUID();
const SIGNAL_SESSION_ID = crypto.randomUUID();
const ORCH_INTENT_SESSION_ID = crypto.randomUUID();
const SIGNAL_INTENT_SESSION_ID = crypto.randomUUID();
const SHARED_INTENT_ID = crypto.randomUUID();

afterAll(async () => {
  for (const id of [ORCH_SESSION_ID, SIGNAL_SESSION_ID, ORCH_INTENT_SESSION_ID, SIGNAL_INTENT_SESSION_ID]) {
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
      id: SIGNAL_SESSION_ID,
      userId: USER_ID,
      persona: 'signal',
    });

    const session = await adapter.getChatSession(SIGNAL_SESSION_ID);
    expect(session).not.toBeNull();
    expect(session!.persona).toBe('signal');
  }, 15000);
});

describe('persona-specific intent scope registry', () => {
  it('keeps Signal and orchestrator sessions distinct for the same intent', async () => {
    await adapter.createChatSession({
      id: ORCH_INTENT_SESSION_ID,
      userId: USER_ID,
      persona: 'orchestrator',
      scopeType: 'intent',
      scopeId: SHARED_INTENT_ID,
    });
    await adapter.createChatSession({
      id: SIGNAL_INTENT_SESSION_ID,
      userId: USER_ID,
      persona: 'signal',
      scopeType: 'intent',
      scopeId: SHARED_INTENT_ID,
    });

    const orchestrator = await adapter.getChatSessionByScope(
      USER_ID,
      'intent',
      SHARED_INTENT_ID,
      'orchestrator',
    );
    const signal = await adapter.getChatSessionByScope(
      USER_ID,
      'intent',
      SHARED_INTENT_ID,
      'signal',
    );

    expect(orchestrator?.id).toBe(ORCH_INTENT_SESSION_ID);
    expect(orchestrator?.persona).toBe('orchestrator');
    expect(signal?.id).toBe(SIGNAL_INTENT_SESSION_ID);
    expect(signal?.persona).toBe('signal');
  }, 15000);
});

describe('getUserChatSessions persona filter', () => {
  it('defaults to orchestrator-only compatibility history', async () => {
    const sessions = await adapter.getUserChatSessions(USER_ID, 10);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(ORCH_SESSION_ID);
    expect(ids).not.toContain(SIGNAL_SESSION_ID);
    expect(sessions.every((s) => s.persona === 'orchestrator')).toBe(true);
  }, 15000);

  it('returns orchestrator and Signal for the explicit web history filter', async () => {
    const sessions = await adapter.getUserChatSessions(
      USER_ID,
      10,
      ['orchestrator', 'signal'],
    );
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(ORCH_SESSION_ID);
    expect(ids).toContain(SIGNAL_SESSION_ID);
    expect(sessions.every((s) => s.persona !== 'negotiator')).toBe(true);
  }, 15000);

  it('returns only matching sessions when a persona filter is given', async () => {
    const orchSessions = await adapter.getUserChatSessions(USER_ID, 10, 'orchestrator');
    expect(orchSessions.map((s) => s.id)).toContain(ORCH_SESSION_ID);
    expect(orchSessions.map((s) => s.id)).not.toContain(SIGNAL_SESSION_ID);
    expect(orchSessions.every((s) => s.persona === 'orchestrator')).toBe(true);

    const signalSessions = await adapter.getUserChatSessions(USER_ID, 10, 'signal');
    expect(signalSessions.map((s) => s.id)).toContain(SIGNAL_SESSION_ID);
    expect(signalSessions.every((s) => s.persona === 'signal')).toBe(true);
  }, 15000);

  it('returns no sessions for an unknown persona', async () => {
    const sessions = await adapter.getUserChatSessions(USER_ID, 10, 'does-not-exist');
    expect(sessions).toEqual([]);
  }, 15000);

  it('keeps Signal out of generic MCP/session detail reads', async () => {
    const orchestrator = await adapter.getChatSessionDetail(USER_ID, ORCH_SESSION_ID);
    const signal = await adapter.getChatSessionDetail(USER_ID, SIGNAL_SESSION_ID);

    expect(orchestrator?.sessionId).toBe(ORCH_SESSION_ID);
    expect(signal).toBeNull();
  }, 15000);

  it('keeps Signal out of generic MCP/session summaries', async () => {
    const summaries = await adapter.listChatSessionSummaries(
      USER_ID,
      25,
      'orchestrator',
    );
    const ids = summaries.map((summary) => summary.sessionId);
    expect(ids).toContain(ORCH_SESSION_ID);
    expect(ids).not.toContain(SIGNAL_SESSION_ID);
    expect(ids).not.toContain(SIGNAL_INTENT_SESSION_ID);
  }, 15000);
});
