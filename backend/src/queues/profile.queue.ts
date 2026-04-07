import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ProfileDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { ProfileGraphFactory } from '@indexnetwork/protocol';
import { enrichUserProfile } from '../lib/parallel/parallel';

/** BullMQ queue name for profile HyDE (ensure profile + HyDE) jobs. */
export const QUEUE_NAME = 'profile-hyde-queue';

/** Payload for ensure_profile_hyde job. */
export interface EnsureProfileHydeData {
  userId: string;
}

/** Payload for profile.enrich jobs. */
export interface EnrichUserData {
  userId: string;
}

/** Union of all job payloads accepted by the profile queue. */
export type ProfileJobPayload = EnsureProfileHydeData | EnrichUserData;

/**
 * Optional dependencies for testing.
 */
export interface ProfileQueueDeps {
  invokeProfileWrite?: (userId: string) => Promise<void>;
  invokeEnrichUser?: (userId: string) => Promise<void>;
}

/**
 * Profile HyDE queue: BullMQ queue plus worker and job handlers.
 *
 * Handles `ensure_profile_hyde`: invokes the profile graph in write mode so the user has
 * a profile and HyDE documents for discovery (index members can be found).
 *
 * Handles `profile.enrich`: enriches users (ghost or real) via Chat API enrichment
 * inside the profile graph, then generates profile + HyDE documents.
 *
 * @remarks
 * Workers are started only by the protocol server via {@link ProfileQueue.startWorker}.
 */
export class ProfileQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<ProfileJobPayload>(QUEUE_NAME);

  private readonly logger = log.job.from('ProfileHydeJob');
  private readonly queueLogger = log.queue.from('ProfileQueue');
  private readonly deps: ProfileQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<ProfileJobPayload>> | null = null;

  constructor(deps?: ProfileQueueDeps) {
    this.deps = deps;
  }

  /**
   * Enqueue a job to ensure profile and HyDE for a user (profile graph write mode).
   * @param data - userId
   * @returns The BullMQ job
   */
  addEnsureProfileHydeJob(data: { userId: string }): Promise<Job<ProfileJobPayload>> {
    return this.addJob('ensure_profile_hyde', data);
  }

  /**
   * Enqueue a job to enrich a user with public data and generate their profile.
   * Works for both ghost users (imported contacts) and real users (onboarding).
   * @param data - userId to enrich
   * @returns The BullMQ job
   */
  addEnrichUserJob(data: { userId: string }): Promise<Job<ProfileJobPayload>> {
    return this.addJob('profile.enrich', data, {
      jobId: `profile.enrich.${data.userId}.${Date.now()}`,
    });
  }

  /**
   * Enqueue enrichment jobs for multiple users in a single BullMQ call.
   * @param items - Array of { userId } to enrich
   * @returns Array of BullMQ jobs
   */
  addEnrichUserJobBulk(items: Array<{ userId: string }>): Promise<Job<ProfileJobPayload>[]> {
    if (items.length === 0) return Promise.resolve([]);
    const now = Date.now();
    return this.queue.addBulk(
      items.map((item, i) => ({
        name: 'profile.enrich' as const,
        data: { userId: item.userId },
        opts: {
          jobId: `profile.enrich.${item.userId}.${now}.${i}`,
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 1000 },
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      }))
    );
  }

  /**
   * Add a job to the profile HyDE queue.
   * @param name - Job type: `ensure_profile_hyde`
   * @param data - Payload for the job
   * @param options - Optional jobId and priority
   * @returns The BullMQ job
   */
  async addJob(
    name: 'ensure_profile_hyde' | 'profile.enrich',
    data: ProfileJobPayload,
    options?: { jobId?: string; priority?: number }
  ): Promise<Job<ProfileJobPayload>> {
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
   * @param name - Job name (`ensure_profile_hyde`)
   * @param data - Job payload
   */
  async processJob(name: string, data: ProfileJobPayload): Promise<void> {
    switch (name) {
      case 'ensure_profile_hyde':
        await this.handleEnsureProfileHyde(data);
        break;
      case 'profile.enrich':
        await this.handleEnrichUser(data);
        break;
      default:
        this.queueLogger.warn(`[ProfileProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent; call from the protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<ProfileJobPayload>) => {
      this.queueLogger.info(`[ProfileProcessor] Processing job ${job.id} (${job.name})`, {
        userId: (job.data as EnsureProfileHydeData).userId,
      });
      await this.processJob(job.name, job.data);
    };
    // Parallel Chat API allows 300 req/min. Rate-limit at queue level to prevent bursts.
    this.worker = QueueFactory.createWorker<ProfileJobPayload>(QUEUE_NAME, processor, {
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
    if (this.deps?.invokeProfileWrite) {
      await this.deps.invokeProfileWrite(userId);
      return;
    }
    try {
      await this.invokeProfileGraph(userId, 'write');
      this.logger.verbose('[ProfileHyde] Ensured profile HyDE for user', { userId });
    } catch (err) {
      this.logger.error('[ProfileHyde] Failed to ensure profile HyDE', { userId, error: err });
      throw err;
    }
  }

  private async handleEnrichUser(data: EnrichUserData): Promise<void> {
    const { userId } = data;
    if (this.deps?.invokeEnrichUser) {
      await this.deps.invokeEnrichUser(userId);
      return;
    }
    try {
      await this.invokeProfileGraph(userId, 'generate');
      this.queueLogger.info('[EnrichUser] Profile enrichment completed', { userId });
    } catch (err) {
      this.queueLogger.error('[EnrichUser] Failed to enrich user', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private async invokeProfileGraph(userId: string, operationMode: 'write' | 'generate') {
    const database = new ProfileDatabaseAdapter();
    const embedder = new EmbedderAdapter();
    const scraper = new ScraperAdapter();
    const factory = new ProfileGraphFactory(database, embedder, scraper, { enrichUserProfile });
    const graph = factory.createGraph();
    return graph.invoke({ userId, operationMode });
  }
}

/** Singleton profile HyDE queue instance. Use for adding jobs and starting the worker. */
export const profileQueue = new ProfileQueue();
