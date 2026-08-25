import type { Job, Queue, Worker } from 'bullmq';
import { maybeEnqueueRoundReflect, type NegotiationGraphLike, type NegotiationRoundReflectEnqueueFn } from '@indexnetwork/protocol';

import type { ConversationDatabaseAdapter, StaleNegotiationTask, StaleNegotiationTasksInput } from '../../adapters/conversation.database.adapter';
import type { ChatDatabaseAdapter } from '../../adapters/chat.database.adapter';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { log } from '../../lib/log';

export const QUEUE_NAME = 'negotiation-watchdog';
export const JOB_NAME = 'negotiation_watchdog_sweep';
export const SCHEDULER_ID = 'negotiation-watchdog-every-5-minutes-v1';
export const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
export const SUBMITTED_STALE_AFTER_MS = 10 * 60 * 1000;
export const WORKING_STALE_AFTER_MS = 12 * 60 * 60 * 1000;
export const WATCHDOG_TASK_LIMIT = 25;
export const MAX_WATCHDOG_ATTEMPTS = 3;

export interface NegotiationWatchdogJobData {
  source: 'scheduler';
}

interface WatchdogQueueHandle {
  upsertJobScheduler: Queue<NegotiationWatchdogJobData>['upsertJobScheduler'];
  close: Queue<NegotiationWatchdogJobData>['close'];
}

type WatchdogWorkerHandle = Pick<Worker<NegotiationWatchdogJobData>, 'close'>;
type WatchdogDatabase = Pick<
  ConversationDatabaseAdapter,
  'getStaleNegotiationTasks' | 'getTask' | 'recordNegotiationWatchdogAttempt'
  | 'getIntentNegotiationRound' | 'getNegotiationTasksForIntentRound'
>;
type WatchdogOpportunities = Pick<ChatDatabaseAdapter, 'getOpportunity'>;

type StaleTaskForWatchdog = {
  id: string;
  state: 'submitted' | 'working' | 'paused';
  updatedAt: Date;
  metadata: Record<string, unknown> | null;
};

type WatchdogLogger = {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
};

export interface NegotiationWatchdogQueueDeps {
  database?: Pick<
    ConversationDatabaseAdapter,
    'getStaleNegotiationTasks' | 'getTask' | 'recordNegotiationWatchdogAttempt'
    | 'getIntentNegotiationRound' | 'getNegotiationTasksForIntentRound'
  >;
  opportunities?: Pick<ChatDatabaseAdapter, 'getOpportunity'>;
  negotiationGraph?: NegotiationGraphLike;
  queue?: WatchdogQueueHandle;
  createWorker?: (
    processor: (job: Job<NegotiationWatchdogJobData>) => Promise<void>,
  ) => WatchdogWorkerHandle;
  logger?: WatchdogLogger;
  clock?: () => Date;
  reflectEnqueue?: NegotiationRoundReflectEnqueueFn;
}

/**
 * @returns true — stale-task reconciliation always runs. This path has never
 * run in production; the `watchdogAttempts` cap is what bounds it.
 */
export function isNegotiationWatchdogEnabled(): boolean {
  return true;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function watchdogAttempts(metadata: Record<string, unknown>): number {
  const value = metadata.watchdogAttempts;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Reconciles negotiation tasks whose kickoff or active worker may have been
 * lost.
 */
export class NegotiationWatchdogQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  private readonly deps: NegotiationWatchdogQueueDeps;
  private readonly logger: WatchdogLogger;
  private readonly clock: () => Date;
  private queueInstance: WatchdogQueueHandle | null = null;
  private worker: WatchdogWorkerHandle | null = null;
  private negotiationGraph: NegotiationGraphLike | undefined;
  private reflectEnqueue: NegotiationRoundReflectEnqueueFn | undefined;

  constructor(deps: NegotiationWatchdogQueueDeps = {}) {
    this.deps = deps;
    this.logger = deps.logger ?? log.queue.from('NegotiationWatchdogQueue');
    this.clock = deps.clock ?? (() => new Date());
    this.negotiationGraph = deps.negotiationGraph;
    this.reflectEnqueue = deps.reflectEnqueue;
  }

  /** Wired once at startup by main.ts, after the single NegotiationGraph is compiled. */
  setNegotiationGraph(graph: NegotiationGraphLike): void {
    this.negotiationGraph = graph;
  }

  /** Wired once at startup so durable ready pauses can retry their reflect enqueue. */
  setReflectEnqueue(enqueue: NegotiationRoundReflectEnqueueFn): void {
    this.reflectEnqueue = enqueue;
  }

  private get queue(): WatchdogQueueHandle {
    this.queueInstance ??= this.deps.queue ?? QueueFactory.createQueue<NegotiationWatchdogJobData>(QUEUE_NAME);
    return this.queueInstance;
  }

  /** Register the repeatable sweep and worker when the flag is enabled. */
  async start(): Promise<void> {
    if (!isNegotiationWatchdogEnabled()) return;

    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: WATCHDOG_INTERVAL_MS },
      {
        name: JOB_NAME,
        data: { source: 'scheduler' },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 24 * 3600 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      },
    );

    if (!this.worker) {
      const createWorker = this.deps.createWorker ?? ((processor) => (
        QueueFactory.createWorker<NegotiationWatchdogJobData>(QUEUE_NAME, processor)
      ));
      this.worker = createWorker(async (job) => {
        await this.processJob(job.name, job.data);
      });
    }

    this.logger.info('Negotiation watchdog scheduled', {
      queueName: QUEUE_NAME,
      schedulerId: SCHEDULER_ID,
      intervalMs: WATCHDOG_INTERVAL_MS,
    });
  }

  /** Run one watchdog job. Exported for queue-level tests. */
  async processJob(name: string, _data: NegotiationWatchdogJobData): Promise<void> {
    if (name !== JOB_NAME) {
      this.logger.warn('Unknown negotiation watchdog job name', { name });
      return;
    }
    await this.sweep();
  }

  /** Sweep stale tasks and reconcile each one independently. */
  async sweep(): Promise<void> {
    const input: StaleNegotiationTasksInput = {
      submittedOlderThanMs: SUBMITTED_STALE_AFTER_MS,
      workingOlderThanMs: WORKING_STALE_AFTER_MS,
      limit: WATCHDOG_TASK_LIMIT,
    };
    const database: WatchdogDatabase = this.deps.database
      ?? (await import('../../adapters/database.adapter')).conversationDatabaseAdapter;
    const opportunities: WatchdogOpportunities = this.deps.opportunities
      ?? (await import('../../adapters/database.adapter')).chatDatabaseAdapter;
    const staleTasks = await database.getStaleNegotiationTasks(input);

    for (const candidate of staleTasks) {
      await this.reconcileCandidate(candidate, database, opportunities).catch((error) => {
        this.logger.error('Negotiation watchdog candidate failed; continuing sweep', {
          taskId: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  /**
   * A task the watchdog has given up retrying (no opportunity id, or the
   * retry budget is exhausted) is paused through the graph's own system-pause
   * input — the same path a routine stale timeout uses — never marked with a
   * state ('failed') outside the working|paused|completed union. That state
   * bypassed checkAllPaused entirely (no round reflect) and could never read
   * back through anything that expects the real union. A paused task drops
   * out of getStaleNegotiationTasks on its own, so this still stops the sweep
   * from retrying it — no second state writer needed to get that effect.
   */
  private async terminalMark(
    task: StaleTaskForWatchdog,
    reason: string,
  ): Promise<void> {
    if (!this.negotiationGraph) {
      this.logger.error('Negotiation watchdog fired before the graph was wired', { taskId: task.id });
      return;
    }
    this.logger.warn('Negotiation watchdog pausing a task it will not retry', { taskId: task.id, reason });
    try {
      const result = await this.negotiationGraph.invoke({ negotiationId: task.id, pause: 'counterparty_silent' });
      if (result.status === 'error') {
        this.logger.error('Negotiation watchdog terminal pause invoke returned an error status', {
          taskId: task.id,
          reason,
          error: result.error,
        });
      }
    } catch (error) {
      this.logger.error('Negotiation watchdog terminal pause invoke failed', {
        taskId: task.id,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async reconcileCandidate(
    candidate: StaleNegotiationTask,
    database: WatchdogDatabase,
    opportunities: WatchdogOpportunities,
  ): Promise<void> {
    const task = await database.getTask(candidate.id);
    if (
      !task
      || task.state !== candidate.state
      || task.updatedAt.getTime() !== candidate.updatedAt.getTime()
    ) {
      this.logger.info('Negotiation watchdog skipped task changed since sweep', { taskId: candidate.id });
      return;
    }
    const staleTask: StaleTaskForWatchdog = {
      id: candidate.id,
      state: candidate.state,
      updatedAt: candidate.updatedAt,
      metadata: task.metadata,
    };

    const metadata = asRecord(staleTask.metadata);
    if (metadata.type !== 'negotiation') {
      this.logger.info('Negotiation watchdog skipped non-negotiation task', { taskId: candidate.id });
      return;
    }

    const pause = asRecord(metadata.pause);
    if (staleTask.state === 'paused') {
      if (pause.reason === 'ready_for_verdict') {
        const seats = asRecord(metadata.seats);
        for (const [intentId, rawBinding] of Object.entries(seats)) {
          const binding = asRecord(rawBinding);
          if (typeof binding.userId !== 'string' || typeof binding.round !== 'number') continue;
          await maybeEnqueueRoundReflect(database, this.reflectEnqueue, {
            userId: binding.userId,
            intentId,
            round: binding.round,
          });
        }
        return;
      }
      if (pause.reason !== 'needs_principal' && pause.reason !== 'counterparty_silent') return;
      if (!this.negotiationGraph) {
        this.logger.error('Negotiation watchdog fired before the graph was wired', { taskId: candidate.id });
        return;
      }
      const result = await this.negotiationGraph.invoke({
        negotiationId: staleTask.id,
        expire: { expectedUpdatedAt: staleTask.updatedAt, reason: pause.reason },
      });
      if (result.status === 'error') {
        this.logger.error('Negotiation watchdog expiry invoke returned an error status', { taskId: candidate.id, error: result.error });
      }
      return;
    }

    const opportunityId = typeof metadata.opportunityId === 'string' && metadata.opportunityId.length > 0
      ? metadata.opportunityId
      : null;
    if (!opportunityId) {
      await this.terminalMark(staleTask, 'missing_opportunity_id');
      return;
    }

    const opportunity = await opportunities.getOpportunity(opportunityId);
    if (!opportunity || opportunity.status !== 'negotiating') {
      this.logger.info('Negotiation watchdog skipped task whose opportunity is not negotiating', {
        taskId: candidate.id,
        opportunityId,
        opportunityStatus: opportunity?.status ?? 'missing',
      });
      return;
    }

    const attempts = watchdogAttempts(metadata);
    if (attempts >= MAX_WATCHDOG_ATTEMPTS) {
      await this.terminalMark(staleTask, 'watchdog_attempts_exhausted');
      return;
    }

    if (!this.negotiationGraph) {
      this.logger.error('Negotiation watchdog fired before the graph was wired', { taskId: candidate.id });
      return;
    }

    const nextAttempt = attempts + 1;
    const ageMs = Math.max(0, this.clock().getTime() - staleTask.updatedAt.getTime());
    this.logger.warn('Negotiation watchdog pausing stale task', {
      taskId: candidate.id,
      opportunityId,
      state: candidate.state,
      ageMs,
      attempt: nextAttempt,
    });

    // Record the attempt before invoking: the invoke may return a discarded
    // {status:'error'} instead of throwing, so this counter — not a caught
    // exception — is what makes MAX_WATCHDOG_ATTEMPTS/terminalMark reachable.
    const recorded = await database.recordNegotiationWatchdogAttempt({
      taskId: candidate.id,
      expectedUpdatedAt: candidate.updatedAt,
      attempts: nextAttempt,
    });
    if (!recorded) {
      this.logger.info('Negotiation watchdog skipped task changed since sweep', { taskId: candidate.id });
      return;
    }

    try {
      const result = await this.negotiationGraph.invoke({ negotiationId: staleTask.id, pause: 'counterparty_silent' });
      if (result.status === 'error') {
        this.logger.error('Negotiation watchdog pause invoke returned an error status', {
          taskId: candidate.id,
          opportunityId,
          attempt: nextAttempt,
          error: result.error,
        });
      }
    } catch (error) {
      this.logger.error('Negotiation watchdog pause invoke failed', {
        taskId: candidate.id,
        opportunityId,
        attempt: nextAttempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Gracefully close the worker and any queue connection created by start(). */
  async close(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
    await this.queueInstance?.close();
    this.queueInstance = null;
  }
}

export const negotiationWatchdogQueue = new NegotiationWatchdogQueue();
