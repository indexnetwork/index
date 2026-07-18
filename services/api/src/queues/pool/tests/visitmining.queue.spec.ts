/**
 * IND-439 visibility-audit slice — visit-triggered pool mining.
 *
 * Hermetic unit tests with a mocked QueueFactory (no Redis/DB):
 * - flag-off (default) is a strict no-op: nothing is ever enqueued
 * - the trigger requires BOTH POOL_QUESTIONS_VISIT_TRIGGER=on and
 *   POOL_QUESTIONS_MODE=on, and no live pending pool_discovery question
 * - the debounce is one BullMQ deduplication id per caller+intent with the
 *   6h ttl
 * - the worker enforces ownership + active-lifecycle admission and re-checks
 *   flags before invoking the shared mining hook with source 'intent_visit'
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';

const mockAdd = mock(async (..._args: unknown[]) => ({ id: 'job-1' }));
const mockCreateQueue = mock(() => ({ add: mockAdd, close: async () => {} }));
const mockCreateWorker = mock(() => ({ close: async () => {} }));

mock.module('../../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: mockCreateQueue,
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

afterAll(() => {
  mock.restore();
});

import { POOL_VISIT_MINING_DEBOUNCE_MS } from '@indexnetwork/protocol';

import { POOL_VISIT_MINING_QUEUE_NAME, PoolVisitMiningQueue, maybeEnqueueVisitPoolMining, poolVisitMiningDeduplicationId, type PoolVisitMiningJobData } from '../visitmining.queue';
import type { PoolMiningTrigger } from '../mining.shared';

const savedVisitTrigger = process.env.POOL_QUESTIONS_VISIT_TRIGGER;
const savedMode = process.env.POOL_QUESTIONS_MODE;

afterEach(() => {
  if (savedVisitTrigger === undefined) delete process.env.POOL_QUESTIONS_VISIT_TRIGGER;
  else process.env.POOL_QUESTIONS_VISIT_TRIGGER = savedVisitTrigger;
  if (savedMode === undefined) delete process.env.POOL_QUESTIONS_MODE;
  else process.env.POOL_QUESTIONS_MODE = savedMode;
  mockAdd.mockClear();
});

/** Await the fire-and-forget enqueue microtask chain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function collectEnqueues(): Array<PoolVisitMiningJobData> {
  const calls: Array<PoolVisitMiningJobData> = [];
  return calls;
}

describe('maybeEnqueueVisitPoolMining gating', () => {
  it('is a strict no-op when the flag is unset (default off)', async () => {
    delete process.env.POOL_QUESTIONS_VISIT_TRIGGER;
    process.env.POOL_QUESTIONS_MODE = 'on';
    const calls = collectEnqueues();
    maybeEnqueueVisitPoolMining(
      { userId: 'u1', intentId: 'i1', hasLivePoolQuestion: false },
      { addVisitJob: async (data) => { calls.push(data); } },
    );
    await settle();
    expect(calls).toEqual([]);
  });

  it('is a no-op when POOL_QUESTIONS_MODE is off, even with the trigger on', async () => {
    process.env.POOL_QUESTIONS_VISIT_TRIGGER = 'on';
    delete process.env.POOL_QUESTIONS_MODE;
    const calls = collectEnqueues();
    maybeEnqueueVisitPoolMining(
      { userId: 'u1', intentId: 'i1', hasLivePoolQuestion: false },
      { addVisitJob: async (data) => { calls.push(data); } },
    );
    await settle();
    expect(calls).toEqual([]);
  });

  it('is a no-op when a live pending pool_discovery question exists', async () => {
    process.env.POOL_QUESTIONS_VISIT_TRIGGER = 'on';
    process.env.POOL_QUESTIONS_MODE = 'on';
    const calls = collectEnqueues();
    maybeEnqueueVisitPoolMining(
      { userId: 'u1', intentId: 'i1', hasLivePoolQuestion: true },
      { addVisitJob: async (data) => { calls.push(data); } },
    );
    await settle();
    expect(calls).toEqual([]);
  });

  it('enqueues once when both flags are on and no live pool question exists', async () => {
    process.env.POOL_QUESTIONS_VISIT_TRIGGER = 'on';
    process.env.POOL_QUESTIONS_MODE = 'on';
    const calls = collectEnqueues();
    maybeEnqueueVisitPoolMining(
      { userId: 'u1', intentId: 'i1', hasLivePoolQuestion: false },
      { addVisitJob: async (data) => { calls.push(data); } },
    );
    await settle();
    expect(calls).toEqual([{ userId: 'u1', intentId: 'i1' }]);
  });

  it('swallows enqueue failures (a Redis hiccup must not fail the fetch)', async () => {
    process.env.POOL_QUESTIONS_VISIT_TRIGGER = 'on';
    process.env.POOL_QUESTIONS_MODE = 'on';
    maybeEnqueueVisitPoolMining(
      { userId: 'u1', intentId: 'i1', hasLivePoolQuestion: false },
      { addVisitJob: async () => { throw new Error('redis down'); } },
    );
    await settle(); // Would surface as an unhandled rejection if not caught.
  });
});

describe('PoolVisitMiningQueue.addVisitJob debounce', () => {
  it('uses one deterministic deduplication id per caller+intent with the 6h ttl', async () => {
    const queue = new PoolVisitMiningQueue();
    await queue.addVisitJob({ userId: 'u1', intentId: 'i1' });
    expect(mockAdd).toHaveBeenCalledWith(
      'mine_pool_on_visit',
      { userId: 'u1', intentId: 'i1' },
      expect.objectContaining({
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
        deduplication: {
          id: poolVisitMiningDeduplicationId('u1', 'i1'),
          ttl: POOL_VISIT_MINING_DEBOUNCE_MS,
        },
      }),
    );
    expect(poolVisitMiningDeduplicationId('u1', 'i1')).toBe('pool-visit-mine-u1-i1');
    expect(poolVisitMiningDeduplicationId('u1', 'i1')).not.toContain(':');
    expect(POOL_VISIT_MINING_DEBOUNCE_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('exposes the queue name on the class', () => {
    expect(PoolVisitMiningQueue.QUEUE_NAME).toBe(POOL_VISIT_MINING_QUEUE_NAME);
    expect(POOL_VISIT_MINING_QUEUE_NAME).toBe('pool-visit-mining-queue');
  });
});

type IntentRow = NonNullable<Awaited<ReturnType<typeof import('../../../adapters/database.adapter').chatDatabaseAdapter.getIntent>>>;

function intentRow(overrides?: Partial<IntentRow>): IntentRow {
  return {
    id: 'i1',
    payload: 'Find a cofounder',
    summary: null,
    isIncognito: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 'u1',
    archivedAt: null,
    embedding: null,
    sourceType: null,
    sourceId: null,
    status: 'ACTIVE',
    ...overrides,
  } as IntentRow;
}

describe('PoolVisitMiningQueue.processJob', () => {
  const job: PoolVisitMiningJobData = { userId: 'u1', intentId: 'i1' };

  function build(intent: IntentRow | null) {
    const mined: PoolMiningTrigger[] = [];
    const queue = new PoolVisitMiningQueue({
      mine: async (trigger) => { mined.push(trigger); },
      database: { getIntent: async () => intent },
    });
    return { queue, mined };
  }

  it('re-checks flags at processing time (flags flipped off after enqueue)', async () => {
    delete process.env.POOL_QUESTIONS_VISIT_TRIGGER;
    process.env.POOL_QUESTIONS_MODE = 'on';
    const { queue, mined } = build(intentRow());
    await queue.processJob(job);
    expect(mined).toEqual([]);
  });

  it('skips when the caller is not the intent owner', async () => {
    process.env.POOL_QUESTIONS_VISIT_TRIGGER = 'on';
    process.env.POOL_QUESTIONS_MODE = 'on';
    const { queue, mined } = build(intentRow({ userId: 'someone-else' }));
    await queue.processJob(job);
    expect(mined).toEqual([]);
  });

  it('skips archived and non-active intents (mirrors discovery admission)', async () => {
    process.env.POOL_QUESTIONS_VISIT_TRIGGER = 'on';
    process.env.POOL_QUESTIONS_MODE = 'on';
    for (const intent of [
      intentRow({ archivedAt: new Date() }),
      intentRow({ status: 'PAUSED' as IntentRow['status'] }),
      null,
    ]) {
      const { queue, mined } = build(intent);
      await queue.processJob(job);
      expect(mined).toEqual([]);
    }
  });

  it("mines with source 'intent_visit' for the owner's active intent", async () => {
    process.env.POOL_QUESTIONS_VISIT_TRIGGER = 'on';
    process.env.POOL_QUESTIONS_MODE = 'on';
    const { queue, mined } = build(intentRow());
    await queue.processJob(job);
    expect(mined).toEqual([{ source: 'intent_visit', userId: 'u1', intentId: 'i1' }]);
  });
});
