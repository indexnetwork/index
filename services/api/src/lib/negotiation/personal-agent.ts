/**
 * PersonalAgent turns. Everything for one signal runs one at a time.
 *
 * Three events, one graph input each:
 * - `user_message` — the chat controller awaits this turn.
 * - `matches_ready` — a burst of discovery batches coalesces into one kickoff.
 * - `all_paused` — fires once per durable drain generation.
 */
import { negotiationRoundReflectJobId, requestContext } from '@indexnetwork/protocol';
import type { NegotiationRoundReflectJobData, PersonalAgentInput, PersonalAgentResult } from '@indexnetwork/protocol';

import { personalAgentGraph } from './negotiation-graph';
import { log } from '../log';
import { publishPersonalAgentTurnCompletedEvent } from '../conversation-events';

export const PERSONAL_AGENT_TURN_WAIT_MS = 90_000;
export const PERSONAL_AGENT_EXECUTION_BUDGET_MS = 70_000;

export type PersonalAgentEvent = Extract<PersonalAgentInput, { event: string }>;
export type PersonalAgentUserMessageEvent = Extract<PersonalAgentEvent, { event: 'user_message' }>;

export function personalAgentUserMessageJobId(messageId: string): string {
  return `personal-agent-msg.${messageId}`;
}

export function personalAgentMatchesReadyJobId(intentId: string): string {
  return `personal-agent-matches.${intentId}`;
}

export class PersonalAgentTurns {
  private readonly logger = log.job.from('PersonalAgent');
  private readonly invoke: (input: PersonalAgentInput) => Promise<PersonalAgentResult>;
  private readonly publishTurnCompleted: (input: { userId: string; intentId: string }) => Promise<void>;
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly matchesFollowup = new Set<string>();
  private readonly completedAllPaused = new Set<string>();

  constructor(
    invoke?: (input: PersonalAgentInput) => Promise<PersonalAgentResult>,
    publishTurnCompleted = publishPersonalAgentTurnCompletedEvent,
  ) {
    this.invoke = invoke ?? ((input) => personalAgentGraph.invoke(input));
    this.publishTurnCompleted = publishTurnCompleted;
  }

  private runSerialized<T>(intentId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(intentId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.chains.set(intentId, next.then(() => undefined, () => undefined));
    return next;
  }

  addUserMessageEvent(event: PersonalAgentUserMessageEvent): Promise<PersonalAgentResult> {
    return this.runSerialized(event.intentId, () => this.processEvent(event));
  }

  addMatchesReadyEvent(input: { userId: string; intentId: string }): Promise<void> {
    const key = input.intentId;
    const running = this.chains.get(key);
    if (running) {
      if (this.matchesFollowup.has(key)) return Promise.resolve();
      this.matchesFollowup.add(key);
      void this.runSerialized(key, () => this.processEvent({ ...input, event: 'matches_ready' }))
        .finally(() => { this.matchesFollowup.delete(key); });
      return Promise.resolve();
    }
    void this.runSerialized(key, () => this.processEvent({ ...input, event: 'matches_ready' }));
    return Promise.resolve();
  }

  addAllPausedEvent(job: NegotiationRoundReflectJobData): Promise<void> {
    const id = negotiationRoundReflectJobId(job.intentId, job.round, job.generation);
    if (this.completedAllPaused.has(id)) return Promise.resolve();
    this.completedAllPaused.add(id);
    void this.runSerialized(job.intentId, () => this.processEvent({ ...job, event: 'all_paused' }));
    return Promise.resolve();
  }

  async runUserMessageTurn(
    event: PersonalAgentUserMessageEvent,
    options?: { timeoutMs?: number },
  ): Promise<PersonalAgentResult> {
    const timeoutMs = options?.timeoutMs ?? PERSONAL_AGENT_TURN_WAIT_MS;
    return Promise.race([
      this.addUserMessageEvent(event),
      new Promise<PersonalAgentResult>((_, reject) => {
        setTimeout(() => reject(new Error('PersonalAgent turn timed out')), timeoutMs).unref?.();
      }),
    ]);
  }

  async processEvent(event: PersonalAgentEvent): Promise<PersonalAgentResult> {
    const startedAt = Date.now();
    const isUserMessage = event.event === 'user_message';
    const remaining = PERSONAL_AGENT_EXECUTION_BUDGET_MS;
    const deadlineSignal = AbortSignal.timeout(remaining);
    try {
      const existing = requestContext.getStore() ?? {};
      const abortSignal = existing.abortSignal
        ? AbortSignal.any([existing.abortSignal, deadlineSignal])
        : deadlineSignal;
      const result = await requestContext.run(
        { ...existing, abortSignal },
        () => this.invoke(event),
      );
      if (result.error) throw new Error(result.error);
      try {
        await this.publishTurnCompleted({ userId: event.userId, intentId: event.intentId });
      } catch (error) {
        this.logger.warn('Failed to publish completed PersonalAgent turn', {
          userId: event.userId,
          intentId: event.intentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.logger.info('PersonalAgent turn completed', {
        event: event.event,
        userId: event.userId,
        intentId: event.intentId,
        executionDurationMs: Date.now() - startedAt,
        actCount: result.acts.length,
        messageCount: result.messages.length,
      });
      return result;
    } catch (error) {
      const failure = isUserMessage && deadlineSignal.aborted
        ? new Error('PersonalAgent execution deadline expired')
        : error;
      this.logger.error('PersonalAgent turn failed', {
        event: event.event,
        userId: event.userId,
        intentId: event.intentId,
        executionDurationMs: Date.now() - startedAt,
        error: failure instanceof Error ? failure.message : String(failure),
      });
      throw failure;
    }
  }
}

export const personalAgentTurns = new PersonalAgentTurns();
