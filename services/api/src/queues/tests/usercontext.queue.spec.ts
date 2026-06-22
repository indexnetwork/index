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

import { UserContextQueue, QUEUE_NAME, computePremiseHash, type ContextPremise, type UserContextQueueDeps } from '../usercontext.queue';

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
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
  });

  it('regenerates the global row plus only networks whose premise hash changed', async () => {
    const premises: ContextPremise[] = [
      { id: 'p1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), assertion: { text: 'hello' } },
    ];
    const currentHash = computePremiseHash(premises);

    const generateContext = mock(async () => ({ text: 'ctx', embedding: [0.1] }));
    const generateGlobalContext = mock(async () => ({ text: 'global-ctx', embedding: [0.2] }));
    const upsertUserContext = mock(async () => ({ id: 'ctx-1' }));
    const generateContextHyde = mock(async () => {});

    const deps: UserContextQueueDeps = {
      getUserNetworkIds: async () => ['netA', 'netB'],
      getActivePremises: async () => premises,
      // global (null) is stale → regenerate; netA already has the current hash →
      // short-circuit; netB is stale → regenerate
      getExistingContext: async (_userId, networkId) =>
        networkId === 'netA' ? { premiseHash: currentHash } : null,
      getNetwork: async (networkId) => ({ title: networkId, prompt: null }),
      generateContext,
      generateGlobalContext,
      upsertUserContext,
      generateContextHyde,
    };

    const queue = new UserContextQueue(deps);
    await queue.processJob('regenerate_contexts', { userId: 'u1', reason: 'profile_regen' });

    // Global row regenerated once (network-agnostic generator).
    expect(generateGlobalContext).toHaveBeenCalledTimes(1);
    // Per-network synthesis runs only for the stale netB (netA short-circuits).
    expect(generateContext).toHaveBeenCalledTimes(1);
    // Two upserts: the global row and netB.
    expect(upsertUserContext).toHaveBeenCalledTimes(2);
    expect(upsertUserContext).toHaveBeenCalledWith(
      expect.objectContaining({ networkId: null, premiseHash: currentHash }),
    );
    expect(upsertUserContext).toHaveBeenCalledWith(
      expect.objectContaining({ networkId: 'netB', premiseHash: currentHash }),
    );
    expect(generateContextHyde).toHaveBeenCalledTimes(2);
  });

  it('rolls back the premiseHash and fails the job when HyDE generation fails', async () => {
    const premises: ContextPremise[] = [
      { id: 'p1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), assertion: { text: 'hello' } },
    ];
    const currentHash = computePremiseHash(premises);

    const upsertUserContext = mock(async () => ({ id: 'ctx-1' }));
    const generateContextHyde = mock(async () => {
      throw new Error('hyde boom');
    });

    // Zero networks: only the global row runs, exercising the shared rollback path.
    const deps: UserContextQueueDeps = {
      getUserNetworkIds: async () => [],
      getActivePremises: async () => premises,
      getExistingContext: async () => null,
      generateGlobalContext: async () => ({ text: 'global-ctx', embedding: [0.2] }),
      upsertUserContext,
      generateContextHyde,
    };

    const queue = new UserContextQueue(deps);

    // The job must fail so BullMQ retries.
    await expect(
      queue.processJob('regenerate_contexts', { userId: 'u1', reason: 'profile_regen' }),
    ).rejects.toThrow(/regeneration failed/);

    // First upsert commits the fresh hash; second rolls it back to '' so the retry
    // won't short-circuit the global row as already-fresh while its HyDE is stale.
    expect(upsertUserContext).toHaveBeenCalledTimes(2);
    expect(upsertUserContext).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ networkId: null, premiseHash: currentHash }),
    );
    expect(upsertUserContext).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ networkId: null, premiseHash: '' }),
    );
  });

  it('generates the global row even when the user belongs to no networks', async () => {
    const premises: ContextPremise[] = [
      { id: 'p1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), assertion: { text: 'hi' } },
    ];
    const currentHash = computePremiseHash(premises);
    const generateContext = mock(async () => ({ text: 'ctx', embedding: [0.1] }));
    const generateGlobalContext = mock(async () => ({ text: 'global-ctx', embedding: [0.2] }));
    const upsertUserContext = mock(async () => ({ id: 'ctx-1' }));
    const generateContextHyde = mock(async () => {});

    const queue = new UserContextQueue({
      getUserNetworkIds: async () => [],
      getActivePremises: async () => premises,
      getExistingContext: async () => null,
      generateContext,
      generateGlobalContext,
      upsertUserContext,
      generateContextHyde,
    });
    await queue.processJob('regenerate_contexts', { userId: 'u1', reason: 'enrichment_complete' });

    expect(generateGlobalContext).toHaveBeenCalledTimes(1);
    expect(generateContext).not.toHaveBeenCalled();
    expect(upsertUserContext).toHaveBeenCalledTimes(1);
    expect(upsertUserContext).toHaveBeenCalledWith(
      expect.objectContaining({ networkId: null, premiseHash: currentHash }),
    );
  });

  it('no-ops when the user has no premises', async () => {
    const generateContext = mock(async () => ({ text: 'ctx', embedding: [0.1] }));
    const generateGlobalContext = mock(async () => ({ text: 'global-ctx', embedding: [0.2] }));
    const queue = new UserContextQueue({
      getUserNetworkIds: async () => [],
      getActivePremises: async () => [],
      generateContext,
      generateGlobalContext,
    });
    await queue.processJob('regenerate_contexts', { userId: 'u1', reason: 'enrichment_complete' });
    expect(generateContext).not.toHaveBeenCalled();
    expect(generateGlobalContext).not.toHaveBeenCalled();
  });
});
