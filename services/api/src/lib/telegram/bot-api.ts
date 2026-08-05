import { log } from '../log';

const logger = log.lib.from('telegram/bot-api');

const BASE = 'https://api.telegram.org';

/**
 * Re-export the shared HTML escaper. Telegram's HTML parse_mode requires the
 * same five characters escaped (`<`, `>`, `&`, `"`, `'`) that the shared helper
 * handles, so keep a single canonical implementation.
 */
export { escapeHtml } from '../escapeHtml';

let missingTokenWarned = false;

/**
 * Resolve the bot token, or null when the gateway is not configured.
 * Unsetting `TELEGRAM_BOT_TOKEN` is how the Telegram gateway is switched off:
 * outbound calls then no-op instead of requesting a bot URL built from an
 * undefined token.
 */
function botToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token ? token : null;
}

/**
 * Whether the gateway can actually reply.
 *
 * Inbound and outbound are gated by different variables
 * (`TELEGRAM_WEBHOOK_SECRET` vs `TELEGRAM_BOT_TOKEN`), so a half-configured
 * deployment can authenticate updates it can never answer. Callers on the
 * inbound path use this to stop before doing expensive work whose reply would
 * be discarded here anyway.
 */
export function isTelegramOutboundConfigured(): boolean {
  return botToken() !== null;
}

/** Warn once per process that Telegram outbound is disabled, then stay quiet. */
function warnDisabled(method: string): void {
  if (missingTokenWarned) return;
  missingTokenWarned = true;
  logger.warn('Telegram outbound skipped: TELEGRAM_BOT_TOKEN is not set', { method });
}

function botUrl(token: string, method: string): string {
  return `${BASE}/bot${token}/${method}`;
}

/**
 * Send a text message to a Telegram chat.
 * @param chatId - Telegram chat ID (string form of the integer ID)
 * @param text - Message text
 * @param inlineKeyboard - Optional URL-button rows: [[{ text, url }], ...]
 * @param parseMode - Parse mode for text formatting (default: none / plain text)
 */
export async function sendMessage(
  chatId: string,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; url: string }>>,
  parseMode?: 'HTML' | 'MarkdownV2',
): Promise<void> {
  const token = botToken();
  if (!token) {
    warnDisabled('sendMessage');
    return;
  }
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) {
    body.parse_mode = parseMode;
  }
  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  const res = await fetch(botUrl(token, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram sendMessage failed: ${err}`);
  }
}

/**
 * Signal that the bot is "typing" (or performing another action).
 * The indicator auto-expires after 5 seconds; call repeatedly for longer operations.
 * Best-effort — failures are silently ignored.
 * @param chatId - Telegram chat ID
 * @param action - Chat action (default: 'typing')
 */
export async function sendChatAction(
  chatId: string,
  action: 'typing' | 'upload_document' = 'typing',
): Promise<void> {
  const token = botToken();
  if (!token) {
    warnDisabled('sendChatAction');
    return;
  }
  await fetch(botUrl(token, 'sendChatAction'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}

/**
 * Register a webhook URL with Telegram so the bot receives updates via HTTP POST.
 * @param url - The full HTTPS webhook URL
 * @param secretToken - Sent as X-Telegram-Bot-Api-Secret-Token header with each update
 */
export async function setWebhook(url: string, secretToken: string): Promise<void> {
  const token = botToken();
  if (!token) {
    warnDisabled('setWebhook');
    return;
  }
  const res = await fetch(botUrl(token, 'setWebhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secretToken }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram setWebhook failed: ${err}`);
  }
}
