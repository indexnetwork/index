import { describe, test, expect } from 'bun:test';

import { normalizeEmbedding } from '../vector';

describe('normalizeEmbedding', () => {
  test('parses a pgvector string into a real number[] (the IND-348 crash path)', () => {
    // Raw `db.execute` reads of a pgvector column arrive as a string, not number[].
    const result = normalizeEmbedding('[0.1,0.2,0.3]');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([0.1, 0.2, 0.3]);
    // The exact operation that threw `source.embedding.join is not a function`.
    expect(() => result.join(',')).not.toThrow();
    expect(result.join(',')).toBe('0.1,0.2,0.3');
  });

  test('passes a number[] through unchanged', () => {
    const input = [0.5, 0.25];
    const result = normalizeEmbedding(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([0.5, 0.25]);
  });

  test('returns [] for null', () => {
    expect(normalizeEmbedding(null)).toEqual([]);
  });

  test('returns [] for undefined', () => {
    expect(normalizeEmbedding(undefined)).toEqual([]);
  });

  test('returns [] for an empty pgvector string', () => {
    expect(normalizeEmbedding('[]')).toEqual([]);
  });

  test('returns [] for an unparseable string instead of throwing', () => {
    expect(normalizeEmbedding('not-a-vector')).toEqual([]);
  });
});
