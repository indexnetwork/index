/**
 * The IntentAgent inbox (docs/plans/2026-08-21-holistic-intent-agent.md,
 * "Serialization").
 *
 * All events for one intent execute strictly one-at-a-time: the worker runs
 * at the factory default concurrency 1, so no two agent turns — for the same
 * intent or any other — ever interleave. Global serialization is the choice
 * the existing infra supports with zero new machinery; the actor property
 * (per-intent) is pinned by test either way, so raising concurrency later
 * (with a per-intent lock in the processor) cannot silently break it.
 *
 * Events are jobs, never coalesced away: a `user_message` job is keyed by
 * the reply message id (redelivery dedup), a `negotiation_needs_input` job
 * by its (opportunityId, taskId) — the same park cannot wake the agent twice
 * while its job is queued, and a later re-park carries a new task id.
 */
import { Job } from 'bullmq';
import type { QueueEvents } from 'bullmq';

import { QueueFactory } from '../lib/bullmq/bullmq';
import { runIntentAgentTurn } from '../lib/intent-agent/intent-agent.host';
import type { IntentAgentHostDeps } from '../lib/intent-agent/intent-agent.host';
import type { IntentAgentInboxEvent, IntentAgentNeedsInputEvent, IntentAgentTurnResult, IntentAgentUserMessageEvent } from '../lib/intent-agent/intent-agent.types';
import { log } from '../lib/log';

export const QUEUE_NAME = 'intent-agent-queue';

/**
 * How long the chat controller waits for an awaited `user_message` turn
 * before answering with fixed copy and leaving the event to retry in the
 * background. Covers one queued turn ahead plus one model call.
 */
export const INTENT_AGENT_TURN_WAIT_MS = 90_000;

export function intentAgentUserMessageJobId(messageId: string): string {
  return `intent-agent-msg.${messageId}`;
}

export function intentAgentNeedsInputJobId(opportunityId: string, taskId?: string): string {
  return `intent-agent-ask.${opportunityId}.${taskId ?? 'stall'}`;
}

export class IntentAgentQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<IntentAgentInboxEvent>(QUEUE_NAME);

  private readonly logger = log.queue.from('IntentAgentQueue');
  private readonly deps: IntentAgentHostDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<IntentAgentInboxEvent>> | null = null;
  private queueEvents: QueueEvents | null = null;

  constructor(deps?: IntentAgentHostDeps) {
    this.deps = deps;
  }

  /** Wake the agent with a client message. */
  addUserMessageEvent(event: IntentAgentUserMessageEvent): Promise<Job<IntentAgentInboxEvent>> {
    return this.queue.add('user_message', event, {
      jobId: intentAgentUserMessageJobId(event.messageId),
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /** Wake the agent with a parked negotiation's information need. */
  addNeedsInputEvent(event: IntentAgentNeedsInputEvent): Promise<Job<IntentAgentInboxEvent>> {
    return this.queue.add('negotiation_needs_input', event, {
      jobId: intentAgentNeedsInputJobId(event.opportunityId, event.taskId),
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /**
   * The chat controller's lane: enqueue the client's message and wait for
   * the serialized turn, returning what the agent did so the controller can
   * emit its messages as the turn's response. Throws on turn failure or
   * timeout — the caller answers with fixed copy while the event retries in
   * the background, so the message is durably heard either way.
   */
  async runUserMessageTurn(
    event: IntentAgentUserMessageEvent,
    options?: { timeoutMs?: number },
  ): Promise<IntentAgentTurnResult> {
    const job = await this.addUserMessageEvent(event);
    const result = await job.waitUntilFinished(
      this.getQueueEvents(),
      options?.timeoutMs ?? INTENT_AGENT_TURN_WAIT_MS,
    );
    return result as IntentAgentTurnResult;
  }

  /** Run one event's turn (used by the worker and by tests with injected deps). */
  processEvent(event: IntentAgentInboxEvent): Promise<IntentAgentTurnResult> {
    return runIntentAgentTurn(event, this.deps);
  }

  /** Start the BullMQ worker. Idempotent; call from the protocol server only. */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<IntentAgentInboxEvent>) => {
      this.logger.info('Processing event', { jobId: job.id, jobName: job.name });
      return this.processEvent(job.data);
    };
    this.worker = QueueFactory.createWorker<IntentAgentInboxEvent>(QUEUE_NAME, processor);
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
export const intentAgentQueue = new IntentAgentQueue();
