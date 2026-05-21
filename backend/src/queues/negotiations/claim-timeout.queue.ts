import { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import * as convSchema from '../../schemas/conversation.schema';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { conversationDatabaseAdapter } from '../../adapters/database.adapter';
import { IndexNegotiator, AMBIENT_PARK_WINDOW_MS } from '@indexnetwork/protocol';
import type { NegotiationTurn, NegotiationOutcome, UserNegotiationContext, SeedAssessment, NegotiationDatabase } from '@indexnetwork/protocol';

/** BullMQ queue name for negotiation claim-timeout jobs. */
export const QUEUE_NAME = 'negotiation-claim-timeout';

/** Payload for a negotiation claim-timeout job. */
export interface NegotiationClaimTimeoutJobData {
  negotiationId: string;
  turnNumber: number;
  agentId: string;
}

/** Optional deps for testing. */
export interface NegotiationClaimTimeoutQueueDeps {
  database?: NegotiationDatabase;
}

/**
 * NegotiationClaimTimeoutQueue: BullMQ queue + worker for handling claimed-but-abandoned negotiation turns.
 *
 * When an external agent claims a negotiation turn via polling but never responds
 * within the remaining park-window budget, the timeout worker runs the AI agent
 * as a fallback for that turn and continues the negotiation evaluation
 * (evaluate -> next turn or finalize).
 *
 * This is distinct from {@link NegotiationTimeoutQueue}, which fires when a turn
 * is never picked up at all. This queue fires after a turn has been claimed but
 * the agent abandoned it without responding. Both queues share the same
 * park-window budget (default {@link AMBIENT_PARK_WINDOW_MS}, 5 minutes) — the
 * remaining budget carries across the waiting_for_agent → claimed transition
 * rather than being re-armed fresh.
 *
 * Workers are started only by the protocol server via {@link NegotiationClaimTimeoutQueue.startWorker}.
 */
export class NegotiationClaimTimeoutQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<NegotiationClaimTimeoutJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('NegotiationClaimTimeoutJob');
  private readonly queueLogger = log.queue.from('NegotiationClaimTimeoutQueue');
  private readonly deps: NegotiationClaimTimeoutQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<NegotiationClaimTimeoutJobData>> | null = null;

  constructor(deps?: NegotiationClaimTimeoutQueueDeps) {
    this.deps = deps;
  }

  /**
   * Enqueue a delayed claim-timeout job for a negotiation.
   *
   * @param negotiationId - The negotiation task ID
   * @param turnNumber - Current turn number (used to detect stale jobs)
   * @param agentId - The agent that claimed the turn
   * @param delayMs - Remaining park-window budget in milliseconds (typically the
   *   value returned by `computeRemainingBudgetMs(parkStart, AMBIENT_PARK_WINDOW_MS)`
   *   — required so callers cannot accidentally fall back to a stale default).
   * @returns The BullMQ job ID
   */
  async enqueueTimeout(
    negotiationId: string,
    turnNumber: number,
    agentId: string,
    delayMs: number,
  ): Promise<string> {
    const jobId = `neg-claim-timeout-${negotiationId}`;

    // Remove any existing claim-timeout job for this negotiation before adding a new one
    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        await existing.remove();
      }
    } catch {
      // Job may not exist, ignore
    }

    const job = await this.queue.add('negotiation_claim_timeout', { negotiationId, turnNumber, agentId }, {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });

    this.logger.info('[NegotiationClaimTimeoutJob] Claim timeout enqueued', {
      negotiationId,
      turnNumber,
      agentId,
      delayMs,
      jobId: job.id,
    });
    return job.id ?? jobId;
  }

  /**
   * Cancel a pending claim-timeout job for a negotiation.
   *
   * @param negotiationId - The negotiation task ID
   */
  async cancelTimeout(negotiationId: string): Promise<void> {
    const jobId = `neg-claim-timeout-${negotiationId}`;
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting') {
          await job.remove();
          this.logger.info('[NegotiationClaimTimeoutJob] Claim timeout cancelled', { negotiationId, jobId });
        }
      }
    } catch (err) {
      this.logger.warn('[NegotiationClaimTimeoutJob] Failed to cancel claim timeout', {
        negotiationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Process a claim-timeout job. Exported for testing.
   *
   * @param name - The BullMQ job name
   * @param data - The job payload
   */
  async processJob(name: string, data: NegotiationClaimTimeoutJobData): Promise<void> {
    switch (name) {
      case 'negotiation_claim_timeout':
        await this.handleClaimTimeout(data);
        break;
      default:
        this.queueLogger.warn(`[NegotiationClaimTimeoutProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker. Idempotent.
   */
  startWorker(): void {
    if (this.worker) return;

    const processor = async (job: Job<NegotiationClaimTimeoutJobData>) => {
      this.queueLogger.info(`[NegotiationClaimTimeoutProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };

    this.worker = QueueFactory.createWorker<NegotiationClaimTimeoutJobData>(QUEUE_NAME, processor);
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
   * Handle a negotiation claim timeout: an agent claimed the turn but never responded.
   * Run the AI agent as a fallback for the abandoned turn.
   */
  private async handleClaimTimeout(data: NegotiationClaimTimeoutJobData): Promise<void> {
    const { negotiationId, turnNumber, agentId } = data;
    const database = this.deps?.database ?? conversationDatabaseAdapter;

    // Atomically transition out of 'claimed' to 'working' before doing any
    // work. If another path (agent respond) is racing this worker, only one
    // side will flip the state — the other no-ops. This prevents both paths
    // from appending a turn for the same claimed state.
    const [task] = await db
      .update(convSchema.tasks)
      .set({ state: 'working', updatedAt: new Date() })
      .where(
        and(
          eq(convSchema.tasks.id, negotiationId),
          eq(convSchema.tasks.state, 'claimed'),
        ),
      )
      .returning();

    if (!task) {
      this.logger.info('[NegotiationClaimTimeoutJob] Task no longer claimed, skipping (stale job)', {
        negotiationId,
      });
      return;
    }

    const messages = await database.getMessagesForConversation(task.conversationId);
    const currentTurnCount = messages.length;

    // Check if turnNumber still matches (response may have come in between)
    if (currentTurnCount !== turnNumber) {
      this.logger.info('[NegotiationClaimTimeoutJob] Turn count mismatch, skipping (stale job)', {
        negotiationId,
        expectedTurn: turnNumber,
        actualTurn: currentTurnCount,
      });
      return;
    }

    const meta = task.metadata as {
      sourceUserId?: string;
      candidateUserId?: string;
      type?: string;
      maxTurns?: number;
    } | null;
    if (meta?.type !== 'negotiation') {
      this.logger.warn('[NegotiationClaimTimeoutJob] Task is not a negotiation, skipping', { negotiationId });
      return;
    }

    // Determine whose turn it is
    const currentSpeaker = currentTurnCount % 2 === 0 ? 'source' : 'candidate';
    const isSource = currentSpeaker === 'source';
    const activeUserId = isSource ? meta.sourceUserId! : meta.candidateUserId!;
    const otherUserId = isSource ? meta.candidateUserId! : meta.sourceUserId!;

    this.logger.info('[NegotiationClaimTimeoutJob] Claimed agent timed out, running AI fallback', {
      negotiationId,
      agentId,
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
    const seedAssessment: SeedAssessment = { reasoning: 'Claim timeout fallback', valencyRole: 'peer' };

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
    const maxTurns = meta.maxTurns ?? 6;

    // Evaluate: accept/reject -> finalize; counter at max -> finalize; counter under max -> continue
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
        await database.updateOpportunityStatus(opportunityId, nextStatus).catch((err: unknown) => {
          this.logger.error('[NegotiationClaimTimeoutJob] Failed to update opportunity status on claim-timeout finalization', {
            opportunityId,
            nextStatus,
            error: err,
          });
        });
      }

      this.logger.info('[NegotiationClaimTimeoutJob] Negotiation finalized after claim timeout', {
        negotiationId,
        outcome: outcomeStr,
        turnCount: newTurnCount,
      });
      return;
    }

    // AI countered and under max turns -- the other party now needs to respond.
    // Set to waiting_for_agent and arm a new general timeout so the negotiation doesn't stall.
    await database.updateTaskState(task.id, 'waiting_for_agent');

    // Import dynamically to avoid circular dependency; arm the park-window timeout for the next speaker
    const { negotiationTimeoutQueue } = await import('./timeout.queue');
    await negotiationTimeoutQueue.enqueueTimeout(negotiationId, newTurnCount, AMBIENT_PARK_WINDOW_MS);

    this.logger.info('[NegotiationClaimTimeoutJob] AI agent countered, armed timeout for next speaker', {
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

/** Singleton negotiation claim-timeout queue instance. */
export const negotiationClaimTimeoutQueue = new NegotiationClaimTimeoutQueue();
