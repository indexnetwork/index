import type { Job, Queue, Worker } from 'bullmq';

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
  'getStaleNegotiationTasks' | 'getTask' | 'transitionNegotiationTaskForWatchdog'
>;
type WatchdogOpportunities = Pick<ChatDatabaseAdapter, 'getOpportunity'>;

type StaleTaskForWatchdog = {
  id: string;
  state: 'submitted' | 'working';
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
    'getStaleNegotiationTasks' | 'getTask' | 'transitionNegotiationTaskForWatchdog'
  >;
  opportunities?: Pick<ChatDatabaseAdapter, 'getOpportunity'>;
  enqueueRunExisting?: (data: { opportunityId: string; userId: string }) => Promise<unknown>;
  queue?: WatchdogQueueHandle;
  createWorker?: (
    processor: (job: Job<NegotiationWatchdogJobData>) => Promise<void>,
  ) => WatchdogWorkerHandle;
  logger?: WatchdogLogger;
  clock?: () => Date;
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

  constructor(deps: NegotiationWatchdogQueueDeps = {}) {
    this.deps = deps;
    this.logger = deps.logger ?? log.queue.from('NegotiationWatchdogQueue');
    this.clock = deps.clock ?? (() => new Date());
  }

  private get queue(): WatchdogQueueHandle {
    this.queueInstance ??= this.deps.queue ?? QueueFactory.createQueue<NegotiationWatchdogJobData>(QUEUE_NAME);
    return this.queueInstance;
  }

  private async enqueueRunExisting(data: { opportunityId: string; userId: string }): Promise<unknown> {
    if (this.deps.enqueueRunExisting) return this.deps.enqueueRunExisting(data);
    const { negotiationRunExistingQueue } = await import('./run-existing.queue');
    return negotiationRunExistingQueue.addJob(data);
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

  private async terminalMark(
    database: WatchdogDatabase,
    task: StaleTaskForWatchdog,
    reason: string,
  ): Promise<void> {
    const now = this.clock();
    const metadata = {
      ...asRecord(task.metadata),
      watchdogTerminalReason: reason,
      watchdogTerminalAt: now.toISOString(),
    };
    const updated = await database.transitionNegotiationTaskForWatchdog({
      taskId: task.id,
      expectedState: task.state,
      expectedUpdatedAt: task.updatedAt,
      nextState: 'failed',
      metadata,
      statusMessage: { reason: 'negotiation_watchdog_terminal', detail: reason },
    });
    if (!updated) {
      this.logger.info('Negotiation watchdog terminal mark lost a state race', { taskId: task.id, reason });
      return;
    }
    this.logger.warn('Negotiation watchdog terminal-marked stale task', {
      taskId: task.id,
      reason,
    });
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

    const opportunityId = typeof metadata.opportunityId === 'string' && metadata.opportunityId.length > 0
      ? metadata.opportunityId
      : null;
    if (!opportunityId) {
      await this.terminalMark(database, staleTask, 'missing_opportunity_id');
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
      await this.terminalMark(database, staleTask, 'watchdog_attempts_exhausted');
      return;
    }

    const sourceUserId = typeof metadata.sourceUserId === 'string' && metadata.sourceUserId.length > 0
      ? metadata.sourceUserId
      : null;
    if (!sourceUserId) {
      await this.terminalMark(database, staleTask, 'missing_source_user_id');
      return;
    }

    const nextAttempt = attempts + 1;
    const updated = await database.transitionNegotiationTaskForWatchdog({
      taskId: staleTask.id,
      expectedState: staleTask.state,
      expectedUpdatedAt: staleTask.updatedAt,
      nextState: 'canceled',
      metadata: {
        ...metadata,
        watchdogAttempts: nextAttempt,
        watchdogLastAttemptAt: this.clock().toISOString(),
      },
      statusMessage: { reason: 'watchdog-requeue', attempt: nextAttempt },
    });
    if (!updated) {
      this.logger.info('Negotiation watchdog skipped task after a concurrent state change', { taskId: candidate.id, opportunityId });
      return;
    }

    const ageMs = Math.max(0, this.clock().getTime() - staleTask.updatedAt.getTime());
    this.logger.warn('Negotiation watchdog re-enqueuing stale task', {
      taskId: candidate.id,
      opportunityId,
      state: candidate.state,
      ageMs,
      attempt: nextAttempt,
    });
    try {
      await this.enqueueRunExisting({ opportunityId, userId: sourceUserId });
    } catch (error) {
      this.logger.error('Negotiation watchdog re-enqueue failed after task cancellation', {
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
