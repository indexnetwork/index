// services/api/src/queues/opportunity/from-intent.queue.ts
import { Job } from 'bullmq';
import type { DeduplicationOptions } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import type { Id } from '../../types/common.types';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import type { NegotiationGraphLike, AgentDispatcher, StampNewbornOpportunitiesFn } from '@indexnetwork/protocol';

import { createOpportunityGraphDb, runOpportunityDiscovery, type OpportunityGraphDb } from './discovery.shared';
import { maybeMinePoolDiscriminators, minePoolDiscriminatorsOnCompletion, type PoolMiningTrigger } from '../pool/mining.shared';
import { maybeEnqueueIntentRecovery } from '../questioner/recovery.shared';
import type { RecoveryQuestionerJobData } from '../questioner.queue';

export const QUEUE_NAME = 'opportunity-from-intent';

export interface FromIntentJobData {
  intentId: string;
  userId: string;
  networkIds?: string[];
  /**
   * What enqueued this run. `pool_answer` marks Tier-1 answer-triggered
   * re-discovery; `intent_resume` identifies lifecycle resume runs while
   * retaining the ordinary discovery/mining path.
   */
  trigger?: 'pool_answer' | 'intent_resume';
}

export type FromIntentDatabase = Pick<
  ChatDatabaseAdapter,
  'getIntentForIndexing' | 'getNetworkIdsForIntent' | 'getAssignmentNetworkMembershipsForUser' | 'markIntentFirstDiscoverySucceeded'
>;

export interface FromIntentGraphInvokeOptions {
  userId: string;
  searchQuery: string;
  operationMode: 'create';
  networkId?: string;
  indexScope?: string[];
  triggerIntentId: string;
  options: { initialStatus: 'latent' };
}

export interface FromIntentDeps {
  database?: FromIntentDatabase;
  invokeOpportunityGraph?: (opts: FromIntentGraphInvokeOptions) => Promise<void>;
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>;
  stampNewbornOpportunities?: StampNewbornOpportunitiesFn;
  /** Pool-discriminator mining hook (IND-417/418). Defaults to the shared fire-and-forget implementation; injectable for tests. */
  minePoolDiscriminators?: (trigger: PoolMiningTrigger) => void | Promise<void>;
  /** Answer context appended to Tier-1 discovery input after the debounce window. */
  getPoolAnswerContext?: (userId: string, intentId: string) => Promise<string>;
  /** Beat-2 narration for pool-answer re-runs (IND-419); injectable for tests. */
  narratePoolRerun?: (input: { userId: string; intentId: string; newCandidates: number | null }) => Promise<void>;
  /** Post-success no-opportunity recovery hook; failure-isolated by this queue. */
  recoverAfterCompletion?: (input: RecoveryQuestionerJobData) => Promise<unknown>;
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

  setRuntimeDeps(runtimeDeps: Pick<FromIntentDeps, 'negotiationGraph' | 'agentDispatcher' | 'stampNewbornOpportunities' | 'getPoolAnswerContext' | 'narratePoolRerun'>): void {
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

  async processJob(name: string, data: FromIntentJobData): Promise<void> {
    switch (name) {
      case 'discover_opportunities':
        await this.handleDiscover(data);
        break;
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  private async handleDiscover(data: FromIntentJobData): Promise<void> {
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
    // scope is narrowing-only. Any empty intersection must stop before the graph,
    // pool mining, or narration can observe an unscoped run.
    if (validNetworkIds.length === 0) {
      this.logger.warn('Intent has no valid discovery networks, skipping fail-closed', {
        intentId,
        userId,
        requestedNetworkCount: networkIds?.length,
      });
      return;
    }

    this.logger.info('Starting discovery', { intentId, userId, networkIds: validNetworkIds });

    let searchQuery = intent.payload;
    if (data.trigger === 'pool_answer' && this.deps?.getPoolAnswerContext) {
      try {
        const answerContext = await this.deps.getPoolAnswerContext(userId, intentId);
        if (answerContext.trim()) searchQuery = `${searchQuery}\n\n${answerContext.trim()}`;
      } catch (error) {
        // The run still provides a useful pool refresh if answer-context lookup
        // fails; Tier 0 already applied the deterministic preference locally.
        this.logger.warn('Pool answer context unavailable; running base intent', {
          intentId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const invokeOpts: FromIntentGraphInvokeOptions = {
      userId: userId as Id<'users'>,
      searchQuery,
      operationMode: 'create',
      ...(validNetworkIds.length === 1
        ? { networkId: validNetworkIds[0] as Id<'networks'> }
        : { indexScope: validNetworkIds as Id<'networks'>[] }),
      triggerIntentId: intentId,
      options: { initialStatus: 'latent' },
    };

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

    // Intent refinement is an independent, failure-isolated post-success
    // effect. It shares a material-fingerprint cadence with the creation-time
    // intent Questioner, so this completion retry cannot duplicate a question.
    // Run it before pool mining/narration so every intent-page question family
    // gets the same completion opportunity.
    try {
      await (this.deps?.recoverAfterCompletion ?? maybeEnqueueIntentRecovery)({
        source: 'from_intent',
        recipientUserId: userId,
        intentId,
      });
    } catch (error) {
      // Discovery has already completed authoritatively. Recovery is bounded,
      // asynchronous follow-up and must never turn success into a retry.
      this.logger.warn('Recovery completion hook failed after successful discovery', {
        intentId,
        userId,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    // Pool-discriminator mining + question enqueue (IND-417/418): web intent
    // creation/edit is the frontend's discovery path — without this hook only
    // MCP-triggered runs would ever produce pool questions. Normal runs stay
    // fire-and-forget; pool-answer runs await failure-isolated mining so the
    // next question is ready before Beat 2. Flags off = no-op.
    const miningTrigger: PoolMiningTrigger = {
      source: 'from_intent',
      userId,
      intentId,
    };
    if (data.trigger === 'pool_answer') {
      await (this.deps?.minePoolDiscriminators ?? minePoolDiscriminatorsOnCompletion)(miningTrigger);
    } else {
      (this.deps?.minePoolDiscriminators ?? maybeMinePoolDiscriminators)(miningTrigger);
    }

    if (data.trigger === 'pool_answer' && this.deps?.narratePoolRerun) {
      await this.deps.narratePoolRerun({
        userId,
        intentId,
        newCandidates: summary?.opportunitiesCreated ?? null,
      });
    }
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
      await this.processJob(job.name, job.data);
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
