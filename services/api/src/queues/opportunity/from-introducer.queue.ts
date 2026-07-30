// services/api/src/queues/opportunity/from-introducer.queue.ts
import { Job } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import type { Id } from '../../types/common.types';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { isIntroducerDiscoveryEnabled, type NegotiationGraphLike, type AgentDispatcher } from '@indexnetwork/protocol';

import { createOpportunityGraphDb, runOpportunityDiscovery, type OpportunityGraphDb } from './discovery.shared';

export const QUEUE_NAME = 'opportunity-from-introducer';

export interface FromIntroducerJobData {
  userId: string;
  contactUserId: string;
  networkIds?: string[];
}

export type FromIntroducerDatabase = Pick<ChatDatabaseAdapter, 'getActiveIntents'>;

export interface FromIntroducerGraphInvokeOptions {
  userId: string;
  searchQuery: string;
  operationMode: 'create';
  networkId?: string;
  onBehalfOfUserId: string;
  options: { initialStatus: 'latent' };
}

export interface FromIntroducerDeps {
  database?: FromIntroducerDatabase;
  invokeOpportunityGraph?: (opts: FromIntroducerGraphInvokeOptions) => Promise<void>;
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>;
}

export class FromIntroducerQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<FromIntroducerJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('FromIntroducerJob');
  private readonly queueLogger = log.queue.from('FromIntroducerQueue');
  private readonly database: FromIntroducerDatabase | ChatDatabaseAdapter;
  private readonly graphDb: OpportunityGraphDb;
  private deps: FromIntroducerDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<FromIntroducerJobData>> | null = null;

  constructor(deps?: FromIntroducerDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    this.graphDb = createOpportunityGraphDb(this.database);
  }

  setRuntimeDeps(runtimeDeps: Pick<FromIntroducerDeps, 'negotiationGraph' | 'agentDispatcher'>): void {
    this.deps = { ...(this.deps ?? {}), ...runtimeDeps };
  }

  async addJob(
    data: FromIntroducerJobData,
    options?: { jobId?: string; priority?: number },
  ): Promise<Job<FromIntroducerJobData>> {
    return this.queue.add('discover_opportunities', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
      jobId: options?.jobId,
      priority: options?.priority,
    });
  }

  async processJob(name: string, data: FromIntroducerJobData): Promise<void> {
    switch (name) {
      case 'discover_opportunities':
        await this.handleDiscover(data);
        break;
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  private async handleDiscover(data: FromIntroducerJobData): Promise<void> {
    const { userId, contactUserId, networkIds } = data;
    if (!isIntroducerDiscoveryEnabled()) {
      this.logger.info('Introducer discovery skipped — disabled by configuration', {
        userId: data.userId,
        contactUserId: data.contactUserId,
      });
      return;
    }

    // `this.database` is already `deps?.database ?? new ChatDatabaseAdapter()` and
    // setRuntimeDeps never replaces `database`, so this is the injected db when provided.
    const contactIntents = await this.database.getActiveIntents(contactUserId);
    if (contactIntents.length === 0) {
      this.logger.warn('Contact has no active intents, skipping', { contactUserId, userId });
      return;
    }

    if (networkIds && networkIds.length > 1) {
      this.logger.warn('Multiple networkIds provided, only first used', { userId, contactUserId, networkIds });
    }
    this.logger.info('Starting discovery', { userId, contactUserId, networkIds });

    const invokeOpts: FromIntroducerGraphInvokeOptions = {
      userId: userId as Id<'users'>,
      searchQuery: contactIntents[0].payload,
      operationMode: 'create',
      networkId: networkIds?.[0] as Id<'networks'> | undefined,
      onBehalfOfUserId: contactUserId,
      options: { initialStatus: 'latent' },
    };

    await runOpportunityDiscovery({
      graphDb: this.graphDb,
      deps: this.deps,
      invokeOpts,
      logger: this.logger,
      label: 'FromIntroducer',
      errorLabel: 'from-introducer',
      logContext: { userId, contactUserId },
    });
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<FromIntroducerJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id });
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<FromIntroducerJobData>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}

export const fromIntroducerQueue = new FromIntroducerQueue();
