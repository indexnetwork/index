import { describe, expect, it, mock } from 'bun:test';

import { QueueFactory } from './bullmq';

function queueName(suffix: string): string {
  return `test-${suffix}-${crypto.randomUUID()}`;
}

describe('QueueFactory test isolation', () => {
  it('suppresses duplicate custom IDs without overwriting the first job', async () => {
    const name = queueName('duplicate');
    const queue = QueueFactory.createQueue<{ value: number }>(name);
    const events = QueueFactory.createQueueEvents(name);
    const duplicated = mock(() => undefined);
    events.on('duplicated', duplicated);

    const first = await queue.add('work', { value: 1 }, { jobId: 'job-1' });
    const second = await queue.add('work', { value: 2 }, { jobId: 'job-1' });

    expect(second.id).toBe(first.id);
    expect((await queue.getJob('job-1'))?.data).toEqual({ value: 1 });
    expect(duplicated).toHaveBeenCalledTimes(1);
    await first.remove();
    expect(await queue.getJob('job-1')).toBeNull();
    await events.close();
    await queue.close();
  });

  it('models delayed and prioritized states', async () => {
    const queue = QueueFactory.createQueue(queueName('states'));
    const delayed = await queue.add('delayed', {}, { delay: 60_000 });
    const prioritized = await queue.add('priority', {}, { priority: 1 });

    expect(await delayed.getState()).toBe('delayed');
    expect(await prioritized.getState()).toBe('prioritized');
    expect(await queue.getJobCounts('delayed', 'prioritized')).toEqual({
      delayed: 1,
      prioritized: 1,
    });
    await queue.close();
  });

  it('applies factory defaults, queue overrides, and per-job options', async () => {
    const defaultQueue = QueueFactory.createQueue(queueName('defaults'));
    const defaultJob = await defaultQueue.add('work', {});
    expect(defaultJob.opts.attempts).toBe(3);
    expect(defaultJob.opts.backoff).toEqual({ type: 'exponential', delay: 1000 });

    const overrideQueue = QueueFactory.createQueue(queueName('overrides'), {
      defaultJobOptions: { attempts: 5 },
    });
    const overridden = await overrideQueue.add('work', {}, { attempts: 2 });
    expect(overridden.opts.attempts).toBe(2);

    await defaultQueue.close();
    await overrideQueue.close();
  });

  it('delivers jobs to workers and honors configured concurrency', async () => {
    const name = queueName('worker');
    const queue = QueueFactory.createQueue(name, {
      defaultJobOptions: { attempts: 1 },
    });
    const events = QueueFactory.createQueueEvents(name);
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const worker = QueueFactory.createWorker(
      name,
      async (job) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return job.data;
      },
      { concurrency: 2 },
    );

    const first = await queue.add('work', { value: 1 });
    const second = await queue.add('work', { value: 2 });
    for (let index = 0; index < 50 && releases.length < 2; index += 1) {
      await Bun.sleep(2);
    }
    expect(releases).toHaveLength(2);
    expect(maximumActive).toBe(2);
    for (const release of releases) release();

    await expect(first.waitUntilFinished(events, 1_000)).resolves.toEqual({ value: 1 });
    await expect(second.waitUntilFinished(events, 1_000)).resolves.toEqual({ value: 2 });
    expect(await first.getState()).toBe('completed');

    await worker.close();
    await events.close();
    await queue.close();
  });

  it('stores schedulers with the flattened BullMQ JobSchedulerJson shape', async () => {
    const queue = QueueFactory.createQueue(queueName('scheduler'));
    await queue.upsertJobScheduler(
      'daily-v1',
      { pattern: '15 0 * * *', tz: 'UTC' },
      {
        name: 'capture-daily',
        data: { source: 'daily-scheduler' },
        opts: { attempts: 3 },
      },
    );

    const scheduler = await queue.getJobScheduler('daily-v1');
    expect(scheduler).toMatchObject({
      key: 'daily-v1',
      name: 'capture-daily',
      pattern: '15 0 * * *',
      tz: 'UTC',
      template: {
        data: { source: 'daily-scheduler' },
        opts: { attempts: 3 },
      },
    });
    expect(Number.isFinite(scheduler?.next)).toBe(true);
    expect(scheduler).not.toHaveProperty('repeat');
    await queue.close();
  });

  it('creates queue events without opening Redis in the default test baseline', async () => {
    const events = QueueFactory.createQueueEvents(queueName('events'));
    expect(events).toBeDefined();
    await events.close();
  });
});
