// services/api/src/queues/opportunity/from-intent.queue.ts
import { Job } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import type { Id } from '../../types/common.types';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import type { NegotiationGraphLike, AgentDispatcher } from '@indexnetwork/protocol';

import { createOpportunityGraphDb, runOpportunityDiscovery, type OpportunityGraphDb } from './discovery.shared';

export const QUEUE_NAME = 'opportunity-from-intent';

export interface FromIntentJobData {
  intentId: string;
  userId: string;
  networkIds?: string[];
}

export type FromIntentDatabase = Pick<ChatDatabaseAdapter, 'getIntentForIndexing'>;

export interface FromIntentGraphInvokeOptions {
  userId: string;
  searchQuery: string;
  operationMode: 'create';
  networkId?: string;
  triggerIntentId: string;
  options: { initialStatus: 'latent' };
}

export interface FromIntentDeps {
  database?: FromIntentDatabase;
  invokeOpportunityGraph?: (opts: FromIntentGraphInvokeOptions) => Promise<void>;
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasPersonalAgent'>;
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
    options?: { jobId?: string; priority?: number },
  ): Promise<Job<FromIntentJobData>> {
    return this.queue.add('discover_opportunities', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
      jobId: options?.jobId,
      priority: options?.priority,
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
      this.logger.warn('Intent not found, skipping', { intentId });
      return;
    }

    if (networkIds && networkIds.length === 0) {
      this.logger.warn('Empty scoped networkIds provided, skipping fail-closed', { intentId, userId });
      return;
    }

    if (networkIds && networkIds.length > 1) {
      this.logger.warn('Multiple networkIds provided, only first used', { intentId, networkIds });
    }
    this.logger.info('Starting discovery', { intentId, userId, networkIds });

    const invokeOpts: FromIntentGraphInvokeOptions = {
      userId: userId as Id<'users'>,
      searchQuery: intent.payload,
      operationMode: 'create',
      networkId: networkIds?.[0] as Id<'networks'> | undefined,
      triggerIntentId: intentId,
      options: { initialStatus: 'latent' },
    };

    await runOpportunityDiscovery({
      graphDb: this.graphDb,
      deps: this.deps,
      invokeOpts,
      logger: this.logger,
      label: 'FromIntent',
      errorLabel: 'from-intent',
      logContext: { intentId, userId },
    });
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
