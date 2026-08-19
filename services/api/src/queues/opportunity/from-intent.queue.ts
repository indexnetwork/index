// services/api/src/queues/opportunity/from-intent.queue.ts
import { Job } from 'bullmq';
import type { DeduplicationOptions } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import type { NegotiationGraphLike, AgentDispatcher } from '@indexnetwork/protocol';

import { createOpportunityGraphDb, runOpportunityDiscovery, type OpportunityGraphDb } from './discovery.shared';
import { buildIntentDiscoveryTrigger, type FromIntentGraphInvokeOptions } from './discovery-trigger.builders';
export type { FromIntentGraphInvokeOptions } from './discovery-trigger.builders';
import { maybeRunNegotiationEvidenceShadow } from '../pool/negotiation-evidence.shadow';

export const QUEUE_NAME = 'opportunity-from-intent';

export interface FromIntentJobData {
  intentId: string;
  userId: string;
  networkIds?: string[];
  /** What enqueued this run. `intent_resume` identifies lifecycle resume runs. */
  trigger?: 'intent_resume';
}

export type FromIntentDatabase = Pick<
  ChatDatabaseAdapter,
  'getIntentForIndexing' | 'getNetworkIdsForIntent' | 'getAssignmentNetworkMembershipsForUser' | 'markIntentFirstDiscoverySucceeded' | 'recordIntentDiscoveryProgress'
>;

export interface FromIntentDeps {
  database?: FromIntentDatabase;
  invokeOpportunityGraph?: (opts: FromIntentGraphInvokeOptions) => Promise<void>;
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>;
}

export class FromIntentQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<FromIntentJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('FromIntentJob');
  private readonly queueLogger = log.queue.from('FromIntentQueue');
  private readonly database: FromIntentDatabase | ChatDatabaseAdapter;
  private readonly graphDb: OpportunityGraphDb;
  private deps: FromIntentDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<FromIntentJobData>> | null = null;

  constructor(deps?: FromIntentDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    this.graphDb = createOpportunityGraphDb(this.database);
  }

  setRuntimeDeps(runtimeDeps: Pick<FromIntentDeps, 'negotiationGraph' | 'agentDispatcher'>): void {
    this.deps = { ...(this.deps ?? {}), ...runtimeDeps };
  }

  async addJob(
    data: FromIntentJobData,
    options?: {
      jobId?: string;
      priority?: number;
      delay?: number;
      removeOnComplete?: boolean;
      removeOnFail?: boolean;
      deduplication?: DeduplicationOptions;
    },
  ): Promise<Job<FromIntentJobData>> {
    await this.recordProgress(data, 'queued', 0);
    return this.queue.add('discover_opportunities', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: options?.removeOnComplete ?? { age: 24 * 60 * 60 },
      removeOnFail: options?.removeOnFail ?? { age: 24 * 60 * 60 },
      deduplication: options?.deduplication,
      jobId: options?.jobId,
      priority: options?.priority,
      // Tier-1 debounce (IND-419): callers use BullMQ deduplication with
      // replace+extend+keepLastIfActive for sliding and trailing semantics.
      delay: options?.delay,
    });
  }

  private async recordProgress(
    data: FromIntentJobData,
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked',
    attempt: number,
    assignedCommunityCount?: number,
    /** Run tallies, known only at a successful boundary; omitted leaves the stored counts alone. */
    counts?: { processedCommunityCount: number; possibleOverlapCount: number; conversationsStartedCount: number },
  ): Promise<void> {
    const record = (this.database as Partial<FromIntentDatabase>).recordIntentDiscoveryProgress;
    // Isolated queue tests and a rolling deploy may run a worker before its
    // adapter has been updated. Production adapters always provide this.
    if (!record) return;
    await record.call(this.database, {
      intentId: data.intentId, userId: data.userId, status, attempt, assignedCommunityCount, ...counts,
    });
  }

  async processJob(name: string, data: FromIntentJobData, attempt = 1): Promise<void> {
    switch (name) {
      case 'discover_opportunities':
        await this.handleDiscover(data, attempt);
        break;
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  private async handleDiscover(data: FromIntentJobData, attempt: number): Promise<void> {
    const { intentId, userId, networkIds } = data;
    // `this.database` is already `deps?.database ?? new ChatDatabaseAdapter()` and
    // setRuntimeDeps never replaces `database`, so this is the injected db when provided.
    const intent = await this.database.getIntentForIndexing(intentId);
    if (!intent) {
      this.logger.warn('Intent not found, skipping admission', { intentId, userId });
      return;
    }
    if (intent.userId !== userId) {
      this.logger.warn('Intent owner mismatch, skipping admission', {
        intentId,
        expectedUserId: userId,
        actualUserId: intent.userId,
      });
      return;
    }
    if (intent.archivedAt || (intent.status != null && intent.status !== 'ACTIVE')) {
      this.logger.info('Intent is not discoverable, skipping admission', {
        intentId,
        userId,
        status: intent.status ?? 'ACTIVE',
        archived: Boolean(intent.archivedAt),
      });
      return;
    }

    const validNetworkIds = await this.getValidDiscoveryNetworkIds(intentId, userId, networkIds);

    // A trigger intent is authoritative for admission: omitted scope means all
    // of its still-valid assignments, never all owner memberships. Explicit
    // scope is narrowing-only. Any empty intersection must stop before the graph
    // or the evidence shadow can observe an unscoped run.
    if (validNetworkIds.length === 0) {
      await this.recordProgress(data, 'blocked', 0, 0);
      this.logger.warn('Intent has no valid discovery networks, skipping fail-closed', {
        intentId,
        userId,
        requestedNetworkCount: networkIds?.length,
      });
      return;
    }

    await this.recordProgress(data, 'running', attempt, validNetworkIds.length);

    this.logger.info('Starting discovery', { intentId, userId, networkIds: validNetworkIds });

    const searchQuery = intent.payload;

    const invokeOpts = buildIntentDiscoveryTrigger({
      userId,
      searchQuery,
      networkIds: validNetworkIds,
      triggerIntentId: intentId,
    });

    // The graph's own summary is the only honest source for the owner-visible
    // tallies; it is null when the caller injected a graph (test path), in
    // which case the success write carries no counts at all.
    const summary = await runOpportunityDiscovery({
      graphDb: this.graphDb,
      deps: this.deps,
      invokeOpts,
      logger: this.logger,
      label: 'FromIntent',
      errorLabel: 'from-intent',
      logContext: { intentId, userId },
    });

    // A successful graph is not enough to clear WARMING: assignment and
    // membership can change while it runs. Re-check the same authoritative
    // admission predicate immediately before the irreversible success stamp.
    const stampNetworkIds = await this.getValidDiscoveryNetworkIds(intentId, userId, networkIds);
    if (stampNetworkIds.length === 0) {
      const error = new Error('Intent discovery stamp precondition failed: no active assigned networks remain');
      this.logger.error('Discovery success stamp precondition violated; BullMQ will retry', {
        event: 'intent_discovery_stamp_precondition_violation',
        intentId,
        userId,
        requestedNetworkCount: networkIds?.length,
        error,
      });
      throw error;
    }

    // Discovery completed without throwing: stamp first-discovery success so
    // the read-side WARMING derivation clears immediately instead of waiting
    // out the 24-hour freshness window (IND-482). Failed runs throw above and
    // skipped runs return earlier, so neither reaches this stamp. Stamp
    // failures must not fail the (already successful) discovery job.
    try {
      await this.database.markIntentFirstDiscoverySucceeded(intentId);
    } catch (error) {
      this.logger.warn('Failed to stamp first-discovery success', {
        intentId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await this.recordProgress(data, 'succeeded', attempt, stampNetworkIds.length, summary ? {
      // The graph runs once across every valid network, so "processed" is the
      // set that was still valid at the success stamp — there is no per-community
      // boundary observable from here.
      processedCommunityCount: stampNetworkIds.length,
      possibleOverlapCount: summary.candidatesFound,
      // Each created opportunity enqueues a negotiation run, so this is a count
      // of conversations the run actually started.
      conversationsStartedCount: summary.opportunitiesCreated,
    } : undefined);

    // Lens C negotiation-evidence shadow (IND-433): fire-and-forget on its
    // own flag. Formerly triggered through the pool-discriminator mining hook;
    // the mining pass and its question enqueue are retired
    // (conversational-questions plan, "Retirements").
    void maybeRunNegotiationEvidenceShadow({
      source: 'from_intent',
      userId,
      intentId,
    }).catch(() => {});
  }

  /** Resolve the assignment + current-membership intersection used for both admission and stamping. */
  private async getValidDiscoveryNetworkIds(intentId: string, userId: string, networkIds?: string[]): Promise<string[]> {
    const [assignedNetworkIds, ownerMemberships] = await Promise.all([
      this.database.getNetworkIdsForIntent(intentId),
      this.database.getAssignmentNetworkMembershipsForUser(userId),
    ]);
    const activeOwnerNetworkIds = new Set(ownerMemberships.map((membership) => membership.networkId));
    const explicitNetworkIds = networkIds == null ? null : new Set(networkIds);
    return [...new Set(assignedNetworkIds)]
      .filter((networkId) => activeOwnerNetworkIds.has(networkId))
      .filter((networkId) => explicitNetworkIds == null || explicitNetworkIds.has(networkId))
      .sort();
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<FromIntentJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id });
      try {
        await this.processJob(job.name, job.data, job.attemptsMade + 1);
      } catch (error) {
        const attempt = job.attemptsMade + 1;
        await this.recordProgress(job.data, 'failed', attempt);
        throw error;
      }
    };
    this.worker = QueueFactory.createWorker<FromIntentJobData>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}

export const fromIntentQueue = new FromIntentQueue();
