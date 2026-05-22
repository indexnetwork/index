/**
 * Unit tests for ProfileQueue. Use injected deps to avoid Redis/DB; QueueFactory is mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it, afterAll } from 'bun:test';
import { mock } from 'bun:test';

const mockAdd = mock(async (name: string, data: unknown) => ({ id: 'job-1', name, data }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

afterAll(() => {
  mock.restore();
});

import {
  ProfileQueue,
  QUEUE_NAME,
} from '../profile.queue';

describe('ProfileQueue', () => {
  describe('addEnsureProfileHydeJob', () => {
    it('returns a job with name ensure_profile_hyde and data { userId: "u1" }', async () => {
      const queue = new ProfileQueue();
      const job = await queue.addEnsureProfileHydeJob({ userId: 'u1' });
      expect(job.name).toBe('ensure_profile_hyde');
      expect(job.data).toEqual({ userId: 'u1' });
      expect(mockAdd).toHaveBeenCalledWith('ensure_profile_hyde', { userId: 'u1' }, expect.any(Object));
    });
  });

  describe('addEnrichUserJob', () => {
    it('returns a job with name profile.enrich and data { userId: "g1" }', async () => {
      const queue = new ProfileQueue();
      const job = await queue.addEnrichUserJob({ userId: 'g1' });
      expect(job.name).toBe('profile.enrich');
      expect(job.data).toEqual({ userId: 'g1' });
      expect(mockAdd).toHaveBeenCalledWith('profile.enrich', { userId: 'g1' }, expect.any(Object));
    });
  });

  describe('processJob', () => {
    it('ensure_profile_hyde invokes profile-write handler with userId', async () => {
      const invokeProfileWrite = mock(async (_userId: string) => {});
      const queue = new ProfileQueue({ invokeProfileWrite });
      await queue.processJob('ensure_profile_hyde', { userId: 'u1' });
      expect(invokeProfileWrite).toHaveBeenCalledWith('u1');
      expect(invokeProfileWrite).toHaveBeenCalledTimes(1);
    });

    it('profile.enrich invokes enrich-user handler with userId', async () => {
      const invokeEnrichUser = mock(async (_userId: string) => {});
      const queue = new ProfileQueue({ invokeEnrichUser });
      await queue.processJob('profile.enrich', { userId: 'g1' });
      expect(invokeEnrichUser).toHaveBeenCalledWith('g1');
      expect(invokeEnrichUser).toHaveBeenCalledTimes(1);
    });

    it('unknown job name logs warning and does not throw', async () => {
      const queue = new ProfileQueue();
      await expect(queue.processJob('unknown_job', { userId: 'u1' })).resolves.toBeUndefined();
    });
  });

  describe('startWorker', () => {
    it('is idempotent: second call does not create another worker', () => {
      const queue = new ProfileQueue();
      queue.startWorker();
      queue.startWorker();
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });
  });

  describe('onEnrichmentComplete callback', () => {
    it('fires with userId after successful enrichment', async () => {
      const onComplete = mock((_userId: string) => {});
      const invokeEnrichUser = mock(async (_userId: string) => {});
      const queue = new ProfileQueue({ invokeEnrichUser });
      queue.onEnrichmentComplete = onComplete;
      await queue.processJob('profile.enrich', { userId: 'u1' });
      expect(onComplete).toHaveBeenCalledWith('u1');
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('does not fire when enrichment fails', async () => {
      const onComplete = mock((_userId: string) => {});
      const invokeEnrichUser = mock(async () => { throw new Error('enrichment failed'); });
      const queue = new ProfileQueue({ invokeEnrichUser });
      queue.onEnrichmentComplete = onComplete;
      try {
        await queue.processJob('profile.enrich', { userId: 'u1' });
      } catch {
        // expected
      }
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('does not fire for ensure_profile_hyde jobs', async () => {
      const onComplete = mock((_userId: string) => {});
      const invokeProfileWrite = mock(async (_userId: string) => {});
      const queue = new ProfileQueue({ invokeProfileWrite });
      queue.onEnrichmentComplete = onComplete;
      await queue.processJob('ensure_profile_hyde', { userId: 'u1' });
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('is null by default (no-op)', async () => {
      const invokeEnrichUser = mock(async (_userId: string) => {});
      const queue = new ProfileQueue({ invokeEnrichUser });
      expect(queue.onEnrichmentComplete).toBeNull();
      await queue.processJob('profile.enrich', { userId: 'u1' });
    });
  });

  describe('static', () => {
    it('exposes QUEUE_NAME on class', () => {
      expect(ProfileQueue.QUEUE_NAME).toBe(QUEUE_NAME);
      expect(QUEUE_NAME).toBe('profile-hyde-queue');
    });
  });
});
