import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, it, expect, beforeEach } from 'bun:test';
import type { TelegramPrefs } from '../../schemas/database.schema';
import type { GatewayStreamEvent } from '../telegram.gateway';

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
  const chatIdIndex = new Map<string, { userId: string; sessionId?: string }>();
  const chatActions: string[] = [];

  return {
    sent,
    messages,
    sessions,
    telegramPrefs,
    chatIdIndex,
    chatActions,
    getTelegramPrefs: async (userId: string) => telegramPrefs.get(userId) ?? null,
    updateTelegramPrefs: async (userId: string, prefs: TelegramPrefs) => { telegramPrefs.set(userId, prefs); },
    findByTelegramChatId: async (chatId: string) => chatIdIndex.get(chatId) ?? null,
    createChatSession: async (data: { id: string; userId: string; title?: string }) => { sessions.set(data.id, data); },
    createChatMessage: async (data: { id: string; sessionId: string; role: string; content: string }) => { messages.push(data); },
    processMessage: async (_userId: string, _text: string) => ({ responseText: 'Hello from Index!' }),
    sendTelegramMessage: async (chatId: string, text: string, keyboard?: unknown, parseMode?: string) => { sent.push({ chatId, text, keyboard, parseMode }); },
    sendChatAction: async (chatId: string) => { chatActions.push(chatId); },
    seedTelegramUser: (userId: string, prefs: TelegramPrefs) => {
      telegramPrefs.set(userId, prefs);
      chatIdIndex.set(prefs.chatId, { userId, sessionId: prefs.sessionId });
    },
  };
}

/** Helper: create a fake stream that yields the given events. */
function fakeStream(...events: GatewayStreamEvent[]): () => AsyncGenerator<GatewayStreamEvent> {
  return async function* () {
    for (const e of events) yield e;
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

// ── Tests: handleInbound (blocking fallback) ────────────────────────────────

describe('handleInbound (blocking)', () => {
  let deps: ReturnType<typeof makeDeps>;
  let redisFake: Map<string, string>;

  beforeEach(() => {
    deps = makeDeps();
    redisFake = new Map();
  });

  async function callInbound(chatId: string, text: string, overrides?: Partial<ReturnType<typeof defaultDeps>>) {
    const d = overrides ? { ...deps, ...overrides } : deps;
    const { handleInbound } = await import('../telegram.gateway');
    await handleInbound(chatId, text, d, {
      get: async (key: string) => redisFake.get(key) ?? null,
      del: async (key: string) => { redisFake.delete(key); },
    });
  }

  it('replies with connect prompt and button for unknown chatId', async () => {
    await callInbound('unknown-chat', 'hello');
    expect(deps.sent[0].text).toContain('connect your Telegram account');
    expect(deps.sent[0].keyboard).toBeDefined();
  });

  it('routes a known user message to the chat graph and writes to conversation', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-known',
      sessionId: 'sess-1',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser('user-known', prefs);

    await callInbound('chat-known', 'What are my intents?');

    // Final message is the response
    const responseMsgs = deps.sent.filter((m) => m.chatId === 'chat-known');
    expect(responseMsgs[responseMsgs.length - 1].text).toBe('Hello from Index!');
    // Writes user + assistant messages to conversation
    const userMsg = deps.messages.find((m) => m.role === 'user');
    const assistantMsg = deps.messages.find((m) => m.role === 'assistant');
    expect(userMsg?.content).toBe('What are my intents?');
    expect(assistantMsg?.content).toBe('Hello from Index!');
  });

  it('sends typing indicator while processing', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-typing',
      sessionId: 'sess-typing',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser('user-typing', prefs);

    await callInbound('chat-typing', 'hello');

    // At least one typing action should have been sent
    expect(deps.chatActions.length).toBeGreaterThanOrEqual(1);
    expect(deps.chatActions[0]).toBe('chat-typing');
  });

  it('creates a session when user has none', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-nosess',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser('user-nosess', prefs);

    await callInbound('chat-nosess', 'hi');

    // A session should have been created
    expect(deps.sessions.size).toBe(1);
    // Prefs should be updated with the session ID
    expect(deps.telegramPrefs.get('user-nosess')?.sessionId).toBeDefined();
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

  it('replies with expired-token message for unknown token', async () => {
    await callInbound('chat-x', '/start bad-token');
    expect(deps.sent[0].text).toContain('expired');
  });
});

// ── Tests: handleInbound (streaming) ────────────────────────────────────────

describe('handleInbound (streaming)', () => {
  let deps: ReturnType<typeof makeDeps>;
  let redisFake: Map<string, string>;

  beforeEach(() => {
    deps = makeDeps();
    redisFake = new Map();
  });

  function seedUser(userId: string, chatId: string, sessionId?: string) {
    const prefs: TelegramPrefs = {
      chatId,
      sessionId,
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true },
    };
    deps.seedTelegramUser(userId, prefs);
  }

  async function callInbound(chatId: string, text: string, streamFn: ReturnType<typeof fakeStream>) {
    const d = { ...deps, streamMessage: streamFn };
    const { handleInbound } = await import('../telegram.gateway');
    await handleInbound(chatId, text, d, {
      get: async (key: string) => redisFake.get(key) ?? null,
      del: async (key: string) => { redisFake.delete(key); },
    });
  }

  it('sends final response from response_complete event', async () => {
    seedUser('user-s1', 'chat-s1', 'sess-s1');

    const stream = fakeStream(
      { type: 'status' },
      { type: 'response_complete', response: 'Here are your signals.' },
    );

    await callInbound('chat-s1', 'Show my signals', stream);

    const responseMsgs = deps.sent.filter((m) => m.chatId === 'chat-s1');
    expect(responseMsgs[responseMsgs.length - 1].text).toBe('Here are your signals.');
  });

  it('sends typing indicator during streaming', async () => {
    seedUser('user-s2', 'chat-s2', 'sess-s2');

    const stream = fakeStream(
      { type: 'response_complete', response: 'Done.' },
    );

    await callInbound('chat-s2', 'hi', stream);

    expect(deps.chatActions.length).toBeGreaterThanOrEqual(1);
    expect(deps.chatActions[0]).toBe('chat-s2');
  });

  it('sends tool-activity status messages', async () => {
    seedUser('user-s3', 'chat-s3', 'sess-s3');

    const stream = fakeStream(
      { type: 'tool_activity', toolName: 'search_intents', phase: 'start' },
      { type: 'tool_activity', toolName: 'search_intents', phase: 'end' },
      { type: 'response_complete', response: 'Found 3 signals.' },
    );

    await callInbound('chat-s3', 'What are my signals?', stream);

    // Should have sent a status message for the tool activity
    const statusMsg = deps.sent.find((m) => m.text.includes('signals'));
    expect(statusMsg).toBeDefined();

    // Final message should be the response
    expect(deps.sent[deps.sent.length - 1].text).toBe('Found 3 signals.');
  });

  it('deduplicates consecutive identical status messages', async () => {
    seedUser('user-s4', 'chat-s4', 'sess-s4');

    const stream = fakeStream(
      { type: 'tool_activity', toolName: 'search_intents', phase: 'start' },
      { type: 'tool_activity', toolName: 'search_intents', phase: 'start' }, // duplicate
      { type: 'response_complete', response: 'Done.' },
    );

    await callInbound('chat-s4', 'test', stream);

    // Only one status message (plus the final response)
    const statusMsgs = deps.sent.filter((m) => m.text.includes('signals'));
    expect(statusMsgs).toHaveLength(1);
  });

  it('falls back to error message when stream yields no response_complete', async () => {
    seedUser('user-s5', 'chat-s5', 'sess-s5');

    const stream = fakeStream(
      { type: 'status' },
      // No response_complete event
    );

    await callInbound('chat-s5', 'hello', stream);

    expect(deps.sent[deps.sent.length - 1].text).toContain('could not process');
  });

  it('writes user and assistant messages to conversation', async () => {
    seedUser('user-s6', 'chat-s6', 'sess-s6');

    const stream = fakeStream(
      { type: 'response_complete', response: 'Streamed response!' },
    );

    await callInbound('chat-s6', 'hi there', stream);

    const userMsg = deps.messages.find((m) => m.role === 'user');
    const assistantMsg = deps.messages.find((m) => m.role === 'assistant');
    expect(userMsg?.content).toBe('hi there');
    expect(assistantMsg?.content).toBe('Streamed response!');
  });

  it('sends agent-start status for negotiator', async () => {
    seedUser('user-s7', 'chat-s7', 'sess-s7');

    const stream = fakeStream(
      { type: 'agent_start', name: 'negotiation-agent' },
      { type: 'response_complete', response: 'Connection found.' },
    );

    await callInbound('chat-s7', 'find connections', stream);

    const statusMsg = deps.sent.find((m) => m.text.includes('connection'));
    expect(statusMsg).toBeDefined();
  });

  it('sends LLM response with special chars as-is (no HTML parse mode)', async () => {
    seedUser('user-html', 'chat-html', 'sess-html');

    const stream = fakeStream(
      { type: 'response_complete', response: 'Use <code>x & y</code> to compare' },
    );

    await callInbound('chat-html', 'test', stream);

    // sendMessage defaults to plain text — no escaping, chars sent verbatim
    const finalMsg = deps.sent[deps.sent.length - 1];
    expect(finalMsg.text).toBe('Use <code>x & y</code> to compare');

    // Conversation record matches
    const assistantMsg = deps.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.content).toBe('Use <code>x & y</code> to compare');
  });

  it('continues streaming when a status send fails', async () => {
    seedUser('user-sfail', 'chat-sfail', 'sess-sfail');

    const deliveredMsgs: SentMessage[] = [];
    const streamFn = fakeStream(
      { type: 'tool_activity', toolName: 'search_intents', phase: 'start' },
      { type: 'response_complete', response: 'Here are results.' },
    );

    const d = {
      ...deps,
      sendTelegramMessage: async (chatId: string, text: string, keyboard?: Array<Array<{ text: string; url: string }>>, parseMode?: string) => {
        if (text.includes('signals')) throw new Error('Telegram 429');
        deliveredMsgs.push({ chatId, text, keyboard, parseMode });
      },
      streamMessage: streamFn,
    };

    const { handleInbound } = await import('../telegram.gateway');
    await handleInbound('chat-sfail', 'test', d, {
      get: async () => null,
      del: async () => {},
    });

    // Final response delivered despite status send failure
    expect(deliveredMsgs.some((m) => m.text === 'Here are results.')).toBe(true);
  });

  it('delivers fallback when final send throws', async () => {
    seedUser('user-fallback', 'chat-fallback', 'sess-fallback');

    const deliveredMsgs: SentMessage[] = [];
    let finalSendAttempted = false;
    const streamFn = fakeStream(
      { type: 'response_complete', response: 'Normal response text' },
    );

    const d = {
      ...deps,
      sendTelegramMessage: async (chatId: string, text: string, keyboard?: Array<Array<{ text: string; url: string }>>, parseMode?: string) => {
        // Simulate Telegram network error on the first final-send attempt
        if (text === 'Normal response text' && !finalSendAttempted) {
          finalSendAttempted = true;
          throw new Error('Telegram network error');
        }
        deliveredMsgs.push({ chatId, text, keyboard, parseMode });
      },
      streamMessage: streamFn,
    };

    const { handleInbound } = await import('../telegram.gateway');
    await handleInbound('chat-fallback', 'test', d, {
      get: async () => null,
      del: async () => {},
    });

    // Fallback message was delivered
    expect(deliveredMsgs.some((m) => m.text.includes('couldn\'t deliver'))).toBe(true);
  });

  it('renders opportunity blocks as formatted HTML cards', async () => {
    seedUser('user-opp', 'chat-opp', 'sess-opp');

    const responseWithBlocks = [
      'I found some connections for you.',
      '',
      '```opportunity',
      JSON.stringify({
        opportunityId: 'opp-1',
        name: 'Alice',
        headline: 'Potential collaborator',
        mainText: 'Alice works in AI research.',
        mutualIntentsLabel: 'Aligned goals',
        narratorChip: { name: 'Index', text: 'Strong overlap in interests' },
        primaryActionLabel: 'Start Chat',
      }),
      '```',
      '',
      'Want to see more?',
    ].join('\n');

    const stream = fakeStream(
      { type: 'response_complete', response: responseWithBlocks },
    );

    await callInbound('chat-opp', 'find me connections', stream);

    // Filter to messages sent to this chat (excludes typing actions)
    const oppMsgs = deps.sent.filter((m) => m.chatId === 'chat-opp');

    // First: framing text (plain, no parseMode)
    expect(oppMsgs[0].text).toContain('I found some connections');
    expect(oppMsgs[0].parseMode).toBeUndefined();

    // Second: HTML card with inline keyboard
    expect(oppMsgs[1].text).toContain('<b>Alice</b>');
    expect(oppMsgs[1].text).toContain('AI research');
    expect(oppMsgs[1].text).toContain('💡');
    expect(oppMsgs[1].parseMode).toBe('HTML');
    expect(oppMsgs[1].keyboard).toBeDefined();

    // Third: trailing text (plain)
    expect(oppMsgs[2].text).toContain('Want to see more');
    expect(oppMsgs[2].parseMode).toBeUndefined();

    // Conversation record stores the original response with JSON blocks intact
    const assistantMsg = deps.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.content).toContain('```opportunity');
  });

  it('falls back to plain text when HTML card send fails', async () => {
    seedUser('user-oppfail', 'chat-oppfail', 'sess-oppfail');

    const responseWithBlock = [
      'Found a connection.',
      '',
      '```opportunity',
      JSON.stringify({
        opportunityId: 'opp-fail',
        name: 'Bob',
        headline: 'Developer',
        mainText: 'Bob builds apps.',
      }),
      '```',
    ].join('\n');

    const deliveredMsgs: SentMessage[] = [];
    const streamFn = fakeStream(
      { type: 'response_complete', response: responseWithBlock },
    );

    const d = {
      ...deps,
      sendTelegramMessage: async (chatId: string, text: string, keyboard?: unknown, parseMode?: string) => {
        if (parseMode === 'HTML') throw new Error('Telegram HTML parse error');
        deliveredMsgs.push({ chatId, text, keyboard, parseMode });
      },
      streamMessage: streamFn,
    };

    const { handleInbound } = await import('../telegram.gateway');
    await handleInbound('chat-oppfail', 'test', d, {
      get: async () => null,
      del: async () => {},
    });

    // Plain-text fallback should have been sent (no HTML tags)
    const cardMsg = deliveredMsgs.find((m) => m.text.includes('Bob'));
    expect(cardMsg).toBeDefined();
    expect(cardMsg!.text).toContain('Developer');
    expect(cardMsg!.text).not.toContain('<b>');
    expect(cardMsg!.text).not.toContain('<i>');
  });
});
