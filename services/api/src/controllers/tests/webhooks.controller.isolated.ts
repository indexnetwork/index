import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

/**
 * The half-configured gateway.
 *
 * Inbound is gated by `TELEGRAM_WEBHOOK_SECRET`, outbound by
 * `TELEGRAM_BOT_TOKEN`. With only the secret set, Telegram updates authenticate
 * successfully but no reply can ever be delivered — so the expensive inbound
 * path must not run at all. These tests pin that, plus the two configurations
 * either side of it.
 */

let inboundCalls: Array<{ chatId: string; text: string }> = [];

mock.module('../../gateways/telegram.gateway', () => ({
  handleInbound: mock(async (chatId: string, text: string) => {
    inboundCalls.push({ chatId, text });
  }),
}));

const { WebhooksController } = await import('../webhooks.controller');

const SECRET = 'webhook-secret-under-test';
const ORIGINAL_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function updateRequest(secret: string | null, text = 'hello there'): Request {
  return new Request('https://api.test/webhooks/telegram', {
    method: 'POST',
    headers: secret === null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ message: { chat: { id: 4242 }, text, from: { username: 'someone' } } }),
  });
}

beforeEach(() => {
  inboundCalls = [];
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
  else process.env.TELEGRAM_WEBHOOK_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_TOKEN === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
});

describe('POST /webhooks/telegram — credential configurations', () => {
  it('drops the update without running the inbound path when the bot token is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;

    const res = await new WebhooksController().telegram(updateRequest(SECRET));

    // 200, because a non-2xx makes Telegram retry the same update forever.
    expect(res.status).toBe(200);
    expect(inboundCalls).toHaveLength(0);
  });

  it('treats a whitespace-only bot token as unconfigured', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '   ';

    const res = await new WebhooksController().telegram(updateRequest(SECRET));

    expect(res.status).toBe(200);
    expect(inboundCalls).toHaveLength(0);
  });

  it('runs the inbound path when both credentials are set', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'real-token';

    const res = await new WebhooksController().telegram(updateRequest(SECRET, 'run me'));

    expect(res.status).toBe(200);
    expect(inboundCalls).toEqual([{ chatId: '4242', text: 'run me' }]);
  });

  it('still rejects a wrong or missing secret before anything else', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'real-token';

    expect((await new WebhooksController().telegram(updateRequest('wrong'))).status).toBe(401);
    expect((await new WebhooksController().telegram(updateRequest(null))).status).toBe(401);
    expect(inboundCalls).toHaveLength(0);
  });

  it('fails closed when the webhook secret itself is unset', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    process.env.TELEGRAM_BOT_TOKEN = 'real-token';

    const res = await new WebhooksController().telegram(updateRequest('anything'));

    expect(res.status).toBe(401);
    expect(inboundCalls).toHaveLength(0);
  });
});
