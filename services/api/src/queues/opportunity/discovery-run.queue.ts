import { Job } from 'bullmq';

import { deriveAllowedNetworkIds, HydeGenerator, HydeGraphFactory, LensInferrer, OpportunityGraphFactory, PoolAxisMiner, POOL_AXIS_MAX_CANDIDATES, POOL_AXIS_MAX_PUBLIC_CONTEXT_CHARS, POOL_AXIS_MIN_POOL_SIZE, createOpportunityTools, getToolTimeoutPolicy, poolQuestionsMiningMode, requestContext, resolveChatContext, runPoolAxisShadow } from '@indexnetwork/protocol';
import type { AgentDispatcher, CompiledGraph, DiscoveryRunInput, DiscoveryRunRecord, HydeGraphDatabase, NegotiationGraphLike, OpportunityGraphDatabase, PoolAxisCandidate, RawToolDefinition, ResolvedToolContext, ToolDeps } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { captureAppException } from '../../lib/sentry';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { chatDatabaseAdapter, createSystemDatabase, createUserDatabase } from '../../adapters/database.adapter';
import { embedderAdapter } from '../../adapters/embedder.adapter';
import { cacheAdapter, hydeCacheAdapter, RedisCacheAdapter } from '../../adapters/cache.adapter';
import { scraperAdapter } from '../../adapters/scraper.adapter';
import { discoveryRunAdapter } from '../../adapters/discovery-run.adapter';
import { mintConnectLink as mintConnectLinkSvc, buildConnectShortUrl } from '../../services/connect-link.service';
import { resolveProtocolBaseUrl } from '../../lib/protocol-url';
import type { ConnectLinkKind } from '../../services/connect-link.service';
import { negotiationRunExistingQueue } from '../negotiations/run-existing.queue';
import { questionerEnqueueIfEnabled } from '../questioner.queue';

export const QUEUE_NAME = 'opportunity-discovery-run';

export interface DiscoveryRunJobData {
  runId: string;
}

export interface DiscoveryRunQueueDeps {
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>;
}

const apiBaseUrl = resolveProtocolBaseUrl();

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

/**
 * Minimal shape of one discovery-result candidate needed for pool-axis
 * mining (a subset of the protocol's FormattedDiscoveryCandidate).
 */
interface DiscoveryResultCandidate {
  opportunityId?: unknown;
  userId?: unknown;
  name?: unknown;
  bio?: unknown;
  matchReason?: unknown;
  score?: unknown;
  presentation?: { headline?: unknown };
  homeCardPresentation?: { headline?: unknown };
}

/** One extracted candidate usable for pool-axis mining. */
interface ExtractedCandidate {
  opportunityId: string;
  userId: string;
  name?: string;
  bio?: string;
  matchReason?: string;
  headline?: string;
  score: number;
}

/** Extracts usable pool candidates from a completed discovery-run result. */
function extractDiscoveryCandidates(result: unknown): ExtractedCandidate[] {
  const opportunities = (result as { opportunities?: unknown })?.opportunities;
  if (!Array.isArray(opportunities)) return [];
  const out: ExtractedCandidate[] = [];
  for (const raw of opportunities as DiscoveryResultCandidate[]) {
    if (typeof raw?.opportunityId !== 'string' || typeof raw?.userId !== 'string') continue;
    const headline = raw.homeCardPresentation?.headline ?? raw.presentation?.headline;
    out.push({
      opportunityId: raw.opportunityId,
      userId: raw.userId,
      ...(typeof raw.name === 'string' && raw.name ? { name: raw.name } : {}),
      ...(typeof raw.bio === 'string' && raw.bio ? { bio: raw.bio } : {}),
      ...(typeof raw.matchReason === 'string' && raw.matchReason ? { matchReason: raw.matchReason } : {}),
      ...(typeof headline === 'string' && headline ? { headline } : {}),
      score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0,
    });
  }
  return out;
}

/** Splits free text into novelty-reference sentences (short fragments dropped). */
function toReferenceSentences(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

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
  /** Greppable shadow-mining logger (IND-417): search deploy logs for "PoolAxisMiner". */
  private readonly poolAxisLogger = log.job.from('PoolAxisMiner');
  /** Lazily constructed so queue creation never requires OPENROUTER_API_KEY. */
  private poolAxisMiner: PoolAxisMiner | null = null;
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
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<DiscoveryRunJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id });
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
        .catch((err) => this.logger.warn('Cancel poll failed', {
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
      this.logger.info('Completed', { runId, userId: run.userId });
      this.maybeMinePoolAxes(run, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (abortController.signal.aborted || await discoveryRunAdapter.isCancelRequested(runId)) {
        await discoveryRunAdapter.markCancelled(runId, message);
        return;
      }
      await discoveryRunAdapter.markFailed(runId, message);
      this.logger.error('Failed', { runId, userId: run.userId, error: message });
      captureAppException(err, {
        subsystem: 'protocol',
        operation: 'discovery-run.queue',
        tags: {
          queue: QUEUE_NAME,
          runId,
        },
        context: { runId, userId: run.userId },
        userId: run.userId,
      });
      throw err;
    } finally {
      clearInterval(cancelPoll);
    }
  }

  private async executeRun(run: DiscoveryRunRecord): Promise<unknown> {
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
      isMcp: true,
      ...(run.agentId ? { agentId: run.agentId } : {}),
      ...(run.context.clientSurface ? { clientSurface: run.context.clientSurface } : {}),
    };
    const allowedNetworkIds = deriveAllowedNetworkIds({
      memberships: context.userNetworks,
      ...(context.scopeType && context.scopeId
        ? { scopeType: context.scopeType, scopeId: context.scopeId }
        : {}),
    });

    const userDb = createUserDatabase(chatDatabaseAdapter, run.userId);
    const systemDb = createSystemDatabase(chatDatabaseAdapter, run.userId, allowedNetworkIds, embedderAdapter);
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

    // Env-gated questioner enqueue: queued/async discovery runs generate
    // discovery-mode questions exactly like synchronous MCP discover calls
    // (the tool computes enableQuestions from QUESTIONER_ENABLED + QUESTIONER_DISCOVERY_ENABLED +
    // context.isMcp, which is true here).
    const questionerEnqueue = questionerEnqueueIfEnabled();

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
      frontendUrl: process.env.WEB_APP_URL ?? 'https://index.network',
      apiBaseUrl,
      ...(questionerEnqueue && { questionerEnqueue }),
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

  /**
   * IND-417 shadow axis mining. Fire-and-forget: never awaited by the run
   * lifecycle and never allowed to fail the discovery run. Active only when
   * POOL_QUESTIONS_MINING=shadow; flag off = zero behavior change.
   */
  private maybeMinePoolAxes(run: DiscoveryRunRecord, result: unknown): void {
    if (poolQuestionsMiningMode() !== 'shadow') return;
    void this.minePoolAxesShadow(run, result).catch((err) => {
      this.poolAxisLogger.warn('pool-axis.miner shadow pass failed', {
        runId: run.id,
        userId: run.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private async minePoolAxesShadow(run: DiscoveryRunRecord, result: unknown): Promise<void> {
    const extracted = extractDiscoveryCandidates(result);
    if (extracted.length < POOL_AXIS_MIN_POOL_SIZE) {
      this.poolAxisLogger.debug('pool-axis.miner skipped: pool below k-anonymity floor', {
        runId: run.id,
        poolSize: extracted.length,
        minPoolSize: POOL_AXIS_MIN_POOL_SIZE,
      });
      return;
    }

    const top = [...extracted]
      .sort((a, b) => b.score - a.score)
      .slice(0, POOL_AXIS_MAX_CANDIDATES);

    // ≤3 active premise snippets per candidate enrich the thin (≤100 char)
    // bio/matchReason context — the same corpus the presenter exposes.
    const uniqueUserIds = [...new Set(top.map((c) => c.userId))];
    const premisesByUser = new Map<string, string>();
    await Promise.all(uniqueUserIds.map(async (uid) => {
      try {
        const premises = await chatDatabaseAdapter.getPremisesForUser(uid, 'ACTIVE');
        const snippets = premises.slice(0, 3).map((p) => p.assertion.text.slice(0, 90));
        if (snippets.length > 0) premisesByUser.set(uid, snippets.join('; '));
      } catch {
        // Premises are enrichment only — a failed lookup never blocks mining.
      }
    }));

    const candidates: PoolAxisCandidate[] = top.map((c) => {
      const publicContext = [
        c.name ? `Name: ${c.name}.` : null,
        c.bio ? `Bio: ${c.bio}` : null,
        c.matchReason ? `Match: ${c.matchReason}` : null,
        c.headline ? `Headline: ${c.headline}` : null,
        premisesByUser.has(c.userId) ? `Premises: ${premisesByUser.get(c.userId)}` : null,
      ].filter(Boolean).join(' ').slice(0, POOL_AXIS_MAX_PUBLIC_CONTEXT_CHARS);
      return { id: c.opportunityId, publicContext, score: c.score };
    });

    // Intent text: prefer the triggering intent record; fall back to the ad-hoc query.
    let intentText = run.input.searchQuery ?? run.input.hint ?? '';
    const intentId = run.input.intentId;
    if (intentId) {
      const intent = await chatDatabaseAdapter.getIntent(intentId);
      if (intent) intentText = `${intent.payload}${intent.summary ? ` (${intent.summary})` : ''}`;
    }

    // Novelty references: the owner's own intent sentences + active premises —
    // axes the user has effectively already answered should score ~0.
    let ownerPremises: string[] = [];
    try {
      ownerPremises = (await chatDatabaseAdapter.getPremisesForUser(run.userId, 'ACTIVE'))
        .slice(0, 12)
        .map((p) => p.assertion.text);
    } catch {
      // Novelty degrades gracefully without references.
    }
    const referenceTexts = [...toReferenceSentences(intentText), ...ownerPremises];

    this.poolAxisMiner ??= new PoolAxisMiner();
    const shadow = await runPoolAxisShadow({
      intentText,
      candidates,
      referenceTexts,
      miner: this.poolAxisMiner,
      embedder: embedderAdapter,
    });

    const round = (n: number): number => Math.round(n * 1000) / 1000;
    this.poolAxisLogger.info('pool-axis.miner shadow result', {
      runId: run.id,
      userId: run.userId,
      intentId: intentId ?? null,
      poolSize: shadow.poolSize,
      axes: shadow.axes.map((a) => ({
        axis: a.axis,
        questionSeed: a.questionSeed,
        sides: a.sides,
        voi: round(a.voi),
        entropy: round(a.entropy),
        coverage: round(a.coverage),
        novelty: round(a.novelty),
        evidenceRate: round(a.evidenceRate),
      })),
    });
  }
}

export const discoveryRunQueue = new DiscoveryRunQueue();

