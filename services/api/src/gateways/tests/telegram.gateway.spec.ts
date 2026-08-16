import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { TelegramPrefs } from '../../schemas/database.schema';

// ── Fakes ────────────────────────────────────────────────────────────────────

interface SentMessage { chatId: string; text: string; keyboard?: unknown; parseMode?: string }

function makeDeps(overrides: Partial<ReturnType<typeof defaultDeps>> = {}) {
  return { ...defaultDeps(), ...overrides };
}

function defaultDeps() {
  const sessions = new Map<string, { id: string; userId: string }>();
  const messages: Array<{ sessionId: string; role: string; content: string }> = [];
  const sent: SentMessage[] = [];
  const telegramPrefs = new Map<string, TelegramPrefs>();
  const userSocials = new Map<string, Array<{ label: string; value: string }>>();
  const chatIdIndex = new Map<string, { userId: string; sessionId?: string }>();
  const chatActions: string[] = [];

  return {
    sent,
    messages,
    sessions,
    telegramPrefs,
    userSocials,
    chatIdIndex,
    chatActions,
    getTelegramPrefs: async (userId: string) => telegramPrefs.get(userId) ?? null,
    updateTelegramPrefs: async (userId: string, prefs: TelegramPrefs) => { telegramPrefs.set(userId, prefs); },
    findByTelegramChatId: async (chatId: string) => chatIdIndex.get(chatId) ?? null,
    getUserSocials: async (userId: string) => userSocials.get(userId) ?? [],
    setUserSocials: mock(async (userId: string, socials: { label: string; value: string }[]) => { userSocials.set(userId, socials); }),
    createChatSession: async (data: { id: string; userId: string; title?: string; persona: 'telegram' }) => { sessions.set(data.id, data); },
    createChatMessage: async (data: { id: string; sessionId: string; role: string; content: string }) => { messages.push(data); },
    sendTelegramMessage: async (chatId: string, text: string, keyboard?: unknown, parseMode?: string) => { sent.push({ chatId, text, keyboard, parseMode }); },
    sendChatAction: async (chatId: string) => { chatActions.push(chatId); },
    seedTelegramUser: (userId: string, prefs: TelegramPrefs) => {
      telegramPrefs.set(userId, prefs);
      chatIdIndex.set(prefs.chatId, { userId, sessionId: prefs.sessionId });
    },
  };
}

// ── Tests: handleOutbound ────────────────────────────────────────────────────

describe('handleOutbound', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => { deps = makeDeps(); });

  it('sends the message and writes it to the existing session', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-1',
      sessionId: 'session-1',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser('user-1', prefs);

    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound({ userId: 'user-1', message: 'You have a new match!' }, deps);

    expect(deps.sent).toHaveLength(1);
    expect(deps.sent[0]).toMatchObject({ chatId: 'chat-1', text: 'You have a new match!' });
    expect(deps.messages).toHaveLength(1);
    expect(deps.messages[0]).toMatchObject({ sessionId: 'session-1', role: 'assistant', content: 'You have a new match!' });
  });

  it('creates a session lazily when sessionId is missing', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-2',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser('user-2', prefs);

    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound({ userId: 'user-2', message: 'Hello!' }, deps);

    expect(deps.sessions.size).toBe(1);
    const [session] = [...deps.sessions.values()];
    expect(session.userId).toBe('user-2');
    expect(deps.messages[0].sessionId).toBe(session.id);
    // prefs updated with new sessionId
    expect(deps.telegramPrefs.get('user-2')?.sessionId).toBe(session.id);
  });

  it('logs and returns silently when user has no Telegram connection', async () => {
    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound({ userId: 'ghost-user', message: 'test' }, deps);
    expect(deps.sent).toHaveLength(0);
  });

  it('passes inline buttons to sendTelegramMessage', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-3',
      sessionId: 'session-3',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser('user-3', prefs);

    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound(
      { userId: 'user-3', message: 'New match!', inlineButtons: [{ text: 'View', url: 'https://index.network/o/1' }] },
      deps,
    );

    expect(deps.sent[0].keyboard).toEqual([[{ text: 'View', url: 'https://index.network/o/1' }]]);
  });
});

// ── Tests: handleInbound (connection & message routing) ─────────────────────

describe('handleInbound (routing)', () => {
  let deps: ReturnType<typeof makeDeps>;
  let redisFake: Map<string, string>;

  beforeEach(() => {
    deps = makeDeps();
    redisFake = new Map();
  });

  async function callInbound(chatId: string, text: string, overrides?: Partial<ReturnType<typeof defaultDeps>>, telegramUsername?: string | null) {
    const d = overrides ? { ...deps, ...overrides } : deps;
    const { handleInbound } = await import('../telegram.gateway');
    await handleInbound(chatId, text, d, {
      get: async (key: string) => redisFake.get(key) ?? null,
      del: async (key: string) => { redisFake.delete(key); },
    }, telegramUsername);
  }

  it('replies with connect prompt and button for unknown chatId', async () => {
    await callInbound('unknown-chat', 'hello');
    expect(deps.sent[0].text).toContain('connect your Telegram account');
    expect(deps.sent[0].keyboard).toBeDefined();
  });

  it('points a known user at the app instead of chatting', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-known',
      sessionId: 'sess-1',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser('user-known', prefs);

    await callInbound('chat-known', 'What are my intents?');

    const responseMsgs = deps.sent.filter((m) => m.chatId === 'chat-known');
    expect(responseMsgs).toHaveLength(1);
    expect(responseMsgs[0].text).toContain("can't chat on Telegram");
    expect(responseMsgs[0].keyboard).toBeDefined();
  });

  it('does not write inbound chat turns to a conversation', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-nowrite',
      sessionId: 'sess-nowrite',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser('user-nowrite', prefs);

    await callInbound('chat-nowrite', 'hello');

    expect(deps.messages).toHaveLength(0);
  });

  it('does not create a session for an inbound message', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-nosess',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser('user-nosess', prefs);

    await callInbound('chat-nosess', 'hi');

    expect(deps.sessions.size).toBe(0);
    expect(deps.telegramPrefs.get('user-nosess')?.sessionId).toBeUndefined();
  });

  it('completes /start <token> flow: stores chatId and confirms', async () => {
    redisFake.set('telegram:connect:valid-token', 'user-new');

    await callInbound('chat-new', '/start valid-token');

    const stored = deps.telegramPrefs.get('user-new');
    expect(stored?.chatId).toBe('chat-new');
    expect(stored?.notifications.opportunityAccepted).toBe(true);
    expect(deps.sent[0].text).toContain('connected');
    // Token consumed
    expect(redisFake.has('telegram:connect:valid-token')).toBe(false);
  });

  it('captures Telegram username during /start without removing other socials', async () => {
    redisFake.set('telegram:connect:valid-token', 'user-new');
    deps.userSocials.set('user-new', [{ label: 'github', value: 'alice-gh' }]);

    await callInbound('chat-new', '/start valid-token', undefined, '@alice_tg');

    expect(deps.userSocials.get('user-new')).toEqual([
      { label: 'github', value: 'alice-gh' },
      { label: 'telegram', value: 'alice_tg' },
    ]);
  });

  it('captures Telegram username on known inbound messages', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-known',
      sessionId: 'sess-1',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser('user-known', prefs);
    deps.userSocials.set('user-known', [{ label: 'telegram', value: 'old_handle' }]);

    await callInbound('chat-known', 'hello', undefined, 'new_handle');

    expect(deps.userSocials.get('user-known')).toContainEqual({ label: 'telegram', value: 'new_handle' });
    expect(deps.userSocials.get('user-known')?.filter((s) => s.label === 'telegram')).toHaveLength(1);
  });

  it('skips social writes when Telegram username is unchanged', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-unchanged',
      sessionId: 'sess-unchanged',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser('user-unchanged', prefs);
    deps.userSocials.set('user-unchanged', [
      { label: 'github', value: 'alice-gh' },
      { label: 'telegram', value: 'same_handle' },
    ]);

    await callInbound('chat-unchanged', 'hello', undefined, 'same_handle');

    expect(deps.setUserSocials).not.toHaveBeenCalled();
  });

  it('replies with expired-token message for unknown token', async () => {
    await callInbound('chat-x', '/start bad-token');
    expect(deps.sent[0].text).toContain('expired');
  });
});
