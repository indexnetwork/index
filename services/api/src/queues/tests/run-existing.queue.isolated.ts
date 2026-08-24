/**
 * Unit tests for NegotiationRunExistingQueue (negotiation-graph rewrite,
 * #1494) — a stub. Its only job kind, `negotiate_existing`, drove the
 * pre-rewrite continuation-execution machinery (claim/park/release/receipt),
 * which is deleted along with `OpportunityGraphFactory.negotiateExisting`.
 * Callers still enqueue by `{ opportunityId, userId }` so the admin queues
 * board and existing call sites keep compiling; `processJob` is a no-op.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, afterAll } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'negotiate_existing', data: {} }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd, close: async () => {} }),
    createWorker: mockCreateWorker,
  },
}));

afterAll(() => {
  mock.restore();
});

import { NegotiationRunExistingQueue, QUEUE_NAME } from '../negotiations/run-existing.queue';

describe('NegotiationRunExistingQueue', () => {
  it('exposes QUEUE_NAME on class and instance', () => {
    expect(NegotiationRunExistingQueue.QUEUE_NAME).toBe(QUEUE_NAME);
    expect(QUEUE_NAME).toBe('negotiation-run-existing');
  });

  describe('addJob', () => {
    it('enqueues with job name negotiate_existing and payload preserved', async () => {
      const queue = new NegotiationRunExistingQueue();
      const job = await queue.addJob({ opportunityId: 'opp-1', userId: 'u1' });
      expect(job.id).toBe('job-1');
      expect(mockAdd).toHaveBeenCalledWith(
        'negotiate_existing',
        { opportunityId: 'opp-1', userId: 'u1' },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        }),
      );
    });
  });

  describe('processJob', () => {
    it('unknown job name logs a warning and does not throw', async () => {
      const queue = new NegotiationRunExistingQueue();
      await expect(
        queue.processJob('unknown_job', { opportunityId: 'opp-1', userId: 'u1' }),
      ).resolves.toBeUndefined();
    });

    it('negotiate_existing is a no-op stub: resolves without invoking anything', async () => {
      const queue = new NegotiationRunExistingQueue();
      await expect(
        queue.processJob('negotiate_existing', { opportunityId: 'opp-42', userId: 'u1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('setRuntimeDeps', () => {
    it('is idempotent and merges without throwing', () => {
      const queue = new NegotiationRunExistingQueue();
      queue.setRuntimeDeps({});
      queue.setRuntimeDeps({});
    });
  });

  describe('startWorker', () => {
    it('is idempotent: second call does not create another worker', () => {
      mockCreateWorker.mockClear();
      const queue = new NegotiationRunExistingQueue();
      queue.startWorker();
      queue.startWorker();
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });

    it('processor invokes processJob (the no-op stub) when the worker runs a job', async () => {
      let capturedProcessor: ((job: { id: string; name: string; data: unknown }) => Promise<void>) | null = null;
      (mockCreateWorker as import('bun:test').Mock<(n: string, p: (job: unknown) => Promise<void>) => unknown>)
        .mockImplementation((_name: string, processor: (job: unknown) => Promise<void>) => {
          capturedProcessor = processor as (job: { id: string; name: string; data: unknown }) => Promise<void>;
          return {};
        });
      const queue = new NegotiationRunExistingQueue();
      queue.startWorker();
      expect(capturedProcessor).not.toBeNull();
      await expect(capturedProcessor!({
        id: 'job-1',
        name: 'negotiate_existing',
        data: { opportunityId: 'opp-1', userId: 'u1' },
      })).resolves.toBeUndefined();
    });
  });
});
