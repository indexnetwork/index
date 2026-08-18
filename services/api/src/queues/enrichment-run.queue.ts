import { Job } from 'bullmq';

import { PremiseGraphFactory, EnrichmentGraphFactory, createEnrichmentTools, deriveAllowedNetworkIds, getToolTimeoutPolicy, requestContext, resolveChatContext } from '@indexnetwork/protocol';
import type { EnrichmentToolDeps, PremiseGraphDatabase, EnrichmentRunInput, EnrichmentRunRecord, RawToolDefinition, ResolvedToolContext } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { captureAppException } from '../lib/sentry';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { chatDatabaseAdapter, createSystemDatabase, createUserDatabase } from '../adapters/database.adapter';
import { embedderAdapter } from '../adapters/embedder.adapter';
import { scraperAdapter } from '../adapters/scraper.adapter';
import { enricherAdapter } from '../adapters/enricher.adapter';
import { enrichmentRunAdapter } from '../adapters/enrichment-run.adapter';

export const QUEUE_NAME = 'enrichment-tool-run';

export interface EnrichmentRunJobData {
  runId: string;
}

interface EnrichmentRunQueueDeps {
  queue?: ReturnType<typeof QueueFactory.createQueue<EnrichmentRunJobData>>;
  runs?: typeof enrichmentRunAdapter;
  executeRun?: (run: EnrichmentRunRecord) => Promise<unknown>;
  createWorker?: (
    name: string,
    processor: (job: Job<EnrichmentRunJobData>) => Promise<void>,
  ) => ReturnType<typeof QueueFactory.createWorker<EnrichmentRunJobData>>;
  captureException?: typeof captureAppException;
}

function assertEnrichmentRunOutputFits(toolName: string, raw: string): void {
  const policy = getToolTimeoutPolicy(toolName);
  const outputBytes = new TextEncoder().encode(raw).byteLength;
  if (outputBytes > policy.maxOutputBytes) {
    throw new Error(
      `Profile run result exceeded MCP output cap: ${outputBytes} bytes > ${policy.maxOutputBytes} bytes`,
    );
  }
}

export class EnrichmentRunQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue: ReturnType<typeof QueueFactory.createQueue<EnrichmentRunJobData>>;

  private readonly logger = log.job.from('EnrichmentRunJob');
  private readonly queueLogger = log.queue.from('EnrichmentRunQueue');
  private readonly runs: typeof enrichmentRunAdapter;
  private readonly executeRunOverride?: (run: EnrichmentRunRecord) => Promise<unknown>;
  private readonly createWorker: NonNullable<EnrichmentRunQueueDeps['createWorker']>;
  private readonly captureException: typeof captureAppException;
  private worker: ReturnType<typeof QueueFactory.createWorker<EnrichmentRunJobData>> | null = null;

  constructor(deps: EnrichmentRunQueueDeps = {}) {
    this.queue = deps.queue ?? QueueFactory.createQueue<EnrichmentRunJobData>(QUEUE_NAME);
    this.runs = deps.runs ?? enrichmentRunAdapter;
    this.executeRunOverride = deps.executeRun;
    this.createWorker = deps.createWorker
      ?? ((name, processor) => QueueFactory.createWorker(name, processor));
    this.captureException = deps.captureException ?? captureAppException;
  }

  async enqueue(runId: string): Promise<{ jobId?: string | number }> {
    const job = await this.queue.add('run_profile_tool', { runId }, {
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

  async processJob(name: string, data: EnrichmentRunJobData): Promise<void> {
    switch (name) {
      case 'run_profile_tool':
        await this.handleRun(data.runId);
        break;
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<EnrichmentRunJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id });
      await this.processJob(job.name, job.data);
    };
    this.worker = this.createWorker(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async handleRun(runId: string): Promise<void> {
    const run = await this.runs.markRunning(runId);
    if (!run) return;
    if (await this.runs.isCancelRequested(runId)) {
      await this.runs.markCancelled(runId, 'cancelled before start');
      return;
    }

    const abortController = new AbortController();
    const cancelPoll = setInterval(() => {
      this.runs.isCancelRequested(runId)
        .then((cancelled) => {
          if (cancelled && !abortController.signal.aborted) {
            abortController.abort(new Error('Profile run cancelled'));
          }
        })
        .catch((err) => this.logger.warn('Cancel poll failed', {
          runId,
          error: err instanceof Error ? err.message : String(err),
        }));
    }, 1000);

    try {
      await this.runs.updateProgress(runId, { stage: 'running', operation: run.operation });
      const result = await requestContext.run(
        { abortSignal: abortController.signal },
        () => this.executeRunOverride ? this.executeRunOverride(run) : this.executeRun(run),
      );
      if (abortController.signal.aborted || await this.runs.isCancelRequested(runId)) {
        await this.runs.markCancelled(runId, 'cancelled');
        return;
      }
      await this.runs.markSucceeded(runId, result);
      this.logger.info('Completed', { runId, userId: run.userId, operation: run.operation });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (abortController.signal.aborted || await this.runs.isCancelRequested(runId)) {
        await this.runs.markCancelled(runId, message);
        return;
      }
      await this.runs.markFailed(runId, message);
      this.logger.error('Failed', { runId, userId: run.userId, operation: run.operation, error: message });
      this.captureException(err, {
        subsystem: 'protocol',
        operation: 'enrichment-run.queue',
        tags: {
          queue: QUEUE_NAME,
          runId,
          toolName: run.operation,
        },
        context: { runId, userId: run.userId, operation: run.operation },
        userId: run.userId,
      });
      throw err;
    } finally {
      clearInterval(cancelPoll);
    }
  }

  private async executeRun(run: EnrichmentRunRecord): Promise<unknown> {
    const resolved = await resolveChatContext({
      database: chatDatabaseAdapter,
      userId: run.userId,
      networkId: run.context.scopeType === 'network' ? run.context.scopeId : undefined,
      sessionId: run.context.sessionId,
    });
    const context: ResolvedToolContext = {
      ...resolved,
      ...(run.context.scopeType && run.context.scopeId
        ? { scopeType: run.context.scopeType, scopeId: run.context.scopeId }
        : {}),
      isMcp: false,
      ...(run.agentId ? { agentId: run.agentId } : {}),
    };
    const allowedNetworkIds = deriveAllowedNetworkIds({
      memberships: context.userNetworks,
      ...(context.scopeType && context.scopeId ? { scopeType: context.scopeType, scopeId: context.scopeId } : {}),
    });

    const userDb = createUserDatabase(chatDatabaseAdapter, run.userId);
    const systemDb = createSystemDatabase(chatDatabaseAdapter, run.userId, allowedNetworkIds, embedderAdapter);
    const premiseGraph = new PremiseGraphFactory(chatDatabaseAdapter as unknown as PremiseGraphDatabase, embedderAdapter).createGraph();
    const profileGraph = new EnrichmentGraphFactory(
      chatDatabaseAdapter,
      scraperAdapter,
      enricherAdapter,
      premiseGraph,
    ).createGraph();

    const rawTools = new Map<string, RawToolDefinition>();
    createEnrichmentTools(((opts: {
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
      userDb,
      systemDb,
      enricher: enricherAdapter,
      graphs: {
        profile: profileGraph,
      },
      reportToolError: (error: unknown, report: { subsystem?: string; operation: string; tags?: Record<string, string | number | boolean | null | undefined>; context?: Record<string, unknown>; userId?: string }) => captureAppException(error, {
        subsystem: report.subsystem ?? 'protocol',
        operation: report.operation,
        tags: report.tags,
        context: report.context,
        userId: report.userId,
      }),
    } satisfies EnrichmentToolDeps);

    const tool = rawTools.get(run.operation);
    if (!tool) throw new Error(`${run.operation} handler not available`);
    const raw = await tool.handler({ context, query: run.input as EnrichmentRunInput });
    assertEnrichmentRunOutputFits(run.operation, raw);
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}

export const enrichmentRunQueue = new EnrichmentRunQueue();
