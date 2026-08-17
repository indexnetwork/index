/**
 * conversations.persona column + session-listing filter.
 *
 * Verifies the post-orchestrator semantics end-to-end against the test DB:
 * - every chat session names its persona at creation (there is no default)
 * - the column default is the neutral 'none', which only rows where the column
 *   is meaningless (H2H DMs, A2A negotiation conversations) ever hit
 * - retired 'orchestrator' rows are retained: they read back and list
 * - each persona gets its own intent registry key, so two personas can hold
 *   distinct sessions for the same signal
 * - listing and detail reads are persona-scoped, never implicitly broad
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, afterAll } from 'bun:test';
import { ConversationDatabaseAdapter } from '../database.adapter';

const adapter = new ConversationDatabaseAdapter();

const USER_ID = `persona-test-user-${Date.now()}`;
const RETIRED_SESSION_ID = crypto.randomUUID();
const SIGNAL_SESSION_ID = crypto.randomUUID();
const ONBOARDING_INTENT_SESSION_ID = crypto.randomUUID();
const SIGNAL_INTENT_SESSION_ID = crypto.randomUUID();
const SHARED_INTENT_ID = crypto.randomUUID();

afterAll(async () => {
  for (const id of [RETIRED_SESSION_ID, SIGNAL_SESSION_ID, ONBOARDING_INTENT_SESSION_ID, SIGNAL_INTENT_SESSION_ID]) {
    try { await adapter.deleteChatSession(id); } catch { /* best effort */ }
  }
});

describe('conversations.persona column', () => {
  it('persists the persona named at creation', async () => {
    await adapter.createChatSession({
      id: SIGNAL_SESSION_ID,
      userId: USER_ID,
      persona: 'signal',
    });

    const session = await adapter.getChatSession(SIGNAL_SESSION_ID);
    expect(session).not.toBeNull();
    expect(session!.persona).toBe('signal');
  }, 15000);

  it('retains retired orchestrator rows as readable history', async () => {
    await adapter.createChatSession({
      id: RETIRED_SESSION_ID,
      userId: USER_ID,
      persona: 'orchestrator',
    });

    const session = await adapter.getChatSession(RETIRED_SESSION_ID);
    expect(session).not.toBeNull();
    expect(session!.persona).toBe('orchestrator');
  }, 15000);

  it('defaults to the neutral sentinel for conversations that are not chat sessions', async () => {
    // getOrCreateDM inserts without a persona: the column is meaningless for a
    // H2H DM, so it must fall to 'none' rather than to any chat persona.
    const peerId = `persona-test-peer-${Date.now()}`;
    const dm = await adapter.getOrCreateDM(USER_ID, peerId);
    const session = await adapter.getChatSession(dm.id);
    expect(session?.persona ?? 'none').toBe('none');
  }, 15000);
});

describe('persona-specific intent scope registry', () => {
  it('keeps two personas distinct for the same intent', async () => {
    await adapter.createChatSession({
      id: ONBOARDING_INTENT_SESSION_ID,
      userId: USER_ID,
      persona: 'onboarding',
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

    const onboarding = await adapter.getChatSessionByScope(
      USER_ID,
      'intent',
      SHARED_INTENT_ID,
      'onboarding',
    );
    const signal = await adapter.getChatSessionByScope(
      USER_ID,
      'intent',
      SHARED_INTENT_ID,
      'signal',
    );

    expect(onboarding?.id).toBe(ONBOARDING_INTENT_SESSION_ID);
    expect(onboarding?.persona).toBe('onboarding');
    expect(signal?.id).toBe(SIGNAL_INTENT_SESSION_ID);
    expect(signal?.persona).toBe('signal');
  }, 15000);
});

describe('getUserChatSessions persona filter', () => {
  it('lists retained orchestrator history when asked for it', async () => {
    const sessions = await adapter.getUserChatSessions(USER_ID, 10, 'orchestrator');
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(RETIRED_SESSION_ID);
    expect(ids).not.toContain(SIGNAL_SESSION_ID);
    expect(sessions.every((s) => s.persona === 'orchestrator')).toBe(true);
  }, 15000);

  it('returns retired orchestrator and Signal for the explicit web history filter', async () => {
    const sessions = await adapter.getUserChatSessions(
      USER_ID,
      10,
      ['orchestrator', 'signal'],
    );
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(RETIRED_SESSION_ID);
    expect(ids).toContain(SIGNAL_SESSION_ID);
    expect(sessions.every((s) => s.persona !== 'negotiator')).toBe(true);
  }, 15000);

  it('returns only matching sessions for a single-persona filter', async () => {
    const signalSessions = await adapter.getUserChatSessions(USER_ID, 10, 'signal');
    expect(signalSessions.map((s) => s.id)).toContain(SIGNAL_SESSION_ID);
    expect(signalSessions.map((s) => s.id)).not.toContain(RETIRED_SESSION_ID);
    expect(signalSessions.every((s) => s.persona === 'signal')).toBe(true);
  }, 15000);

  it('returns no sessions for an unknown persona', async () => {
    const sessions = await adapter.getUserChatSessions(USER_ID, 10, 'does-not-exist');
    expect(sessions).toEqual([]);
  }, 15000);

  it('scopes session detail reads to the requested persona', async () => {
    const signal = await adapter.getChatSessionDetail(USER_ID, SIGNAL_SESSION_ID, 50, 'signal');
    const mismatched = await adapter.getChatSessionDetail(USER_ID, RETIRED_SESSION_ID, 50, 'signal');

    expect(signal?.sessionId).toBe(SIGNAL_SESSION_ID);
    expect(mismatched).toBeNull();
  }, 15000);

  it('scopes session summaries to the requested persona', async () => {
    const summaries = await adapter.listChatSessionSummaries(USER_ID, 25, 'signal');
    const ids = summaries.map((summary) => summary.sessionId);
    expect(ids).toContain(SIGNAL_SESSION_ID);
    expect(ids).not.toContain(RETIRED_SESSION_ID);
  }, 15000);
});
