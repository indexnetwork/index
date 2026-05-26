/**
 * Unit tests for OpportunityService.getCounterpartTelegramHandle.
 * Exercises the normalization logic (stripping URL prefixes, @, query params)
 * and validation (5-32 chars, alphanumeric + underscore).
 *
 * Mocks the database layer to isolate the normalization/validation logic.
 */

import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, test, expect, mock } from 'bun:test';

import db from '../../lib/drizzle/drizzle';
import { OpportunityService } from '../opportunity.service';

const originalSelect = db.select.bind(db);

const service = new OpportunityService();

/**
 * Helper: patches db.select to return a single row with the given value,
 * calls getCounterpartTelegramHandle, then restores db.select.
 */
async function callWithValue(value: string | null): Promise<string | null> {
  const rows = value !== null ? [{ value }] : [];
  // @ts-expect-error — patching for test
  db.select = mock(() => ({
    from: mock(() => ({
      where: mock(() => ({
        limit: mock(() => Promise.resolve(rows)),
      })),
    })),
  }));

  try {
    return await service.getCounterpartTelegramHandle('any-user-id');
  } finally {
    db.select = originalSelect;
  }
}

describe('OpportunityService.getCounterpartTelegramHandle', () => {
  test('returns null when no row exists', async () => {
    const result = await callWithValue(null);
    expect(result).toBeNull();
  });

  test('returns bare handle as-is', async () => {
    const result = await callWithValue('seref_k');
    expect(result).toBe('seref_k');
  });

  test('strips @ prefix', async () => {
    const result = await callWithValue('@seref_k');
    expect(result).toBe('seref_k');
  });

  test('strips https://t.me/ prefix', async () => {
    const result = await callWithValue('https://t.me/seref_k');
    expect(result).toBe('seref_k');
  });

  test('strips https://telegram.me/ prefix', async () => {
    const result = await callWithValue('https://telegram.me/seref_k');
    expect(result).toBe('seref_k');
  });

  test('strips http:// prefix (no TLS)', async () => {
    const result = await callWithValue('http://t.me/some_user');
    expect(result).toBe('some_user');
  });

  test('strips query params after handle', async () => {
    const result = await callWithValue('https://t.me/seref_k?start=abc');
    expect(result).toBe('seref_k');
  });

  test('strips hash fragment after handle', async () => {
    const result = await callWithValue('https://t.me/seref_k#section');
    expect(result).toBe('seref_k');
  });

  test('strips trailing slash (path separator)', async () => {
    const result = await callWithValue('https://t.me/seref_k/');
    expect(result).toBe('seref_k');
  });

  test('returns null for handle shorter than 5 chars', async () => {
    const result = await callWithValue('abcd');
    expect(result).toBeNull();
  });

  test('returns null for handle longer than 32 chars', async () => {
    const result = await callWithValue('a'.repeat(33));
    expect(result).toBeNull();
  });

  test('returns null for handle with invalid chars (spaces)', async () => {
    const result = await callWithValue('hello world');
    expect(result).toBeNull();
  });

  test('returns null for handle with invalid chars (special)', async () => {
    const result = await callWithValue('user!name');
    expect(result).toBeNull();
  });

  test('returns null for empty string value', async () => {
    const result = await callWithValue('');
    expect(result).toBeNull();
  });

  test('accepts handle at exactly 5 chars', async () => {
    const result = await callWithValue('ab_cd');
    expect(result).toBe('ab_cd');
  });

  test('accepts handle at exactly 32 chars', async () => {
    const handle = 'a'.repeat(32);
    const result = await callWithValue(handle);
    expect(result).toBe(handle);
  });

  test('handles t.me URL without protocol prefix', async () => {
    // The regex makes https?:// optional, so t.me/handle still matches
    const result = await callWithValue('t.me/my_handle');
    expect(result).toBe('my_handle');
  });

  test('handles numeric-only handle', async () => {
    // Telegram allows all-numeric handles if 5+ chars
    const result = await callWithValue('12345');
    expect(result).toBe('12345');
  });

  test('handles underscore-heavy handle', async () => {
    const result = await callWithValue('_____');
    expect(result).toBe('_____');
  });
});
