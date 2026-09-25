/**
 * Index's own personal agent: the seat that works a signal whose owner has
 * bound no external negotiator.
 *
 * It is not a session. Nothing runs on a clock — a wake happens because
 * something changed on the signal, and a negotiator runs because a decision
 * authorised it. The reasoning is `@indexnetwork/agent`, reached through
 * {@link HostedIndex}, so a hosted seat runs exactly the code an external
 * runner would without a request leaving this process.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { closeInitiation, owedWork, runNegotiate, runWake, type Intent, type Model } from '@indexnetwork/agent';

import { AgentDatabaseAdapter } from '../../adapters/agent.database.adapter';
import { createRedisClient } from '../../adapters/cache.adapter';
import { intentService } from '../../services/intent.service';
import { log } from '../log';
import { ackPendingUserEvents, ackUserEvent, ensureUserEventGroup, readUserEventGroup, scanUserEventStreams, skipUserEventGroupToTail, type UserEventRecord } from '../user-events';

import { HostedIndex } from './hosted.index';

const logger = log.agent.from('HostedAgent');

/** Redis holds this group's offset, so every wake is handled by exactly one replica. */
const WAKE_GROUP = 'hosted-negotiator';
/** Short enough that an owner's first-ever stream is picked up by the next scan. */
const WAKE_BLOCK_MS = 2000;
/** How many times a failed wake is retried before it waits for the next event or restart. */
const WAKE_RETRIES = 3;
/** The first retry's delay; each later one waits that much longer again. */
const WAKE_RETRY_MS = 30_000;

/** One frame as this host reads it; every other field is somebody else's business. */
interface WakeFrame {
  type?: string;
  data?: { intentId?: string; opportunityId?: string; status?: string };
}

/** Runs brief, wake and negotiate for owners who left the seat to Index. */
export class HostedAgent {
  private readonly registry = new AgentDatabaseAdapter();
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
  private readonly joined = new Set<string>();
  /** Owners whose seat an external negotiator holds, so this host leaves their stream unread. */
  private readonly aside = new Set<string>();
  /** Owners whose owed work is being recovered, one at a time. */
  private recovery: Promise<void> = Promise.resolve();
  private abort = new AbortController();
  private reader?: ReturnType<typeof createRedisClient>;
  private running = false;

  constructor(private readonly model: Model) {}

  /** Start reading every owner's event stream. */
  async start(): Promise<void> {
    this.running = true;
    this.abort = new AbortController();
    this.reader = createRedisClient();
    void this.follow(this.reader);
  }

  /** Stop answering, cancel the runs in flight, and drop the reader. */
  async stop(): Promise<void> {
    this.running = false;
    this.abort.abort();
    this.reader?.disconnect();
    this.reader = undefined;
  }

  /**
   * Streams are per owner, so each pass discovers them by scan — there is no
   * pattern to read — joins the group on any new one, then takes one blocking
   * batch. The group's offset lives in Redis, so a wake reaches exactly one
   * process, and the first pass claims wakes an earlier process read but never
   * acknowledged.
   *
   * An owner with an external negotiator is left out of that batch. Pending
   * entries are acknowledged on the way out, and the group id moves to the
   * tail only when the seat comes back, so the external period is not replayed.
   */
  private async follow(reader: ReturnType<typeof createRedisClient>): Promise<void> {
    let from: '>' | '0' = '0';

    while (this.running) {
      try {
        const userIds = await scanUserEventStreams();
        for (const userId of userIds) {
          if (this.joined.has(userId)) continue;
          await ensureUserEventGroup(userId, WAKE_GROUP);
          this.joined.add(userId);
          // Joining is this process first seeing the owner, so whatever they
          // were owed while no process was reading is taken up now.
          this.recovery = this.recovery.then(() => this.recover(userId)).catch((error: unknown) => {
            logger.error('Hosted recovery failed', { error: error instanceof Error ? error.message : String(error) });
          });
        }

        const selected = new Set(await this.registry.listSelectedNegotiatorOwners());
        for (const userId of userIds) {
          if (selected.has(userId)) {
            if (this.aside.has(userId)) continue;
            await ackPendingUserEvents(userId, WAKE_GROUP);
            this.aside.add(userId);
            continue;
          }
          if (!this.aside.has(userId)) continue;
          await skipUserEventGroupToTail(userId, WAKE_GROUP);
          this.aside.delete(userId);
        }

        const seated = userIds.filter((userId) => !this.aside.has(userId));
        if (!seated.length) {
          await sleep(WAKE_BLOCK_MS);
          continue;
        }

        const records = await readUserEventGroup(reader, {
          group: WAKE_GROUP, consumer: WAKE_GROUP, userIds: seated, from, blockMs: WAKE_BLOCK_MS,
        });
        from = '>';

        for (const record of records) {
          this.dispatch(record);
          await ackUserEvent(WAKE_GROUP, record);
        }
      } catch (error: unknown) {
        if (!this.running) return;
        logger.error('Hosted wake read failed', { error: error instanceof Error ? error.message : String(error) });
        // A restarted Redis has no groups, so the next pass rejoins every stream
        // and picks up whatever this group never acknowledged.
        this.joined.clear();
        this.aside.clear();
        from = '0';
        await sleep(WAKE_BLOCK_MS);
      }
    }
  }

  /**
   * Route one frame the way the reference runner routes it: a counterpart's
   * turn moves one opportunity and reaches the principal only if that
   * negotiator stalls, because it is not something they have to think about.
   * Their own input, a new signal, and a resumed one are.
   *
   * @param record - One entry from an owner's stream.
   */
  private dispatch({ userId, data }: UserEventRecord): void {
    let frame: WakeFrame;
    try { frame = JSON.parse(data) as WakeFrame; } catch { return; }
    const { intentId, opportunityId, status } = frame.data ?? {};

    switch (frame.type) {
      case 'negotiation.turn':
        if (intentId && opportunityId) this.run(this.negotiate(userId, intentId, opportunityId));
        break;
      case 'principal.input':
        // An answer releases only the stalls its question asked about, which the
        // wake reads from the conversation; anything else they write releases none.
        if (intentId) this.run(this.wake(userId, intentId));
        break;
      case 'intent.created':
        if (intentId) this.run(this.wake(userId, intentId));
        break;
      case 'intent.lifecycle':
        // A resumed signal is worth a think pass; pausing and removing are not.
        if (intentId && status === 'ACTIVE') this.run(this.wake(userId, intentId));
        break;
      default:
        break;
    }
  }

  /**
   * A run is its own unit of work: a failure is reported and dropped rather
   * than taken out on the stream reader or a sibling run.
   *
   * @param work - One run already started.
   */
  private run(work: Promise<void>): void {
    void work.catch((error: unknown) => {
      logger.error('Hosted run failed', { error: error instanceof Error ? error.message : String(error) });
    });
  }

  /** @param userId - The owner in question. @returns Whether Index still holds their seat. */
  private async holdsSeat(userId: string): Promise<boolean> {
    return this.running && await this.registry.getSelectedNegotiator(userId) === null;
  }

  /**
   * @param userId - The signal's owner.
   * @param intentId - The signal a frame named.
   * @returns The signal as a run reads it, or null when it cannot be worked now.
   */
  private async activeIntent(userId: string, intentId: string): Promise<Intent | null> {
    const intent = await intentService.getById(intentId, userId);
    if (!intent || intent.archivedAt || intent.status !== 'ACTIVE') return null;
    return { id: intent.id, statement: intent.payload };
  }

  /** @returns What every run needs beyond Index: the model, cancellation, and somewhere to report. */
  private runtime() {
    return {
      model: this.model,
      signal: this.abort.signal,
      log: (line: string) => { logger.verbose(line.trim()); },
    };
  }

  /**
   * One wake over one signal, coalescing a request that arrives while one is
   * running into a single follow-up.
   *
   * @param userId - The signal's owner.
   * @param intentId - The signal to think about.
   */
  private async wake(userId: string, intentId: string): Promise<void> {
    if (!this.running) return;
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

    try {
      if (!await this.holdsSeat(userId)) return;
      const intent = await this.activeIntent(userId, intentId);
      if (!intent) return;
      // Each opportunity opens the moment its own decision is published, so the
      // first turns go out while the wake is still thinking.
      await runWake(new HostedIndex(userId), intent, {
        ...this.runtime(),
        onNegotiate: (opportunityId) => this.run(this.negotiate(userId, intentId, opportunityId)),
      });
      this.retries.delete(intentId);
    } catch (error: unknown) {
      this.retry(userId, intentId);
      throw error;
    } finally {
      this.waking.delete(intentId);
      if (this.again.delete(intentId) && this.running) this.run(this.wake(userId, intentId));
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
    if (!this.running || attempt > WAKE_RETRIES) {
      this.retries.delete(intentId);
      return;
    }
    this.retries.set(intentId, attempt);
    logger.verbose('Hosted wake retry scheduled', { intentId, attempt });
    setTimeout(() => this.run(this.wake(userId, intentId)), WAKE_RETRY_MS * attempt).unref();
  }

  /**
   * Take up whatever one owner is still owed, as Index records it: the wake a
   * stall is waiting on, and the turns nothing is holding, on every signal with
   * an open negotiation.
   *
   * @param userId - The owner.
   */
  private async recover(userId: string): Promise<void> {
    if (!await this.holdsSeat(userId)) return;
    const index = new HostedIndex(userId);
    const open = await index.listNegotiations();
    for (const intentId of new Set(open.map((negotiation) => negotiation.intentId))) {
      const intent = await this.activeIntent(userId, intentId);
      if (!intent) continue;
      const owed = await owedWork(index, intent);
      if (owed.wake) this.run(this.wake(userId, intentId));
      for (const opportunityId of owed.negotiate) this.run(this.negotiate(userId, intentId, opportunityId));
    }
  }

  /**
   * Work one negotiation. A stall stands on the conversation and is recorded
   * here; waking on it is {@link finish}'s call, not this run's.
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
  private async negotiate(userId: string, intentId: string, opportunityId: string): Promise<void> {
    if (!this.running || this.working.has(opportunityId)) return;
    this.working.set(opportunityId, intentId);
    // The wake waits for this negotiator to be out of flight: it re-decides the
    // opportunity, and a decision starts a negotiator for it again.
    try {
      await this.takeTurn(userId, intentId, opportunityId);
    } finally {
      await this.finish(userId, intentId, opportunityId);
    }
  }

  /**
   * One negotiator is done. The initiation is the negotiations this seat opened
   * since the last summary. While one of them is still on its opening turn,
   * a stall waits here instead of waking. When none are, one summary is written
   * and one wake decides the whole set.
   *
   * A stall the principal already has stays standing until they answer, and is
   * not a reason to wake over every turn that lands meanwhile.
   *
   * @param userId - The seat owner.
   * @param intentId - The signal that negotiator belonged to.
   * @param opportunityId - The negotiation it worked.
   */
  private async finish(userId: string, intentId: string, opportunityId: string): Promise<void> {
    this.working.delete(opportunityId);
    await this.settle(userId, intentId);
  }

  /**
   * Read the initiation from the database and wake once it has finished.
   * A check that arrives while one is running becomes a single follow-up.
   *
   * @param userId - The seat owner.
   * @param intentId - The signal.
   */
  private async settle(userId: string, intentId: string): Promise<void> {
    if (!this.running) return;
    if (this.closing.has(intentId)) {
      this.resettle.add(intentId);
      return;
    }
    this.closing.add(intentId);
    try {
      if (!await this.holdsSeat(userId)) return;
      const intent = await this.activeIntent(userId, intentId);
      if (!intent) return;
      const status = await closeInitiation(new HostedIndex(userId), intent, this.runtime());
      if (!this.running) return;
      const unread = [...this.unread.values()].includes(intentId);
      if (status === 'done' || (status === 'idle' && unread)) await this.wake(userId, intentId);
    } catch (error: unknown) {
      logger.error('Negotiation summary failed', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.closing.delete(intentId);
      if (this.resettle.delete(intentId) && this.running) await this.settle(userId, intentId);
    }
  }

  /**
   * @param userId - The seat owner.
   * @param intentId - The signal this negotiation belongs to.
   * @param opportunityId - The negotiation to work.
   */
  private async takeTurn(userId: string, intentId: string, opportunityId: string): Promise<void> {
    if (!await this.holdsSeat(userId)) return;
    const intent = await this.activeIntent(userId, intentId);
    if (!intent) return;

    const index = new HostedIndex(userId);
    // A turn that hit the limit without settling is still a `negotiation.turn`
    // frame with nobody awaiting. Reading first is what keeps that from reaching
    // the negotiator, which would stall and ask for a wake over nothing.
    const record = await index.getNegotiation(opportunityId).catch(() => null);
    if (!record || record.settledAt || record.awaitingUserId !== userId) return;

    const result = await runNegotiate(index, opportunityId, intent, this.runtime());
    if ('turn' in result) {
      this.unread.delete(opportunityId);
      return;
    }
    if ('held' in result) return;
    this.unread.set(opportunityId, intentId);
  }
}
