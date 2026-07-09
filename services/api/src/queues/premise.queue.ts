import cron from 'node-cron';
import { Job, JobsOptions } from 'bullmq';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ChatDatabaseAdapter, OpportunityDatabaseAdapter } from '../adapters/database.adapter';

import { userContextQueue } from './usercontext.queue';

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

/**
 * In-flight statuses (sent or mid-negotiation) that expire when the premise
 * that motivated them lapses. `accepted` is deliberately excluded: a made
 * connection outlives its originating premise. `stalled` is reserved for
 * negotiation outcomes (turn cap / timeout / no consensus) and is never
 * written by this cascade.
 */
const IN_FLIGHT_STATUSES = ['pending', 'negotiating'] as const;

/** Statuses that represent early-stage (not yet sent) opportunities; they expire. */
const EARLY_STATUSES = ['draft', 'latent'] as const;

export type InFlightStatus = (typeof IN_FLIGHT_STATUSES)[number];
export type EarlyStatus = (typeof EARLY_STATUSES)[number];
export type NonTerminalStatus = InFlightStatus | EarlyStatus;

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
   * Retrieve cascade-eligible (non-terminal, non-accepted) opportunities
   * where `userId` is an actor. Returns a minimal shape: id + current status.
   */
  getUserOpportunities?: (userId: string) => Promise<Array<{ id: string; status: NonTerminalStatus }>>;

  /**
   * Transition an opportunity to a new status. The cascade only ever expires.
   */
  updateOpportunityStatus?: (opportunityId: string, status: 'expired') => Promise<void>;

  /**
   * Enqueue user-context regeneration (global + per-network) for the user.
   * Called whenever the user's premises change so their context representation
   * (the profile replacement) is rebuilt from the fresh premise set.
   */
  enqueueContextRegen?: (userId: string) => Promise<void>;

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
 * `premise_cascade` — when a premise is retracted or expired, expires the
 * opportunities it motivated: draft/latent/pending/negotiating → expired.
 * `accepted` opportunities are left untouched (the connection already
 * happened), and `stalled` is never written here — it is strictly a
 * negotiation outcome (turn cap / timeout / no consensus).
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
  private readonly expiryLogger = log.job.from('PremiseJob:ExpiryCheck');
  private readonly cascadeLogger = log.job.from('PremiseJob:Cascade');
  private readonly profileRegenLogger = log.job.from('PremiseJob:ProfileRegen');
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
      // Free the jobId as soon as the regen settles so repeated premise changes
      // re-run instead of being deduped against a retained completed job — the
      // jobId only needs to coalesce concurrent bursts (jobs still waiting/active).
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  // -------------------------------------------------------------------------
  // Core enqueue method
  // -------------------------------------------------------------------------

  /**
   * Add a named job to the premise queue.
   * @param name - Job type (`premise_cascade` or `profile_regen`)
   * @param data - Job payload
   * @param options - Optional jobId, priority, and removeOnComplete/removeOnFail overrides
   */
  async addJob(
    name: 'premise_cascade' | 'profile_regen',
    data: PremiseJobPayload,
    options?: {
      jobId?: string;
      priority?: number;
      removeOnComplete?: JobsOptions['removeOnComplete'];
      removeOnFail?: JobsOptions['removeOnFail'];
    }
  ): Promise<Job<PremiseJobPayload>> {
    return this.queue.add(name, data, {
      jobId: options?.jobId,
      priority: options?.priority,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: options?.removeOnComplete ?? { age: 24 * 60 * 60 },
      removeOnFail: options?.removeOnFail ?? { age: 7 * 24 * 60 * 60 },
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
        this.queueLogger.warn('Unknown job name', { name });
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
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
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
        .catch((err) => this.expiryLogger.error('Cron failed', { error: err }));
    });
    this.queueLogger.info('📅 Expiry check scheduled (every hour)');
  }

  /**
   * Find ACTIVE premises past their validUntil date and transition each to EXPIRED.
   * The adapter's updatePremise emits onExpired for downstream cascade/regen.
   * @returns Number of premises expired
   */
  async checkExpiredPremises(): Promise<number> {
    this.expiryLogger.verbose('Starting expired premise check');

    const getExpiredPremises =
      this.deps?.getExpiredPremises ??
      (() => this.defaultGetExpiredPremises());

    const expirePremise =
      this.deps?.expirePremise ??
      ((id: string) => this.defaultExpirePremise(id));

    const expired = await getExpiredPremises();
    this.expiryLogger.verbose('Found expired premises', { count: expired.length });

    for (const { id } of expired) {
      // onExpired fires inside the adapter's updatePremise (status EXPIRED) —
      // emitting here as well would double-enqueue the cascade/regen jobs.
      await expirePremise(id);
    }

    this.expiryLogger.info('Expired premises', { count: expired.length });
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
   * Default production implementation: fetch all cascade-eligible
   * opportunities for a user from the database using a single filtered query.
   * `accepted` is intentionally outside the fetch scope — the cascade must
   * never touch a made connection.
   */
  private async defaultGetUserOpportunities(
    userId: string
  ): Promise<Array<{ id: string; status: NonTerminalStatus }>> {
    const adapter = new OpportunityDatabaseAdapter();
    const cascadeStatuses: NonTerminalStatus[] = [
      ...EARLY_STATUSES,
      ...IN_FLIGHT_STATUSES,
    ];
    const rows = await adapter.getOpportunitiesForUser(userId, {
      statuses: cascadeStatuses,
    });
    return rows.map((row) => ({ id: row.id, status: row.status as NonTerminalStatus }));
  }

  /**
   * Default production implementation: update an opportunity's status in the
   * database.
   */
  private async defaultUpdateOpportunityStatus(
    opportunityId: string,
    status: 'expired'
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
    this.cascadeLogger.info('Starting cascade', { premiseId, userId, event });

    const getUserOpportunities =
      this.deps?.getUserOpportunities ??
      ((uid: string) => this.defaultGetUserOpportunities(uid));

    const updateOpportunityStatus =
      this.deps?.updateOpportunityStatus ??
      ((oppId: string, status: 'expired') =>
        this.defaultUpdateOpportunityStatus(oppId, status));

    const opportunities = await getUserOpportunities(userId);

    // The premise that motivated these opportunities no longer holds, so they
    // all expire — regardless of how far along they were. `stalled` is never
    // written here: it is reserved for negotiation outcomes, and `accepted`
    // rows are outside the fetch scope entirely.
    for (const opp of opportunities) {
      await updateOpportunityStatus(opp.id, 'expired');
    }

    this.cascadeLogger.info('Cascade complete', {
      premiseId,
      userId,
      event,
      total: opportunities.length,
      expired: opportunities.length,
    });
  }

  private async handleProfileRegen(data: ProfileRegenData): Promise<void> {
    const { userId, trigger } = data;
    this.profileRegenLogger.info('Starting profile regeneration', { userId, trigger });

    const enqueueContextRegen =
      this.deps?.enqueueContextRegen ??
      ((uid: string) => this.defaultEnqueueContextRegen(uid));

    // Premises changed; rebuild the user's context representation (global + per-network),
    // which is the profile replacement. The legacy profile-graph `aggregate` step (which
    // synthesized the now-removed user_profiles identity document) was dropped in WS8/IND-365.
    // Log completion only after the enqueue settles so a failed/retried job is not
    // preceded by a misleading "complete" line.
    await enqueueContextRegen(userId);
    this.profileRegenLogger.info('Profile regeneration complete', { userId, trigger });
  }

  /**
   * Default production implementation: enqueue a per-network context regeneration job.
   */
  private async defaultEnqueueContextRegen(userId: string): Promise<void> {
    await userContextQueue.addRegenJob({ userId, reason: 'profile_regen' });
  }
}

/** Singleton premise queue instance. Use for adding jobs and starting the worker. */
export const premiseQueue = new PremiseQueue();
