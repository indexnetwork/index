import { describe, expect, test } from 'bun:test';

import { mergeTelegramHandleIntoSocials, normalizeTelegramSocialValue } from '../socials';

describe('normalizeTelegramSocialValue', () => {
  test('stores Telegram handles as bare routable handles', () => {
    expect(normalizeTelegramSocialValue('@alice_tg')).toBe('alice_tg');
    expect(normalizeTelegramSocialValue('https://t.me/alice_tg?start=1')).toBe('alice_tg');
    expect(normalizeTelegramSocialValue('Alice Example')).toBeNull();
  });
});

describe('mergeTelegramHandleIntoSocials', () => {
  test('adds Telegram while preserving unrelated socials', () => {
    expect(mergeTelegramHandleIntoSocials([
      { label: 'github', value: 'alice-gh' },
      { label: 'linkedin', value: 'alice-li' },
    ], 'alice_tg')).toEqual([
      { label: 'github', value: 'alice-gh' },
      { label: 'linkedin', value: 'alice-li' },
      { label: 'telegram', value: 'alice_tg' },
    ]);
  });

  test('replaces existing Telegram without duplicating it', () => {
    const merged = mergeTelegramHandleIntoSocials([
      { label: 'telegram', value: 'old_tg' },
      { label: 'github', value: 'alice-gh' },
    ], 'new_tg');

    expect(merged).toEqual([
      { label: 'github', value: 'alice-gh' },
      { label: 'telegram', value: 'new_tg' },
    ]);
  });

  test('normalizes Telegram handle before storing', () => {
    const merged = mergeTelegramHandleIntoSocials([
      { label: 'github', value: 'alice-gh' },
    ], '@alice_tg');

    expect(merged).toContainEqual({ label: 'telegram', value: 'alice_tg' });
  });

  test('returns null when Telegram handle is already unchanged', () => {
    expect(mergeTelegramHandleIntoSocials([
      { label: 'github', value: 'alice-gh' },
      { label: 'telegram', value: 'alice_tg' },
    ], 'alice_tg')).toBeNull();
  });
});
