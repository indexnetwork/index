/**
 * The PersonalAgent's inbox.
 *
 * Everything that wakes a signal's agent lands here, fire-and-forget via
 * {@link background}. Turns for one signal run strictly one at a time (see
 * {@link PersonalAgentQueue.serializeIntent}), while unrelated signals run
 * side by side.
 *
 * Four events, one graph input each:
 * - `user_message` — the chat controller calls {@link PersonalAgentQueue.runUserMessageTurn}
 *   directly, on the signal's serialized lane.
 * - `matches_ready` — no coalescing anymore (BullMQ's duplicate-jobId slots
 *   are gone): a burst of discovery batches now produces one kickoff turn per
 *   batch, serialized. Still safe — the graph's own END-OF-TURN RE-CHECK
 *   (D31) was always the authority that made a batch recoverable, not the
 *   slots; they were "only an optimisation in front of it".
 * - `all_paused` — deduped in-process by the durable all-paused generation's
 *   key so reflect still fires exactly once per durable drain within this
 *   process's lifetime (a process restart forgets the dedup set; the
 *   watchdog's redelivery is the recovery path, same as every other
 *   in-flight-work-lost-on-restart case in this refactor).
 * - `counterparty_resolved` — deduped in-process by negotiation/signal/verdict
 *   so a counterpart still receives one factual terminal announcement.
 */
import { negotiationRoundReflectJobId, requestContext } from '@indexnetwork/protocol';
import type { NegotiationRoundReflectJobData, PersonalAgentInput, PersonalAgentResult } from '@indexnetwork/protocol';

import { background } from '../lib/background';
import { personalAgentGraph } from '../lib/negotiation/negotiation-graph';
import { log } from '../lib/log';
import { publishPersonalAgentTurnCompletedEvent } from '../lib/conversation-events';

/**
 * How long the chat controller waits for a `user_message` turn — awaited
 * directly, on the signal's serialized lane — before answering with fixed
 * copy. The same deadline bounds the graph invocation itself, so a slow model
 * call is aborted rather than left running past the point the controller
 * gives up on it.
 */
export const PERSONAL_AGENT_TURN_WAIT_MS = 90_000;

/** A kickoff may author several briefs and A2A turns; it is not constrained by an HTTP response. */
export const PERSONAL_AGENT_BACKGROUND_EXECUTION_BUDGET_MS = 5 * 60_000;

/** What the agent is woken with — the graph's own intent-scope input shapes. */
export type PersonalAgentEvent = Extract<PersonalAgentInput, { event: string }>;

export type PersonalAgentUserMessageEvent = Extract<PersonalAgentEvent, { event: 'user_message' }>;

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
  private readonly logger = log.queue.from('PersonalAgentQueue');
  private readonly invoke: (input: PersonalAgentInput) => Promise<PersonalAgentResult>;
  private readonly publishTurnCompleted: (input: { userId: string; intentId: string }) => Promise<void>;
  /** Tail promise for each signal's actor lane. Resolved even after a failed turn. */
  private readonly intentTails = new Map<string, Promise<void>>();
  /**
   * Durable dedupe keys already triggered, for `all_paused` and
   * `counterparty_resolved` — both need "exactly once", not just "at least
   * once". In-process only: forgotten on restart, same accepted risk as
   * every other in-flight-work-lost-on-restart case in this refactor.
   */
  private readonly triggeredDedupeKeys = new Set<string>();

  constructor(
    invoke?: (input: PersonalAgentInput) => Promise<PersonalAgentResult>,
    publishTurnCompleted = publishPersonalAgentTurnCompletedEvent,
  ) {
    this.invoke = invoke ?? ((input) => personalAgentGraph.invoke(input));
    this.publishTurnCompleted = publishTurnCompleted;
  }

  /** Trigger a discovery-matches kickoff turn for a signal, fire-and-forget. */
  async addMatchesReadyEvent(input: { userId: string; intentId: string }): Promise<void> {
    const data: PersonalAgentEvent = { ...input, event: 'matches_ready' };
    background('personal-agent', async () => { await this.runBackgroundEvent(data); });
  }

  /**
   * Every negotiation of a batch has paused. `dedupeKey` is the whole dedup:
   * duplicate delivery of one durable settle must still trigger one reflect.
   * A reopened task produces a new dedupe key (the round-log fold's own
   * position marker) and so is a genuinely new trigger.
   */
  async addAllPausedEvent(job: NegotiationRoundReflectJobData): Promise<void> {
    const key = negotiationRoundReflectJobId(job.intentId, job.batchId, job.dedupeKey);
    if (this.triggeredDedupeKeys.has(key)) return;
    this.triggeredDedupeKeys.add(key);
    background('personal-agent', async () => { await this.runBackgroundEvent({ ...job, event: 'all_paused' }); });
  }

  /** One owned question per negotiation pause generation, without waiting for the batch to drain. */
  async addNeedsPrincipalEvent(input: Extract<PersonalAgentEvent, { event: 'needs_principal' }> & { generation: number }): Promise<void> {
    const { generation, ...event } = input;
    const key = personalAgentNeedsPrincipalJobId(event.negotiationId, event.intentId, generation);
    if (this.triggeredDedupeKeys.has(key)) return;
    this.triggeredDedupeKeys.add(key);
    background('personal-agent', async () => { await this.runBackgroundEvent(event); });
  }

  /** One durable, server-owned announcement of the other agent's verdict. */
  async addCounterpartyResolvedEvent(input: Extract<PersonalAgentEvent, { event: 'counterparty_resolved' }>): Promise<void> {
    const key = personalAgentCounterpartyResolvedJobId(input.negotiationId, input.intentId, input.verdict);
    if (this.triggeredDedupeKeys.has(key)) return;
    this.triggeredDedupeKeys.add(key);
    background('personal-agent', async () => { await this.runBackgroundEvent(input); });
  }

  /**
   * The chat controller's lane: run the principal's message turn on the
   * signal's serialized lane and return what the agent did so the controller
   * can emit its messages as the turn's response. Throws on turn failure or
   * deadline. The deadline is call-relative — it starts counting here, before
   * the lane is even joined — so a turn queued behind a slow sibling on the
   * same signal cannot pin the controller past its own budget; the queued
   * turn still runs to completion afterward (in this process, on this lane),
   * it is just no longer what the controller is waiting on. The same signal
   * also bounds the graph invocation itself, wherever in the deadline it
   * happens to start.
   */
  async runUserMessageTurn(
    event: PersonalAgentUserMessageEvent,
    options?: { timeoutMs?: number },
  ): Promise<PersonalAgentResult> {
    const timeoutMs = options?.timeoutMs ?? PERSONAL_AGENT_TURN_WAIT_MS;
    const deadlineSignal = AbortSignal.timeout(timeoutMs);
    const existing = requestContext.getStore() ?? {};
    const abortSignal = existing.abortSignal
      ? AbortSignal.any([existing.abortSignal, deadlineSignal])
      : deadlineSignal;

    const turn = this.serializeIntent(
      event.intentId,
      () => requestContext.run({ ...existing, abortSignal }, () => this.processEvent(event)),
    );
    const deadline = new Promise<never>((_, reject) => {
      const fail = () => reject(new Error(`PersonalAgent user-message turn exceeded its ${timeoutMs}ms deadline`));
      if (abortSignal.aborted) fail();
      else abortSignal.addEventListener('abort', fail, { once: true });
    });
    return Promise.race([turn, deadline]);
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

  /** Bound `fn` with an abort signal that fires after `timeoutMs`, composed with any inherited cancellation. */
  private async runWithDeadline<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    const deadlineSignal = AbortSignal.timeout(timeoutMs);
    const existing = requestContext.getStore() ?? {};
    const abortSignal = existing.abortSignal
      ? AbortSignal.any([existing.abortSignal, deadlineSignal])
      : deadlineSignal;
    return requestContext.run({ ...existing, abortSignal }, fn);
  }

  /**
   * Run work in one signal's actor lane. BullMQ's queue-wide worker
   * concurrency gets unrelated signals moving; this small in-process gate
   * preserves the signal's existing no-interleaving contract.
   */
  private async serializeIntent<T>(intentId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.intentTails.get(intentId);
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.intentTails.set(intentId, current);
    const finish = (): void => {
      release();
      if (this.intentTails.get(intentId) === current) this.intentTails.delete(intentId);
    };
    // Start an idle lane immediately. Besides avoiding an unnecessary turn of
    // the event loop, this keeps a just-created AbortSignal observable by the
    // graph before callers can cancel it.
    if (!previous) return work().finally(finish);
    return previous.then(work).finally(finish);
  }

  /**
   * Run one background event on its signal's serialized lane, with a fresh
   * execution budget and completion/failure logging — the background-event
   * equivalent of what {@link runUserMessageTurn} does for `user_message`.
   */
  private async runBackgroundEvent(event: PersonalAgentEvent): Promise<PersonalAgentResult> {
    return this.serializeIntent(event.intentId, async () => {
      const startedAt = Date.now();
      try {
        const result = await this.runWithDeadline(
          () => this.processEvent(event),
          PERSONAL_AGENT_BACKGROUND_EXECUTION_BUDGET_MS,
        );
        this.logger.info('PersonalAgent turn completed', {
          event: event.event,
          userId: event.userId,
          intentId: event.intentId,
          executionDurationMs: Date.now() - startedAt,
          actCount: result.acts.length,
          messageCount: result.messages.length,
          acts: result.acts.map((act) => act.tool === 'kickoff'
            ? { tool: act.tool, attempted: act.attempted, opened: act.opened, failed: act.failed }
            : { tool: act.tool }),
        });
        return result;
      } catch (error) {
        this.logger.error('PersonalAgent turn failed', {
          event: event.event,
          userId: event.userId,
          intentId: event.intentId,
          executionDurationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  }
}

/** Singleton inbox. Use for triggering events. */
export const personalAgentQueue = new PersonalAgentQueue();
