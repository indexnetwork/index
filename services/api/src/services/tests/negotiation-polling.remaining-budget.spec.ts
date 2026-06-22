import { describe, it, expect } from 'bun:test';
import { computeRemainingBudgetMs } from '../negotiation-polling.service';

describe('computeRemainingBudgetMs', () => {
  it('returns full budget when task just started', () => {
    const parkStart = new Date();
    const result = computeRemainingBudgetMs(parkStart, 300_000);
    expect(result).toBeGreaterThan(299_000);
    expect(result).toBeLessThanOrEqual(300_000);
  });

  it('returns reduced budget after time has passed', () => {
    const parkStart = new Date(Date.now() - 60_000);
    const result = computeRemainingBudgetMs(parkStart, 300_000);
    expect(result).toBeGreaterThan(239_000);
    expect(result).toBeLessThanOrEqual(240_000);
  });

  it('clamps to the 1s floor when elapsed time has overrun the budget', () => {
    // 400s elapsed against a 300s budget → raw remaining is negative,
    // implementation clamps via Math.max(1_000, remainingMs).
    const parkStart = new Date(Date.now() - 400_000);
    const result = computeRemainingBudgetMs(parkStart, 300_000);
    expect(result).toBe(1_000);
  });
});
