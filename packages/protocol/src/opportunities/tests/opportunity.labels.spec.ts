/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { MINIMAL_MAIN_TEXT_MAX_CHARS, PRIMARY_ACTION_LABEL_INTRODUCER, PRIMARY_ACTION_LABEL_DEFAULT, SECONDARY_ACTION_LABEL, getPrimaryActionLabel } from "../opportunity.labels.js";

describe('opportunity.constants', () => {
  it('MINIMAL_MAIN_TEXT_MAX_CHARS is a positive number', () => {
    expect(MINIMAL_MAIN_TEXT_MAX_CHARS).toBeGreaterThan(0);
  });

  describe('getPrimaryActionLabel', () => {
    it('returns introducer label for "introducer" role', () => {
      expect(getPrimaryActionLabel('introducer')).toBe(PRIMARY_ACTION_LABEL_INTRODUCER);
    });

    it('returns default label for any other role', () => {
      expect(getPrimaryActionLabel('member')).toBe(PRIMARY_ACTION_LABEL_DEFAULT);
      expect(getPrimaryActionLabel('')).toBe(PRIMARY_ACTION_LABEL_DEFAULT);
      expect(getPrimaryActionLabel('patient')).toBe(PRIMARY_ACTION_LABEL_DEFAULT);
    });

    it('constants are non-empty strings', () => {
      expect(PRIMARY_ACTION_LABEL_INTRODUCER.length).toBeGreaterThan(0);
      expect(PRIMARY_ACTION_LABEL_DEFAULT.length).toBeGreaterThan(0);
      expect(SECONDARY_ACTION_LABEL.length).toBeGreaterThan(0);
    });
  });
});
