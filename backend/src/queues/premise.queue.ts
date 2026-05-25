import { Job } from 'bullmq';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { OpportunityDatabaseAdapter } from '../adapters/database.adapter';

/** BullMQ queue name for premise cascade and profile regeneration jobs. */
export const QUEUE_NAME = 'premise-queue';

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** Payload for `premise_cascade` jobs. */
export interface PremiseCascadeData {
  /** The premise that was retracted or expired. */
  premiseId: string;
  /** Owner of the premise whose opportunities should be cascaded. */
  userId: string;
  /** What triggered the cascade. */
  event: 'retracted' | 'expired';
}

/** Payload for `profile_regen` jobs. */
export interface ProfileRegenData {
  /** User whose profile should be regenerated from active premises. */
  userId: string;
  /** What premise lifecycle event triggered the regen. */
  trigger: 'premise_created' | 'premise_updated' | 'premise_retracted' | 'premise_expired';
}

/** Union of all job payloads accepted by the premise queue. */
export type PremiseJobPayload = PremiseCascadeData | ProfileRegenData;

// ---------------------------------------------------------------------------
// Opportunity status helpers (kept local to avoid importing schema at queue layer)
// ---------------------------------------------------------------------------

/** Non-terminal statuses that are "in-progress" and should be stalled. */
const IN_PROGRESS_STATUSES = ['pending', 'negotiating', 'accepted'] as const;

/** Statuses that represent early-stage (not yet sent) opportunities; they expire. */
const EARLY_STATUSES = ['draft', 'latent'] as const;

export type InProgressStatus = (typeof IN_PROGRESS_STATUSES)[number];
export type EarlyStatus = (typeof EARLY_STATUSES)[number];
export type NonTerminalStatus = InProgressStatus | EarlyStatus;

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

/**
 * Optional dependencies for testing.
 * All fields are typed as narrow abstractions so tests can inject mocks
 * without pulling in concrete adapters.
 */
export interface PremiseQueueDeps {
  /**
   * Retrieve non-terminal opportunities where `userId` is an actor.
   * Returns a minimal shape: id + current status.
   */
  getUserOpportunities?: (userId: string) => Promise<Array<{ id: string; status: NonTerminalStatus }>>;

  /**
   * Transition an opportunity to a new status.
   */
  updateOpportunityStatus?: (opportunityId: string, status: 'expired' | 'stalled') => Promise<void>;

  /**
   * Invoke the profile graph in `aggregate` mode for the given user,
   * rebuilding the profile from their current active premises.
   */
  invokeProfileAggregate?: (userId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Queue class
// ---------------------------------------------------------------------------

/**
 * Premise cascade and profile regeneration queue.
 *
 * `premise_cascade` — when a premise is retracted or expired, transitions
 * non-terminal opportunities owned by the user: draft/latent → expired,
 * pending/negotiating/accepted → stalled.
 *
 * `profile_regen` — when any premise lifecycle event fires, regenerates the
 * user's profile from their current active premises via the profile graph's
 * `aggregate` operation mode.
 *
 * @remarks
 * Workers are started only by the protocol server via {@link PremiseQueue.startWorker}.
 * Actual cascade and regen logic is implemented in later tasks; handlers are
 * currently stubs that log TODO placeholders.
 */
export class PremiseQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<PremiseJobPayload>(QUEUE_NAME);

  private readonly logger = log.job.from('PremiseJob');
  private readonly queueLogger = log.queue.from('PremiseQueue');
  private readonly deps: PremiseQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<PremiseJobPayload>> | null = null;

  constructor(deps?: PremiseQueueDeps) {
    this.deps = deps;
  }

  // -------------------------------------------------------------------------
  // Convenience enqueue methods
  // -------------------------------------------------------------------------

  /**
   * Enqueue a premise cascade job.
   * Job ID is deduplicated per premise+event so duplicate triggers are safe.
   * @param data - Cascade payload
   */
  addCascadeJob(data: PremiseCascadeData): Promise<Job<PremiseJobPayload>> {
    return this.addJob('premise_cascade', data, {
      jobId: `premise-cascade-${data.premiseId}-${data.event}`,
    });
  }

  /**
   * Enqueue a profile regeneration job.
   * Job ID is deduplicated per user+trigger so rapid successive events coalesce.
   * @param data - Profile regen payload
   */
  addProfileRegenJob(data: ProfileRegenData): Promise<Job<PremiseJobPayload>> {
    return this.addJob('profile_regen', data, {
      jobId: `profile-regen-${data.userId}-${data.trigger}`,
    });
  }

  // -------------------------------------------------------------------------
  // Core enqueue method
  // -------------------------------------------------------------------------

  /**
   * Add a named job to the premise queue.
   * @param name - Job type (`premise_cascade` or `profile_regen`)
   * @param data - Job payload
   * @param options - Optional jobId and priority
   */
  async addJob(
    name: 'premise_cascade' | 'profile_regen',
    data: PremiseJobPayload,
    options?: { jobId?: string; priority?: number }
  ): Promise<Job<PremiseJobPayload>> {
    return this.queue.add(name, data, {
      jobId: options?.jobId,
      priority: options?.priority,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    });
  }

  // -------------------------------------------------------------------------
  // Job routing
  // -------------------------------------------------------------------------

  /**
   * Route and dispatch a job by name. Called by the worker and directly by tests.
   * @param name - Job name
   * @param data - Job payload
   */
  async processJob(name: string, data: PremiseJobPayload): Promise<void> {
    switch (name) {
      case 'premise_cascade':
        await this.handlePremiseCascade(data as PremiseCascadeData);
        break;
      case 'profile_regen':
        await this.handleProfileRegen(data as ProfileRegenData);
        break;
      default:
        this.queueLogger.warn(`[PremiseProcessor] Unknown job name: ${name}`);
    }
  }

  // -------------------------------------------------------------------------
  // Worker lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the BullMQ worker. Idempotent; call from the protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<PremiseJobPayload>) => {
      this.queueLogger.info(`[PremiseProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<PremiseJobPayload>(QUEUE_NAME, processor);
  }

  /**
   * Gracefully close the worker and queue connections.
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  // -------------------------------------------------------------------------
  // Job handlers (stubs — logic implemented in later tasks)
  // -------------------------------------------------------------------------

  /**
   * Default production implementation: fetch all non-terminal opportunities for
   * a user from the database using a single filtered query.
   */
  private async defaultGetUserOpportunities(
    userId: string
  ): Promise<Array<{ id: string; status: NonTerminalStatus }>> {
    const adapter = new OpportunityDatabaseAdapter();
    const nonTerminalStatuses: NonTerminalStatus[] = [
      ...EARLY_STATUSES,
      ...IN_PROGRESS_STATUSES,
    ];
    const rows = await adapter.getOpportunitiesForUser(userId, {
      statuses: nonTerminalStatuses,
    });
    return rows.map((row) => ({ id: row.id, status: row.status as NonTerminalStatus }));
  }

  /**
   * Default production implementation: update an opportunity's status in the
   * database.
   */
  private async defaultUpdateOpportunityStatus(
    opportunityId: string,
    status: 'expired' | 'stalled'
  ): Promise<void> {
    const adapter = new OpportunityDatabaseAdapter();
    await adapter.updateOpportunityStatus(opportunityId, status);
  }

  private async handlePremiseCascade(data: PremiseCascadeData): Promise<void> {
    const { premiseId, userId, event } = data;
    this.logger.info('[PremiseCascade] Starting cascade', { premiseId, userId, event });

    const getUserOpportunities =
      this.deps?.getUserOpportunities ??
      ((uid: string) => this.defaultGetUserOpportunities(uid));

    const updateOpportunityStatus =
      this.deps?.updateOpportunityStatus ??
      ((oppId: string, status: 'expired' | 'stalled') =>
        this.defaultUpdateOpportunityStatus(oppId, status));

    const opportunities = await getUserOpportunities(userId);

    let expiredCount = 0;
    let stalledCount = 0;

    for (const opp of opportunities) {
      const newStatus = (EARLY_STATUSES as readonly string[]).includes(opp.status)
        ? 'expired'
        : 'stalled';
      await updateOpportunityStatus(opp.id, newStatus);
      if (newStatus === 'expired') expiredCount++;
      else stalledCount++;
    }

    this.logger.info('[PremiseCascade] Cascade complete', {
      premiseId,
      userId,
      event,
      total: opportunities.length,
      expired: expiredCount,
      stalled: stalledCount,
    });
  }

  private async handleProfileRegen(data: ProfileRegenData): Promise<void> {
    const { userId, trigger } = data;
    this.logger.info('[ProfileRegen] Starting profile regeneration', { userId, trigger });

    // TODO(Task N): Implement profile regeneration logic.
    // 1. Invoke the profile graph in 'aggregate' mode for userId.
    //    Use: this.deps?.invokeProfileAggregate ?? defaultInvokeProfileAggregate
    //    The graph reads the user's active premises and rebuilds profile + embeddings.
    // 2. Log completion.

    this.logger.info('[ProfileRegen] Profile regen stub complete (not yet implemented)', {
      userId,
      trigger,
    });
  }
}

/** Singleton premise queue instance. Use for adding jobs and starting the worker. */
export const premiseQueue = new PremiseQueue();
