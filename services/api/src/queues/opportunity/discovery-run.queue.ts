import { Job } from 'bullmq';

import { deriveAllowedNetworkIds, HydeGenerator, HydeGraphFactory, LensInferrer, OpportunityGraphFactory, PoolDiscriminatorMiner, POOL_DISCRIMINATOR_MAX_CANDIDATES, POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS, POOL_DISCRIMINATOR_MIN_POOL_SIZE, createOpportunityTools, getToolTimeoutPolicy, poolQuestionsMiningMode, poolQuestionsMode, requestContext, resolveChatContext, runPoolDiscriminatorShadow, selectQuestionDiscriminators, toQuestionDiscriminator } from '@indexnetwork/protocol';
import type { AgentDispatcher, CompiledGraph, DiscoveryRunInput, DiscoveryRunRecord, HydeGraphDatabase, NegotiationGraphLike, OpportunityGraphDatabase, PoolCandidate, RawToolDefinition, ResolvedToolContext, ToolDeps } from '@indexnetwork/protocol';

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

/** Statuses that make an opportunity part of the viewer's live candidate pool. */
const POOL_STATUSES = ['draft', 'latent', 'pending', 'negotiating'] as const;

/** Max chars of bio / match-reason folded into one candidate's publicContext. */
const POOL_FIELD_MAX_CHARS = 100;

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
  /** Greppable shadow-mining logger (IND-417): search deploy logs for "PoolDiscriminatorMiner". */
  private readonly poolDiscriminatorLogger = log.job.from('PoolDiscriminatorMiner');
  /** Lazily constructed so queue creation never requires OPENROUTER_API_KEY. */
  private poolDiscriminatorMiner: PoolDiscriminatorMiner | null = null;
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
      this.maybeMinePoolDiscriminators(run);
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
   * IND-417 shadow axis mining + IND-418 question enqueue. Fire-and-forget:
   * never awaited by the run lifecycle and never allowed to fail the
   * discovery run. Mining runs when POOL_QUESTIONS_MINING=shadow OR
   * POOL_QUESTIONS_MODE=on; questions are enqueued only when the latter is on
   * (and QUESTIONER_ENABLED gates the actual enqueue). Both flags off = zero
   * behavior change.
   *
   * The pool is read from the opportunities table (the run's durable output —
   * the MCP tool response flattens cards into message text, so the run result
   * carries no structured candidate array). These are also the exact rows P3
   * will re-rank, so mining over them keeps the phases consistent.
   */
  private maybeMinePoolDiscriminators(run: DiscoveryRunRecord): void {
    if (poolQuestionsMiningMode() !== 'shadow' && poolQuestionsMode() !== 'on') return;
    // Introducer flow: the discovered candidates are matches for someone else,
    // not the viewer's own pool — discriminator questions don't apply.
    if (run.input.introTargetUserId) return;
    void this.minePoolDiscriminatorsShadow(run).catch((err) => {
      this.poolDiscriminatorLogger.warn('shadow mining pass failed', {
        runId: run.id,
        userId: run.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private async minePoolDiscriminatorsShadow(run: DiscoveryRunRecord): Promise<void> {
    const intentId = run.input.intentId;
    const pool = await chatDatabaseAdapter.getOpportunitiesForUser(run.userId, {
      statuses: [...POOL_STATUSES],
      limit: 50,
      ...(intentId ? { scopeType: 'intent' as const, scopeId: intentId } : {}),
      // Chat-scoped MCP discovery creates this session's candidates as drafts;
      // passing the session id includes them in the pool.
      ...(run.context.sessionId ? { conversationId: run.context.sessionId } : {}),
    });

    const withCounterpart = pool
      .map((o) => ({
        opportunity: o,
        counterpartUserId: o.actors.find((a) => a.userId !== run.userId && a.role !== 'introducer')?.userId,
      }))
      .filter((x): x is typeof x & { counterpartUserId: string } => Boolean(x.counterpartUserId));

    if (withCounterpart.length < POOL_DISCRIMINATOR_MIN_POOL_SIZE) {
      this.poolDiscriminatorLogger.debug('shadow mining skipped: pool below k-anonymity floor', {
        runId: run.id,
        poolSize: withCounterpart.length,
        minPoolSize: POOL_DISCRIMINATOR_MIN_POOL_SIZE,
      });
      return;
    }

    const top = withCounterpart
      .sort((a, b) => (b.opportunity.interpretation?.confidence ?? 0) - (a.opportunity.interpretation?.confidence ?? 0))
      .slice(0, POOL_DISCRIMINATOR_MAX_CANDIDATES);

    // Thin per-candidate context: profile name/bio + ≤3 active premise
    // snippets — the same public corpus the presenter exposes.
    const uniqueUserIds = [...new Set(top.map((c) => c.counterpartUserId))];
    const profilesByUser = new Map<string, { name: string; bio: string }>();
    await Promise.all(uniqueUserIds.map(async (uid) => {
      try {
        const profile = await chatDatabaseAdapter.getProfile(uid);
        if (profile) profilesByUser.set(uid, { name: profile.identity.name, bio: profile.identity.bio });
      } catch {
        // Profile is enrichment only — a failed lookup never blocks mining.
      }
    }));
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

    const candidates: PoolCandidate[] = top.map((c) => {
      const profile = profilesByUser.get(c.counterpartUserId);
      const matchReason = c.opportunity.interpretation?.reasoning?.slice(0, POOL_FIELD_MAX_CHARS);
      const publicContext = [
        profile?.name ? `Name: ${profile.name}.` : null,
        profile?.bio ? `Bio: ${profile.bio.slice(0, POOL_FIELD_MAX_CHARS)}` : null,
        matchReason ? `Match: ${matchReason}` : null,
        premisesByUser.has(c.counterpartUserId) ? `Premises: ${premisesByUser.get(c.counterpartUserId)}` : null,
      ].filter(Boolean).join(' ').slice(0, POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS);
      return { id: c.opportunity.id, publicContext, score: c.opportunity.interpretation?.confidence ?? 0 };
    });

    // Intent text: prefer the triggering intent record; fall back to the ad-hoc query.
    let intentText = run.input.searchQuery ?? run.input.hint ?? '';
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

    this.poolDiscriminatorMiner ??= new PoolDiscriminatorMiner();
    const shadow = await runPoolDiscriminatorShadow({
      intentText,
      candidates,
      referenceTexts,
      miner: this.poolDiscriminatorMiner,
      embedder: embedderAdapter,
    });

    const round = (n: number): number => Math.round(n * 1000) / 1000;
    this.poolDiscriminatorLogger.info('shadow mining result', {
      runId: run.id,
      userId: run.userId,
      intentId: intentId ?? null,
      poolSize: shadow.poolSize,
      discriminators: shadow.discriminators.map((d) => ({
        label: d.label,
        questionSeed: d.questionSeed,
        sides: d.sides,
        voi: round(d.voi),
        entropy: round(d.entropy),
        coverage: round(d.coverage),
        novelty: round(d.novelty),
        evidenceRate: round(d.evidenceRate),
      })),
    });

    // IND-418: turn the top eligible discriminator into a pool_discovery
    // question. QUESTIONER_ENABLED gates via questionerEnqueueIfEnabled;
    // budget + dedup enforcement lives in the QuestionerQueue worker.
    if (poolQuestionsMode() !== 'on' || !intentId) return;
    const enqueue = questionerEnqueueIfEnabled();
    if (!enqueue) return;
    const eligible = selectQuestionDiscriminators(shadow.discriminators);
    if (eligible.length === 0) {
      this.poolDiscriminatorLogger.debug('no discriminator cleared the question bar', {
        runId: run.id,
        intentId,
      });
      return;
    }
    await enqueue({
      mode: 'pool_discovery',
      userId: run.userId,
      sourceType: 'intent',
      sourceId: intentId,
      triggeredByIntentId: intentId,
      context: {
        intentId,
        intentText,
        poolSize: shadow.poolSize,
        runId: run.id,
        minedAt: new Date().toISOString(),
        discriminators: eligible.map(toQuestionDiscriminator),
      },
    });
    this.poolDiscriminatorLogger.info('pool question enqueued', {
      runId: run.id,
      intentId,
      eligible: eligible.length,
    });
  }
}

export const discoveryRunQueue = new DiscoveryRunQueue();

