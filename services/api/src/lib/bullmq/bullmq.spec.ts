import { describe, expect, it } from 'bun:test';

import { QueueFactory } from './bullmq';

describe('QueueFactory test isolation', () => {
  it('creates a hermetic queue with stable job ids', async () => {
    const queue = QueueFactory.createQueue<{ value: number }>('test-queue');
    const job = await queue.add('work', { value: 1 }, { jobId: 'job-1' });

    expect(job.id).toBe('job-1');
    expect((await queue.getJob('job-1'))?.data).toEqual({ value: 1 });
    await job.remove();
    expect(await queue.getJob('job-1')).toBeNull();
    await queue.close();
  });

  it('creates a worker without opening Redis in the default test baseline', async () => {
    const worker = QueueFactory.createWorker('test-queue', async () => undefined);
    expect(worker).toBeDefined();
    await worker.close();
  });

  it('creates queue events without opening Redis in the default test baseline', async () => {
    const events = QueueFactory.createQueueEvents('test-queue');
    expect(events).toBeDefined();
    await events.close();
  });
});
