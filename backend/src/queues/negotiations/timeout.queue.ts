import { Job } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { conversationDatabaseAdapter } from '../../adapters/database.adapter';
import { IndexNegotiator, AMBIENT_PARK_WINDOW_MS } from '@indexnetwork/protocol';
import type { NegotiationTurn, NegotiationOutcome, UserNegotiationContext, SeedAssessment, NegotiationDatabase } from '@indexnetwork/protocol';

/** BullMQ queue name for negotiation timeout jobs. */
export const QUEUE_NAME = 'negotiation-timeout';

/** Payload for a negotiation timeout job. */
export interface NegotiationTimeoutJobData {
  negotiationId: string;
  turnNumber: number;
}

/** Optional deps for testing. */
export interface NegotiationTimeoutQueueDeps {
  database?: NegotiationDatabase;
}

/**
 * NegotiationTimeoutQueue: BullMQ queue + worker for handling negotiation timeouts.
 *
 * When an external agent doesn't respond within the park-window budget (the
 * dispatcher-provided `timeoutMs`, currently `AMBIENT_PARK_WINDOW_MS` / 5 min
 * for the ambient trigger), the timeout worker runs the AI agent for that turn
 * and continues the negotiation evaluation (evaluate -> next turn or finalize).
 * If the AI counter-responds, the re-arm path uses `AMBIENT_PARK_WINDOW_MS`
 * again for the next speaker.
 *
 * Workers are started only by the protocol server via {@link NegotiationTimeoutQueue.startWorker}.
 */
export class NegotiationTimeoutQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<NegotiationTimeoutJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('NegotiationTimeoutJob');
  private readonly queueLogger = log.queue.from('NegotiationTimeoutQueue');
  private readonly deps: NegotiationTimeoutQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<NegotiationTimeoutJobData>> | null = null;

  constructor(deps?: NegotiationTimeoutQueueDeps) {
    this.deps = deps;
  }

  /**
   * Enqueue a delayed timeout job for a negotiation.
   *
   * @param negotiationId - The negotiation task ID
   * @param turnNumber - Current turn number (used to detect stale jobs)
   * @param delayMs - Delay in milliseconds before the timeout fires
   * @returns The BullMQ job ID
   */
  async enqueueTimeout(negotiationId: string, turnNumber: number, delayMs: number): Promise<string> {
    const jobId = `neg-timeout-${negotiationId}`;

    // Remove any existing timeout job for this negotiation before adding a new one
    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        await existing.remove();
      }
    } catch {
      // Job may not exist, ignore
    }

    const job = await this.queue.add('negotiation_timeout', { negotiationId, turnNumber }, {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });

    this.logger.info('[NegotiationTimeoutJob] Timeout enqueued', { negotiationId, turnNumber, delayMs, jobId: job.id });
    return job.id ?? jobId;
  }

  /**
   * Cancel a pending timeout job for a negotiation.
   *
   * @param negotiationId - The negotiation task ID
   */
  async cancelTimeout(negotiationId: string): Promise<void> {
    const jobId = `neg-timeout-${negotiationId}`;
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting') {
          await job.remove();
          this.logger.info('[NegotiationTimeoutJob] Timeout cancelled', { negotiationId, jobId });
        }
      }
    } catch (err) {
      this.logger.warn('[NegotiationTimeoutJob] Failed to cancel timeout', {
        negotiationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Process a timeout job. Exported for testing.
   */
  async processJob(name: string, data: NegotiationTimeoutJobData): Promise<void> {
    switch (name) {
      case 'negotiation_timeout':
        await this.handleTimeout(data);
        break;
      default:
        this.queueLogger.warn(`[NegotiationTimeoutProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker. Idempotent.
   */
  startWorker(): void {
    if (this.worker) return;

    const processor = async (job: Job<NegotiationTimeoutJobData>) => {
      this.queueLogger.info(`[NegotiationTimeoutProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };

    this.worker = QueueFactory.createWorker<NegotiationTimeoutJobData>(QUEUE_NAME, processor);
  }

  /**
   * Gracefully close worker and queue.
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  /**
   * Handle a negotiation timeout: run the AI agent for the stalled turn.
   */
  private async handleTimeout(data: NegotiationTimeoutJobData): Promise<void> {
    const { negotiationId, turnNumber } = data;
    const database = this.deps?.database ?? conversationDatabaseAdapter;

    // Load the negotiation task
    const task = await database.getTask(negotiationId);
    if (!task) {
      this.logger.warn('[NegotiationTimeoutJob] Task not found, skipping', { negotiationId });
      return;
    }

    // Only process if still waiting_for_agent and turn matches
    if (task.state !== 'waiting_for_agent') {
      this.logger.info('[NegotiationTimeoutJob] Task no longer waiting, skipping (stale job)', {
        negotiationId,
        currentState: task.state,
      });
      return;
    }

    const messages = await database.getMessagesForConversation(task.conversationId);
    const currentTurnCount = messages.length;

    // Check if turnNumber still matches (response may have come in between)
    if (currentTurnCount !== turnNumber) {
      this.logger.info('[NegotiationTimeoutJob] Turn count mismatch, skipping (stale job)', {
        negotiationId,
        expectedTurn: turnNumber,
        actualTurn: currentTurnCount,
      });
      return;
    }

    const meta = task.metadata as { sourceUserId?: string; candidateUserId?: string; type?: string } | null;
    if (meta?.type !== 'negotiation') {
      this.logger.warn('[NegotiationTimeoutJob] Task is not a negotiation, skipping', { negotiationId });
      return;
    }

    // Determine whose turn it is
    const currentSpeaker = currentTurnCount % 2 === 0 ? 'source' : 'candidate';
    const isSource = currentSpeaker === 'source';
    const activeUserId = isSource ? meta.sourceUserId! : meta.candidateUserId!;
    const otherUserId = isSource ? meta.candidateUserId! : meta.sourceUserId!;

    this.logger.info('[NegotiationTimeoutJob] External agent timed out, running AI fallback', {
      negotiationId,
      activeUserId,
      turnNumber,
    });

    // Parse history
    const history: NegotiationTurn[] = messages.map((m: { parts: unknown[] }) => {
      const dp = (m.parts as Array<{ kind?: string; data?: unknown }>)?.find(p => p.kind === 'data');
      return dp?.data as NegotiationTurn;
    }).filter(Boolean);

    // Run AI agent for the timed-out turn
    const agent = new IndexNegotiator();
    const ownUserCtx: UserNegotiationContext = { id: activeUserId, intents: [], profile: {} };
    const otherUserCtx: UserNegotiationContext = { id: otherUserId, intents: [], profile: {} };
    const seedAssessment: SeedAssessment = { reasoning: 'Timeout fallback', valencyRole: 'peer' };

    const aiTurn = await agent.invoke({
      ownUser: ownUserCtx,
      otherUser: otherUserCtx,
      indexContext: { networkId: '', prompt: '' },
      seedAssessment,
      history,
      isDiscoverer: isSource,
    });

    // Persist the AI turn
    await database.createMessage({
      conversationId: task.conversationId,
      senderId: `agent:${activeUserId}`,
      role: 'agent',
      parts: [{ kind: 'data' as const, data: aiTurn }],
      taskId: task.id,
    });

    const newTurnCount = currentTurnCount + 1;
    const maxTurns = 6;

    // Evaluate: accept/reject → finalize; counter at max → finalize; counter under max → continue
    if (aiTurn.action === 'accept' || aiTurn.action === 'reject' || newTurnCount >= maxTurns) {
      const fullHistory = [...history, aiTurn];
      const nextSpeaker = currentSpeaker === 'source' ? 'candidate' : 'source';
      const outcome = this.buildOutcome(fullHistory, newTurnCount, aiTurn.action, meta.sourceUserId!, meta.candidateUserId!, nextSpeaker);

      await database.updateTaskState(task.id, 'completed');
      await database.createArtifact({
        taskId: task.id,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: outcome }],
        metadata: { hasOpportunity: outcome.hasOpportunity, turnCount: newTurnCount },
      });

      const outcomeStr = aiTurn.action === 'accept' ? 'accepted'
        : aiTurn.action === 'reject' ? 'rejected'
        : 'turn_cap';

      const opportunityId = (meta as { opportunityId?: string }).opportunityId;
      if (opportunityId) {
        const nextStatus = aiTurn.action === 'accept' ? 'pending'
          : aiTurn.action === 'reject' ? 'rejected'
          : 'stalled';
        await database.updateOpportunityStatus(opportunityId, nextStatus).catch((err) => {
          this.logger.error('[NegotiationTimeoutJob] Failed to update opportunity status on timeout finalization', {
            opportunityId,
            nextStatus,
            error: err,
          });
        });
      }

      this.logger.info('[NegotiationTimeoutJob] Negotiation finalized after timeout', {
        negotiationId,
        outcome: outcomeStr,
        turnCount: newTurnCount,
      });
      return;
    }

    // AI countered and under max turns — the other party now needs to respond.
    // Set to waiting_for_agent and arm a new timeout so the negotiation doesn't stall.
    await database.updateTaskState(task.id, 'waiting_for_agent');

    await this.enqueueTimeout(negotiationId, newTurnCount, AMBIENT_PARK_WINDOW_MS);

    this.logger.info('[NegotiationTimeoutJob] AI agent countered, armed timeout for next speaker', {
      negotiationId,
      action: aiTurn.action,
      turnCount: newTurnCount,
    });
  }

  /** Build a NegotiationOutcome (mirrors graph finalizeNode logic). */
  private buildOutcome(
    history: NegotiationTurn[],
    turnCount: number,
    lastAction: string,
    sourceUserId: string,
    candidateUserId: string,
    currentSpeaker: string,
  ): NegotiationOutcome {
    const hasOpportunity = lastAction === 'accept';
    const atCap = lastAction === 'counter';

    let agreedRoles: NegotiationOutcome['agreedRoles'] = [];
    if (hasOpportunity && history.length >= 2) {
      const acceptTurn = history[history.length - 1];
      const precedingTurn = history[history.length - 2];
      const accepterIsSource = currentSpeaker === 'candidate';
      const [sourceRole, candidateRole] = accepterIsSource
        ? [acceptTurn.assessment.suggestedRoles.ownUser, precedingTurn.assessment.suggestedRoles.ownUser]
        : [precedingTurn.assessment.suggestedRoles.ownUser, acceptTurn.assessment.suggestedRoles.ownUser];
      agreedRoles = [
        { userId: sourceUserId, role: sourceRole },
        { userId: candidateUserId, role: candidateRole },
      ];
    }

    return {
      hasOpportunity,
      agreedRoles,
      reasoning: history[history.length - 1]?.assessment.reasoning ?? '',
      turnCount,
      ...(atCap && { reason: 'turn_cap' }),
    };
  }
}

/** Singleton negotiation timeout queue instance. */
export const negotiationTimeoutQueue = new NegotiationTimeoutQueue();
