import { Job } from 'bullmq';

import {
  HydeGenerator,
  HydeGraphFactory,
  LensInferrer,
  OpportunityGraphFactory,
  createOpportunityTools,
  getToolTimeoutPolicy,
  requestContext,
  resolveChatContext,
} from '@indexnetwork/protocol';
import type {
  AgentDispatcher,
  CompiledGraph,
  DiscoveryRunInput,
  DiscoveryRunRecord,
  HydeGraphDatabase,
  NegotiationGraphLike,
  OpportunityGraphDatabase,
  RawToolDefinition,
  ResolvedToolContext,
  ToolDeps,
} from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { chatDatabaseAdapter, createSystemDatabase, createUserDatabase } from '../../adapters/database.adapter';
import { embedderAdapter } from '../../adapters/embedder.adapter';
import { cacheAdapter, hydeCacheAdapter, RedisCacheAdapter } from '../../adapters/cache.adapter';
import { scraperAdapter } from '../../adapters/scraper.adapter';
import { discoveryRunAdapter } from '../../adapters/discovery-run.adapter';
import { mintConnectLink as mintConnectLinkSvc, buildConnectShortUrl } from '../../services/connect-link.service';
import type { ConnectLinkKind } from '../../services/connect-link.service';
import { negotiationRunExistingQueue } from '../negotiations/run-existing.queue';

export const QUEUE_NAME = 'opportunity-discovery-run';

export interface DiscoveryRunJobData {
  runId: string;
}

export interface DiscoveryRunQueueDeps {
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasPersonalAgent'>;
}

const apiBaseUrl = (
  process.env.BASE_URL ||
  process.env.API_BASE_URL ||
  process.env.APP_URL ||
  'http://localhost:3001'
).replace(/\/+$/, '');

const mintConnectLink = async ({ userId, opportunityId, kind, greeting, preferredSurface }: {
  userId: string;
  opportunityId: string;
  kind: ConnectLinkKind;
  greeting?: string | null;
  preferredSurface?: 'telegram' | 'web';
}): Promise<{ url: string }> => {
  const { code } = await mintConnectLinkSvc({ userId, opportunityId, kind, greeting, preferredSurface });
  return { url: buildConnectShortUrl(apiBaseUrl, code) };
};

function assertDiscoveryRunOutputFits(raw: string): void {
  const policy = getToolTimeoutPolicy('discover_opportunities');
  const outputBytes = new TextEncoder().encode(raw).byteLength;
  if (outputBytes > policy.maxOutputBytes) {
    throw new Error(
      `Discovery run result exceeded MCP output cap: ${outputBytes} bytes > ${policy.maxOutputBytes} bytes`,
    );
  }
}

export class DiscoveryRunQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<DiscoveryRunJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('DiscoveryRunJob');
  private readonly queueLogger = log.queue.from('DiscoveryRunQueue');
  private worker: ReturnType<typeof QueueFactory.createWorker<DiscoveryRunJobData>> | null = null;
  private deps: DiscoveryRunQueueDeps | undefined;

  setRuntimeDeps(deps: DiscoveryRunQueueDeps): void {
    this.deps = { ...(this.deps ?? {}), ...deps };
  }

  async enqueue(runId: string): Promise<{ jobId?: string | number }> {
    const job = await this.queue.add('run_discovery', { runId }, {
      attempts: 1,
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
      jobId: runId,
      priority: 10,
    });
    return { jobId: job.id };
  }

  async cancel(runId: string): Promise<boolean> {
    const job = await this.queue.getJob(runId);
    if (!job) return false;
    const state = await job.getState();
    if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
      await job.remove();
      return true;
    }
    return false;
  }

  async processJob(name: string, data: DiscoveryRunJobData): Promise<void> {
    switch (name) {
      case 'run_discovery':
        await this.handleRun(data.runId);
        break;
      default:
        this.queueLogger.warn(`[DiscoveryRunProcessor] Unknown job name: ${name}`);
    }
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<DiscoveryRunJobData>) => {
      this.queueLogger.info(`[DiscoveryRunProcessor] Processing job ${job.id}`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<DiscoveryRunJobData>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async handleRun(runId: string): Promise<void> {
    const run = await discoveryRunAdapter.markRunning(runId);
    if (!run) return;
    if (await discoveryRunAdapter.isCancelRequested(runId)) {
      await discoveryRunAdapter.markCancelled(runId, 'cancelled before start');
      return;
    }

    const abortController = new AbortController();
    const cancelPoll = setInterval(() => {
      discoveryRunAdapter.isCancelRequested(runId)
        .then((cancelled) => {
          if (cancelled && !abortController.signal.aborted) {
            abortController.abort(new Error('Discovery run cancelled'));
          }
        })
        .catch((err) => this.logger.warn('[DiscoveryRun] cancel poll failed', {
          runId,
          error: err instanceof Error ? err.message : String(err),
        }));
    }, 1000);

    try {
      await discoveryRunAdapter.updateProgress(runId, { stage: 'discovering' });
      const result = await requestContext.run({ abortSignal: abortController.signal }, () => this.executeRun(run));
      if (abortController.signal.aborted || await discoveryRunAdapter.isCancelRequested(runId)) {
        await discoveryRunAdapter.markCancelled(runId, 'cancelled');
        return;
      }
      await discoveryRunAdapter.markSucceeded(runId, result);
      this.logger.info('[DiscoveryRun] Completed', { runId, userId: run.userId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (abortController.signal.aborted || await discoveryRunAdapter.isCancelRequested(runId)) {
        await discoveryRunAdapter.markCancelled(runId, message);
        return;
      }
      await discoveryRunAdapter.markFailed(runId, message);
      this.logger.error('[DiscoveryRun] Failed', { runId, userId: run.userId, error: message });
      throw err;
    } finally {
      clearInterval(cancelPoll);
    }
  }

  private async executeRun(run: DiscoveryRunRecord): Promise<unknown> {
    const resolved = await resolveChatContext({
      database: chatDatabaseAdapter,
      userId: run.userId,
      networkId: run.context.networkId,
      sessionId: run.context.sessionId,
    });
    const context: ResolvedToolContext = {
      ...resolved,
      indexScope: run.context.indexScope ?? resolved.indexScope,
      isMcp: true,
      ...(run.agentId ? { agentId: run.agentId } : {}),
      ...(run.context.clientSurface ? { clientSurface: run.context.clientSurface } : {}),
    };

    const userDb = createUserDatabase(chatDatabaseAdapter, run.userId);
    const systemDb = createSystemDatabase(chatDatabaseAdapter, run.userId, context.indexScope, embedderAdapter);
    const graphDb = chatDatabaseAdapter as unknown as OpportunityGraphDatabase & HydeGraphDatabase;
    const hydeGraph = new HydeGraphFactory(
      graphDb,
      embedderAdapter,
      hydeCacheAdapter ?? new RedisCacheAdapter(),
      new LensInferrer(),
      new HydeGenerator(),
    ).createGraph();
    const opportunityGraph = new OpportunityGraphFactory(
      graphDb,
      embedderAdapter,
      hydeGraph,
      undefined,
      undefined,
      this.deps?.negotiationGraph,
      this.deps?.agentDispatcher,
      async (opportunityId: string, userId: string) => {
        await negotiationRunExistingQueue.addJob({ opportunityId, userId });
      },
    ).createGraph();

    const rawTools = new Map<string, RawToolDefinition>();
    createOpportunityTools(((opts: {
      name: string;
      description: string;
      querySchema: RawToolDefinition['schema'];
      handler: RawToolDefinition['handler'];
    }) => {
      rawTools.set(opts.name, {
        name: opts.name,
        description: opts.description,
        schema: opts.querySchema,
        handler: opts.handler,
      });
      return null;
    }) as never, {
      database: chatDatabaseAdapter,
      userDb,
      systemDb,
      scraper: scraperAdapter,
      embedder: embedderAdapter,
      cache: cacheAdapter,
      integration: {} as ToolDeps['integration'],
      contactService: {} as ToolDeps['contactService'],
      integrationImporter: {} as ToolDeps['integrationImporter'],
      enricher: {} as ToolDeps['enricher'],
      negotiationDatabase: {} as ToolDeps['negotiationDatabase'],
      mintConnectLink,
      frontendUrl: process.env.FRONTEND_URL ?? process.env.APP_URL ?? 'https://index.network',
      apiBaseUrl,
      graphs: {
        profile: { invoke: async () => ({}) } as CompiledGraph,
        intent: { invoke: async () => ({}) } as CompiledGraph,
        index: { invoke: async () => ({}) } as CompiledGraph,
        networkMembership: { invoke: async () => ({}) } as CompiledGraph,
        intentIndex: { invoke: async () => ({}) } as CompiledGraph,
        opportunity: opportunityGraph,
        premise: { invoke: async () => ({}) } as CompiledGraph,
      },
    });

    const discover = rawTools.get('discover_opportunities');
    if (!discover) throw new Error('discover_opportunities handler not available');
    const raw = await discover.handler({ context, query: run.input as DiscoveryRunInput });
    assertDiscoveryRunOutputFits(raw);
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}

export const discoveryRunQueue = new DiscoveryRunQueue();
