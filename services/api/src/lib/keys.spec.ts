import { describe, expect, test } from 'bun:test';

import { isUUID, validateKey } from './keys';

describe('usernames', () => {
  test('lowercase letters, numbers and inner hyphens are accepted', () => {
    expect(validateKey('seren-s2', 'Username').valid).toBe(true);
  });

  test('errors name the thing being validated', () => {
    expect(validateKey('ab', 'Username').error).toBe('Username must be at least 3 characters');
    expect(validateKey('profile', 'Username').error).toBe('"profile" is a reserved word and cannot be used as a username');
  });

  test('uppercase, underscores and edge hyphens are refused', () => {
    for (const bad of ['Seren', 'seren_s', '-seren', 'seren-']) {
      expect(validateKey(bad, 'Username').valid).toBe(false);
    }
  });

  test('a UUID passes the key pattern, so callers must refuse it themselves', () => {
    // userService.setUsername checks isUUID for exactly this reason.
    const id = crypto.randomUUID();
    expect(validateKey(id, 'Username').valid).toBe(true);
    expect(isUUID(id)).toBe(true);
  });
});
