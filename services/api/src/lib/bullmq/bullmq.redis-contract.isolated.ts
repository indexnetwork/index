import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Queue, QueueEvents, Worker } from 'bullmq';

import { resolveRedisIntegrationTestUrl } from '../redis/test-integration';
import { QueueFactory } from './bullmq';

const redisUrl = resolveRedisIntegrationTestUrl();
const describeRedis = redisUrl ? describe : describe.skip;
const queueName = `bullmq-contract-${crypto.randomUUID()}`;
let queue: Queue<{ value: number }>;
let worker: Worker<{ value: number }>;
let events: QueueEvents;

describeRedis('QueueFactory real Redis contract', () => {
  beforeAll(() => {
    queue = QueueFactory.createQueue(queueName, {
      defaultJobOptions: { attempts: 1, removeOnComplete: false, removeOnFail: false },
    });
    events = QueueFactory.createQueueEvents(queueName);
  });

  afterAll(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true });
    await events?.close();
    await queue?.close();
  });

  it('suppresses duplicate custom IDs and reports delayed state', async () => {
    const first = await queue.add('duplicate', { value: 1 }, { jobId: 'stable-id' });
    const second = await queue.add('duplicate', { value: 2 }, { jobId: 'stable-id' });
    const delayed = await queue.add('delayed', { value: 3 }, { delay: 60_000 });

    expect(second.id).toBe(first.id);
    expect((await queue.getJob('stable-id'))?.data).toEqual({ value: 1 });
    expect(await delayed.getState()).toBe('delayed');
    await delayed.remove();
  });

  it('executes workers and resolves waitUntilFinished', async () => {
    worker = QueueFactory.createWorker(queueName, async (job) => job.data, {
      concurrency: 2,
    });
    const job = await queue.add('work', { value: 42 });

    await expect(job.waitUntilFinished(events, 10_000)).resolves.toEqual({ value: 42 });
  });
});
