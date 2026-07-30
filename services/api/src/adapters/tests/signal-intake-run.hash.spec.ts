import { describe, expect, it } from 'bun:test';

import { computeAnswersHash } from '../signal-intake-run.database.adapter';

const base = {
  whoAnswer: { selectedOptions: ['A design partner'] },
  bringAnswer: { selectedOptions: ['Engineering depth'] },
};

describe('computeAnswersHash', () => {
  it('is stable for identical answers', () => {
    expect(computeAnswersHash(base)).toBe(computeAnswersHash(base));
  });

  it('changes when an answer changes', () => {
    expect(computeAnswersHash(base)).not.toBe(
      computeAnswersHash({ ...base, bringAnswer: { selectedOptions: ['Distribution'] } }),
    );
  });

  it('separates a whereText re-synthesis from the speculative run', () => {
    expect(computeAnswersHash(base)).not.toBe(computeAnswersHash({ ...base, whereText: 'Berlin only' }));
  });

  it('treats blank whereText as absent so speculation is reused', () => {
    expect(computeAnswersHash({ ...base, whereText: '   ' })).toBe(computeAnswersHash(base));
  });

  it('is insensitive to selected-option ordering', () => {
    const ab = computeAnswersHash({ ...base, bringAnswer: { selectedOptions: ['a', 'b'] } });
    const ba = computeAnswersHash({ ...base, bringAnswer: { selectedOptions: ['b', 'a'] } });
    expect(ab).toBe(ba);
  });
});

describe('SIGNAL_INTAKE_RUN_TTL_MS', () => {
  it('matches the 24h proposal retention window', async () => {
    const { SIGNAL_INTAKE_RUN_TTL_MS } = await import('../signal-intake-run.database.adapter');
    expect(SIGNAL_INTAKE_RUN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
