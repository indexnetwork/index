/**
 * Unit tests for IntentQueue. Use injected deps to avoid Redis/DB; QueueFactory is mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it, mock } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'generate_hyde', data: {} }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));
mock.module('../opportunity/from-intent.queue', () => ({
  fromIntentQueue: { addJob: async () => ({ id: '1' }) },
}));

import {
  IntentQueue,
  QUEUE_NAME,
  type IntentJobPayload,
  type IntentQueueDatabase,
} from '../intent.queue';

/** Cast a plain object to IntentQueueDatabase for tests (avoids satisfying full adapter type). */
const asIntentDb = (db: unknown): IntentQueueDatabase => db as IntentQueueDatabase;

describe('IntentQueue', () => {
  describe('constructor and static', () => {
    it('exposes QUEUE_NAME on class', () => {
      expect(IntentQueue.QUEUE_NAME).toBe(QUEUE_NAME);
      expect(QUEUE_NAME).toBe('intent-hyde-queue');
    });

    it('creates queue via QueueFactory when no deps', () => {
      const q = new IntentQueue();
      expect(q.queue).toBeDefined();
      expect(typeof (q.queue as { add: unknown }).add).toBe('function');
    });

    it('uses provided database when deps given', async () => {
      const getIntentForIndexing = mock(async () => null as unknown as Awaited<ReturnType<IntentQueueDatabase['getIntentForIndexing']>>);
      const db = {
        getIntentForIndexing,
        getUserIndexIds: async () => [] as string[],
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentQueue({ database: asIntentDb(db) });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(getIntentForIndexing).toHaveBeenCalledWith('i1');
    });
  });

  describe('addJob / addGenerateHydeJob / addDeleteHydeJob', () => {
    it('addJob adds to queue with name and data', async () => {
      const queue = new IntentQueue();
      const job = await queue.addJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(job.id).toBe('job-1');
      expect(mockAdd).toHaveBeenCalledWith('generate_hyde', { intentId: 'i1', userId: 'u1' }, expect.any(Object));
    });

    it('addJob supports options', async () => {
      const queue = new IntentQueue();
      await queue.addJob('delete_hyde', { intentId: 'i2' }, { jobId: 'custom', priority: 1 });
      expect(mockAdd).toHaveBeenCalledWith('delete_hyde', { intentId: 'i2' }, expect.objectContaining({ jobId: 'custom', priority: 1 }));
    });

    it('addGenerateHydeJob delegates to addJob', async () => {
      const queue = new IntentQueue();
      const job = await queue.addGenerateHydeJob({ intentId: 'i1', userId: 'u1' });
      expect(job.id).toBe('job-1');
      expect(mockAdd).toHaveBeenCalledWith('generate_hyde', { intentId: 'i1', userId: 'u1' }, expect.any(Object));
    });

    it('addDeleteHydeJob delegates to addJob', async () => {
      const queue = new IntentQueue();
      await queue.addDeleteHydeJob({ intentId: 'i1' });
      expect(mockAdd).toHaveBeenCalledWith('delete_hyde', { intentId: 'i1' }, expect.any(Object));
    });
  });

  describe('processJob', () => {
    it('unknown job name logs warning and does not throw', async () => {
      const queue = new IntentQueue();
      await expect(queue.processJob('unknown_job', { intentId: 'i1', userId: 'u1' })).resolves.toBeUndefined();
    });

    it('generate_hyde: intent not found skips and logs', async () => {
      const db = {
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<IntentQueueDatabase['getIntentForIndexing']>>,
        getUserIndexIds: async () => [] as string[],
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentQueue({ database: asIntentDb(db) });
      await queue.processJob('generate_hyde', { intentId: 'missing', userId: 'u1' });
      // No throw, handler exits early
    });

    it('generate_hyde: intent found, invokeHyde and addOpportunityJob called', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null }),
        getUserIndexIds: async () => ['idx1'],
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentQueue({
        database: asIntentDb(db),
        invokeHyde,
        addOpportunityJob,
      });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(invokeHyde).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceText: 'Build a SaaS',
          sourceType: 'intent',
          sourceId: 'i1',
          forceRegenerate: true,
        })
      );
      expect(addOpportunityJob).toHaveBeenCalledWith({ intentId: 'i1', userId: 'u1' });
    });

    it('generate_hyde: getUserIndexIds throws is caught and logged', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getUserIndexIds: async () => {
          throw new Error('DB error');
        },
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentQueue({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(invokeHyde).toHaveBeenCalled();
      expect(addOpportunityJob).toHaveBeenCalled();
    });

    it('generate_hyde: assignIntentToNetwork throws for one index is caught', async () => {
      let callCount = 0;
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getUserIndexIds: async () => ['idx1', 'idx2'],
        assignIntentToNetwork: async () => {
          callCount++;
          if (callCount === 1) throw new Error('assign failed');
        },
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentQueue({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(invokeHyde).toHaveBeenCalled();
      expect(addOpportunityJob).toHaveBeenCalled();
    });

    it('generate_hyde: addOpportunityJob reject is caught and logged', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => {
        throw new Error('opportunity queue full');
      });
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getUserIndexIds: async () => [] as string[],
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentQueue({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(invokeHyde).toHaveBeenCalled();
    });

    it('generate_hyde: networkScopeId restricts assignment to scope ∪ personal networks', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      const assignIntentToNetwork = mock(async () => {});
      const getUserPersonalNetworkIds = mock(async () => ['personal-net']);
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getUserIndexIds: async () => ['scope-net', 'personal-net', 'other-net'],
        getUserPersonalNetworkIds,
        getNetworkMemberContext: async () => ({ indexPrompt: null, memberPrompt: null }),
        assignIntentToNetwork,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentQueue({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1', networkScopeId: 'scope-net' });

      expect(getUserPersonalNetworkIds).toHaveBeenCalledWith('u1');
      const assignedNetworkIds = assignIntentToNetwork.mock.calls.map((c) => c[1]);
      expect(assignedNetworkIds.sort()).toEqual(['personal-net', 'scope-net']);
      expect(assignedNetworkIds).not.toContain('other-net');
      expect(invokeHyde).toHaveBeenCalled();
      expect(addOpportunityJob).toHaveBeenCalledWith({ intentId: 'i1', userId: 'u1' });
    });

    it('generate_hyde: no networkScopeId leaves all user index IDs eligible', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      const assignIntentToNetwork = mock(async () => {});
      const getUserPersonalNetworkIds = mock(async () => ['personal-net']);
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getUserIndexIds: async () => ['scope-net', 'personal-net', 'other-net'],
        getUserPersonalNetworkIds,
        getNetworkMemberContext: async () => ({ indexPrompt: null, memberPrompt: null }),
        assignIntentToNetwork,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentQueue({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });

      expect(getUserPersonalNetworkIds).not.toHaveBeenCalled();
      const assignedNetworkIds = assignIntentToNetwork.mock.calls.map((c) => c[1]);
      expect(assignedNetworkIds.sort()).toEqual(['other-net', 'personal-net', 'scope-net']);
    });

    it('delete_hyde: calls deleteHydeDocumentsForSource', async () => {
      const deleteHydeDocumentsForSource = mock(async () => 0);
      const db = {
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<IntentQueueDatabase['getIntentForIndexing']>>,
        getUserIndexIds: async () => [] as string[],
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource,
      };
      const queue = new IntentQueue({ database: asIntentDb(db) });
      await queue.processJob('delete_hyde', { intentId: 'i1' });
      expect(deleteHydeDocumentsForSource).toHaveBeenCalledWith('intent', 'i1');
    });
  });

  describe('startWorker', () => {
    it('is idempotent: second call does not create another worker', () => {
      const queue = new IntentQueue();
      queue.startWorker();
      queue.startWorker();
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });

    it('processor invokes processJob when worker runs a job', async () => {
      let capturedProcessor: ((job: { id: string; name: string; data: IntentJobPayload }) => Promise<void>) | null = null;
      (mockCreateWorker as import('bun:test').Mock<(name: string, processor: (job: unknown) => Promise<void>) => unknown>).mockImplementation(
        (_name: string, processor: (job: unknown) => Promise<void>) => {
          capturedProcessor = processor as (job: { id: string; name: string; data: IntentJobPayload }) => Promise<void>;
          return {};
        }
      );
      const deleteHydeDocumentsForSource = mock(async () => 0);
      const db = {
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<IntentQueueDatabase['getIntentForIndexing']>>,
        getUserIndexIds: async () => [] as string[],
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource,
      };
      const queue = new IntentQueue({ database: asIntentDb(db) });
      queue.startWorker();
      expect(capturedProcessor).not.toBeNull();
      await capturedProcessor!({
        id: 'job-1',
        name: 'delete_hyde',
        data: { intentId: 'i1' },
      });
      expect(deleteHydeDocumentsForSource).toHaveBeenCalledWith('intent', 'i1');
    });
  });
});
