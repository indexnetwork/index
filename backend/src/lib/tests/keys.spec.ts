import { describe, test, expect } from 'bun:test';
import { toKebabKey, validateKey, isUUID, isHexPrefix, generateUniqueKey } from '../keys';

describe('toKebabKey', () => {
  test('converts a simple name to kebab-case', () => {
    expect(toKebabKey('Jane Doe')).toBe('jane-doe');
  });

  test('handles multiple spaces', () => {
    expect(toKebabKey('AI  Research  Network')).toBe('ai-research-network');
  });

  test('strips special characters', () => {
    expect(toKebabKey("O'Brien & Associates")).toBe('obrien-associates');
  });

  test('collapses consecutive hyphens', () => {
    expect(toKebabKey('test--name---here')).toBe('test-name-here');
  });

  test('trims leading and trailing hyphens', () => {
    expect(toKebabKey('-test-name-')).toBe('test-name');
  });

  test('strips diacritics', () => {
    expect(toKebabKey('Cafe Resume')).toBe('cafe-resume');
  });

  test('truncates to 64 characters', () => {
    const long = 'a'.repeat(100);
    expect(toKebabKey(long).length).toBeLessThanOrEqual(64);
  });

  test('handles empty string', () => {
    expect(toKebabKey('')).toBe('');
  });

  test('handles string with only special chars', () => {
    expect(toKebabKey('!@#$%')).toBe('');
  });
});

describe('validateKey', () => {
  test('accepts valid keys', () => {
    expect(validateKey('jane-doe')).toEqual({ valid: true });
    expect(validateKey('abc')).toEqual({ valid: true });
    expect(validateKey('user-123')).toEqual({ valid: true });
    expect(validateKey('a1b')).toEqual({ valid: true });
  });

  test('rejects keys shorter than 3 chars', () => {
    const result = validateKey('ab');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at least 3');
  });

  test('rejects keys longer than 64 chars', () => {
    const result = validateKey('a'.repeat(65));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at most 64');
  });

  test('rejects keys with uppercase', () => {
    const result = validateKey('Jane-Doe');
    expect(result.valid).toBe(false);
  });

  test('rejects keys starting with hyphen', () => {
    const result = validateKey('-test');
    expect(result.valid).toBe(false);
  });

  test('rejects keys ending with hyphen', () => {
    const result = validateKey('test-');
    expect(result.valid).toBe(false);
  });

  test('rejects keys with special chars', () => {
    const result = validateKey('test_name');
    expect(result.valid).toBe(false);
  });

  test('rejects reserved words', () => {
    const result = validateKey('admin');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('reserved');
  });

  test('rejects "me" as reserved', () => {
    const result = validateKey('settings');
    expect(result.valid).toBe(false);
  });
});

describe('isUUID', () => {
  test('recognizes valid UUID', () => {
    expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  test('rejects non-UUID strings', () => {
    expect(isUUID('jane-doe')).toBe(false);
    expect(isUUID('550e8400')).toBe(false);
    expect(isUUID('')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(isUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });
});

describe('isHexPrefix', () => {
  test('recognizes short hex strings', () => {
    expect(isHexPrefix('550e8400')).toBe(true);
    expect(isHexPrefix('abc123')).toBe(true);
  });

  test('rejects full UUIDs', () => {
    expect(isHexPrefix('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  test('rejects non-hex strings', () => {
    expect(isHexPrefix('jane-doe')).toBe(false);
    expect(isHexPrefix('xyz123')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isHexPrefix('')).toBe(false);
  });
});

describe('generateUniqueKey', () => {
  test('returns base key when not taken', async () => {
    const result = await generateUniqueKey('Jane Doe', async () => false);
    expect(result).toBe('jane-doe');
  });

  test('appends suffix when base key is taken', async () => {
    const taken = new Set(['jane-doe']);
    const result = await generateUniqueKey('Jane Doe', async (k) => taken.has(k));
    expect(result).toBe('jane-doe-2');
  });

  test('increments suffix until unique', async () => {
    const taken = new Set(['jane-doe', 'jane-doe-2', 'jane-doe-3']);
    const result = await generateUniqueKey('Jane Doe', async (k) => taken.has(k));
    expect(result).toBe('jane-doe-4');
  });

  test('returns empty string for invalid names', async () => {
    const result = await generateUniqueKey('', async () => false);
    expect(result).toBe('');
  });

  test('returns empty string for names too short after conversion', async () => {
    const result = await generateUniqueKey('ab', async () => false);
    expect(result).toBe('');
  });

  test('skips reserved words', async () => {
    const result = await generateUniqueKey('Admin', async () => false);
    expect(result).toBe('admin-2');
  });
});
