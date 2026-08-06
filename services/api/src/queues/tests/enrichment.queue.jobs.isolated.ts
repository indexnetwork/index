/**
 * Unit tests for EnrichmentQueue job routing, worker, and completion callback.
 * Use injected deps to avoid Redis/DB; QueueFactory is mocked.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test';
import type { EnrichmentAdmissionDecision, EnrichmentQueueDeps } from '../enrichment.queue';

const mockAdd = mock(async (name: string, data: unknown) => ({ id: 'job-1', name, data }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

const savedEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  API_TEST_ISOLATED_CHILD: process.env.API_TEST_ISOLATED_CHILD,
  API_TEST_DATABASE_READY: process.env.API_TEST_DATABASE_READY,
  API_TEST_PARENT_PID: process.env.API_TEST_PARENT_PID,
};
process.env.DATABASE_URL ||= 'postgres://stub:stub@localhost:5432/stub';
process.env.API_TEST_ISOLATED_CHILD = '1';
process.env.API_TEST_DATABASE_READY = '1';
process.env.API_TEST_PARENT_PID = String(process.ppid);

const { EnrichmentQueue, QUEUE_NAME } = await import('../enrichment.queue.js');

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const allowAdmission = async (): Promise<EnrichmentAdmissionDecision> => ({
  allowed: true,
  reason: 'enrichment_allowed',
  hasExistingProfile: false,
});

function createQueue(deps: EnrichmentQueueDeps = {}) {
  return new EnrichmentQueue({ checkAdmission: allowAdmission, ...deps });
}

afterAll(() => {
  mock.restore();
});

describe('EnrichmentQueue', () => {
  describe('addEnsureProfileHydeJob', () => {
    it('returns a job with name ensure_profile_hyde and data { userId: "u1" }', async () => {
      const queue = createQueue();
      const job = await queue.addEnsureProfileHydeJob({ userId: 'u1' });
      expect(job.name).toBe('ensure_profile_hyde');
      expect(job.data).toEqual({ userId: 'u1' });
      expect(mockAdd).toHaveBeenCalledWith('ensure_profile_hyde', { userId: 'u1' }, expect.any(Object));
    });
  });

  describe('addEnrichUserJob', () => {
    it('returns a job with name enrich.user and data { userId: "g1" }', async () => {
      const queue = createQueue();
      const job = await queue.addEnrichUserJob({ userId: 'g1' });
      expect(job.name).toBe('enrich.user');
      expect(job.data).toEqual({ userId: 'g1' });
      expect(mockAdd).toHaveBeenCalledWith('enrich.user', { userId: 'g1' }, expect.any(Object));
    });
  });

  describe('processJob', () => {
    it('ensure_profile_hyde invokes profile-write handler with userId', async () => {
      const invokeProfileWrite = mock(async (_userId: string) => {});
      const queue = createQueue({ invokeProfileWrite });
      await queue.processJob('ensure_profile_hyde', { userId: 'u1' });
      expect(invokeProfileWrite).toHaveBeenCalledWith('u1');
      expect(invokeProfileWrite).toHaveBeenCalledTimes(1);
    });

    it('enrich.user invokes enrich-user handler with userId', async () => {
      const invokeEnrichUser = mock(async (_userId: string) => {});
      const queue = createQueue({ invokeEnrichUser });
      await queue.processJob('enrich.user', { userId: 'g1' });
      expect(invokeEnrichUser).toHaveBeenCalledWith('g1');
      expect(invokeEnrichUser).toHaveBeenCalledTimes(1);
    });

    it('unknown job name logs warning and does not throw', async () => {
      const queue = createQueue();
      await expect(queue.processJob('unknown_job', { userId: 'u1' })).resolves.toBeUndefined();
    });
  });

  describe('startWorker', () => {
    it('is idempotent: second call does not create another worker', () => {
      const queue = createQueue();
      queue.startWorker();
      queue.startWorker();
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });
  });

  describe('onEnrichmentComplete callback', () => {
    it('fires with userId after successful enrichment', async () => {
      const onComplete = mock((_userId: string) => {});
      const invokeEnrichUser = mock(async (_userId: string) => {});
      const queue = createQueue({ invokeEnrichUser });
      queue.onEnrichmentComplete = onComplete;
      await queue.processJob('enrich.user', { userId: 'u1' });
      expect(onComplete).toHaveBeenCalledWith('u1');
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('does not fire when enrichment fails', async () => {
      const onComplete = mock((_userId: string) => {});
      const invokeEnrichUser = mock(async () => { throw new Error('enrichment failed'); });
      const queue = createQueue({ invokeEnrichUser });
      queue.onEnrichmentComplete = onComplete;
      try {
        await queue.processJob('enrich.user', { userId: 'u1' });
      } catch {
        // expected
      }
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('does not fire for ensure_profile_hyde jobs', async () => {
      const onComplete = mock((_userId: string) => {});
      const invokeProfileWrite = mock(async (_userId: string) => {});
      const queue = createQueue({ invokeProfileWrite });
      queue.onEnrichmentComplete = onComplete;
      await queue.processJob('ensure_profile_hyde', { userId: 'u1' });
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('is null by default (no-op)', async () => {
      const invokeEnrichUser = mock(async (_userId: string) => {});
      const queue = createQueue({ invokeEnrichUser });
      expect(queue.onEnrichmentComplete).toBeNull();
      await queue.processJob('enrich.user', { userId: 'u1' });
    });
  });

  describe('static', () => {
    it('exposes QUEUE_NAME on class', () => {
      expect(EnrichmentQueue.QUEUE_NAME).toBe(QUEUE_NAME);
      expect(QUEUE_NAME).toBe('profile-hyde-queue');
    });
  });
});
