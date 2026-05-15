import { describe, expect, test } from 'bun:test';

import { parseClientSurface } from '../mcp.controller';

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
});
