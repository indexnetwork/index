/**
 * Unit tests for UserContextQueue. Injected deps avoid Redis/DB; QueueFactory is mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, afterAll } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'regenerate_contexts', data: {} }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd, close: async () => {} }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

afterAll(() => {
  mock.restore();
});

import {
  UserContextQueue,
  QUEUE_NAME,
  computePremiseHash,
  type ContextPremise,
  type UserContextQueueDeps,
} from '../usercontext.queue';

describe('UserContextQueue', () => {
  it('exposes QUEUE_NAME on class', () => {
    expect(UserContextQueue.QUEUE_NAME).toBe(QUEUE_NAME);
    expect(QUEUE_NAME).toBe('user-context-queue');
  });

  it('addRegenJob dedups per user via jobId', async () => {
    const queue = new UserContextQueue();
    await queue.addRegenJob({ userId: 'u1', reason: 'profile_regen' });
    expect(mockAdd).toHaveBeenCalledWith(
      'regenerate_contexts',
      { userId: 'u1', reason: 'profile_regen' },
      expect.objectContaining({
        jobId: 'usercontext-regen-u1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      }),
    );
  });

  it('regenerates only networks whose premise hash changed', async () => {
    const premises: ContextPremise[] = [
      { id: 'p1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), assertion: { text: 'hello' } },
    ];
    const currentHash = computePremiseHash(premises);

    const generateContext = mock(async () => ({ text: 'ctx', embedding: [0.1] }));
    const upsertUserContext = mock(async () => ({ id: 'ctx-1' }));
    const generateContextHyde = mock(async () => {});

    const deps: UserContextQueueDeps = {
      getUserNetworkIds: async () => ['netA', 'netB'],
      getActivePremises: async () => premises,
      // netA already has the current hash → short-circuit; netB is stale → regenerate
      getExistingContext: async (_userId, networkId) =>
        networkId === 'netA' ? { premiseHash: currentHash } : null,
      getNetwork: async (networkId) => ({ title: networkId, prompt: null }),
      generateContext,
      upsertUserContext,
      generateContextHyde,
    };

    const queue = new UserContextQueue(deps);
    await queue.processJob('regenerate_contexts', { userId: 'u1', reason: 'profile_regen' });

    expect(generateContext).toHaveBeenCalledTimes(1);
    expect(upsertUserContext).toHaveBeenCalledTimes(1);
    expect(upsertUserContext).toHaveBeenCalledWith(
      expect.objectContaining({ networkId: 'netB', premiseHash: currentHash }),
    );
    expect(generateContextHyde).toHaveBeenCalledTimes(1);
    expect(generateContextHyde).toHaveBeenCalledWith({ contextId: 'ctx-1', sourceText: 'ctx' });
  });

  it('no-ops when the user has no networks or no premises', async () => {
    const generateContext = mock(async () => ({ text: 'ctx', embedding: [0.1] }));
    const queue = new UserContextQueue({
      getUserNetworkIds: async () => [],
      getActivePremises: async () => [{ id: 'p1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), assertion: { text: 'hi' } }],
      generateContext,
    });
    await queue.processJob('regenerate_contexts', { userId: 'u1', reason: 'enrichment_complete' });
    expect(generateContext).not.toHaveBeenCalled();
  });
});
