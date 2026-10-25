import { describe, expect, test } from 'bun:test';

import { distinctXProfileUrls, normalizeXProfileUrl } from './socials';

describe('normalizeXProfileUrl', () => {
  test('bare handles and @handles resolve to lowercase profile URLs', () => {
    expect(normalizeXProfileUrl('jack')).toBe('https://x.com/jack');
    expect(normalizeXProfileUrl('@Jack')).toBe('https://x.com/jack');
    expect(normalizeXProfileUrl('  @jack_123 ')).toBe('https://x.com/jack_123');
  });

  test('x.com and twitter.com URLs resolve, with or without scheme, www, or mobile', () => {
    expect(normalizeXProfileUrl('https://x.com/jack')).toBe('https://x.com/jack');
    expect(normalizeXProfileUrl('twitter.com/jack')).toBe('https://x.com/jack');
    expect(normalizeXProfileUrl('https://www.twitter.com/@Jack/')).toBe('https://x.com/jack');
    expect(normalizeXProfileUrl('mobile.x.com/jack')).toBe('https://x.com/jack');
  });

  test('a tweet URL resolves to its author profile', () => {
    expect(normalizeXProfileUrl('https://x.com/jack/status/20')).toBe('https://x.com/jack');
  });

  test('only the first token of a packed value counts', () => {
    expect(normalizeXProfileUrl('jack , https://instagram.com/nick/')).toBe('https://x.com/jack');
    expect(normalizeXProfileUrl('https://x.com/jack, @nick')).toBe('https://x.com/jack');
  });

  test('URLs on any other host are rejected, even under the x label', () => {
    expect(normalizeXProfileUrl('https://linkedin.com/in/jack')).toBeNull();
    expect(normalizeXProfileUrl('instagram.com/jack')).toBeNull();
  });

  test('product pages never become profiles', () => {
    expect(normalizeXProfileUrl('https://x.com')).toBeNull();
    expect(normalizeXProfileUrl('https://x.com/')).toBeNull();
    expect(normalizeXProfileUrl('https://x.com/i/lists/1')).toBeNull();
    expect(normalizeXProfileUrl('x.com/home')).toBeNull();
    expect(normalizeXProfileUrl('https://x.com/messages')).toBeNull();
    expect(normalizeXProfileUrl('home')).toBeNull();
  });

  test('invalid handles are rejected', () => {
    expect(normalizeXProfileUrl('a'.repeat(16))).toBeNull();
    expect(normalizeXProfileUrl('jack-smith')).toBeNull();
    expect(normalizeXProfileUrl('jack.smith')).toBeNull();
    expect(normalizeXProfileUrl('not a handle!')).toBeNull();
    expect(normalizeXProfileUrl('')).toBeNull();
    expect(normalizeXProfileUrl('   ')).toBeNull();
    expect(normalizeXProfileUrl(null)).toBeNull();
    expect(normalizeXProfileUrl(undefined)).toBeNull();
  });

  test('fifteen characters is the longest handle', () => {
    expect(normalizeXProfileUrl('a'.repeat(15))).toBe(`https://x.com/${'a'.repeat(15)}`);
  });
});

describe('distinctXProfileUrls', () => {
  test('case variants and URL forms of one handle fold to one URL', () => {
    expect(distinctXProfileUrls(['@Jack', 'jack', 'https://x.com/Jack'])).toEqual(['https://x.com/jack']);
  });

  test('unroutable values are dropped and order is first-seen', () => {
    expect(distinctXProfileUrls(['linkedin.com/in/jack', 'nick', 'jack'])).toEqual([
      'https://x.com/nick',
      'https://x.com/jack',
    ]);
    expect(distinctXProfileUrls([])).toEqual([]);
  });
});
