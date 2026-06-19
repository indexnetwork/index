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
  it('enqueues context regen for the user when premises change', async () => {
    const calls: string[] = [];
    const queue = new PremiseQueue({
      enqueueContextRegen: async (uid) => { calls.push(`context:${uid}`); },
    });

    await queue.processJob('profile_regen', { userId: 'u1', trigger: 'premise_created' });

    expect(calls).toEqual(['context:u1']);
  });

  it('propagates errors when context regen enqueue fails', async () => {
    const queue = new PremiseQueue({
      enqueueContextRegen: async () => { throw new Error('boom'); },
    });

    await expect(
      queue.processJob('profile_regen', { userId: 'u1', trigger: 'premise_created' }),
    ).rejects.toThrow('boom');
  });
});

describe('PremiseQueue — profile regen enqueue options', () => {
  it('frees the jobId on settle so repeated premise changes re-run (removeOnComplete/Fail true)', async () => {
    const queue = new PremiseQueue();
    await queue.addProfileRegenJob({ userId: 'u1', trigger: 'premise_created' });
    expect(mockAdd).toHaveBeenCalledWith(
      'profile_regen',
      { userId: 'u1', trigger: 'premise_created' },
      expect.objectContaining({
        jobId: 'profile-regen-u1-premise_created',
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
  });
});
