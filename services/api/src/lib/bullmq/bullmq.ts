import { Queue, Worker, QueueEvents, Job, Processor, WorkerOptions, QueueOptions, JobsOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';

import { traceAppOperation } from '../sentry-performance';
import { log } from '../log';

const logger = log.lib.from("bullmq");

/**
 * Get BullMQ-compatible Redis connection options.
 * BullMQ requires maxRetriesPerRequest: null for blocking commands. Tests stay
 * lazy unless RUN_REDIS_INTEGRATION_TESTS=1 so importing queue singletons does
 * not implicitly require a localhost Redis server.
 */
function getBullMQConnection(): RedisOptions {
  const redisUrl = process.env.REDIS_URL;
  const lazyConnect = process.env.NODE_ENV === 'test'
    && process.env.RUN_REDIS_INTEGRATION_TESTS !== '1';

  if (redisUrl) {
    const url = new URL(redisUrl);
    const useTls = url.protocol === 'rediss:';
    return {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
      username: url.username || undefined,
      db: url.pathname ? parseInt(url.pathname.slice(1)) || 0 : 0,
      maxRetriesPerRequest: null,
      lazyConnect,
      enableReadyCheck: false,
      ...(useTls && { tls: {} }),
    };
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    username: process.env.REDIS_USERNAME || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
    maxRetriesPerRequest: null,
    lazyConnect,
    enableReadyCheck: false,
  };
}

const SHARED_REDIS_OPTS = getBullMQConnection();

const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: {
    age: 24 * 3600, // 1 day
    count: 1000,
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // 7 days
    count: 1000,
  },
};

function useHermeticRedis(): boolean {
  return process.env.NODE_ENV === 'test'
    && process.env.RUN_REDIS_INTEGRATION_TESTS !== '1';
}

function createHermeticQueue<T>(name: string): Queue<T> {
  const jobs = new Map<string, Job<T>>();
  let sequence = 0;
  const queue = {
    name,
    async add(jobName: string, data: T, options?: JobsOptions) {
      const id = String(options?.jobId ?? `${name}-${++sequence}`);
      const job = {
        id,
        name: jobName,
        data,
        opts: options ?? {},
        async getState() { return 'waiting'; },
        async remove() { jobs.delete(id); },
      } as unknown as Job<T>;
      jobs.set(id, job);
      return job;
    },
    async addBulk(entries: Array<{ name: string; data: T; opts?: JobsOptions }>) {
      return Promise.all(entries.map((entry) => queue.add(entry.name, entry.data, entry.opts)));
    },
    async getJob(id: string) { return jobs.get(String(id)) ?? null; },
    async getJobs() { return [...jobs.values()]; },
    async getJobCounts() { return { waiting: jobs.size }; },
    async remove(id: string) { return jobs.delete(String(id)) ? 1 : 0; },
    async upsertJobScheduler() { return undefined; },
    async removeJobScheduler() { return true; },
    async close() { jobs.clear(); },
    on() { return queue; },
  };
  return queue as unknown as Queue<T>;
}

/**
 * QueueFactory
 * 
 * Central factory for creating standardized BullMQ components (Queues, Workers, Events).
 * 
 * PURPOSE:
 * - Enforces consistent Redis connection configuration (reusing the same connection settings).
 * - Applies standard default job options (retries, backoff, cleanup).
 * - Centralizes logging for queue initialization.
 * 
 * STANDARD DEFAULTS:
 * - Retries: 3 attempts with exponential backoff (1s delay).
 * - Cleanup: Removes completed jobs after 24h, failed after 7d.
 * - Concurrency: Default worker concurrency is 1 (sequential).
 */
export class QueueFactory {
  /**
   * Create a new Queue with standard configuration.
   * 
   * A "Queue" is the Producer side: used to add jobs.
   * 
   * @template T - The type of data payload for jobs in this queue.
   * @param name - Unique name of the queue (namespace).
   * @param options - Queue settings (overrides defaults).
   * @returns Configured BullMQ Queue instance.
   */
  static createQueue<T = any>(name: string, options?: Omit<QueueOptions, 'connection'>): Queue<T> {
    logger.info('Initializing queue', { name });
    if (useHermeticRedis()) return createHermeticQueue<T>(name);
    return new Queue<T>(name, {
      connection: SHARED_REDIS_OPTS,
      defaultJobOptions: DEFAULT_JOB_OPTS,
      ...options,
    });
  }

  /**
   * Create a new Worker for processing jobs.
   * 
   * A "Worker" is the Consumer side: defines the process function.
   * 
   * @template T - The type of data payload for jobs in this queue.
   * @param name - Must match the Queue name.
   * @param processor - The async function that handles the job.
   * @param options - Worker settings (concurrency, etc).
   * @returns Configured BullMQ Worker instance.
   */
  static createWorker<T = any>(name: string, processor: Processor<T>, options?: Omit<WorkerOptions, 'connection'>): Worker<T> {
    logger.info('Initializing worker', { name });
    const tracedProcessor: Processor<T> = (job, token) => traceAppOperation(
      {
        name: `queue ${name} ${job.name}`,
        op: 'queue.process',
        forceTransaction: true,
        attributes: {
          subsystem: 'queue',
          queue: name,
          'messaging.destination.name': name,
          'messaging.message.id': String(job.id ?? ''),
          'messaging.message.receive_count': job.attemptsMade + 1,
          'job.name': job.name,
        },
      },
      () => processor(job, token),
    );
    if (useHermeticRedis()) {
      return {
        name,
        processor: tracedProcessor,
        async close() {},
        on() { return this; },
      } as unknown as Worker<T>;
    }
    return new Worker<T>(name, tracedProcessor, {
      connection: SHARED_REDIS_OPTS,
      concurrency: 1, // Default to sequential processing
      ...options,
    });
  }

  /**
   * Create QueueEvents listener.
   * 
   * Used for listening to global queue events (completed, failed, etc.) irrespective of the worker.
   * Useful for websockets or monitoring dashboards.
   * 
   * @param name - Must match the Queue name.
   * @returns QueueEvents instance.
   */
  static createQueueEvents(name: string): QueueEvents {
    if (useHermeticRedis()) {
      const events = {
        on() { return events; },
        async close() {},
      };
      return events as unknown as QueueEvents;
    }
    return new QueueEvents(name, {
      connection: SHARED_REDIS_OPTS,
    });
  }
}
