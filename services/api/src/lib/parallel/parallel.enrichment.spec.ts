import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it } from 'bun:test';
import { extractHandle } from './parallel';

describe('extractHandle', () => {
  describe('twitter/x', () => {
    it('returns handle from plain username', () => {
      expect(extractHandle('elonmusk', 'x')).toBe('elonmusk');
    });

    it('strips @ prefix', () => {
      expect(extractHandle('@elonmusk', 'x')).toBe('elonmusk');
    });

    it('extracts from full URL', () => {
      expect(extractHandle('https://twitter.com/elonmusk', 'x')).toBe('elonmusk');
    });

    it('extracts from x.com URL', () => {
      expect(extractHandle('https://x.com/elonmusk', 'x')).toBe('elonmusk');
    });

    it('extracts from scheme-less URL', () => {
      expect(extractHandle('x.com/elonmusk', 'x')).toBe('elonmusk');
    });

    it('handles trailing slash', () => {
      expect(extractHandle('https://twitter.com/elonmusk/', 'x')).toBe('elonmusk');
    });

    it('returns undefined for empty string', () => {
      expect(extractHandle('', 'x')).toBeUndefined();
    });
  });

  describe('linkedin', () => {
    it('returns handle from plain username', () => {
      expect(extractHandle('johndoe', 'linkedin')).toBe('johndoe');
    });

    it('extracts from /in/ URL', () => {
      expect(extractHandle('https://www.linkedin.com/in/johndoe', 'linkedin')).toBe('johndoe');
    });

    it('extracts from scheme-less /in/ URL', () => {
      expect(extractHandle('linkedin.com/in/johndoe', 'linkedin')).toBe('johndoe');
    });

    it('handles trailing slash on /in/ URL', () => {
      expect(extractHandle('https://www.linkedin.com/in/johndoe/', 'linkedin')).toBe('johndoe');
    });

    it('rejects company URLs', () => {
      expect(extractHandle('https://linkedin.com/company/acme', 'linkedin')).toBeUndefined();
    });

    it('rejects feed URLs', () => {
      expect(extractHandle('https://linkedin.com/feed', 'linkedin')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(extractHandle('', 'linkedin')).toBeUndefined();
    });
  });

  describe('github', () => {
    it('returns handle from plain username', () => {
      expect(extractHandle('octocat', 'github')).toBe('octocat');
    });

    it('extracts from full URL', () => {
      expect(extractHandle('https://github.com/octocat', 'github')).toBe('octocat');
    });

    it('extracts from scheme-less URL', () => {
      expect(extractHandle('github.com/octocat', 'github')).toBe('octocat');
    });

    it('strips @ prefix', () => {
      expect(extractHandle('@octocat', 'github')).toBe('octocat');
    });

    it('returns undefined for empty string', () => {
      expect(extractHandle('', 'github')).toBeUndefined();
    });
  });
});
