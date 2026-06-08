/**
 * Unit tests for PremiseQueue profile-regen chaining. Injected deps avoid Redis/DB;
 * QueueFactory and the user-context queue module are mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, afterAll } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'profile_regen', data: {} }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd, close: async () => {} }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

// Prevent importing the real user-context queue (pulls adapters/Redis) when premise.queue loads.
mock.module('../usercontext.queue', () => ({
  userContextQueue: { addRegenJob: mock(async () => ({ id: 'uc-1' })) },
}));

afterAll(() => {
  mock.restore();
});

import { PremiseQueue } from '../premise.queue';

describe('PremiseQueue — profile regen chaining', () => {
  it('enqueues context regen AFTER the profile aggregate completes', async () => {
    const calls: string[] = [];
    const queue = new PremiseQueue({
      invokeProfileAggregate: async () => { calls.push('aggregate'); },
      enqueueContextRegen: async () => { calls.push('context'); },
    });

    await queue.processJob('profile_regen', { userId: 'u1', trigger: 'premise_created' });

    expect(calls).toEqual(['aggregate', 'context']);
  });

  it('does NOT enqueue context regen when the aggregate throws', async () => {
    const enqueueContextRegen = mock(async () => {});
    const queue = new PremiseQueue({
      invokeProfileAggregate: async () => { throw new Error('boom'); },
      enqueueContextRegen,
    });

    await expect(
      queue.processJob('profile_regen', { userId: 'u1', trigger: 'premise_created' }),
    ).rejects.toThrow('boom');
    expect(enqueueContextRegen).not.toHaveBeenCalled();
  });
});
