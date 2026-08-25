/**
 * The PersonalAgent's inbox.
 *
 * Everything that wakes a signal's agent lands here, and everything for one
 * signal runs strictly one at a time: the worker runs at the factory default
 * concurrency 1, so a reflect turn can never interleave with the principal's
 * own message turn. Global serialization is what the existing infra supports
 * with zero new machinery.
 *
 * Four events, one graph input each:
 * - `user_message` — keyed by the reply message id, so a redelivery cannot
 *   double-speak. Removed on completion; the chat controller awaits it.
 * - `matches_ready` — keyed by the signal, so a burst of discovery batches
 *   coalesces into one kickoff turn rather than one per batch.
 * - `all_paused` — keyed by one durable all-paused generation and NOT removed on
 *   completion: reflect must fire exactly once per durable drain, or the agent acts
 *   twice on the same moment.
 * - `counterparty_resolved` — keyed by the negotiation, recipient signal and
 *   verdict; a counterpart receives one factual terminal announcement.
 */
import { Job, UnrecoverableError } from 'bullmq';
import type { QueueEvents } from 'bullmq';
import { negotiationRoundReflectJobId, requestContext } from '@indexnetwork/protocol';
import type { NegotiationRoundReflectJobData, PersonalAgentInput, PersonalAgentResult } from '@indexnetwork/protocol';

import { QueueFactory } from '../lib/bullmq/bullmq';
import { personalAgentGraph } from '../lib/negotiation/negotiation-graph';
import { log } from '../lib/log';
import { publishPersonalAgentTurnCompletedEvent } from '../lib/conversation-events';

export const QUEUE_NAME = 'personal-agent-queue';

/**
 * How long the chat controller waits for an awaited `user_message` turn
 * before answering with fixed copy. The worker's 70-second enqueue-relative
 * deadline leaves twenty seconds inside this response boundary.
 */
export const PERSONAL_AGENT_TURN_WAIT_MS = 90_000;

/** Leave the controller twenty seconds to finish its own 90-second response path. */
export const PERSONAL_AGENT_EXECUTION_BUDGET_MS = 70_000;

/** What the agent is woken with — the graph's own intent-scope input shapes. */
export type PersonalAgentEvent = Extract<PersonalAgentInput, { event: string }>;

export type PersonalAgentUserMessageEvent = Extract<PersonalAgentEvent, { event: 'user_message' }>;

export function personalAgentUserMessageJobId(messageId: string): string {
  return `personal-agent-msg.${messageId}`;
}

export function personalAgentMatchesReadyJobId(intentId: string): string {
  return `personal-agent-matches.${intentId}`;
}

export function personalAgentCounterpartyResolvedJobId(
  negotiationId: string,
  intentId: string,
  verdict: 'pending' | 'reject',
): string {
  return `personal-agent-counterparty-resolved.${negotiationId}.${intentId}.${verdict}`;
}

export function personalAgentNeedsPrincipalJobId(negotiationId: string, intentId: string, generation: number): string {
  return `personal-agent-needs-principal.${negotiationId}.${intentId}.${generation}`;
}

export class PersonalAgentQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<PersonalAgentEvent>(QUEUE_NAME);

  private readonly logger = log.queue.from('PersonalAgentQueue');
  private readonly invoke: (input: PersonalAgentInput) => Promise<PersonalAgentResult>;
  private readonly publishTurnCompleted: (input: { userId: string; intentId: string }) => Promise<void>;
  private worker: ReturnType<typeof QueueFactory.createWorker<PersonalAgentEvent>> | null = null;
  private queueEvents: QueueEvents | null = null;

  constructor(
    invoke?: (input: PersonalAgentInput) => Promise<PersonalAgentResult>,
    publishTurnCompleted = publishPersonalAgentTurnCompletedEvent,
  ) {
    this.invoke = invoke ?? ((input) => personalAgentGraph.invoke(input));
    this.publishTurnCompleted = publishTurnCompleted;
  }

  /** Wake the agent with the principal's message. */
  addUserMessageEvent(event: PersonalAgentUserMessageEvent): Promise<Job<PersonalAgentEvent>> {
    return this.queue.add('user_message', event, {
      jobId: personalAgentUserMessageJobId(event.messageId),
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /**
   * Discovery persisted matches for a signal; the agent decides what to do.
   *
   * Coalescing is deliberate — a burst of discovery batches should produce one
   * kickoff turn, not one per batch. BullMQ silently returns the existing job
   * for a duplicate id, so a batch arriving while a kickoff turn is already
   * running (turns take minutes) would vanish into a turn that had already
   * read its match list. Two slots narrow that: batches coalesce onto the
   * primary id while it is still queued, onto a single follow-up while the
   * primary runs, and unkeyed if both are occupied.
   *
   * It does NOT close the race, and this comment will not claim it does.
   * Reading a slot's state and then adding is two operations, so two callers
   * — two API processes, or a discovery batch racing the agent's own re-wake
   * — can both see the primary free, and the second add is swallowed. Closing
   * that needs an atomic check-and-add BullMQ does not expose. What makes the
   * batch recoverable anyway is the agent's END-OF-TURN RE-CHECK (D31): every
   * kickoff turn re-reads the match list and wakes this signal again for any
   * undecided match it did not already know about. That is the authority
   * here; these two slots are only an optimisation in front of it.
   */
  async addMatchesReadyEvent(input: { userId: string; intentId: string }): Promise<Job<PersonalAgentEvent>> {
    const data: PersonalAgentEvent = { ...input, event: 'matches_ready' };
    // Failed jobs are RETAINED. A terminally failed wake is the record that a
    // persisted batch never reached its agent — deleted, the batch is lost
    // with no trace and no other path back, which is exactly what
    // `matchesReadyNode` throws to prevent, one hop downstream.
    const options = { removeOnComplete: true };
    const primary = personalAgentMatchesReadyJobId(input.intentId);
    for (const jobId of [primary, `${primary}.next`]) {
      if (!(await this.slotWouldRun(jobId))) continue;
      const job = await this.queue.add('matches_ready', data, { ...options, jobId });
      this.logger.info('Queued matches_ready', {
        jobId: job.id,
        userId: input.userId,
        intentId: input.intentId,
      });
      return job;
    }
    this.logger.warn('Both matches_ready slots are occupied; enqueueing an unkeyed follow-up', { intentId: input.intentId });
    const job = await this.queue.add('matches_ready', data, options);
    this.logger.info('Queued matches_ready', {
      jobId: job.id,
      userId: input.userId,
      intentId: input.intentId,
    });
    return job;
  }

  /**
   * Whether adding onto this id would actually cause a run.
   *
   * BullMQ silently returns the existing job for a duplicate id, so a slot is
   * only reusable while its job is still waiting to start — one that is
   * already running has read its match list, and one that has failed will
   * never read anything again. Either way the batch would vanish into it.
   */
  private async slotWouldRun(jobId: string): Promise<boolean> {
    const existing = await this.queue.getJob(jobId);
    if (!existing) return true;
    const state = await existing.getState();
    if (state === 'waiting' || state === 'delayed' || state === 'waiting-children' || state === 'prioritized') return true;
    // A terminally failed wake is kept as the record that a batch never
    // reached its agent — but only until a new batch arrives for the same
    // signal, which is a fresh wake for the same work. Held past that, both
    // slots stay dead for the seven days BullMQ retains a failure, coalescing
    // stops entirely, and every batch becomes its own kickoff: N strategy
    // messages and N rounds into the principal's conversation.
    if (state === 'failed') {
      this.logger.warn('Replacing a failed matches_ready slot', { jobId, failedReason: existing.failedReason });
      await existing.remove();
      return true;
    }
    return false;
  }

  /**
   * Every negotiation of a round has paused. The deterministic job id is the
   * whole dedup: duplicate delivery of one durable drain produces one reflect,
   * and the completed job is retained so that generation cannot run twice. A
   * reopened task increments its durable generation and therefore gets a new
   * job. The queue's
   * default `removeOnComplete: { age: 24h }` would free the id, and a late
   * watchdog delivery of the same durable pause would then wake the agent to
   * re-decide work it already closed out. One retained row per drain
   * generation is the price of exactly-once.
   *
   * `removeOnFail` keeps the default 7-day window on purpose: a reflect lost
   * to a transient model outage should become reachable again, and a genuinely
   * dead drain is better re-run once than never.
   */
  addAllPausedEvent(job: NegotiationRoundReflectJobData): Promise<Job<PersonalAgentEvent>> {
    return this.queue.add('all_paused', { ...job, event: 'all_paused' }, {
      jobId: negotiationRoundReflectJobId(job.intentId, job.round, job.generation),
      removeOnComplete: false,
    });
  }

  /** One owned question per negotiation pause generation, without waiting for the batch to drain. */
  addNeedsPrincipalEvent(input: Extract<PersonalAgentEvent, { event: 'needs_principal' }> & { generation: number }): Promise<Job<PersonalAgentEvent>> {
    const { generation, ...event } = input;
    return this.queue.add('needs_principal', event, {
      jobId: personalAgentNeedsPrincipalJobId(event.negotiationId, event.intentId, generation),
      // The inbox has one worker to serialize each signal's effects. A newly
      // blocked principal must be the next background turn, not wait behind
      // an initial market-wide kickoff flood.
      lifo: true,
      removeOnComplete: false,
    });
  }

  /** One durable, server-owned announcement of the other agent's verdict. */
  addCounterpartyResolvedEvent(input: Extract<PersonalAgentEvent, { event: 'counterparty_resolved' }>): Promise<Job<PersonalAgentEvent>> {
    return this.queue.add('counterparty_resolved', input, {
      jobId: personalAgentCounterpartyResolvedJobId(input.negotiationId, input.intentId, input.verdict),
      removeOnComplete: false,
    });
  }

  /**
   * The chat controller's lane: enqueue the principal's message and wait for
   * the serialized turn, returning what the agent did so the controller can
   * emit its messages as the turn's response. Throws on turn failure or wait
   * timeout; the worker's enqueue-relative deadline prevents a stale user
   * turn from mutating state after the controller has already answered.
   */
  async runUserMessageTurn(
    event: PersonalAgentUserMessageEvent,
    options?: { timeoutMs?: number },
  ): Promise<PersonalAgentResult> {
    const job = await this.addUserMessageEvent(event);
    const result = await job.waitUntilFinished(
      this.getQueueEvents(),
      options?.timeoutMs ?? PERSONAL_AGENT_TURN_WAIT_MS,
    );
    return result as PersonalAgentResult;
  }

  /** Run one event's turn (used by the worker and by tests with an injected graph). */
  async processEvent(event: PersonalAgentEvent): Promise<PersonalAgentResult> {
    const result = await this.invoke(event);
    // A graph-level error is the turn FAILING, not a turn that decided
    // nothing: surface it so BullMQ retries and the controller falls back.
    if (result.error) throw new Error(result.error);
    try {
      await this.publishTurnCompleted({ userId: event.userId, intentId: event.intentId });
    } catch (error) {
      // The completed turn is already durable. A transient live-update failure
      // must not retry it into duplicate agent effects.
      this.logger.warn('Failed to publish completed PersonalAgent turn', {
        userId: event.userId,
        intentId: event.intentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return result;
  }

  /** Apply the queue-time/user deadline or a fresh, retryable background budget to one invocation. */
  async processJob(job: Job<PersonalAgentEvent>): Promise<PersonalAgentResult> {
    const startedAt = Date.now();
    const queueWaitMs = Math.max(0, startedAt - job.timestamp);
    const isUserMessage = job.data.event === 'user_message';
    let deadlineSignal: AbortSignal | undefined;
    try {
      const remaining = isUserMessage
        ? job.timestamp + PERSONAL_AGENT_EXECUTION_BUDGET_MS - Date.now()
        : PERSONAL_AGENT_EXECUTION_BUDGET_MS;
      if (remaining <= 0) {
        throw new UnrecoverableError('PersonalAgent user-message execution deadline expired before pickup');
      }

      deadlineSignal = AbortSignal.timeout(remaining);
      const existing = requestContext.getStore() ?? {};
      const abortSignal = existing.abortSignal
        ? AbortSignal.any([existing.abortSignal, deadlineSignal])
        : deadlineSignal;
      const result = await requestContext.run(
        { ...existing, abortSignal },
        () => this.processEvent(job.data),
      );
      const finishedAt = Date.now();
      this.logger.info('PersonalAgent turn completed', {
        jobId: job.id,
        event: job.data.event,
        userId: job.data.userId,
        intentId: job.data.intentId,
        queueWaitMs,
        executionDurationMs: finishedAt - startedAt,
        totalDurationMs: finishedAt - job.timestamp,
        actCount: result.acts.length,
        messageCount: result.messages.length,
        acts: result.acts.map((act) => act.tool === 'kickoff'
          ? { tool: act.tool, attempted: act.attempted, opened: act.opened, failed: act.failed }
          : { tool: act.tool }),
      });
      return result;
    } catch (error) {
      // A user-message retry could mutate state after the controller has
      // already returned its timeout response, so its deadline is terminal.
      // Background wakes have no waiting caller and are the only path back to
      // persisted matches/paused rounds; their pre-effect expiry must retain
      // the queue's ordinary retry policy instead of stranding that work.
      const failure = isUserMessage && deadlineSignal?.aborted
        ? new UnrecoverableError('PersonalAgent execution deadline expired')
        : error;
      const finishedAt = Date.now();
      this.logger.error('PersonalAgent turn failed', {
        jobId: job.id,
        event: job.data.event,
        userId: job.data.userId,
        intentId: job.data.intentId,
        queueWaitMs,
        executionDurationMs: finishedAt - startedAt,
        totalDurationMs: finishedAt - job.timestamp,
        error: failure instanceof Error ? failure.message : String(failure),
      });
      throw failure;
    }
  }

  /** Start the BullMQ worker. Idempotent; call from the protocol server only. */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<PersonalAgentEvent>) => {
      this.logger.info('Processing event', { jobId: job.id, jobName: job.name });
      return this.processJob(job);
    };
    this.worker = QueueFactory.createWorker<PersonalAgentEvent>(QUEUE_NAME, processor);
  }

  private getQueueEvents(): QueueEvents {
    if (!this.queueEvents) this.queueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);
    return this.queueEvents;
  }

  /** Close the worker and queue connections (graceful shutdown). */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queueEvents) {
      await this.queueEvents.close();
      this.queueEvents = null;
    }
    await this.queue.close();
  }
}

/** Singleton inbox. Use for adding events and starting the worker. */
export const personalAgentQueue = new PersonalAgentQueue();
