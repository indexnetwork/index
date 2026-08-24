/**
 * conversations.persona column + session-listing filter.
 *
 * Verifies the post-collapse semantics end-to-end against the test DB:
 * - every chat session names its persona at creation (there is no default,
 *   and 'personal' is the only live value)
 * - the column default is the neutral 'none', which only rows where the column
 *   is meaningless (H2H DMs, A2A negotiation conversations) ever hit
 * - retired 'orchestrator' rows are retained: they read back and list
 * - an intent scope registers exactly one 'personal-intent' key per
 *   (user, intent) — no per-persona twins for the same signal
 * - listing and detail reads are persona-scoped, never implicitly broad, and
 *   the web-history read can exclude intent-pinned DMs
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, afterAll } from 'bun:test';
import { ConversationDatabaseAdapter } from '../database.adapter';

const adapter = new ConversationDatabaseAdapter();

const USER_ID = `persona-test-user-${Date.now()}`;
const RETIRED_SESSION_ID = crypto.randomUUID();
const PERSONAL_SESSION_ID = crypto.randomUUID();
const INTENT_SESSION_ID = crypto.randomUUID();
const SECOND_INTENT_SESSION_ID = crypto.randomUUID();
const SHARED_INTENT_ID = crypto.randomUUID();

afterAll(async () => {
  for (const id of [RETIRED_SESSION_ID, PERSONAL_SESSION_ID, INTENT_SESSION_ID, SECOND_INTENT_SESSION_ID]) {
    try { await adapter.deleteChatSession(id); } catch { /* best effort */ }
  }
});

describe('conversations.persona column', () => {
  it('persists the persona named at creation', async () => {
    await adapter.createChatSession({
      id: PERSONAL_SESSION_ID,
      userId: USER_ID,
      persona: 'personal',
    });

    const session = await adapter.getChatSession(PERSONAL_SESSION_ID);
    expect(session).not.toBeNull();
    expect(session!.persona).toBe('personal');
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

describe('personal-intent scope registry', () => {
  it('holds exactly one session per (user, intent)', async () => {
    await adapter.createChatSession({
      id: INTENT_SESSION_ID,
      userId: USER_ID,
      persona: 'personal',
      scopeType: 'intent',
      scopeId: SHARED_INTENT_ID,
    });

    const dm = await adapter.getNegotiatorIntentChatSession(USER_ID, SHARED_INTENT_ID);
    expect(dm?.id).toBe(INTENT_SESSION_ID);
    expect(dm?.persona).toBe('personal');
    expect(dm?.scopeType).toBe('intent');
    expect(dm?.scopeId).toBe(SHARED_INTENT_ID);

    // A second session for the same signal hits the unique registry key.
    await expect(adapter.createChatSession({
      id: SECOND_INTENT_SESSION_ID,
      userId: USER_ID,
      persona: 'personal',
      scopeType: 'intent',
      scopeId: SHARED_INTENT_ID,
    })).rejects.toThrow();
  }, 15000);
});

describe('getUserChatSessions persona filter', () => {
  it('lists retained orchestrator history when asked for it', async () => {
    const sessions = await adapter.getUserChatSessions(USER_ID, 10, 'orchestrator');
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(RETIRED_SESSION_ID);
    expect(ids).not.toContain(PERSONAL_SESSION_ID);
    expect(sessions.every((s) => s.persona === 'orchestrator')).toBe(true);
  }, 15000);

  it('returns retired orchestrator and PersonalAgent rows for the web history filter, excluding intent-pinned DMs', async () => {
    const sessions = await adapter.getUserChatSessions(
      USER_ID,
      10,
      ['orchestrator', 'personal'],
      { excludeIntentPinned: true },
    );
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(RETIRED_SESSION_ID);
    expect(ids).toContain(PERSONAL_SESSION_ID);
    expect(ids).not.toContain(INTENT_SESSION_ID);
  }, 15000);

  it('returns only matching sessions for a single-persona filter', async () => {
    const personalSessions = await adapter.getUserChatSessions(USER_ID, 10, 'personal');
    expect(personalSessions.map((s) => s.id)).toContain(PERSONAL_SESSION_ID);
    expect(personalSessions.map((s) => s.id)).not.toContain(RETIRED_SESSION_ID);
    expect(personalSessions.every((s) => s.persona === 'personal')).toBe(true);
  }, 15000);

  it('returns no sessions for an unknown persona', async () => {
    const sessions = await adapter.getUserChatSessions(USER_ID, 10, 'does-not-exist');
    expect(sessions).toEqual([]);
  }, 15000);

  it('scopes session detail reads to the requested persona', async () => {
    const personal = await adapter.getChatSessionDetail(USER_ID, PERSONAL_SESSION_ID, 50, 'personal');
    const mismatched = await adapter.getChatSessionDetail(USER_ID, RETIRED_SESSION_ID, 50, 'personal');

    expect(personal?.sessionId).toBe(PERSONAL_SESSION_ID);
    expect(mismatched).toBeNull();
  }, 15000);

  it('scopes session summaries to the requested persona', async () => {
    const summaries = await adapter.listChatSessionSummaries(USER_ID, 25, 'personal');
    const ids = summaries.map((summary) => summary.sessionId);
    expect(ids).toContain(PERSONAL_SESSION_ID);
    expect(ids).not.toContain(RETIRED_SESSION_ID);
  }, 15000);
});
