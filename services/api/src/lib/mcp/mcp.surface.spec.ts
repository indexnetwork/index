import { describe, expect, test } from 'bun:test';

import { isGrokClientName } from './mcp.surface';

describe('isGrokClientName', () => {
  test('any name containing grok matches, whatever Grok registers itself as', () => {
    expect(isGrokClientName('Grok')).toBe(true);
    expect(isGrokClientName('grok bot')).toBe(true);
    expect(isGrokClientName('GROK')).toBe(true);
    expect(isGrokClientName('Grok for Business')).toBe(true);
  });

  test('other clients and missing names do not match', () => {
    expect(isGrokClientName('Cursor')).toBe(false);
    expect(isGrokClientName('Claude')).toBe(false);
    expect(isGrokClientName('ChatGPT')).toBe(false);
    expect(isGrokClientName('')).toBe(false);
    expect(isGrokClientName(null)).toBe(false);
    expect(isGrokClientName(undefined)).toBe(false);
  });
});
