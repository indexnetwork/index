import { describe, expect, it } from 'bun:test';

import { computeAnswersHash, type IntakeRound } from '../signal-intake-run.database.adapter';

const round = (prompt: string, selectedOptions: string[], freeText?: string): IntakeRound => ({
  prompt,
  answer: { selectedOptions, ...(freeText !== undefined ? { freeText } : {}) },
});

describe('computeAnswersHash', () => {
  it('is stable across option ordering within a round', () => {
    const a = computeAnswersHash({ rounds: [round('p1', ['A', 'B']), round('p2', ['C'])] });
    const b = computeAnswersHash({ rounds: [round('p1', ['B', 'A']), round('p2', ['C'])] });
    expect(a).toBe(b);
  });

  it('changes when round order changes', () => {
    const a = computeAnswersHash({ rounds: [round('p1', ['A']), round('p2', ['B'])] });
    const b = computeAnswersHash({ rounds: [round('p2', ['B']), round('p1', ['A'])] });
    expect(a).not.toBe(b);
  });

  it('changes when a round is added', () => {
    const a = computeAnswersHash({ rounds: [round('p1', ['A']), round('p2', ['B'])] });
    const b = computeAnswersHash({ rounds: [round('p1', ['A']), round('p2', ['B']), round('p3', ['C'])] });
    expect(a).not.toBe(b);
  });

  it('folds in the where constraint', () => {
    const rounds = [round('p1', ['A']), round('p2', ['B'])];
    expect(computeAnswersHash({ rounds, whereText: 'Berlin' }))
      .not.toBe(computeAnswersHash({ rounds }));
  });
});

describe('SIGNAL_INTAKE_RUN_TTL_MS', () => {
  it('matches the 24h proposal retention window', async () => {
    const { SIGNAL_INTAKE_RUN_TTL_MS } = await import('../signal-intake-run.database.adapter');
    expect(SIGNAL_INTAKE_RUN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
