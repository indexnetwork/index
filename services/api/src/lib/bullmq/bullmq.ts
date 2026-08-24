import { Queue, Worker, QueueEvents, Processor, WorkerOptions, QueueOptions, JobsOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';

import { traceAppOperation } from '../sentry-performance';
import { log } from '../log';

import { createHermeticQueue, createHermeticQueueEvents, createHermeticWorker } from './bullmq.hermetic';

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

/**
 * True when queue infrastructure must stay in-memory: tests without
 * RUN_REDIS_INTEGRATION_TESTS=1. Exported so queue collaborators that reach
 * for Redis outside BullMQ (e.g. SSE publishes) can apply the same guard.
 */
export function useHermeticRedis(): boolean {
  return process.env.NODE_ENV === 'test'
    && process.env.RUN_REDIS_INTEGRATION_TESTS !== '1';
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
    if (useHermeticRedis()) {
      return createHermeticQueue<T>(name, options?.defaultJobOptions ?? DEFAULT_JOB_OPTS);
    }
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
      return createHermeticWorker(name, tracedProcessor, options?.concurrency ?? 1);
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
    if (useHermeticRedis()) return createHermeticQueueEvents(name);
    return new QueueEvents(name, {
      connection: SHARED_REDIS_OPTS,
    });
  }
}
