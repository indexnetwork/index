import { Job } from 'bullmq';

import { PremiseGraphFactory, ProfileGraphFactory, createProfileTools, getToolTimeoutPolicy, requestContext, resolveChatContext } from '@indexnetwork/protocol';
import type { CompiledGraph, PremiseGraphDatabase, ProfileRunInput, ProfileRunRecord, RawToolDefinition, ResolvedToolContext, ToolDeps } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { captureAppException } from '../lib/sentry';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { chatDatabaseAdapter, createSystemDatabase, createUserDatabase } from '../adapters/database.adapter';
import { embedderAdapter } from '../adapters/embedder.adapter';
import { cacheAdapter } from '../adapters/cache.adapter';
import { scraperAdapter } from '../adapters/scraper.adapter';
import { enricherAdapter } from '../adapters/enricher.adapter';
import { profileRunAdapter } from '../adapters/profile-run.adapter';
import { questionerEnqueueIfEnabled } from './questioner.queue';

export const QUEUE_NAME = 'profile-tool-run';

export interface ProfileRunJobData {
  runId: string;
}

function assertProfileRunOutputFits(toolName: string, raw: string): void {
  const policy = getToolTimeoutPolicy(toolName);
  const outputBytes = new TextEncoder().encode(raw).byteLength;
  if (outputBytes > policy.maxOutputBytes) {
    throw new Error(
      `Profile run result exceeded MCP output cap: ${outputBytes} bytes > ${policy.maxOutputBytes} bytes`,
    );
  }
}

export class ProfileRunQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<ProfileRunJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('ProfileRunJob');
  private readonly queueLogger = log.queue.from('ProfileRunQueue');
  private worker: ReturnType<typeof QueueFactory.createWorker<ProfileRunJobData>> | null = null;

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

  async processJob(name: string, data: ProfileRunJobData): Promise<void> {
    switch (name) {
      case 'run_profile_tool':
        await this.handleRun(data.runId);
        break;
      default:
        this.queueLogger.warn(`[ProfileRunProcessor] Unknown job name: ${name}`);
    }
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<ProfileRunJobData>) => {
      this.queueLogger.info(`[ProfileRunProcessor] Processing job ${job.id}`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<ProfileRunJobData>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async handleRun(runId: string): Promise<void> {
    const run = await profileRunAdapter.markRunning(runId);
    if (!run) return;
    if (await profileRunAdapter.isCancelRequested(runId)) {
      await profileRunAdapter.markCancelled(runId, 'cancelled before start');
      return;
    }

    const abortController = new AbortController();
    const cancelPoll = setInterval(() => {
      profileRunAdapter.isCancelRequested(runId)
        .then((cancelled) => {
          if (cancelled && !abortController.signal.aborted) {
            abortController.abort(new Error('Profile run cancelled'));
          }
        })
        .catch((err) => this.logger.warn('[ProfileRun] cancel poll failed', {
          runId,
          error: err instanceof Error ? err.message : String(err),
        }));
    }, 1000);

    try {
      await profileRunAdapter.updateProgress(runId, { stage: 'running', operation: run.operation });
      const result = await requestContext.run({ abortSignal: abortController.signal }, () => this.executeRun(run));
      if (abortController.signal.aborted || await profileRunAdapter.isCancelRequested(runId)) {
        await profileRunAdapter.markCancelled(runId, 'cancelled');
        return;
      }
      await profileRunAdapter.markSucceeded(runId, result);
      this.logger.info('[ProfileRun] Completed', { runId, userId: run.userId, operation: run.operation });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (abortController.signal.aborted || await profileRunAdapter.isCancelRequested(runId)) {
        await profileRunAdapter.markCancelled(runId, message);
        return;
      }
      await profileRunAdapter.markFailed(runId, message);
      this.logger.error('[ProfileRun] Failed', { runId, userId: run.userId, operation: run.operation, error: message });
      captureAppException(err, {
        subsystem: 'protocol',
        operation: 'profile-run.queue',
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

  private async executeRun(run: ProfileRunRecord): Promise<unknown> {
    const resolved = await resolveChatContext({
      database: chatDatabaseAdapter,
      userId: run.userId,
      networkId: run.context.networkId,
      sessionId: run.context.sessionId,
    });
    const context: ResolvedToolContext = {
      ...resolved,
      indexScope: run.context.indexScope ?? resolved.indexScope,
      isMcp: false,
      ...(run.agentId ? { agentId: run.agentId } : {}),
      ...(run.context.clientSurface ? { clientSurface: run.context.clientSurface } : {}),
    };

    const userDb = createUserDatabase(chatDatabaseAdapter, run.userId);
    const systemDb = createSystemDatabase(chatDatabaseAdapter, run.userId, context.indexScope, embedderAdapter);
    const premiseGraph = new PremiseGraphFactory(chatDatabaseAdapter as unknown as PremiseGraphDatabase, embedderAdapter).createGraph();
    const profileGraph = new ProfileGraphFactory(
      chatDatabaseAdapter,
      scraperAdapter,
      enricherAdapter,
      // Env-gated questioner enqueue: async profile runs generate
      // profile-gap questions just like the MCP composition root.
      questionerEnqueueIfEnabled(),
      premiseGraph,
    ).createGraph();

    const rawTools = new Map<string, RawToolDefinition>();
    createProfileTools(((opts: {
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
      enricher: enricherAdapter,
      negotiationDatabase: {} as ToolDeps['negotiationDatabase'],
      graphs: {
        profile: profileGraph,
        intent: { invoke: async () => ({}) } as CompiledGraph,
        index: { invoke: async () => ({}) } as CompiledGraph,
        networkMembership: { invoke: async () => ({}) } as CompiledGraph,
        intentIndex: { invoke: async () => ({}) } as CompiledGraph,
        opportunity: { invoke: async () => ({}) } as CompiledGraph,
        premise: premiseGraph,
      } as unknown as ToolDeps['graphs'],
      reportToolError: (error: unknown, report: { subsystem?: string; operation: string; tags?: Record<string, string | number | boolean | null | undefined>; context?: Record<string, unknown>; userId?: string }) => captureAppException(error, {
        subsystem: report.subsystem ?? 'protocol',
        operation: report.operation,
        tags: report.tags,
        context: report.context,
        userId: report.userId,
      }),
    });

    const tool = rawTools.get(run.operation);
    if (!tool) throw new Error(`${run.operation} handler not available`);
    const raw = await tool.handler({ context, query: run.input as ProfileRunInput });
    assertProfileRunOutputFits(run.operation, raw);
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}

export const profileRunQueue = new ProfileRunQueue();
