import { Job } from 'bullmq';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { EnrichmentDatabaseAdapter, ChatDatabaseAdapter } from '../adapters/database.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { EnrichmentGraphFactory, PremiseGraphFactory } from '@indexnetwork/protocol';
import type { PremiseGraphDatabase } from '@indexnetwork/protocol';
import { enrichUserProfile } from '../lib/parallel/parallel';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { questionerEnqueueIfEnabled } from './questioner.queue';
import { canRunPublicEnrichment, getEnrichmentPolicy } from '../lib/privacy/enrichment-policy';
import type { ProfileEnrichmentPolicy } from '../schemas/database.schema';

/** BullMQ queue name for profile HyDE (ensure profile + HyDE) jobs. */
export const QUEUE_NAME = 'profile-hyde-queue';

/** Payload for ensure_profile_hyde job. */
export interface EnsureProfileHydeData {
  userId: string;
  networkId?: string;
  reason?: string;
}

/** Payload for enrich.user jobs. */
export interface EnrichUserData {
  userId: string;
  networkId?: string;
  reason?: string;
}

/** Union of all job payloads accepted by the enrichment queue. */
export type EnrichmentJobPayload = EnsureProfileHydeData | EnrichUserData;

/**
 * Optional dependencies for testing.
 */
export interface EnrichmentPrivacyDecision {
  allowed: boolean;
  policy: ProfileEnrichmentPolicy;
  reason: string;
  hasExistingProfile: boolean;
}

export interface EnrichmentQueueDeps {
  invokeProfileWrite?: (userId: string) => Promise<void>;
  invokeEnrichUser?: (userId: string) => Promise<void>;
  checkPrivacy?: (input: { jobName: 'ensure_profile_hyde' | 'enrich.user'; userId: string; networkId?: string; reason?: string }) => Promise<EnrichmentPrivacyDecision>;
}

/**
 * Enrichment queue: BullMQ queue plus worker and job handlers.
 *
 * Handles `ensure_profile_hyde`: invokes the profile graph in write mode so the user has
 * a profile and HyDE documents for discovery (network members can be found).
 *
 * Handles `enrich.user`: enriches users (ghost or real) via Chat API enrichment
 * inside the profile graph, then generates profile + HyDE documents.
 *
 * @remarks
 * Workers are started only by the protocol server via {@link EnrichmentQueue.startWorker}.
 */
export class EnrichmentQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<EnrichmentJobPayload>(QUEUE_NAME);

  private readonly logger = log.job.from('EnrichmentJob');
  private readonly profileHydeLogger = log.job.from('EnrichmentJob:ProfileHyde');
  private readonly enrichUserLogger = log.job.from('EnrichmentJob:EnrichUser');
  private readonly queueLogger = log.queue.from('EnrichmentQueue');
  private readonly deps: EnrichmentQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<EnrichmentJobPayload>> | null = null;

  /** Set by main.ts to trigger opportunity discovery after enrichment completes. */
  onEnrichmentComplete: ((userId: string) => void) | null = null;

  constructor(deps?: EnrichmentQueueDeps) {
    this.deps = deps;
  }

  /**
   * Enqueue a job to ensure profile and HyDE for a user (profile graph write mode).
   * @param data - userId
   * @returns The BullMQ job
   */
  addEnsureProfileHydeJob(data: EnsureProfileHydeData): Promise<Job<EnrichmentJobPayload>> {
    return this.addJob('ensure_profile_hyde', data);
  }

  /**
   * Enqueue a job to enrich a user with public data and generate their profile.
   * Works for both ghost users (imported contacts) and real users (onboarding).
   * @param data - userId to enrich
   * @returns The BullMQ job
   */
  addEnrichUserJob(data: EnrichUserData): Promise<Job<EnrichmentJobPayload>> {
    return this.addJob('enrich.user', data, {
      jobId: `enrich.user.${data.userId}.${Date.now()}`,
    });
  }

  /**
   * Enqueue enrichment jobs for multiple users in a single BullMQ call.
   * @param items - Array of { userId } to enrich
   * @returns Array of BullMQ jobs
   */
  addEnrichUserJobBulk(items: EnrichUserData[]): Promise<Job<EnrichmentJobPayload>[]> {
    if (items.length === 0) return Promise.resolve([]);
    const now = Date.now();
    return this.queue.addBulk(
      items.map((item, i) => ({
        name: 'enrich.user' as const,
        data: item,
        opts: {
          jobId: `enrich.user.${item.userId}.${now}.${i}`,
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 1000 },
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      }))
    );
  }

  /**
   * Add a job to the enrichment queue.
   * @param name - Job type: `ensure_profile_hyde` or `enrich.user`
   * @param data - Payload for the job
   * @param options - Optional jobId and priority
   * @returns The BullMQ job
   */
  async addJob(
    name: 'ensure_profile_hyde' | 'enrich.user',
    data: EnrichmentJobPayload,
    options?: { jobId?: string; priority?: number }
  ): Promise<Job<EnrichmentJobPayload>> {
    return this.queue.add(name, data, {
      jobId: options?.jobId,
      priority: options?.priority,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    });
  }

  /**
   * Run the job handler for a given job name and payload. Used by the worker and by tests with injected deps.
   * @param name - Job name (`ensure_profile_hyde` or `enrich.user`)
   * @param data - Job payload
   */
  async processJob(name: string, data: EnrichmentJobPayload): Promise<void> {
    switch (name) {
      case 'ensure_profile_hyde':
        await this.handleEnsureProfileHyde(data);
        break;
      case 'enrich.user':
        await this.handleEnrichUser(data);
        break;
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent; call from the protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<EnrichmentJobPayload>) => {
      const { userId, networkId, reason } = job.data as EnsureProfileHydeData;
      this.queueLogger.info('Processing job', {
        jobId: job.id,
        jobName: job.name,
        userId,
        networkId,
        reason,
      });
      await this.processJob(job.name, job.data);
    };
    // Parallel Chat API allows 300 req/min. Rate-limit at queue level to prevent bursts.
    this.worker = QueueFactory.createWorker<EnrichmentJobPayload>(QUEUE_NAME, processor, {
      concurrency: 50,
      limiter: { max: 4, duration: 1000 },
    });
  }

  /**
   * Gracefully close the worker and queue connections.
   * Called during server shutdown to prevent stale workers.
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async handleEnsureProfileHyde(data: EnsureProfileHydeData): Promise<void> {
    const { userId } = data;
    const privacy = await this.resolvePrivacyDecision('ensure_profile_hyde', data);
    if (!privacy.allowed) {
      this.profileHydeLogger.info('Skipped by profile enrichment policy', {
        userId,
        networkId: data.networkId,
        reason: data.reason,
        policy: privacy.policy,
        skipReason: privacy.reason,
      });
      return;
    }
    if (this.deps?.invokeProfileWrite) {
      await this.deps.invokeProfileWrite(userId);
      return;
    }
    try {
      await this.invokeProfileGraph(userId, 'write');
      this.profileHydeLogger.verbose('Ensured profile HyDE for user', { userId, networkId: data.networkId, reason: data.reason });
    } catch (err) {
      this.profileHydeLogger.error('Failed to ensure profile HyDE', { userId, networkId: data.networkId, reason: data.reason, error: err });
      throw err;
    }
  }

  private async handleEnrichUser(data: EnrichUserData): Promise<void> {
    const { userId } = data;
    const privacy = await this.resolvePrivacyDecision('enrich.user', data);
    if (!privacy.allowed) {
      this.enrichUserLogger.info('Skipped by profile enrichment policy', {
        userId,
        networkId: data.networkId,
        reason: data.reason,
        policy: privacy.policy,
        skipReason: privacy.reason,
      });
      return;
    }
    if (this.deps?.invokeEnrichUser) {
      await this.deps.invokeEnrichUser(userId);
      this.fireEnrichmentComplete(userId);
      return;
    }
    try {
      await this.invokeProfileGraph(userId, 'generate');
      this.enrichUserLogger.info('Profile enrichment completed', { userId, networkId: data.networkId, reason: data.reason });
      this.fireEnrichmentComplete(userId);
    } catch (err) {
      this.enrichUserLogger.error('Failed to enrich user', {
        userId,
        networkId: data.networkId,
        reason: data.reason,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private async resolvePrivacyDecision(
    jobName: 'ensure_profile_hyde' | 'enrich.user',
    data: EnrichmentJobPayload,
  ): Promise<EnrichmentPrivacyDecision> {
    if (this.deps?.checkPrivacy) {
      return this.deps.checkPrivacy({ jobName, userId: data.userId, networkId: data.networkId, reason: data.reason });
    }

    if (!data.networkId) {
      return { allowed: true, policy: 'auto', reason: 'no_network_policy', hasExistingProfile: false };
    }

    // "Has been enriched?" keys on ACTIVE premises, not a `user_profiles` row
    // (WS10/IND-367 — same existence-via-user_profiles anti-pattern WS5 removed from
    // profile.graph). `getProfile` returns a users-sourced row for every user, so it
    // can't signal enrichment; the premise graph is the source of truth.
    const { user, network, hasActivePremise } = await new EnrichmentDatabaseAdapter()
      .getEnrichmentPrivacyContext(data.userId, data.networkId);

    const hasExistingProfile = hasActivePremise;
    if (!network) {
      return { allowed: false, policy: 'disabled', reason: 'network_not_found', hasExistingProfile };
    }

    const policy = getEnrichmentPolicy(network.permissions);
    if (!user) {
      return { allowed: false, policy, reason: 'user_not_found', hasExistingProfile };
    }

    if (jobName === 'ensure_profile_hyde' && hasExistingProfile) {
      return { allowed: true, policy, reason: 'existing_profile_no_public_enrichment_needed', hasExistingProfile };
    }

    const allowed = canRunPublicEnrichment({
      policy,
      onboarding: user.onboarding,
      isGhost: user.isGhost,
    });

    const reason = allowed
      ? 'policy_allows_public_enrichment'
      : policy === 'disabled'
        ? 'profile_enrichment_disabled'
        : user.isGhost
          ? 'ghost_user_cannot_consent'
          : 'public_profile_lookup_consent_missing';

    return { allowed, policy, reason, hasExistingProfile };
  }

  /** Best-effort callback invocation — never fails the enrichment job. */
  private fireEnrichmentComplete(userId: string): void {
    try {
      this.onEnrichmentComplete?.(userId);
    } catch (err) {
      this.enrichUserLogger.error('onEnrichmentComplete callback failed', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async invokeProfileGraph(userId: string, operationMode: 'write' | 'generate') {
    const database = new EnrichmentDatabaseAdapter();
    const premiseDatabase = new ChatDatabaseAdapter();
    const scraper = new ScraperAdapter();
    const embedder = new EmbedderAdapter();
    const premiseGraph = new PremiseGraphFactory(
      premiseDatabase as unknown as PremiseGraphDatabase,
      embedder,
    ).createGraph();
    // Inject the env-gated questioner enqueue so profile regeneration runs
    // (onboarding, premise cascades) generate profile-gap questions instead
    // of silently dropping them (the gap that left prod's questions table empty).
    const factory = new EnrichmentGraphFactory(database, scraper, { enrichUserProfile }, questionerEnqueueIfEnabled(), premiseGraph);
    const graph = factory.createGraph();
    return graph.invoke({ userId, operationMode });
  }
}

/** Singleton enrichment queue instance. Use for adding jobs and starting the worker. */
export const enrichmentQueue = new EnrichmentQueue();
