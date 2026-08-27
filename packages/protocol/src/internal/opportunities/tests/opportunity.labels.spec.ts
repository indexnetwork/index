/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { MINIMAL_MAIN_TEXT_MAX_CHARS, PRIMARY_ACTION_LABEL_DEFAULT, SECONDARY_ACTION_LABEL, getPrimaryActionLabel } from "../opportunity.labels.js";

describe('opportunity.constants', () => {
  it('MINIMAL_MAIN_TEXT_MAX_CHARS is a positive number', () => {
    expect(MINIMAL_MAIN_TEXT_MAX_CHARS).toBeGreaterThan(0);
  });

  describe('getPrimaryActionLabel', () => {
    // There is one label now: the introducer role is gone, and with it the
    // only role that ever got a different primary action.
    it('returns the default label for every role', () => {
      expect(getPrimaryActionLabel('member')).toBe(PRIMARY_ACTION_LABEL_DEFAULT);
      expect(getPrimaryActionLabel('')).toBe(PRIMARY_ACTION_LABEL_DEFAULT);
      expect(getPrimaryActionLabel('patient')).toBe(PRIMARY_ACTION_LABEL_DEFAULT);
      expect(getPrimaryActionLabel('party')).toBe(PRIMARY_ACTION_LABEL_DEFAULT);
    });

    it('constants are non-empty strings', () => {
      expect(PRIMARY_ACTION_LABEL_DEFAULT.length).toBeGreaterThan(0);
      expect(SECONDARY_ACTION_LABEL.length).toBeGreaterThan(0);
    });
  });
});
