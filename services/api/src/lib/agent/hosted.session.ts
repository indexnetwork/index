/**
 * Wake, negotiate, and summary scheduling for one hosted seat.
 *
 * The sets live here so a test can run the loop without Index or Redis. A
 * failed wake does not start its coalesced follow-up: {@link retry} already
 * owns that, on a delay, and it stops after {@link WAKE_RETRIES}. A summary
 * that throws is not immediately run again either.
 */
import type { Intent, NegotiateRun } from '@indexnetwork/agent';

import { describeFailure } from './failure-line';

/** How many times a failed wake is retried before it waits for the next event or restart. */
export const WAKE_RETRIES = 3;
/** The first retry's delay; each later one waits that much longer again. */
export const WAKE_RETRY_MS = 30_000;

/** The negotiation row a turn needs. Null when it cannot be read. */
export interface NegotiationSeat {
  settledAt: string | null;
  awaitingUserId: string | null;
}

/** What the loop asks the process for. Nothing here touches Redis or the database itself. */
export interface HostedSessionIO {
  running(): boolean;
  holdsSeat(userId: string): Promise<boolean>;
  activeIntent(userId: string, intentId: string): Promise<Intent | null>;
  runWake(userId: string, intent: Intent): Promise<void>;
  closeInitiation(userId: string, intent: Intent): Promise<'pending' | 'idle' | 'done'>;
  runNegotiate(userId: string, intent: Intent, opportunityId: string): Promise<NegotiateRun>;
  getNegotiation(userId: string, opportunityId: string): Promise<NegotiationSeat | null>;
  schedule(run: () => void, delayMs: number): void;
  /** One already-formatted failure line. */
  onError(line: string): void;
  verbose(message: string, meta?: Record<string, unknown>): void;
}

/** Runs brief, wake and negotiate for owners who left the seat to Index. */
export class HostedSession {
  /** Signals with a wake in flight, and those that asked for one while it ran. */
  private readonly waking = new Set<string>();
  private readonly again = new Set<string>();
  /** Opportunities with a negotiator in flight, by the signal they stand on. */
  private readonly working = new Map<string, string>();
  /** Failed wakes retried so far, by signal. */
  private readonly retries = new Map<string, number>();
  /** Stalls no wake has read yet, by signal: the only ones worth waking for. */
  private readonly unread = new Map<string, string>();
  /** Signals whose initiation check is running, and those that asked for one while it ran. */
  private readonly closing = new Set<string>();
  private readonly resettle = new Set<string>();

  constructor(private readonly io: HostedSessionIO) {}

  /**
   * A run is its own unit of work: a failure is reported and dropped rather
   * than taken out on the stream reader or a sibling run.
   *
   * @param work - One run already started.
   */
  run(work: Promise<void>): void {
    void work.catch((error: unknown) => {
      this.io.onError(describeFailure('Hosted run failed', error));
    });
  }

  /**
   * One wake over one signal, coalescing a request that arrives while one is
   * running into a single follow-up. The follow-up runs only after a wake that
   * did not throw. A failure belongs to {@link retry}.
   *
   * @param userId - The signal's owner.
   * @param intentId - The signal to think about.
   */
  async wake(userId: string, intentId: string): Promise<void> {
    if (!this.io.running()) return;
    // Claimed before the first await: two frames for one signal must not both
    // become a wake.
    if (this.waking.has(intentId)) {
      this.again.add(intentId);
      return;
    }
    this.waking.add(intentId);
    // This wake reads every stall standing on the signal, so none of them is a
    // reason to wake again.
    for (const [opportunityId, signal] of this.unread) if (signal === intentId) this.unread.delete(opportunityId);

    let failed = false;
    try {
      if (!await this.io.holdsSeat(userId)) return;
      const intent = await this.io.activeIntent(userId, intentId);
      if (!intent) return;
      // Each opportunity opens the moment its own decision is published, so the
      // first turns go out while the wake is still thinking.
      await this.io.runWake(userId, intent);
      this.retries.delete(intentId);
    } catch (error: unknown) {
      failed = true;
      this.retry(userId, intentId);
      throw error;
    } finally {
      this.waking.delete(intentId);
      if (!failed && this.again.delete(intentId) && this.io.running()) this.run(this.wake(userId, intentId));
    }
  }

  /**
   * A failed wake leaves what it owed on the conversation, so the wake runs
   * again a few times, further apart each time, then waits for the next event
   * or restart.
   *
   * @param userId - The signal's owner.
   * @param intentId - The signal whose wake failed.
   */
  private retry(userId: string, intentId: string): void {
    const attempt = (this.retries.get(intentId) ?? 0) + 1;
    if (!this.io.running() || attempt > WAKE_RETRIES) {
      this.retries.delete(intentId);
      return;
    }
    this.retries.set(intentId, attempt);
    this.io.verbose('Hosted wake retry scheduled', { intentId, attempt });
    this.io.schedule(() => this.run(this.wake(userId, intentId)), WAKE_RETRY_MS * attempt);
  }

  /**
   * Work one negotiation. A stall stands on the conversation and is recorded
   * here; waking on it is {@link settle}'s call, not this run's.
   *
   * A stall still standing on the conversation holds the negotiator inside
   * `runNegotiate`, whatever started it — without that, asking and stalling
   * would trade places without end. Its answer, a resolution, a decline or a
   * stop is what releases it.
   *
   * @param userId - The seat owner.
   * @param intentId - The signal this negotiation belongs to.
   * @param opportunityId - The negotiation to work.
   */
  async negotiate(userId: string, intentId: string, opportunityId: string): Promise<void> {
    if (!this.io.running() || this.working.has(opportunityId)) return;
    this.working.set(opportunityId, intentId);
    // The wake waits for this negotiator to be out of flight: it re-decides the
    // opportunity, and a decision starts a negotiator for it again.
    const outcome = { ran: false };
    try {
      await this.takeTurn(userId, intentId, opportunityId, outcome);
    } finally {
      this.working.delete(opportunityId);
      // Not this seat's turn, or already settled: there is nothing to summarize.
      if (outcome.ran) await this.settle(userId, intentId);
    }
  }

  /**
   * Read the initiation from the database and wake once it has finished.
   * A check that arrives while one is running becomes a single follow-up,
   * unless this check threw — that follow-up would retry the failure with no delay.
   *
   * @param userId - The seat owner.
   * @param intentId - The signal.
   */
  async settle(userId: string, intentId: string): Promise<void> {
    if (!this.io.running()) return;
    if (this.closing.has(intentId)) {
      this.resettle.add(intentId);
      return;
    }
    this.closing.add(intentId);
    let failed = false;
    try {
      if (!await this.io.holdsSeat(userId)) return;
      const intent = await this.io.activeIntent(userId, intentId);
      if (!intent) return;
      const status = await this.io.closeInitiation(userId, intent);
      if (!this.io.running()) return;
      const unread = [...this.unread.values()].includes(intentId);
      if (status === 'done' || (status === 'idle' && unread)) await this.wake(userId, intentId);
    } catch (error: unknown) {
      failed = true;
      this.io.onError(describeFailure('Negotiation summary failed', error));
    } finally {
      this.closing.delete(intentId);
      if (failed) {
        this.resettle.delete(intentId);
        return;
      }
      if (this.resettle.delete(intentId) && this.io.running()) await this.settle(userId, intentId);
    }
  }

  /**
   * @param userId - The seat owner.
   * @param intentId - The signal this negotiation belongs to.
   * @param opportunityId - The negotiation to work.
   * @param outcome - Set once the negotiator itself starts, including when it throws.
   */
  private async takeTurn(
    userId: string,
    intentId: string,
    opportunityId: string,
    outcome: { ran: boolean },
  ): Promise<void> {
    if (!await this.io.holdsSeat(userId)) return;
    const intent = await this.io.activeIntent(userId, intentId);
    if (!intent) return;

    // A turn that hit the limit without settling is still a `negotiation.turn`
    // frame with nobody awaiting. Reading first is what keeps that from reaching
    // the negotiator, which would stall and ask for a wake over nothing.
    const record = await this.io.getNegotiation(userId, opportunityId);
    if (!record || record.settledAt || record.awaitingUserId !== userId) return;

    outcome.ran = true;
    const result = await this.io.runNegotiate(userId, intent, opportunityId);
    if ('turn' in result) {
      this.unread.delete(opportunityId);
      return;
    }
    if ('held' in result) return;
    this.unread.set(opportunityId, intentId);
  }
}
