import { Job } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import type { Id } from '../../types/common.types';
import type { NegotiationGraphLike, AgentDispatcher } from '@indexnetwork/protocol';

import { createOpportunityGraphDb, runOpportunityDiscovery, type OpportunityGraphDb } from './discovery.shared';

export const QUEUE_NAME = 'opportunity-from-enrichment';

export interface FromEnrichmentJobData {
  userId: string;
  networkId?: string;
}

export interface FromEnrichmentGraphInvokeOptions {
  userId: string;
  operationMode: 'create';
  networkId?: string;
  options: { initialStatus: 'latent' };
}

export interface FromEnrichmentDeps {
  invokeOpportunityGraph?: (opts: FromEnrichmentGraphInvokeOptions) => Promise<void>;
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>;
}

/**
 * Profile-to-profile opportunity discovery queue.
 *
 * Invokes OpportunityGraph with only userId (+ optional networkId), no
 * searchQuery or triggerIntentId. The graph falls back to profile-embedding
 * vector search, discovering connections based on profile similarity.
 *
 * Triggered after profile enrichment completes for experiment-network imports
 * and headless signups.
 */
export class FromEnrichmentQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<FromEnrichmentJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('FromEnrichmentJob');
  private readonly queueLogger = log.queue.from('FromEnrichmentQueue');
  private readonly graphDb: OpportunityGraphDb;
  private deps: FromEnrichmentDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<FromEnrichmentJobData>> | null = null;

  constructor(deps?: FromEnrichmentDeps) {
    this.deps = deps;
    this.graphDb = createOpportunityGraphDb();
  }

  setRuntimeDeps(runtimeDeps: Pick<FromEnrichmentDeps, 'negotiationGraph' | 'agentDispatcher'>): void {
    this.deps = { ...(this.deps ?? {}), ...runtimeDeps };
  }

  async addJob(
    data: FromEnrichmentJobData,
    options?: { jobId?: string; priority?: number },
  ): Promise<Job<FromEnrichmentJobData>> {
    return this.queue.add('discover_opportunities', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
      jobId: options?.jobId,
      priority: options?.priority,
    });
  }

  async processJob(name: string, data: FromEnrichmentJobData): Promise<void> {
    switch (name) {
      case 'discover_opportunities':
        await this.handleDiscover(data);
        break;
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  private async handleDiscover(data: FromEnrichmentJobData): Promise<void> {
    const { userId, networkId } = data;

    this.logger.info('Starting profile-based discovery', { userId, networkId });

    const invokeOpts: FromEnrichmentGraphInvokeOptions = {
      userId: userId as Id<'users'>,
      operationMode: 'create',
      networkId: networkId as Id<'networks'> | undefined,
      options: { initialStatus: 'latent' },
    };

    await runOpportunityDiscovery({
      graphDb: this.graphDb,
      deps: this.deps,
      invokeOpts,
      logger: this.logger,
      label: 'FromEnrichment',
      errorLabel: 'from-enrichment',
      logContext: { userId, networkId },
      logTrace: false,
    });
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<FromEnrichmentJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id });
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<FromEnrichmentJobData>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}

export const fromEnrichmentQueue = new FromEnrichmentQueue();
