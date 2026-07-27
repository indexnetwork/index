process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';

import { describe, expect, it, mock } from 'bun:test';

import { maybeEnqueueIntentRecovery } from '../questioner/recovery.shared';

const completion = {
  source: 'from_intent' as const,
  recipientUserId: 'user-1',
  intentId: 'intent-1',
};

describe('maybeEnqueueIntentRecovery', () => {
  it('respects the existing master Questioner gate', async () => {
    const enqueue = mock(async () => {});
    expect(await maybeEnqueueIntentRecovery(completion, { enabled: () => false, enqueue })).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues only the privacy-minimal completion payload', async () => {
    const enqueue = mock(async () => {});
    expect(await maybeEnqueueIntentRecovery(completion, { enabled: () => true, enqueue })).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(completion);
  });

  it('isolates enqueue failures after successful discovery', async () => {
    expect(await maybeEnqueueIntentRecovery(completion, {
      enabled: () => true,
      enqueue: async () => { throw Object.assign(new Error('private details'), { code: 'E_QUEUE' }); },
    })).toBe(false);
  });
});
