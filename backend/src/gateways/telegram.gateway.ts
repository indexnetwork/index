import { log } from '../lib/log';
import { onTelegramNotification, type TelegramNotificationPayload } from '../lib/notification-events';
import type { TelegramPrefs } from '../schemas/database.schema';

const logger = log.lib.from('telegram.gateway');

export const CONNECT_TOKEN_PREFIX = 'telegram:connect:';
export const CONNECT_TOKEN_TTL_SEC = 15 * 60;

// ── Dependency interface (injected in tests, resolved from singletons in prod) ─

export interface GatewayDeps {
  getTelegramPrefs(userId: string): Promise<TelegramPrefs | null>;
  updateTelegramPrefs(userId: string, prefs: TelegramPrefs): Promise<void>;
  findByTelegramChatId(chatId: string): Promise<{ userId: string; sessionId?: string } | null>;
  createChatSession(data: { id: string; userId: string; title?: string }): Promise<void>;
  createChatMessage(data: { id: string; sessionId: string; role: 'user' | 'assistant' | 'system'; content: string }): Promise<void>;
  processMessage(userId: string, text: string): Promise<{ responseText: string; error?: string }>;
  sendTelegramMessage(chatId: string, text: string, keyboard?: Array<Array<{ text: string; url: string }>>): Promise<void>;
}

/**
 * Lazily resolved production deps — imports are deferred to avoid pulling
 * heavy transitive modules (e.g. @indexnetwork/protocol) during test discovery.
 */
function productionDeps(): GatewayDeps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { userDatabaseAdapter, conversationDatabaseAdapter } = require('../adapters/database.adapter') as typeof import('../adapters/database.adapter');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chatSessionService } = require('../services/chat.service') as typeof import('../services/chat.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sendMessage } = require('../lib/telegram/bot-api') as typeof import('../lib/telegram/bot-api');
  return {
    getTelegramPrefs: (userId) => userDatabaseAdapter.getTelegramPrefs(userId),
    updateTelegramPrefs: (userId, prefs) => userDatabaseAdapter.updateTelegramPrefs(userId, prefs),
    findByTelegramChatId: (chatId) => userDatabaseAdapter.findByTelegramChatId(chatId),
    createChatSession: (data) => conversationDatabaseAdapter.createChatSession(data),
    createChatMessage: (data) => conversationDatabaseAdapter.createChatMessage(data),
    processMessage: (userId, text) => chatSessionService.processMessage(userId, text),
    sendTelegramMessage: sendMessage,
  };
}

/**
 * Handle a notification event: deliver via Telegram and write to conversation.
 * @param payload - Notification payload from the NotificationQueue
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
    await deps.createChatSession({ id: sessionId, userId: payload.userId, title: 'Telegram' });
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
  return process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network';
}

const EXPIRED_TOKEN_MSG = () => `This link has expired. Please reconnect at ${appUrl()}.`;
const CONNECTED_MSG =
  'Your Telegram account is now connected to Index. You\'ll receive notifications here and can chat with me anytime.';

/**
 * Handle an update received from Telegram (text message or /start command).
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
): Promise<void> {
  if (text.startsWith('/start ')) {
    const token = text.slice(7).trim();
    await handleConnectToken(chatId, token, deps, redis);
    return;
  }

  const found = await deps.findByTelegramChatId(chatId);
  if (!found) {
    const url = appUrl();
    await deps.sendTelegramMessage(
      chatId,
      'To use this bot, connect your Telegram account from the Index website.',
      [[{ text: 'Connect account', url: `${url}/settings` }]],
    );
    return;
  }

  const { userId, sessionId } = found;

  // Write user message to conversation (best-effort)
  if (sessionId) {
    await deps.createChatMessage({
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: text,
    }).catch((err) => logger.warn('Failed to write user message to conversation', { error: err }));
  }

  // Route to chat graph (with timeout — the LLM chain can hang indefinitely)
  const PROCESS_TIMEOUT_MS = 120_000;
  let responseText: string;
  try {
    const result = await Promise.race([
      deps.processMessage(userId, text),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('processMessage timed out')), PROCESS_TIMEOUT_MS),
      ),
    ]);
    responseText = result.responseText || 'Sorry, I could not process your message.';
  } catch (err) {
    logger.error('processMessage failed for Telegram user', { userId, chatId, error: err });
    responseText = 'Sorry, something went wrong. Please try again.';
  }

  // Write assistant response (best-effort)
  if (sessionId) {
    await deps.createChatMessage({
      id: crypto.randomUUID(),
      sessionId,
      role: 'assistant',
      content: responseText,
    }).catch((err) => logger.warn('Failed to write assistant message to conversation', { error: err }));
  }

  await deps.sendTelegramMessage(chatId, responseText);
}

async function handleConnectToken(
  chatId: string,
  token: string,
  deps: GatewayDeps,
  redis: RedisReader,
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
  await deps.sendTelegramMessage(chatId, CONNECTED_MSG);
}
