import { describe, expect, it } from 'bun:test';
import { jaroWinkler, isCommonProvider, emailSimilarity, getPreset, type DedupPreset, deduplicateContacts, type DedupResult } from './dedup';

describe('jaroWinkler', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaroWinkler('hello', 'hello')).toBe(1.0);
  });

  it('returns 0.0 when both strings are empty', () => {
    expect(jaroWinkler('', '')).toBe(0.0);
  });

  it('returns 0.0 when one string is empty', () => {
    expect(jaroWinkler('hello', '')).toBe(0.0);
    expect(jaroWinkler('', 'hello')).toBe(0.0);
  });

  it('scores prefix-sharing strings higher (Winkler boost)', () => {
    const score = jaroWinkler('john', 'johnny');
    expect(score).toBeGreaterThan(0.85);
  });

  it('handles transpositions', () => {
    const score = jaroWinkler('martha', 'marhta');
    expect(score).toBeGreaterThan(0.95);
  });

  it('scores completely different strings low', () => {
    const score = jaroWinkler('abc', 'xyz');
    expect(score).toBeLessThan(0.5);
  });

  it('is case-sensitive (caller normalizes)', () => {
    const lower = jaroWinkler('john', 'john');
    const mixed = jaroWinkler('John', 'john');
    expect(lower).toBeGreaterThan(mixed);
  });
});

describe('isCommonProvider', () => {
  it('recognizes gmail.com', () => {
    expect(isCommonProvider('gmail.com')).toBe(true);
  });

  it('recognizes outlook.com', () => {
    expect(isCommonProvider('outlook.com')).toBe(true);
  });

  it('rejects custom domains', () => {
    expect(isCommonProvider('smith.dev')).toBe(false);
    expect(isCommonProvider('acme.com')).toBe(false);
  });
});

describe('emailSimilarity', () => {
  it('scores identical emails as 1.0', () => {
    expect(emailSimilarity('john@gmail.com', 'john@gmail.com', 0.25)).toBe(1.0);
  });

  it('scores only local-part for common providers', () => {
    const score = emailSimilarity('john.smith@gmail.com', 'johnsmith@yahoo.com', 0.25);
    // Domain mismatch ignored (both common), only local-part Jaro-Winkler
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('adds domain bonus for matching custom domains', () => {
    const withBonus = emailSimilarity('sarah@connor.io', 's.connor@connor.io', 0.25);
    const withoutBonus = emailSimilarity('sarah@connor.io', 's.connor@other.io', 0.25);
    expect(withBonus).toBeGreaterThan(withoutBonus);
  });

  it('caps score at 1.0 after domain bonus', () => {
    const score = emailSimilarity('john@smith.dev', 'john@smith.dev', 0.25);
    expect(score).toBe(1.0);
  });

  it('gives no domain bonus when custom domains differ', () => {
    const score = emailSimilarity('john@smith.dev', 'john@doe.io', 0.25);
    // Same local-part, different custom domains — no bonus
    const localOnly = emailSimilarity('john@gmail.com', 'john@yahoo.com', 0.25);
    expect(score).toBeCloseTo(localOnly, 2);
  });
});

describe('getPreset', () => {
  it('returns conservative thresholds by default', () => {
    const preset = getPreset(undefined);
    expect(preset).toEqual({
      nameThreshold: 0.92,
      emailThreshold: 0.85,
      domainBonus: 0.25,
    });
  });

  it('returns null for "off"', () => {
    expect(getPreset('off')).toBeNull();
  });

  it('returns conservative preset', () => {
    const preset = getPreset('conservative');
    expect(preset?.nameThreshold).toBe(0.92);
  });

  it('returns balanced preset', () => {
    const preset = getPreset('balanced');
    expect(preset?.nameThreshold).toBe(0.85);
    expect(preset?.emailThreshold).toBe(0.75);
    expect(preset?.domainBonus).toBe(0.30);
  });

  it('returns aggressive preset', () => {
    const preset = getPreset('aggressive');
    expect(preset?.nameThreshold).toBe(0.78);
    expect(preset?.emailThreshold).toBe(0.65);
    expect(preset?.domainBonus).toBe(0.35);
  });

  it('defaults to conservative for unknown values', () => {
    const preset = getPreset('invalid');
    expect(preset?.nameThreshold).toBe(0.92);
  });
});

describe('deduplicateContacts', () => {
  const preset = { nameThreshold: 0.92, emailThreshold: 0.85, domainBonus: 0.25 };

  it('keeps all contacts when names differ', () => {
    const contacts = [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ];
    const details = [
      { email: 'alice@test.com', userId: 'u1', isNew: true },
      { email: 'bob@test.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    expect(result.kept).toEqual(details);
    expect(result.removed).toEqual([]);
  });

  it('deduplicates when name and email both score above thresholds', () => {
    const contacts = [
      { name: 'John Smith', email: 'john.smith@gmail.com' },
      { name: 'John Smith', email: 'johnsmith@yahoo.com' },
    ];
    const details = [
      { email: 'john.smith@gmail.com', userId: 'u1', isNew: true },
      { email: 'johnsmith@yahoo.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    expect(result.kept.length).toBe(1);
    expect(result.kept[0].email).toBe('john.smith@gmail.com');
    expect(result.removed.length).toBe(1);
    expect(result.removed[0].matchedWith).toBe('john.smith@gmail.com');
  });

  it('keeps both when name matches but email scores too low', () => {
    const contacts = [
      { name: 'John Smith', email: 'john@gmail.com' },
      { name: 'John Smith', email: 'jsmith@work.com' },
    ];
    const details = [
      { email: 'john@gmail.com', userId: 'u1', isNew: true },
      { email: 'jsmith@work.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    expect(result.kept.length).toBe(2);
    expect(result.removed.length).toBe(0);
  });

  it('applies domain bonus for matching custom domains', () => {
    const contacts = [
      { name: 'Sarah Connor', email: 'sarah@connor.io' },
      { name: 'Sarah Connor', email: 's.connor@connor.io' },
    ];
    const details = [
      { email: 'sarah@connor.io', userId: 'u1', isNew: true },
      { email: 's.connor@connor.io', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    expect(result.kept.length).toBe(1);
    expect(result.removed.length).toBe(1);
  });

  it('uses email local-part as name when name is empty', () => {
    const contacts = [
      { name: '', email: 'alice@gmail.com' },
      { name: '', email: 'bob@yahoo.com' },
    ];
    const details = [
      { email: 'alice@gmail.com', userId: 'u1', isNew: true },
      { email: 'bob@yahoo.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    // Local-parts as names: "alice" vs "bob" — low name similarity, kept separate
    expect(result.kept.length).toBe(2);
  });

  it('returns all contacts when preset is null (off)', () => {
    const contacts = [
      { name: 'John Smith', email: 'john.smith@gmail.com' },
      { name: 'John Smith', email: 'johnsmith@yahoo.com' },
    ];
    const details = [
      { email: 'john.smith@gmail.com', userId: 'u1', isNew: true },
      { email: 'johnsmith@yahoo.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, null);
    expect(result.kept).toEqual(details);
    expect(result.removed).toEqual([]);
  });

  it('handles single contact without error', () => {
    const contacts = [{ name: 'Alice', email: 'alice@test.com' }];
    const details = [{ email: 'alice@test.com', userId: 'u1', isNew: true }];
    const result = deduplicateContacts(contacts, details, preset);
    expect(result.kept).toEqual(details);
    expect(result.removed).toEqual([]);
  });

  it('handles empty input', () => {
    const result = deduplicateContacts([], [], preset);
    expect(result.kept).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('removed entries include scores', () => {
    const contacts = [
      { name: 'John Smith', email: 'john.smith@gmail.com' },
      { name: 'John Smith', email: 'johnsmith@yahoo.com' },
    ];
    const details = [
      { email: 'john.smith@gmail.com', userId: 'u1', isNew: true },
      { email: 'johnsmith@yahoo.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    if (result.removed.length > 0) {
      const removed = result.removed[0];
      expect(removed.nameScore).toBeGreaterThan(0);
      expect(removed.emailScore).toBeGreaterThan(0);
      expect(typeof removed.nameScore).toBe('number');
      expect(typeof removed.emailScore).toBe('number');
    }
  });
});
