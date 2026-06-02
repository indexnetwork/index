import { describe, expect, test } from 'bun:test';

import { mergeTelegramHandleIntoSocials } from '../socials';

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

  test('returns null when Telegram handle is already unchanged', () => {
    expect(mergeTelegramHandleIntoSocials([
      { label: 'github', value: 'alice-gh' },
      { label: 'telegram', value: 'alice_tg' },
    ], 'alice_tg')).toBeNull();
  });
});
