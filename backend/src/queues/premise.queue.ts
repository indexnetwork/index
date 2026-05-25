import cron from 'node-cron';
import { Job } from 'bullmq';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ChatDatabaseAdapter, OpportunityDatabaseAdapter, ProfileDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { ProfileGraphFactory } from '@indexnetwork/protocol';

import { PremiseEvents } from '../events/premise.event';

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

  /**
   * Find ACTIVE premises whose validity.validUntil has passed.
   * Returns a minimal shape: id + userId.
   */
  getExpiredPremises?: () => Promise<Array<{ id: string; userId: string }>>;

  /**
   * Transition a premise to EXPIRED status.
   */
  expirePremise?: (premiseId: string) => Promise<void>;
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
 */
export class PremiseQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<PremiseJobPayload>(QUEUE_NAME);

  private readonly logger = log.job.from('PremiseJob');
  private readonly queueLogger = log.queue.from('PremiseQueue');
  private readonly deps: PremiseQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<PremiseJobPayload>> | null = null;
  private cronTask: ReturnType<typeof cron.schedule> | null = null;

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
   * Schedule expiry detection to run every hour. Call from the protocol server only.
   */
  startCrons(): void {
    if (this.cronTask) return; // idempotent
    this.cronTask = cron.schedule('0 * * * *', () => {
      this.checkExpiredPremises()
        .catch((err) => this.logger.error('[ExpiryCheck] Cron failed', { error: err }));
    });
    this.queueLogger.info('📅 [PremiseJob] Expiry check scheduled (every hour)');
  }

  /**
   * Find ACTIVE premises past their validUntil date, transition each to EXPIRED,
   * and emit {@link PremiseEvents.onExpired} for downstream cascade/regen.
   * @returns Number of premises expired
   */
  async checkExpiredPremises(): Promise<number> {
    this.logger.verbose('[ExpiryCheck] Starting expired premise check');

    const getExpiredPremises =
      this.deps?.getExpiredPremises ??
      (() => this.defaultGetExpiredPremises());

    const expirePremise =
      this.deps?.expirePremise ??
      ((id: string) => this.defaultExpirePremise(id));

    const expired = await getExpiredPremises();
    this.logger.verbose(`[ExpiryCheck] Found ${expired.length} expired premises`);

    for (const { id, userId } of expired) {
      await expirePremise(id);
      PremiseEvents.onExpired(id, userId);
    }

    this.logger.info(`[ExpiryCheck] Expired ${expired.length} premises`);
    return expired.length;
  }

  /**
   * Gracefully close the worker and queue connections.
   */
  async close(): Promise<void> {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  // -------------------------------------------------------------------------
  // Default production implementations (injected via deps or used as fallbacks)
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

  /**
   * Default production implementation: query the database for ACTIVE premises
   * whose validity.validUntil has passed.
   */
  private async defaultGetExpiredPremises(): Promise<Array<{ id: string; userId: string }>> {
    const adapter = new ChatDatabaseAdapter();
    return adapter.getExpiredPremises();
  }

  /**
   * Default production implementation: set a premise's status to EXPIRED.
   */
  private async defaultExpirePremise(premiseId: string): Promise<void> {
    const adapter = new ChatDatabaseAdapter();
    await adapter.updatePremise(premiseId, { status: 'EXPIRED' });
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

    const invokeProfileAggregate =
      this.deps?.invokeProfileAggregate ??
      ((uid: string) => this.defaultInvokeProfileAggregate(uid));

    await invokeProfileAggregate(userId);

    this.logger.info('[ProfileRegen] Profile regeneration complete', { userId, trigger });
  }

  /**
   * Default production implementation: invoke the profile graph in `aggregate` mode.
   * Reads the user's active premises and rebuilds profile + embeddings.
   */
  private async defaultInvokeProfileAggregate(userId: string): Promise<void> {
    const database = new ProfileDatabaseAdapter();
    const embedder = new EmbedderAdapter();
    const scraper = new ScraperAdapter();
    const factory = new ProfileGraphFactory(database, embedder, scraper);
    const graph = factory.createGraph();
    await graph.invoke({ userId, operationMode: 'aggregate' });
  }
}

/** Singleton premise queue instance. Use for adding jobs and starting the worker. */
export const premiseQueue = new PremiseQueue();
