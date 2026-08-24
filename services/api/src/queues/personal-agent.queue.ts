/**
 * The PersonalAgent's inbox.
 *
 * Everything that wakes a signal's agent lands here, and everything for one
 * signal runs strictly one at a time: the worker runs at the factory default
 * concurrency 1, so a reflect turn can never interleave with the principal's
 * own message turn. Global serialization is what the existing infra supports
 * with zero new machinery.
 *
 * Three events, one graph input each:
 * - `user_message` — keyed by the reply message id, so a redelivery cannot
 *   double-speak. Removed on completion; the chat controller awaits it.
 * - `matches_ready` — keyed by the signal, so a burst of discovery batches
 *   coalesces into one kickoff turn rather than one per batch.
 * - `all_paused` — keyed by `(intentId, round)` and NOT removed on
 *   completion: reflect must fire exactly once per round, or the agent acts
 *   twice on the same moment.
 */
import { Job } from 'bullmq';
import type { QueueEvents } from 'bullmq';
import { negotiationRoundReflectJobId } from '@indexnetwork/protocol';
import type { NegotiationRoundReflectJobData, PersonalAgentInput, PersonalAgentResult } from '@indexnetwork/protocol';

import { QueueFactory } from '../lib/bullmq/bullmq';
import { personalAgentGraph } from '../lib/negotiation/negotiation-graph';
import { log } from '../lib/log';

export const QUEUE_NAME = 'personal-agent-queue';

/**
 * How long the chat controller waits for an awaited `user_message` turn
 * before answering with fixed copy and leaving the event to retry in the
 * background. Covers one queued turn ahead plus one model call.
 */
export const PERSONAL_AGENT_TURN_WAIT_MS = 90_000;

/** What the agent is woken with — the graph's own intent-scope input shapes. */
export type PersonalAgentEvent = Extract<PersonalAgentInput, { event: string }>;

export type PersonalAgentUserMessageEvent = Extract<PersonalAgentEvent, { event: 'user_message' }>;

export function personalAgentUserMessageJobId(messageId: string): string {
  return `personal-agent-msg.${messageId}`;
}

export function personalAgentMatchesReadyJobId(intentId: string): string {
  return `personal-agent-matches.${intentId}`;
}

export class PersonalAgentQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<PersonalAgentEvent>(QUEUE_NAME);

  private readonly logger = log.queue.from('PersonalAgentQueue');
  private readonly invoke: (input: PersonalAgentInput) => Promise<PersonalAgentResult>;
  private worker: ReturnType<typeof QueueFactory.createWorker<PersonalAgentEvent>> | null = null;
  private queueEvents: QueueEvents | null = null;

  constructor(invoke?: (input: PersonalAgentInput) => Promise<PersonalAgentResult>) {
    this.invoke = invoke ?? ((input) => personalAgentGraph.invoke(input));
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
   * kickoff turn, not one per batch — but it must never LOSE a batch. BullMQ
   * silently returns the existing job for a duplicate id, so a batch that
   * arrives while a kickoff turn is already running (turns take minutes) would
   * vanish into a turn that had already read its match list. Two slots fix
   * that: batches coalesce onto the primary id while it is still queued, and
   * onto a single follow-up id while the primary is running. If both are
   * somehow running (more than one worker process), the batch is enqueued
   * without an id rather than dropped.
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
      return this.queue.add('matches_ready', data, { ...options, jobId });
    }
    this.logger.warn('Both matches_ready slots are occupied; enqueueing an unkeyed follow-up', { intentId: input.intentId });
    return this.queue.add('matches_ready', data, options);
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
    return state === 'waiting' || state === 'delayed' || state === 'waiting-children' || state === 'prioritized';
  }

  /**
   * Every negotiation of a round has paused. The deterministic job id is the
   * whole dedup: ten pauses produce one reflect, and the completed job is
   * retained FOREVER so the same round can never reflect twice — the queue's
   * default `removeOnComplete: { age: 24h }` would free the id, and a late
   * watchdog pause on a stale negotiation of that round would then wake the
   * agent to re-decide a round it already closed out. One retained row per
   * (signal, round) is the price of exactly-once.
   *
   * `removeOnFail` keeps the default 7-day window on purpose: a reflect lost
   * to a transient model outage should become reachable again, and a genuinely
   * dead round is better re-run once than never.
   */
  addAllPausedEvent(job: NegotiationRoundReflectJobData): Promise<Job<PersonalAgentEvent>> {
    return this.queue.add('all_paused', { ...job, event: 'all_paused' }, {
      jobId: negotiationRoundReflectJobId(job.intentId, job.round),
      removeOnComplete: false,
    });
  }

  /**
   * The chat controller's lane: enqueue the principal's message and wait for
   * the serialized turn, returning what the agent did so the controller can
   * emit its messages as the turn's response. Throws on turn failure or
   * timeout — the caller answers with fixed copy while the event retries in
   * the background, so the message is durably heard either way.
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
    return result;
  }

  /** Start the BullMQ worker. Idempotent; call from the protocol server only. */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<PersonalAgentEvent>) => {
      this.logger.info('Processing event', { jobId: job.id, jobName: job.name });
      return this.processEvent(job.data);
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
