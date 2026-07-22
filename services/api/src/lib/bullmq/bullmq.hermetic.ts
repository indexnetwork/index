import type { Job, JobsOptions, Processor, Queue, QueueEvents, Worker } from 'bullmq';

interface ListenerMap {
  [event: string]: Set<(...args: unknown[]) => void> | undefined;
}

type HermeticState = 'active' | 'completed' | 'delayed' | 'failed' | 'prioritized' | 'waiting';

interface JobRecord {
  error?: Error;
  job: Job<unknown>;
  rejecters: Array<(error: Error) => void>;
  resolvers: Array<(value: unknown) => void>;
  state: HermeticState;
  timer?: ReturnType<typeof setTimeout>;
}

interface WorkerRecord {
  active: number;
  closed: boolean;
  concurrency: number;
  listeners: ListenerMap;
  processor: Processor<unknown>;
}

interface Broker {
  events: Set<ListenerMap>;
  jobs: Map<string, JobRecord>;
  queueReferences: number;
  schedulers: Map<string, unknown>;
  sequence: number;
  workers: Set<WorkerRecord>;
}

const brokers = new Map<string, Broker>();

function getBroker(name: string): Broker {
  let broker = brokers.get(name);
  if (!broker) {
    broker = {
      events: new Set(),
      jobs: new Map(),
      queueReferences: 0,
      schedulers: new Map(),
      sequence: 0,
      workers: new Set(),
    };
    brokers.set(name, broker);
  }
  return broker;
}

/**
 * Creates a Redis-free queue double for the default test baseline.
 *
 * The double models the application-facing contracts relied on by queue code:
 * stable custom IDs, duplicate suppression, merged options, pending states,
 * removal, worker delivery, completion/failure, and queue events.
 *
 * @param name - Queue name shared with hermetic workers and events.
 * @param defaultJobOptions - Queue-level defaults applied to each job.
 * @returns A BullMQ-compatible queue surface.
 */
export function createHermeticQueue<T>(
  name: string,
  defaultJobOptions: JobsOptions,
): Queue<T> {
  const broker = getBroker(name);
  broker.queueReferences += 1;
  let closed = false;

  const queue = {
    name,
    async add(jobName: string, data: T, options: JobsOptions = {}) {
      const id = String(options.jobId ?? `${name}-${++broker.sequence}`);
      const existing = broker.jobs.get(id);
      if (existing) {
        emitGlobal(broker, 'duplicated', { jobId: id });
        return existing.job as Job<T>;
      }

      const opts = { ...defaultJobOptions, ...options };
      const state: HermeticState = Number(opts.delay ?? 0) > 0
        ? 'delayed'
        : Number(opts.priority ?? 0) > 0
          ? 'prioritized'
          : 'waiting';
      const record = makeJobRecord(broker, id, jobName, data, opts, state);
      broker.jobs.set(id, record);
      if (state === 'delayed') scheduleDelayed(broker, record, Number(opts.delay));
      else queueMicrotask(() => dispatch(broker));
      return record.job as Job<T>;
    },
    async addBulk(entries: Array<{ name: string; data: T; opts?: JobsOptions }>) {
      const jobs: Array<Job<T>> = [];
      for (const entry of entries) {
        jobs.push(await queue.add(entry.name, entry.data, entry.opts));
      }
      return jobs;
    },
    async getJob(id: string) {
      return (broker.jobs.get(String(id))?.job as Job<T> | undefined) ?? null;
    },
    async getJobs(states?: string[], start = 0, end = -1, ascending = false) {
      const records = [...broker.jobs.values()].filter(
        (record) => !states || states.length === 0 || states.includes(record.state),
      );
      if (!ascending) records.reverse();
      const finalIndex = end < 0 ? records.length : end + 1;
      return records.slice(start, finalIndex).map((record) => record.job as Job<T>);
    },
    async getJobCounts(...states: string[]) {
      const requested = states.length > 0
        ? states
        : ['waiting', 'active', 'completed', 'delayed', 'failed', 'prioritized'];
      return Object.fromEntries(
        requested.map((state) => [
          state,
          [...broker.jobs.values()].filter((record) => record.state === state).length,
        ]),
      );
    },
    async remove(id: string) {
      return removeRecord(broker, String(id)) ? 1 : 0;
    },
    async upsertJobScheduler(id: string, repeat: unknown, template?: unknown) {
      const repeatOptions = asRecord(repeat);
      const templateOptions = asRecord(template);
      const scheduler = {
        ...repeatOptions,
        key: id,
        name: typeof templateOptions.name === 'string' ? templateOptions.name : id,
        next: calculateSchedulerNext(repeatOptions),
        template: {
          data: templateOptions.data,
          opts: templateOptions.opts,
        },
      };
      broker.schedulers.set(id, scheduler);
      return scheduler;
    },
    async getJobScheduler(id: string) {
      return broker.schedulers.get(id) ?? null;
    },
    async removeJobScheduler(id: string) {
      return broker.schedulers.delete(id);
    },
    async close() {
      if (closed) return;
      closed = true;
      broker.queueReferences -= 1;
      cleanupBroker(name, broker);
    },
    on() {
      return queue;
    },
  };

  return queue as unknown as Queue<T>;
}

/**
 * Creates a hermetic worker that consumes pending jobs from same-name queues.
 *
 * @param name - Queue name to consume.
 * @param processor - Job processor.
 * @param concurrency - Maximum simultaneous jobs.
 * @returns A BullMQ-compatible worker surface.
 */
export function createHermeticWorker<T>(
  name: string,
  processor: Processor<T>,
  concurrency: number,
): Worker<T> {
  const broker = getBroker(name);
  const record: WorkerRecord = {
    active: 0,
    closed: false,
    concurrency: Math.max(1, concurrency),
    listeners: {},
    processor: processor as Processor<unknown>,
  };
  broker.workers.add(record);

  const worker = {
    name,
    on(event: string, listener: (...args: unknown[]) => void) {
      addListener(record.listeners, event, listener);
      return worker;
    },
    async close() {
      record.closed = true;
      broker.workers.delete(record);
      cleanupBroker(name, broker);
    },
  };
  queueMicrotask(() => dispatch(broker));
  return worker as unknown as Worker<T>;
}

/**
 * Creates a hermetic queue-events emitter for same-name queue activity.
 *
 * @param name - Queue name to observe.
 * @returns A BullMQ-compatible queue-events surface.
 */
export function createHermeticQueueEvents(name: string): QueueEvents {
  const broker = getBroker(name);
  const listeners: ListenerMap = {};
  broker.events.add(listeners);

  const events = {
    on(event: string, listener: (...args: unknown[]) => void) {
      addListener(listeners, event, listener);
      return events;
    },
    async close() {
      broker.events.delete(listeners);
      cleanupBroker(name, broker);
    },
  };
  return events as unknown as QueueEvents;
}

function makeJobRecord<T>(
  broker: Broker,
  id: string,
  name: string,
  data: T,
  opts: JobsOptions,
  state: HermeticState,
): JobRecord {
  const record: JobRecord = {
    job: undefined as unknown as Job<unknown>,
    rejecters: [],
    resolvers: [],
    state,
  };
  const job = {
    id,
    name,
    data,
    opts,
    attemptsMade: 0,
    timestamp: Date.now(),
    returnvalue: null,
    failedReason: undefined,
    async getState() {
      return record.state;
    },
    async remove() {
      if (!removeRecord(broker, id)) {
        throw new Error(`Job ${id} could not be removed because it is active`);
      }
    },
    async waitUntilFinished(_events: QueueEvents, timeout?: number) {
      if (record.state === 'completed') return job.returnvalue;
      if (record.state === 'failed') throw record.error;
      return new Promise<unknown>((resolve, reject) => {
        record.resolvers.push(resolve);
        record.rejecters.push(reject);
        if (timeout) {
          const timer = setTimeout(() => reject(new Error(`Job ${id} timed out`)), timeout);
          timer.unref?.();
        }
      });
    },
  };
  record.job = job as unknown as Job<unknown>;
  return record;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function calculateSchedulerNext(repeat: Record<string, unknown>): number {
  const now = Date.now();
  const parsedStart = repeat.startDate instanceof Date
    ? repeat.startDate.getTime()
    : typeof repeat.startDate === 'string' || typeof repeat.startDate === 'number'
      ? new Date(repeat.startDate).getTime()
      : now;
  const start = Number.isFinite(parsedStart) ? Math.max(now, parsedStart) : now;
  const every = Number(repeat.every);
  return start + (Number.isFinite(every) && every > 0 ? every : 60_000);
}

function scheduleDelayed(broker: Broker, record: JobRecord, delay: number): void {
  record.timer = setTimeout(() => {
    record.timer = undefined;
    if (record.state !== 'delayed') return;
    record.state = 'waiting';
    emitGlobal(broker, 'waiting', { jobId: record.job.id });
    dispatch(broker);
  }, Math.max(0, delay));
  record.timer.unref?.();
}

function dispatch(broker: Broker): void {
  for (const worker of broker.workers) {
    if (worker.closed) continue;
    while (worker.active < worker.concurrency) {
      const next = [...broker.jobs.values()].find(
        (record) => record.state === 'waiting' || record.state === 'prioritized',
      );
      if (!next) break;
      processRecord(broker, worker, next);
    }
  }
}

function processRecord(broker: Broker, worker: WorkerRecord, record: JobRecord): void {
  record.state = 'active';
  worker.active += 1;
  emitGlobal(broker, 'active', { jobId: record.job.id, prev: 'waiting' });

  void Promise.resolve(worker.processor(record.job, undefined)).then(
    (result) => {
      record.state = 'completed';
      record.job.returnvalue = result;
      emitListeners(worker.listeners, 'completed', record.job, result);
      emitGlobal(broker, 'completed', {
        jobId: record.job.id,
        returnvalue: result,
        prev: 'active',
      });
      for (const resolve of record.resolvers.splice(0)) resolve(result);
      record.rejecters.splice(0);
      if (record.job.opts.removeOnComplete === true) removeRecord(broker, String(record.job.id));
    },
    (error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      record.job.attemptsMade += 1;
      const attempts = Number(record.job.opts.attempts ?? 1);
      if (record.job.attemptsMade < attempts) {
        record.state = 'waiting';
      } else {
        record.state = 'failed';
        record.error = failure;
        record.job.failedReason = failure.message;
        emitListeners(worker.listeners, 'failed', record.job, failure);
        emitGlobal(broker, 'failed', {
          failedReason: failure.message,
          jobId: record.job.id,
          prev: 'active',
        });
        for (const reject of record.rejecters.splice(0)) reject(failure);
        record.resolvers.splice(0);
        if (record.job.opts.removeOnFail === true) removeRecord(broker, String(record.job.id));
      }
    },
  ).finally(() => {
    worker.active -= 1;
    queueMicrotask(() => dispatch(broker));
  });
}

function removeRecord(broker: Broker, id: string): boolean {
  const record = broker.jobs.get(id);
  if (!record || record.state === 'active') return false;
  if (record.timer) clearTimeout(record.timer);
  const removed = broker.jobs.delete(id);
  if (removed) emitGlobal(broker, 'removed', { jobId: id, prev: record.state });
  return removed;
}

function addListener(
  listeners: ListenerMap,
  event: string,
  listener: (...args: unknown[]) => void,
): void {
  listeners[event] ??= new Set();
  listeners[event]!.add(listener);
}

function emitListeners(listeners: ListenerMap, event: string, ...args: unknown[]): void {
  for (const listener of listeners[event] ?? []) listener(...args);
}

function emitGlobal(broker: Broker, event: string, payload: unknown): void {
  for (const listeners of broker.events) emitListeners(listeners, event, payload);
}

function cleanupBroker(name: string, broker: Broker): void {
  if (broker.queueReferences > 0 || broker.workers.size > 0 || broker.events.size > 0) return;
  for (const record of broker.jobs.values()) {
    if (record.timer) clearTimeout(record.timer);
  }
  brokers.delete(name);
}
