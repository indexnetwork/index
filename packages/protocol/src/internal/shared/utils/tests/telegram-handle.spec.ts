import { describe, test, expect } from 'bun:test';
import { normalizeTelegramHandle } from '../telegram-handle.js';

describe('normalizeTelegramHandle', () => {
  test('returns null for null input', () => {
    expect(normalizeTelegramHandle(null)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(normalizeTelegramHandle(undefined)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(normalizeTelegramHandle('')).toBeNull();
  });

  test('returns bare handle as-is', () => {
    expect(normalizeTelegramHandle('seref_k')).toBe('seref_k');
  });

  test('strips @ prefix', () => {
    expect(normalizeTelegramHandle('@seref_k')).toBe('seref_k');
  });

  test('strips https://t.me/ prefix', () => {
    expect(normalizeTelegramHandle('https://t.me/seref_k')).toBe('seref_k');
  });

  test('strips https://telegram.me/ prefix', () => {
    expect(normalizeTelegramHandle('https://telegram.me/seref_k')).toBe('seref_k');
  });

  test('strips http:// prefix (no TLS)', () => {
    expect(normalizeTelegramHandle('http://t.me/some_user')).toBe('some_user');
  });

  test('strips query params after handle', () => {
    expect(normalizeTelegramHandle('https://t.me/seref_k?start=abc')).toBe('seref_k');
  });

  test('strips hash fragment after handle', () => {
    expect(normalizeTelegramHandle('https://t.me/seref_k#section')).toBe('seref_k');
  });

  test('strips trailing slash (path separator)', () => {
    expect(normalizeTelegramHandle('https://t.me/seref_k/')).toBe('seref_k');
  });

  test('handles t.me URL without protocol prefix', () => {
    expect(normalizeTelegramHandle('t.me/my_handle')).toBe('my_handle');
  });

  test('returns null for handle shorter than 5 chars', () => {
    expect(normalizeTelegramHandle('abcd')).toBeNull();
    expect(normalizeTelegramHandle('bob')).toBeNull();
  });

  test('returns null for handle longer than 32 chars', () => {
    expect(normalizeTelegramHandle('a'.repeat(33))).toBeNull();
  });

  test('accepts handle at exactly 5 chars', () => {
    expect(normalizeTelegramHandle('ab_cd')).toBe('ab_cd');
  });

  test('accepts handle at exactly 32 chars', () => {
    const handle = 'a'.repeat(32);
    expect(normalizeTelegramHandle(handle)).toBe(handle);
  });

  test('URL-like value with query chars is safely normalized (strips prefix + query)', () => {
    // t.me/alice?evil=1 → strips t.me/ prefix, strips ?evil=1, extracts "alice"
    // This is the safe behavior — raw value is never interpolated verbatim.
    expect(normalizeTelegramHandle('t.me/alice?evil=1')).toBe('alice');
  });

  test('returns null for handle with invalid chars (spaces)', () => {
    expect(normalizeTelegramHandle('hello world')).toBeNull();
  });

  test('returns null for handle with special chars', () => {
    expect(normalizeTelegramHandle('user!name')).toBeNull();
  });
});
