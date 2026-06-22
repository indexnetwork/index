import { describe, test, expect } from 'bun:test';
import { isUUID, isHexPrefix, validateKey } from '../keys';

/**
 * Tests for identifier resolution logic used across controllers.
 * Validates UUID detection, hex prefix detection, and key validation
 * used by the idOrKey/idOrPrefix resolution flow.
 */
describe('identifier resolution', () => {
  describe('UUID detection', () => {
    test('full UUID is detected as UUID', () => {
      expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    test('partial UUID is not detected as UUID', () => {
      expect(isUUID('550e8400')).toBe(false);
    });

    test('key-like string is not UUID', () => {
      expect(isUUID('my-network')).toBe(false);
    });
  });

  describe('hex prefix detection', () => {
    test('8-char hex string is a valid prefix', () => {
      expect(isHexPrefix('550e8400')).toBe(true);
    });

    test('full UUID is not a hex prefix', () => {
      expect(isHexPrefix('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    test('key-like string is not a hex prefix', () => {
      expect(isHexPrefix('my-network')).toBe(false);
    });

    test('mixed hex chars are valid prefix', () => {
      expect(isHexPrefix('abcdef12')).toBe(true);
    });

    test('non-hex chars fail', () => {
      expect(isHexPrefix('xyz12345')).toBe(false);
    });
  });

  describe('key validation for updates', () => {
    test('valid key passes', () => {
      expect(validateKey('my-network').valid).toBe(true);
    });

    test('too short key fails', () => {
      expect(validateKey('ab').valid).toBe(false);
    });

    test('reserved word fails', () => {
      expect(validateKey('admin').valid).toBe(false);
    });

    test('uppercase fails', () => {
      expect(validateKey('MyNetwork').valid).toBe(false);
    });

    test('single valid char is too short', () => {
      expect(validateKey('a').valid).toBe(false);
    });
  });
});
