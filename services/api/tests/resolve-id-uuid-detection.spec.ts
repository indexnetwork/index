/**
 * Tests for the UUID detection fix in resolveId functions.
 *
 * Bug: The original regex `/^[0-9a-f]{8}-[0-9a-f]{4}-/i` was a prefix-only
 * check that would match partial UUIDs (e.g., first 13 chars). The fix
 * requires a full UUID match: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
 *
 * Hypothesis: Short ID prefixes and partial UUIDs were falsely matched as
 * full UUIDs, causing exact-match lookups to fail with "not found" errors.
 */

import { describe, it, expect } from 'bun:test';

// Reproduce the old (buggy) and new (fixed) UUID detection regexes
const OLD_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const FIXED_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('UUID detection regex fix', () => {
  const FULL_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const SHORT_PREFIX_8 = 'a1b2c3d4';
  const PARTIAL_UUID_14 = 'a1b2c3d4-e5f6-'; // 14 chars: triggers old regex
  const PARTIAL_UUID_18 = 'a1b2c3d4-e5f6-7890';
  const PARTIAL_UUID_23 = 'a1b2c3d4-e5f6-7890-abcd';
  const KEY_STYLE = 'ai-research-network';

  describe('old (buggy) regex', () => {
    it('matches full UUID', () => {
      expect(OLD_UUID_REGEX.test(FULL_UUID)).toBe(true);
    });

    it('does not match 8-char hex prefix', () => {
      expect(OLD_UUID_REGEX.test(SHORT_PREFIX_8)).toBe(false);
    });

    it('INCORRECTLY matches 14-char partial UUID (the bug)', () => {
      // This is the bug: a partial UUID that starts with 8hex-4hex- matches
      expect(OLD_UUID_REGEX.test(PARTIAL_UUID_14)).toBe(true);
    });

    it('INCORRECTLY matches 18-char partial UUID (the bug)', () => {
      expect(OLD_UUID_REGEX.test(PARTIAL_UUID_18)).toBe(true);
    });

    it('INCORRECTLY matches 23-char partial UUID (the bug)', () => {
      expect(OLD_UUID_REGEX.test(PARTIAL_UUID_23)).toBe(true);
    });
  });

  describe('fixed regex', () => {
    it('matches full UUID', () => {
      expect(FIXED_UUID_REGEX.test(FULL_UUID)).toBe(true);
    });

    it('does not match 8-char hex prefix', () => {
      expect(FIXED_UUID_REGEX.test(SHORT_PREFIX_8)).toBe(false);
    });

    it('does not match 14-char partial UUID', () => {
      // Fixed: partial UUIDs are now correctly rejected
      expect(FIXED_UUID_REGEX.test(PARTIAL_UUID_14)).toBe(false);
    });

    it('does not match 18-char partial UUID', () => {
      expect(FIXED_UUID_REGEX.test(PARTIAL_UUID_18)).toBe(false);
    });

    it('does not match 23-char partial UUID', () => {
      expect(FIXED_UUID_REGEX.test(PARTIAL_UUID_23)).toBe(false);
    });

    it('does not match key-style identifiers', () => {
      expect(FIXED_UUID_REGEX.test(KEY_STYLE)).toBe(false);
    });

    it('matches uppercase UUID', () => {
      expect(FIXED_UUID_REGEX.test(FULL_UUID.toUpperCase())).toBe(true);
    });
  });
});
