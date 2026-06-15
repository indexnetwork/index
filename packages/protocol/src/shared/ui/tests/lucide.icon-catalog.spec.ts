/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { DEFAULT_HOME_SECTION_ICON, HOME_SECTION_ICON_NAMES, normalizeIconName, resolveHomeSectionIcon, getIconNamesForPrompt } from "../lucide.icon-catalog.js";

describe('lucide.icon-catalog', () => {
  describe('normalizeIconName', () => {
    it('lowercases and trims icon names', () => {
      expect(normalizeIconName('  Telescope  ')).toBe('telescope');
    });

    it('replaces spaces with hyphens', () => {
      expect(normalizeIconName('bar chart')).toBe('bar-chart');
    });

    it('returns default for null', () => {
      expect(normalizeIconName(null)).toBe(DEFAULT_HOME_SECTION_ICON);
    });

    it('returns default for undefined', () => {
      expect(normalizeIconName(undefined)).toBe(DEFAULT_HOME_SECTION_ICON);
    });

    it('returns default for empty string', () => {
      expect(normalizeIconName('')).toBe(DEFAULT_HOME_SECTION_ICON);
    });

    it('returns default for whitespace-only string', () => {
      expect(normalizeIconName('   ')).toBe(DEFAULT_HOME_SECTION_ICON);
    });
  });

  describe('resolveHomeSectionIcon', () => {
    it('returns a valid icon name unchanged', () => {
      expect(resolveHomeSectionIcon('telescope')).toBe('telescope');
    });

    it('normalizes and returns a valid icon name', () => {
      expect(resolveHomeSectionIcon('Bar-Chart')).toBe('bar-chart');
    });

    it('falls back to default for unknown icon name', () => {
      expect(resolveHomeSectionIcon('not-a-real-icon')).toBe(DEFAULT_HOME_SECTION_ICON);
    });

    it('falls back to default for null', () => {
      expect(resolveHomeSectionIcon(null)).toBe(DEFAULT_HOME_SECTION_ICON);
    });

    it('default icon is in the allowed set', () => {
      expect(HOME_SECTION_ICON_NAMES).toContain(DEFAULT_HOME_SECTION_ICON);
    });
  });

  describe('getIconNamesForPrompt', () => {
    it('returns a comma-separated string', () => {
      const result = getIconNamesForPrompt();
      expect(typeof result).toBe('string');
      expect(result.includes(',')).toBe(true);
    });

    it('respects maxItems limit', () => {
      const result = getIconNamesForPrompt(3);
      const items = result.split(', ');
      expect(items.length).toBe(3);
    });

    it('includes the default icon', () => {
      const result = getIconNamesForPrompt();
      expect(result).toContain(DEFAULT_HOME_SECTION_ICON);
    });
  });
});
