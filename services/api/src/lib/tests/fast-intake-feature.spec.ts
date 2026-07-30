import { afterEach, describe, expect, it } from 'bun:test';

import { isFastSignalIntakeEnabled } from '../fast-intake-feature';

const original = process.env.FAST_SIGNAL_INTAKE;
afterEach(() => {
  if (original === undefined) delete process.env.FAST_SIGNAL_INTAKE;
  else process.env.FAST_SIGNAL_INTAKE = original;
});

describe('isFastSignalIntakeEnabled', () => {
  it('is disabled by default', () => {
    delete process.env.FAST_SIGNAL_INTAKE;
    expect(isFastSignalIntakeEnabled()).toBe(false);
  });

  it('is enabled only for the exact string "true"', () => {
    process.env.FAST_SIGNAL_INTAKE = 'true';
    expect(isFastSignalIntakeEnabled()).toBe(true);
    for (const value of ['TRUE', '1', 'yes', 'false', '']) {
      process.env.FAST_SIGNAL_INTAKE = value;
      expect(isFastSignalIntakeEnabled()).toBe(false);
    }
  });
});
