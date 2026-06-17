import { Job } from 'bullmq';
import crypto from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';

import { UserContextGenerator, HydeGraphFactory, HydeGenerator, LensInferrer } from '@indexnetwork/protocol';
import type { HydeGraphDatabase } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import db from '../lib/drizzle/drizzle';
import { networkMembers, networks } from '../schemas/database.schema';
import { chatDatabaseAdapter } from '../adapters/database.adapter';
import { embedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';

/** BullMQ queue name for per-network user-context regeneration jobs. */
export const QUEUE_NAME = 'user-context-queue';

/** Payload for `regenerate_contexts` jobs. */
export interface UserContextJobData {
  /** User whose per-network contexts should be regenerated from active premises. */
  userId: string;
  /** What triggered the regen — for observability only. */
  reason: 'profile_regen' | 'enrichment_complete' | 'network_membership' | 'backfill';
}

/** Minimal premise shape needed to synthesize contexts and compute the staleness hash. */
export interface ContextPremise {
  id: string;
  updatedAt: Date;
  assertion: { text: string };
}

/**
 * Optional dependencies for testing. Each is a thin wrapper over an adapter,
 * protocol graph, or DB query so the per-network loop can be unit-tested in isolation.
 */
export interface UserContextQueueDeps {
  /** Non-personal network IDs the user belongs to. */
  getUserNetworkIds?: (userId: string) => Promise<string[]>;
  /** The user's ACTIVE premises (id, updatedAt, assertion text). */
  getActivePremises?: (userId: string) => Promise<ContextPremise[]>;
  /** Existing context for a user+network, for the premiseHash short-circuit. */
  getExistingContext?: (userId: string, networkId: string) => Promise<{ premiseHash: string } | null>;
  /** Network title + prompt used to steer context synthesis. */
  getNetwork?: (networkId: string) => Promise<{ title: string; prompt: string | null } | null>;
  /** Synthesize a context paragraph + embedding from premises. */
  generateContext?: (input: {
    premises: Array<{ text: string }>;
    networkPrompt: string | null;
    networkTitle: string;
  }) => Promise<{ text: string; embedding: number[] }>;
  /** Upsert the context row, returning its id. */
  upsertUserContext?: (params: {
    userId: string;
    networkId: string;
    text: string;
    embedding: number[];
    premiseHash: string;
  }) => Promise<{ id: string }>;
  /** Generate HyDE documents for a freshly upserted context. */
  generateContextHyde?: (params: { contextId: string; sourceText: string }) => Promise<void>;
}

/**
 * Deterministic short hash over a user's active premises. Used per-network as the
 * staleness key: a network whose stored context already carries this hash is skipped.
 */
export function computePremiseHash(premises: ContextPremise[]): string {
  return crypto
    .createHash('sha256')
    .update(premises.map((p) => `${p.id}:${p.updatedAt.toISOString()}`).sort().join('|'))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Per-network user-context regeneration queue: queue + worker + handler in one class.
 *
 * `regenerate_contexts` — rebuilds each non-personal network's `user_contexts` row
 * (synthetic paragraph + embedding + HyDE) from the user's current active premises,
 * skipping networks whose premise hash is unchanged. Workers are started only by the
 * protocol server via {@link UserContextQueue.startWorker}.
 */
export class UserContextQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<UserContextJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('UserContext');
  private readonly queueLogger = log.queue.from('UserContextQueue');
  private readonly deps: UserContextQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<UserContextJobData>> | null = null;

  /**
   * Lazily-built, reused context generator. `UserContextGenerator` builds an LLM
   * model in its constructor, so one is shared across all networks in a job (and
   * across jobs) rather than re-created per network.
   */
  private generator: UserContextGenerator | undefined;

  constructor(deps?: UserContextQueueDeps) {
    this.deps = deps;
  }

  /**
   * Enqueue a context-regeneration job. Job ID is deduplicated per user so concurrent
   * premise bursts coalesce into a single in-flight job.
   * @param data - Regen payload
   */
  addRegenJob(data: UserContextJobData): Promise<Job<UserContextJobData>> {
    return this.queue.add('regenerate_contexts', data, {
      jobId: `usercontext-regen-${data.userId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      // Free the per-user jobId as soon as the job settles so a later premise change
      // always enqueues a fresh regen — the jobId only needs to coalesce concurrent
      // bursts (jobs still waiting/active); retaining completed jobs would dedup and
      // silently drop subsequent edits within the retention window.
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /**
   * Route and dispatch a job by name. Called by the worker and directly by tests.
   * @param name - Job name
   * @param data - Job payload
   */
  async processJob(name: string, data: UserContextJobData): Promise<void> {
    switch (name) {
      case 'regenerate_contexts':
        await this.handleRegenerate(data);
        break;
      default:
        this.queueLogger.warn(`[UserContextProcessor] Unknown job name: ${name}`);
    }
  }

  /** Start the BullMQ worker. Idempotent; call from the protocol server only. */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<UserContextJobData>) => {
      this.queueLogger.info(`[UserContextProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<UserContextJobData>(QUEUE_NAME, processor);
  }

  /** Gracefully close the worker and queue connections. */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  // -------------------------------------------------------------------------
  // Handler
  // -------------------------------------------------------------------------

  private async handleRegenerate(data: UserContextJobData): Promise<void> {
    const { userId } = data;

    const getUserNetworkIds = this.deps?.getUserNetworkIds ?? this.defaultGetUserNetworkIds.bind(this);
    const getActivePremises = this.deps?.getActivePremises ?? this.defaultGetActivePremises.bind(this);
    const getExistingContext = this.deps?.getExistingContext ?? this.defaultGetExistingContext.bind(this);
    const getNetwork = this.deps?.getNetwork ?? this.defaultGetNetwork.bind(this);
    const generateContext = this.deps?.generateContext ?? this.defaultGenerateContext.bind(this);
    const upsertUserContext = this.deps?.upsertUserContext ?? chatDatabaseAdapter.upsertUserContext.bind(chatDatabaseAdapter);
    const generateContextHyde = this.deps?.generateContextHyde ?? this.defaultGenerateContextHyde.bind(this);

    const networkIds = await getUserNetworkIds(userId);
    const allPremises = await getActivePremises(userId);
    if (!allPremises?.length || networkIds.length === 0) return;

    const premiseTexts = allPremises.map((p) => ({ text: p.assertion.text })).filter((p) => p.text.length > 0);
    if (premiseTexts.length === 0) return;

    const premiseHash = computePremiseHash(allPremises);

    let failures = 0;
    for (const networkId of networkIds) {
      try {
        const existing = await getExistingContext(userId, networkId);
        if (existing && existing.premiseHash === premiseHash) continue;

        const network = await getNetwork(networkId);
        if (!network) continue;

        const result = await generateContext({
          premises: premiseTexts,
          networkPrompt: network.prompt,
          networkTitle: network.title,
        });

        const upserted = await upsertUserContext({
          userId,
          networkId,
          text: result.text,
          embedding: result.embedding,
          premiseHash,
        });

        // Generate HyDE documents so context-to-intent discovery uses optimised
        // hypothetical-document embeddings rather than raw paragraph vectors. The
        // context row (with its new premiseHash) is already committed above, so on a
        // HyDE failure we roll the staleness key back to '' — otherwise a retry / the
        // next trigger would short-circuit this network as "fresh" while its HyDE docs
        // are stale. Then rethrow so the network counts as failed.
        try {
          await generateContextHyde({ contextId: upserted.id, sourceText: result.text });
          this.logger.verbose('Generated context HyDE documents', { userId, networkId, contextId: upserted.id });
        } catch (hydeErr) {
          await upsertUserContext({ userId, networkId, text: result.text, embedding: result.embedding, premiseHash: '' });
          throw hydeErr;
        }

        this.logger.verbose('Generated user context', { userId, networkId });
      } catch (err) {
        // Isolate the failure to this network (others still get processed), but record
        // it so the job fails at the end and BullMQ retries. premiseHash for a failed
        // network is either un-advanced (generate/upsert failure) or rolled back (HyDE
        // failure), so the retry regenerates it rather than short-circuiting.
        this.logger.error('Failed to regenerate user context', { userId, networkId, error: err });
        failures += 1;
      }
    }

    if (failures > 0) {
      throw new Error(
        `UserContext regeneration failed for ${failures}/${networkIds.length} network(s) for user ${userId}; failing job so BullMQ retries`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Default production implementations
  // -------------------------------------------------------------------------

  /** All non-personal network IDs the user is a member of. */
  private async defaultGetUserNetworkIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ networkId: networkMembers.networkId })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(and(
        eq(networkMembers.userId, userId),
        isNull(networkMembers.deletedAt),
        isNull(networks.deletedAt),
        eq(networks.isPersonal, false),
      ));
    return rows.map((r) => r.networkId);
  }

  /** The user's ACTIVE premises, narrowed to the fields contexts need. */
  private async defaultGetActivePremises(userId: string): Promise<ContextPremise[]> {
    const premises = await chatDatabaseAdapter.getPremisesForUser(userId, 'ACTIVE');
    return premises.map((p) => ({ id: p.id, updatedAt: p.updatedAt, assertion: { text: p.assertion.text } }));
  }

  /** Existing context's premiseHash (or null) for the short-circuit. */
  private async defaultGetExistingContext(userId: string, networkId: string): Promise<{ premiseHash: string } | null> {
    const existing = await chatDatabaseAdapter.getUserContext(userId, networkId);
    return existing ? { premiseHash: existing.premiseHash } : null;
  }

  /** Network title + prompt (nullable). */
  private async defaultGetNetwork(networkId: string): Promise<{ title: string; prompt: string | null } | null> {
    const network = await chatDatabaseAdapter.getNetwork(networkId);
    if (!network) return null;
    return { title: network.title, prompt: network.prompt ?? null };
  }

  /** Synthesize a context paragraph + embedding via the protocol generator. */
  private async defaultGenerateContext(input: {
    premises: Array<{ text: string }>;
    networkPrompt: string | null;
    networkTitle: string;
  }): Promise<{ text: string; embedding: number[] }> {
    this.generator ??= new UserContextGenerator(embedderAdapter);
    return this.generator.generateColdStart(input);
  }

  /** Run the HyDE graph for a freshly upserted context. */
  private async defaultGenerateContextHyde(params: { contextId: string; sourceText: string }): Promise<void> {
    const hydeCache = new RedisCacheAdapter();
    const inferrer = new LensInferrer();
    const hydeGenerator = new HydeGenerator();
    const graphDb = chatDatabaseAdapter as unknown as HydeGraphDatabase;
    const hydeGraph = new HydeGraphFactory(graphDb, embedderAdapter, hydeCache, inferrer, hydeGenerator).createGraph();
    await hydeGraph.invoke({
      sourceType: 'context' as const,
      sourceId: params.contextId,
      sourceText: params.sourceText,
      // The HyDE cache/DB keys on (sourceType, sourceId, lens) — not the text — and the
      // context row id is stable across regenerations (upsert on userId+networkId). Without
      // forcing, a changed context would reuse stale HyDE docs, which is exactly what
      // context-to-intent discovery matches on. We only reach here when the network's
      // premiseHash changed, so regenerating is both correct and not wasteful.
      forceRegenerate: true,
      maxLenses: 3,
    });
  }
}

/** Singleton user-context queue instance. Use for adding jobs and starting the worker. */
export const userContextQueue = new UserContextQueue();
