/**
 * Unit tests for queue adapter: wrapQueue, createQueueAdapter, create*QueueAdapter.
 * Uses in-memory mocks; no Redis required.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it, mock } from 'bun:test';
import type { Job } from 'bullmq';
import {
  createQueueAdapter,
  wrapQueue,
  createIntentQueueAdapter,
  createOpportunityQueueAdapter,
  createProfileQueueAdapter,
  createNewsletterQueueAdapter,
  type NewsletterJobDataUnion,
} from '../queue.adapter';

describe('QueueAdapter', () => {
  describe('createQueueAdapter', () => {
    it('should return adapter with provided deps', () => {
      const intent = { addJob: mock(async () => ({ id: 'i1' })) };
      const newsletter = { addJob: mock(async () => ({ id: 'n1' })) };
      const opportunity = { addJob: mock(async () => ({ id: 'o1' })) };
      const profile = { addJob: mock(async () => ({ id: 'p1' })) };

      const adapter = createQueueAdapter({
        intent: intent as any,
        newsletter: newsletter as any,
        opportunity: opportunity as any,
        profile: profile as any,
      });

      expect(adapter.intent).toBe(intent);
      expect(adapter.newsletter).toBe(newsletter);
      expect(adapter.opportunity).toBe(opportunity);
      expect(adapter.profile).toBe(profile);
    });
  });

  describe('wrapQueue', () => {
    it('should expose addJob that calls queue.add and returns { id }', async () => {
      const jobId = 'job-' + Date.now();
      const addMock = mock(async (_name: string, _data: unknown, _opts?: unknown) =>
        ({ id: jobId } as Job)
      );
      const queue = { add: addMock } as any;

      const wrapped = wrapQueue(queue);
      const result = await wrapped.addJob('test_job', { foo: 'bar' });

      expect(result).toEqual({ id: jobId });
      expect(addMock).toHaveBeenCalledTimes(1);
      expect(addMock).toHaveBeenCalledWith('test_job', { foo: 'bar' }, {});
    });

    it('should pass priority when addJob is called with priority > 0', async () => {
      const addMock = mock(async () => ({ id: 'x' } as Job));
      const queue = { add: addMock } as any;

      const wrapped = wrapQueue(queue);
      await wrapped.addJob('p_job', { x: 1 }, 5);

      expect(addMock).toHaveBeenCalledWith('p_job', { x: 1 }, { priority: 5 });
    });

    it('should not pass priority when addJob is called with 0 or undefined', async () => {
      const addMock = mock(async () => ({ id: 'x' } as Job));
      const queue = { add: addMock } as any;

      const wrapped = wrapQueue(queue);
      await wrapped.addJob('a', {}, 0);
      expect(addMock).toHaveBeenCalledWith('a', {}, {});

      addMock.mockClear();
      await wrapped.addJob('b', {});
      expect(addMock).toHaveBeenCalledWith('b', {}, {});
    });

    it('should merge getOptions into job options when provided', async () => {
      const addMock = mock(async () => ({ id: 'y' } as Job));
      const queue = { add: addMock } as any;
      const getOptions = mock((name: string, data: unknown) => ({
        jobId: `custom-${name}-${(data as any).id}`,
      }));

      const wrapped = wrapQueue(queue, getOptions);
      await wrapped.addJob('named', { id: '123' }, 1);

      expect(addMock).toHaveBeenCalledWith('named', { id: '123' }, {
        priority: 1,
        jobId: 'custom-named-123',
      });
    });
  });

  describe('createIntentQueueAdapter', () => {
    it('should return addJob for index_intent and generate_intents', async () => {
      const addMock = mock(async () => ({ id: 'intent-job' } as Job));
      const queue = { add: addMock } as any;
      const adapter = createIntentQueueAdapter(queue as any);

      const r1 = await adapter.addJob('index_intent', {
        intentId: 'i1',
        networkId: 'idx1',
        userId: 'u1',
      });
      expect(r1).toEqual({ id: 'intent-job' });
      expect(addMock).toHaveBeenCalledWith(
        'index_intent',
        { intentId: 'i1', networkId: 'idx1', userId: 'u1' },
        expect.any(Object)
      );

      addMock.mockClear();
      const r2 = await adapter.addJob('generate_intents', {
        userId: 'u2',
        sourceId: 's1',
        sourceType: 'file',
      });
      expect(r2).toEqual({ id: 'intent-job' });
      expect(addMock).toHaveBeenCalledWith(
        'generate_intents',
        { userId: 'u2', sourceId: 's1', sourceType: 'file' },
        expect.any(Object)
      );
    });
  });

  describe('createOpportunityQueueAdapter', () => {
    it('should add opportunity job and return id', async () => {
      const addMock = mock(async () => ({ id: 'opp-job' } as Job));
      const adapter = createOpportunityQueueAdapter({ add: addMock } as any);

      const result = await adapter.addJob('run_opportunity', { timestamp: 123, userId: 'u1' });
      expect(result).toEqual({ id: 'opp-job' });
      expect(addMock).toHaveBeenCalledWith('run_opportunity', { timestamp: 123, userId: 'u1' }, expect.any(Object));
    });
  });

  describe('createProfileQueueAdapter', () => {
    it('should add profile job and return id', async () => {
      const addMock = mock(async () => ({ id: 'profile-job' } as Job));
      const adapter = createProfileQueueAdapter({ add: addMock } as any);

      const result = await adapter.addJob('update_profile', {
        userId: 'u1',
        intro: 'Hello',
        userName: 'Alice',
      });
      expect(result).toEqual({ id: 'profile-job' });
      expect(addMock).toHaveBeenCalledWith(
        'update_profile',
        { userId: 'u1', intro: 'Hello', userName: 'Alice' },
        expect.any(Object)
      );
    });
  });

  describe('createNewsletterQueueAdapter', () => {
    it('should add newsletter job with optional getOptions', async () => {
      const addMock = mock(async () => ({ id: 'news-job' } as Job));
      const getOptions = mock((name: string, _data: NewsletterJobDataUnion) =>
        name === 'process_newsletter' ? { removeOnComplete: true } : undefined
      );
      const adapter = createNewsletterQueueAdapter(
        { add: addMock } as any,
        getOptions
      );

      await adapter.addJob('process_newsletter', {
        recipientId: 'r1',
        candidates: [{ userId: 'u1', userName: 'U1', stakeId: 's1' }],
      });
      expect(addMock).toHaveBeenCalledWith(
        'process_newsletter',
        expect.objectContaining({ recipientId: 'r1' }),
        expect.objectContaining({ removeOnComplete: true })
      );
    });
  });
});
