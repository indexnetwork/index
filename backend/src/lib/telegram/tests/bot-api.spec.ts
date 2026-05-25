import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

// Must set before importing bot-api
process.env.TELEGRAM_BOT_TOKEN = 'test-token';

import { sendMessage, setWebhook } from '../bot-api';

let fetchCalls: Array<{ url: string; body: unknown }> = [];
const originalFetch = global.fetch;

beforeEach(() => {
  fetchCalls = [];
  global.fetch = mock(async (url: string, opts?: RequestInit) => {
    fetchCalls.push({ url, body: opts?.body ? JSON.parse(opts.body as string) : null });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('sendMessage', () => {
  it('posts to the correct Telegram endpoint with chat_id and text', async () => {
    await sendMessage('123456', 'Hello!');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain('/bottest-token/sendMessage');
    expect(fetchCalls[0].body).toMatchObject({ chat_id: '123456', text: 'Hello!' });
  });

  it('includes inline_keyboard when buttons are provided', async () => {
    await sendMessage('123456', 'Check this out', [[{ text: 'View', url: 'https://example.com' }]]);
    expect(fetchCalls[0].body).toMatchObject({
      reply_markup: { inline_keyboard: [[{ text: 'View', url: 'https://example.com' }]] },
    });
  });

  it('throws when the Telegram API returns a non-ok response', async () => {
    global.fetch = mock(async () => new Response('Bad Request', { status: 400 })) as unknown as typeof fetch;
    await expect(sendMessage('123456', 'fail')).rejects.toThrow('Telegram sendMessage failed');
  });
});

describe('setWebhook', () => {
  it('posts to setWebhook with url and secret_token', async () => {
    await setWebhook('https://example.com/webhooks/telegram', 'my-secret');
    expect(fetchCalls[0].url).toContain('/bottest-token/setWebhook');
    expect(fetchCalls[0].body).toMatchObject({
      url: 'https://example.com/webhooks/telegram',
      secret_token: 'my-secret',
    });
  });

  it('throws when setWebhook call fails', async () => {
    global.fetch = mock(async () => new Response('Forbidden', { status: 403 })) as unknown as typeof fetch;
    await expect(setWebhook('https://example.com/webhooks/telegram', 'secret')).rejects.toThrow('Telegram setWebhook failed');
  });
});
