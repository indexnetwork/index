import { log } from '../lib/log';
import { onTelegramNotification, type TelegramNotificationPayload } from '../lib/notification-events';
import type { TelegramPrefs } from '../schemas/database.schema';
import { mergeTelegramHandleIntoSocials } from '../lib/telegram/socials';

const logger = log.lib.from('telegram.gateway');

export const CONNECT_TOKEN_PREFIX = 'telegram:connect:';
export const CONNECT_TOKEN_TTL_SEC = 15 * 60;

function normalizeTelegramHandle(raw: string | null | undefined): string | null {
  const trimmed = raw
    ?.trim()
    .replace(/^@/, '')
    .replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//, '')
    .split(/[/?#]/)[0];

  if (!trimmed) return null;
  if (!/^[A-Za-z0-9_]{5,32}$/.test(trimmed)) return null;
  return trimmed;
}

// ── Dependency interface (injected in tests, resolved from singletons in prod) ─

interface GatewayDeps {
  getTelegramPrefs(userId: string): Promise<TelegramPrefs | null>;
  updateTelegramPrefs(userId: string, prefs: TelegramPrefs): Promise<void>;
  findByTelegramChatId(chatId: string): Promise<{ userId: string; sessionId?: string } | null>;
  getUserSocials(userId: string): Promise<Array<{ label: string; value: string }>>;
  setUserSocials(userId: string, socials: { label: string; value: string }[]): Promise<void>;
  createChatSession(data: { id: string; userId: string; title?: string; persona: 'telegram' }): Promise<void>;
  createChatMessage(data: { id: string; sessionId: string; role: 'user' | 'assistant' | 'system'; content: string }): Promise<void>;
  sendTelegramMessage(chatId: string, text: string, keyboard?: Array<Array<{ text: string; url: string }>>, parseMode?: 'HTML' | 'MarkdownV2'): Promise<void>;
  sendChatAction(chatId: string): Promise<void>;
}

/**
 * Lazily resolved production deps — imports are deferred to avoid pulling
 * heavy transitive modules (e.g. @indexnetwork/protocol) during test discovery.
 */
function productionDeps(): GatewayDeps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { userDatabaseAdapter, conversationDatabaseAdapter } = require('../adapters/database.adapter') as typeof import('../adapters/database.adapter');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sendMessage, sendChatAction } = require('../lib/telegram/bot-api') as typeof import('../lib/telegram/bot-api');
  return {
    getTelegramPrefs: (userId) => userDatabaseAdapter.getTelegramPrefs(userId),
    updateTelegramPrefs: (userId, prefs) => userDatabaseAdapter.updateTelegramPrefs(userId, prefs),
    findByTelegramChatId: (chatId) => userDatabaseAdapter.findByTelegramChatId(chatId),
    getUserSocials: (userId) => userDatabaseAdapter.getSocials(userId),
    setUserSocials: (userId, socials) => userDatabaseAdapter.setSocials(userId, socials),
    createChatSession: (data) => conversationDatabaseAdapter.createChatSession(data),
    createChatMessage: (data) => conversationDatabaseAdapter.createChatMessage(data),
    sendTelegramMessage: sendMessage,
    sendChatAction: (chatId) => sendChatAction(chatId),
  };
}

/**
 * Handle a notification event: deliver via Telegram and write to conversation.
 * @param payload - Notification payload from the opportunity notification path
 * @param deps - Injectable deps (defaults to production singletons)
 */
export async function handleOutbound(
  payload: TelegramNotificationPayload,
  deps: GatewayDeps = productionDeps(),
): Promise<void> {
  const currentPrefs = await deps.getTelegramPrefs(payload.userId);
  if (!currentPrefs) {
    logger.warn('Telegram outbound skipped: no connection', { userId: payload.userId });
    return;
  }

  const { chatId } = currentPrefs;
  let { sessionId } = currentPrefs;

  // Create chat session lazily on first notification
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    await deps.createChatSession({ id: sessionId, userId: payload.userId, title: 'Telegram', persona: 'telegram' });
    await deps.updateTelegramPrefs(payload.userId, { ...currentPrefs, sessionId });
  }

  const keyboard = payload.inlineButtons
    ? [payload.inlineButtons.map((b) => ({ text: b.text, url: b.url }))]
    : undefined;

  await deps.sendTelegramMessage(chatId, payload.message, keyboard);

  await deps.createChatMessage({
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    content: payload.message,
  });
}

/**
 * Subscribe the gateway to Telegram notification events.
 * Call once at startup (from main.ts).
 */
export function init(): void {
  onTelegramNotification((payload) => {
    handleOutbound(payload).catch((err) => {
      logger.error('Telegram outbound delivery failed', { userId: payload.userId, error: err });
    });
  });
}

// ── Minimal Redis interface needed by handleInbound ────────────────────────

interface RedisReader {
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
}

function productionRedis(): RedisReader {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getRedisClient } = require('../adapters/cache.adapter') as typeof import('../adapters/cache.adapter');
  const redis = getRedisClient();
  return {
    get: (key) => redis.get(key),
    del: (key) => redis.del(key).then(() => undefined),
  };
}

function appUrl(): string {
  return process.env.WEB_APP_URL || 'https://index.network';
}

const EXPIRED_TOKEN_MSG = () => `This link has expired. Please reconnect at ${appUrl()}.`;
const CONNECTED_MSG =
  'Your Telegram account is now connected to Index. You\'ll receive notifications here and can chat with me anytime.';

// ── Inbound message handling ────────────────────────────────────────────────

async function upsertTelegramHandleFromUsername(
  userId: string,
  username: string | null | undefined,
  deps: GatewayDeps,
): Promise<void> {
  const handle = normalizeTelegramHandle(username);
  if (!handle) return;

  const existingSocials = await deps.getUserSocials(userId);
  const merged = mergeTelegramHandleIntoSocials(existingSocials, handle);
  if (!merged) return;

  await deps.setUserSocials(userId, merged);
}

/**
 * Handle an update received from Telegram: the `/start <token>` connect
 * handshake, or any other text.
 *
 * Inbound chat is not supported. It used to run the orchestrator persona
 * directly, bypassing the persona policy entirely; with that persona retired
 * there is no persona to route a Telegram turn through, so the bot answers
 * with a pointer to the app. Outbound notification delivery is unaffected.
 *
 * @param chatId - Sender's Telegram chat ID
 * @param text - Message text
 * @param deps - Injectable deps (defaults to production singletons)
 * @param redis - Injectable Redis reader (defaults to production client)
 */
export async function handleInbound(
  chatId: string,
  text: string,
  deps: GatewayDeps = productionDeps(),
  redis: RedisReader = productionRedis(),
  telegramUsername?: string | null,
): Promise<void> {
  if (text.startsWith('/start ')) {
    const token = text.slice(7).trim();
    await handleConnectToken(chatId, token, deps, redis, telegramUsername);
    return;
  }

  const url = appUrl();
  const found = await deps.findByTelegramChatId(chatId);
  if (!found) {
    await deps.sendTelegramMessage(
      chatId,
      'To use this bot, connect your Telegram account from the Index website.',
      [[{ text: 'Connect account', url: `${url}/settings` }]],
    );
    return;
  }

  await upsertTelegramHandleFromUsername(found.userId, telegramUsername, deps).catch((err) => {
    logger.warn('Failed to persist Telegram username', { userId: found.userId, chatId, error: err });
  });

  await deps.sendTelegramMessage(
    chatId,
    'I send you notifications here, but I can\'t chat on Telegram. Open Index to talk to your agent.',
    [[{ text: 'Open Index', url }]],
  );
}

async function handleConnectToken(
  chatId: string,
  token: string,
  deps: GatewayDeps,
  redis: RedisReader,
  telegramUsername?: string | null,
): Promise<void> {
  const userId = await redis.get(`${CONNECT_TOKEN_PREFIX}${token}`);
  if (!userId) {
    await deps.sendTelegramMessage(chatId, EXPIRED_TOKEN_MSG());
    return;
  }

  await redis.del(`${CONNECT_TOKEN_PREFIX}${token}`);

  const newPrefs: TelegramPrefs = {
    chatId,
    connectedAt: new Date().toISOString(),
    notifications: { opportunityAccepted: true },
  };
  await deps.updateTelegramPrefs(userId, newPrefs);
  await upsertTelegramHandleFromUsername(userId, telegramUsername, deps).catch((err) => {
    logger.warn('Failed to persist Telegram username during connect', { userId, chatId, error: err });
  });
  await deps.sendTelegramMessage(chatId, CONNECTED_MSG);
}
