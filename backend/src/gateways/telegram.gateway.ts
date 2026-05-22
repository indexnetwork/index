import { log } from '../lib/log';
import { onTelegramNotification, type TelegramNotificationPayload } from '../lib/notification-events';
import type { TelegramPrefs } from '../schemas/database.schema';
import {
  parseResponseSegments,
  hasStructuredBlocks,
  formatOpportunityCardHtml,
  formatOpportunityCardPlainText,
} from '../lib/telegram/formatter';

const logger = log.lib.from('telegram.gateway');

export const CONNECT_TOKEN_PREFIX = 'telegram:connect:';
export const CONNECT_TOKEN_TTL_SEC = 15 * 60;

// ── Stream event subset (gateway only cares about a few event types) ────────

/** Minimal event shape the gateway consumes from the chat graph stream. */
export interface GatewayStreamEvent {
  type: string;
  toolName?: string;
  description?: string;
  phase?: string;
  response?: string;
  name?: string;
}

// ── Dependency interface (injected in tests, resolved from singletons in prod) ─

export interface GatewayDeps {
  getTelegramPrefs(userId: string): Promise<TelegramPrefs | null>;
  updateTelegramPrefs(userId: string, prefs: TelegramPrefs): Promise<void>;
  findByTelegramChatId(chatId: string): Promise<{ userId: string; sessionId?: string } | null>;
  createChatSession(data: { id: string; userId: string; title?: string }): Promise<void>;
  createChatMessage(data: { id: string; sessionId: string; role: 'user' | 'assistant' | 'system'; content: string }): Promise<void>;
  processMessage(userId: string, text: string): Promise<{ responseText: string; error?: string }>;
  sendTelegramMessage(chatId: string, text: string, keyboard?: Array<Array<{ text: string; url: string }>>, parseMode?: 'HTML' | 'MarkdownV2'): Promise<void>;
  sendChatAction(chatId: string): Promise<void>;
  streamMessage?(userId: string, text: string, sessionId: string): AsyncGenerator<GatewayStreamEvent>;
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
  const { sendMessage, sendChatAction } = require('../lib/telegram/bot-api') as typeof import('../lib/telegram/bot-api');
  return {
    getTelegramPrefs: (userId) => userDatabaseAdapter.getTelegramPrefs(userId),
    updateTelegramPrefs: (userId, prefs) => userDatabaseAdapter.updateTelegramPrefs(userId, prefs),
    findByTelegramChatId: (chatId) => userDatabaseAdapter.findByTelegramChatId(chatId),
    createChatSession: (data) => conversationDatabaseAdapter.createChatSession(data),
    createChatMessage: (data) => conversationDatabaseAdapter.createChatMessage(data),
    processMessage: (userId, text) => chatSessionService.processMessage(userId, text),
    sendTelegramMessage: sendMessage,
    sendChatAction: (chatId) => sendChatAction(chatId),
    streamMessage: async function* (userId, text, sessionId) {
      const factory = chatSessionService.getGraphFactory();
      yield* factory.streamChatEventsWithContext({ userId, message: text, sessionId });
    },
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

// ── Typing indicator helper ─────────────────────────────────────────────────

/** Telegram typing indicator expires after ~5 s; re-send every 4 s. */
const TYPING_INTERVAL_MS = 4_000;

/**
 * Start a recurring typing indicator for a Telegram chat.
 * Returns a cleanup function that stops the interval.
 */
function startTypingIndicator(chatId: string, deps: GatewayDeps): () => void {
  deps.sendChatAction(chatId).catch(() => {});
  const timer = setInterval(() => {
    deps.sendChatAction(chatId).catch(() => {});
  }, TYPING_INTERVAL_MS);
  return () => clearInterval(timer);
}

// ── Tool-activity → user-friendly status mapping ────────────────────────────

/**
 * Map internal tool names to short, user-friendly status messages.
 * Returns undefined for tools that shouldn't produce a visible status.
 */
function toolStatusText(toolName: string): string | undefined {
  // Normalize: tools may arrive as camelCase or snake_case
  const normalized = toolName.toLowerCase().replace(/[_-]/g, '');

  if (normalized.includes('searchintent') || normalized.includes('readintent')) return 'Looking at your signals...';
  if (normalized.includes('discoveropportunit')) return 'Discovering opportunities...';
  if (normalized.includes('listopportunit') || normalized.includes('readopportunit')) return 'Checking your opportunities...';
  if (normalized.includes('userprofile') || normalized.includes('readuser')) return 'Loading profile info...';
  if (normalized.includes('searchcontact') || normalized.includes('listcontact')) return 'Looking through contacts...';
  if (normalized.includes('readnetwork') || normalized.includes('listnetwork')) return 'Checking communities...';
  if (normalized.includes('scrape')) return 'Reading linked content...';
  return undefined;
}

/** Minimum gap between status messages to avoid spam. */
const STATUS_THROTTLE_MS = 5_000;

// ── Inbound message handling ────────────────────────────────────────────────

const PROCESS_TIMEOUT_MS = 120_000;

// ── Structured-block formatting ────────────────────────────────────────────────

/**
 * Parse the LLM response for structured blocks (opportunity cards, intent
 * proposals) and render them as individual HTML-formatted messages with inline
 * keyboards. Plain-text responses pass through unchanged.
 *
 * Each opportunity card is sent as a separate message with:
 * - HTML formatting: bold name, italic headline, body, metadata
 * - An inline keyboard button linking to the web app
 * - A plain-text fallback if Telegram rejects the HTML
 */
async function sendFormattedResponse(
  chatId: string,
  responseText: string,
  deps: GatewayDeps,
): Promise<void> {
  const segments = parseResponseSegments(responseText);

  if (!hasStructuredBlocks(segments)) {
    await deps.sendTelegramMessage(chatId, responseText);
    return;
  }

  for (const segment of segments) {
    if (segment.type === 'text') {
      await deps.sendTelegramMessage(chatId, segment.content);
    } else if (segment.type === 'opportunity') {
      const { text, keyboard } = formatOpportunityCardHtml(segment.card, appUrl());
      try {
        await deps.sendTelegramMessage(chatId, text, keyboard, 'HTML');
      } catch {
        // HTML rejected by Telegram — fall back to plain text without keyboard
        const plain = formatOpportunityCardPlainText(segment.card);
        await deps.sendTelegramMessage(chatId, plain).catch(() => {});
      }
    }
  }
}

/**
 * Handle an update received from Telegram (text message or /start command).
 * Uses the streaming graph interface when available, falling back to
 * the blocking `processMessage` path otherwise.
 *
 * While the graph runs the user sees a typing indicator and short
 * status messages as tools execute (e.g. "Looking at your signals...").
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

  const { userId } = found;
  let { sessionId } = found;

  // Ensure a chat session exists (may not if the user messages before any outbound notification)
  if (!sessionId) {
    sessionId = await ensureSession(userId, deps);
  }

  // Write user message to conversation (best-effort)
  await deps.createChatMessage({
    id: crypto.randomUUID(),
    sessionId,
    role: 'user',
    content: text,
  }).catch((err) => logger.warn('Failed to write user message to conversation', { error: err }));

  // Choose streaming or blocking path
  const responseText = deps.streamMessage
    ? await handleInboundStreaming(chatId, userId, text, sessionId, deps)
    : await handleInboundBlocking(chatId, userId, text, deps);

  // Write assistant response (best-effort)
  await deps.createChatMessage({
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    content: responseText,
  }).catch((err) => logger.warn('Failed to write assistant message to conversation', { error: err }));

  // Format structured blocks (opportunity cards, etc.) as styled Telegram
  // messages; plain-text responses are sent as-is.
  try {
    await sendFormattedResponse(chatId, responseText, deps);
  } catch (err) {
    logger.error('Failed to deliver final response via Telegram', { chatId, error: err });
    // Last-resort fallback
    await deps.sendTelegramMessage(chatId, 'I generated a response but couldn\'t deliver it. Please try again.').catch(() => {});
  }
}

/**
 * Send a status message during streaming — best-effort.
 * Telegram API errors (rate limits, network) must not kill the stream.
 */
async function trySendStatus(chatId: string, text: string, deps: GatewayDeps): Promise<void> {
  try {
    await deps.sendTelegramMessage(chatId, text);
  } catch (err) {
    logger.warn('Failed to send Telegram status message', { chatId, text, error: err });
  }
}

/**
 * Streaming path: consumes the graph event stream, sends typing indicators
 * and stage-notification messages as tools run, then returns the final
 * response text.
 */
async function handleInboundStreaming(
  chatId: string,
  userId: string,
  text: string,
  sessionId: string,
  deps: GatewayDeps,
): Promise<string> {
  const stopTyping = startTypingIndicator(chatId, deps);

  // Timeout timer — must be cleaned up to avoid unhandled rejections
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    let responseText = '';
    let lastStatusSentAt = 0;
    let lastStatusText: string | null = null;

    const stream = deps.streamMessage!(userId, text, sessionId);

    // Race the stream against a hard timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('streamMessage timed out')), PROCESS_TIMEOUT_MS);
    });

    // Wrap the async iteration in a promise so we can race it
    const streamPromise = (async () => {
      for await (const event of stream) {
        // Tool-activity status notifications
        if (event.type === 'tool_activity' && event.phase === 'start' && event.toolName) {
          const status = toolStatusText(event.toolName);
          const now = Date.now();
          if (status && status !== lastStatusText && now - lastStatusSentAt >= STATUS_THROTTLE_MS) {
            await trySendStatus(chatId, status, deps);
            lastStatusText = status;
            lastStatusSentAt = now;
          }
        }

        // Agent-level status (e.g. negotiator starting)
        if (event.type === 'agent_start' && event.name) {
          const agentStatus = agentStatusText(event.name);
          const now = Date.now();
          if (agentStatus && agentStatus !== lastStatusText && now - lastStatusSentAt >= STATUS_THROTTLE_MS) {
            await trySendStatus(chatId, agentStatus, deps);
            lastStatusText = agentStatus;
            lastStatusSentAt = now;
          }
        }

        // Authoritative final response
        if (event.type === 'response_complete' && typeof event.response === 'string') {
          responseText = event.response;
        }
      }
    })();

    await Promise.race([streamPromise, timeoutPromise]);
    return responseText || 'Sorry, I could not process your message.';
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errorMsg.includes('timed out');
    logger.error('Streaming processMessage failed for Telegram user', {
      userId,
      chatId,
      errorType: isTimeout ? 'timeout' : 'stream_error',
      errorMessage: errorMsg,
      error: err,
    });
    return isTimeout
      ? 'This is taking longer than expected. Please try a simpler question, or try again in a moment.'
      : 'Sorry, something went wrong. Please try again.';
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    stopTyping();
  }
}

/**
 * Map agent names to user-friendly status messages.
 */
function agentStatusText(agentName: string): string | undefined {
  const lower = agentName.toLowerCase();
  if (lower.includes('negotiat')) return 'Evaluating a potential connection...';
  return undefined;
}

/**
 * Blocking fallback path: calls processMessage with a timeout.
 * Used when streamMessage is not available (e.g. in tests without streaming deps).
 */
async function handleInboundBlocking(
  chatId: string,
  userId: string,
  text: string,
  deps: GatewayDeps,
): Promise<string> {
  const stopTyping = startTypingIndicator(chatId, deps);

  try {
    const result = await Promise.race([
      deps.processMessage(userId, text),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('processMessage timed out')), PROCESS_TIMEOUT_MS),
      ),
    ]);
    return result.responseText || 'Sorry, I could not process your message.';
  } catch (err) {
    logger.error('processMessage failed for Telegram user', { userId, chatId, error: err });
    return 'Sorry, something went wrong. Please try again.';
  } finally {
    stopTyping();
  }
}

/**
 * Create a chat session for a Telegram user who doesn't have one yet.
 * Updates the user's Telegram prefs with the new sessionId.
 */
async function ensureSession(userId: string, deps: GatewayDeps): Promise<string> {
  const sessionId = crypto.randomUUID();
  await deps.createChatSession({ id: sessionId, userId, title: 'Telegram' });

  // Persist sessionId in prefs so future messages reuse it
  const prefs = await deps.getTelegramPrefs(userId);
  if (prefs) {
    await deps.updateTelegramPrefs(userId, { ...prefs, sessionId });
  }

  return sessionId;
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
