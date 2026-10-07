/**
 * Link-preview and crawler agents their operators disclose, plus generic
 * bot words and scripted HTTP clients. Telegram's preview fetcher sends
 * `TelegramBot (like TwitterBot)`.
 */
const BOT_AGENT = new RegExp([
  'telegrambot', 'twitterbot', 'slackbot', 'slack-imgproxy', 'discordbot', 'whatsapp', 'facebookexternalhit',
  'facebot', 'linkedinbot', 'skypeuripreview', 'iframely', 'embedly', 'applebot', 'googlebot', 'bingbot',
  'bot', 'crawl', 'spider', 'preview', 'headless', 'curl', 'wget', 'python', 'go-http', 'okhttp', 'axios',
  'node-fetch', 'undici',
].join('|'), 'i');

/** True for a missing user agent or one that names a link preview, crawler or script. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT_AGENT.test(userAgent);
}
