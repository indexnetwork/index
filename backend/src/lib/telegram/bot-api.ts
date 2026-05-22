const BASE = 'https://api.telegram.org';

function botUrl(method: string): string {
  return `${BASE}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
}

/**
 * Send a text message to a Telegram chat.
 * @param chatId - Telegram chat ID (string form of the integer ID)
 * @param text - Message text (HTML parse mode enabled)
 * @param inlineKeyboard - Optional URL-button rows: [[{ text, url }], ...]
 */
export async function sendMessage(
  chatId: string,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; url: string }>>,
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  const res = await fetch(botUrl('sendMessage'), {
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
  await fetch(botUrl('sendChatAction'), {
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
  const res = await fetch(botUrl('setWebhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secretToken }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram setWebhook failed: ${err}`);
  }
}
