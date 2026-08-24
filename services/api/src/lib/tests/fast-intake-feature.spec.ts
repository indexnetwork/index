import { describe, expect, it } from 'bun:test';

import { getSignalIntakeConfig, getSignalIntakeMaxQuestions, isFastSignalIntakeEnabled, SIGNAL_INTAKE_MAX_QUESTIONS } from '../fast-intake-feature';

describe('fast signal intake', () => {
  it('is always on — the deterministic funnel is how /i/new works', () => {
    expect(isFastSignalIntakeEnabled()).toBe(true);
  });

  it('budgets three questions, including the cached round-1 question', () => {
    expect(SIGNAL_INTAKE_MAX_QUESTIONS).toBe(3);
    expect(getSignalIntakeMaxQuestions()).toBe(3);
    expect(getSignalIntakeConfig()).toEqual({ maxQuestions: 3 });
  });
});
