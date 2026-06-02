import { describe, expect, spyOn, test } from 'bun:test';

import { parseClientSurface, telegramHandleFromRequest } from '../mcp.controller';

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request('https://protocol.index.network/mcp', { headers });
}

describe('parseClientSurface', () => {
  test('returns "web" when header is null', () => {
    expect(parseClientSurface(null)).toBe('web');
  });

  test('returns "web" when header is empty string', () => {
    expect(parseClientSurface('')).toBe('web');
  });

  test('returns "telegram" for canonical lowercase value', () => {
    expect(parseClientSurface('telegram')).toBe('telegram');
  });

  test('returns "telegram" regardless of case', () => {
    expect(parseClientSurface('Telegram')).toBe('telegram');
    expect(parseClientSurface('TELEGRAM')).toBe('telegram');
  });

  test('trims whitespace before matching', () => {
    expect(parseClientSurface('  telegram  ')).toBe('telegram');
    expect(parseClientSurface('\ttelegram\n')).toBe('telegram');
  });

  test('returns "web" for explicit web value', () => {
    expect(parseClientSurface('web')).toBe('web');
    expect(parseClientSurface('WEB')).toBe('web');
  });

  test('coerces unknown values to "web"', () => {
    expect(parseClientSurface('slack')).toBe('web');
    expect(parseClientSurface('foo')).toBe('web');
    expect(parseClientSurface('true')).toBe('web');
  });

  test('warns exactly once per unknown value, not on subsequent calls', () => {
    const spy = spyOn(console, 'warn');
    // Use a value not seen by any earlier test so the Set is empty for it.
    parseClientSurface('zz-novel-unknown-value');
    parseClientSurface('zz-novel-unknown-value');
    parseClientSurface('zz-novel-unknown-value');
    const callCount = spy.mock.calls.filter((call) =>
      typeof call[0] === 'string' && call[0].includes('zz-novel-unknown-value')
    ).length;
    expect(callCount).toBe(1);
    spy.mockRestore();
  });
});

describe('telegramHandleFromRequest', () => {
  test('normalizes x-index-telegram-username', () => {
    expect(telegramHandleFromRequest(requestWithHeaders({
      'x-index-telegram-username': ' @alice_tg ',
    }))).toBe('alice_tg');
  });

  test('accepts x-index-telegram-handle fallback', () => {
    expect(telegramHandleFromRequest(requestWithHeaders({
      'x-index-telegram-handle': 'https://t.me/alice_tg',
    }))).toBe('alice_tg');
  });

  test('rejects invalid or missing handles', () => {
    expect(telegramHandleFromRequest(requestWithHeaders({}))).toBeNull();
    expect(telegramHandleFromRequest(requestWithHeaders({
      'x-index-telegram-username': 'bad',
    }))).toBeNull();
  });
});
