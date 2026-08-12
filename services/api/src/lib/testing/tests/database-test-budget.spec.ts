import { describe, expect, it } from 'bun:test';

import { settlePromiseOutcome } from '../database-test-budget';

describe('database test promise outcomes', () => {
  it('observes rejection immediately and preserves the exact error instance', async () => {
    const expected = new TypeError('contender rejected');
    let rejectPromise: (reason: unknown) => void = () => undefined;
    const contender = new Promise<never>((_resolve, reject) => {
      rejectPromise = reject;
    });

    const outcomePromise = settlePromiseOutcome(contender);
    rejectPromise(expected);
    const outcome = await outcomePromise;

    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') throw new Error('Expected a rejected outcome');
    expect(outcome.reason).toBe(expected);
    expect(outcome.reason).toBeInstanceOf(TypeError);
  });
});
