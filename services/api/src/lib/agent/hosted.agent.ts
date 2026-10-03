/**
 * Index's own personal agent: the seat that works a signal whose owner has
 * bound no external negotiator.
 *
 * A wake happens because something changed, and once each local morning.
 * A negotiator runs because a decision authorised it. The reasoning is
 * `@indexnetwork/agent`, reached through
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
import { HostedSession } from './hosted.session';

const logger = log.agent.from('HostedAgent');

/** Redis holds this group's offset, so every wake is handled by exactly one replica. */
const WAKE_GROUP = 'hosted-negotiator';
/** Short enough that an owner's first-ever stream is picked up by the next scan. */
const WAKE_BLOCK_MS = 2000;
/** One frame as this host reads it; every other field is somebody else's business. */
interface WakeFrame {
  type?: string;
  data?: { intentId?: string; opportunityId?: string; status?: string };
}

/** Runs brief, wake and negotiate for owners who left the seat to Index. */
export class HostedAgent {
  private readonly registry = new AgentDatabaseAdapter();
  private readonly session: HostedSession;
  private readonly joined = new Set<string>();
  /** Owners whose seat an external negotiator holds, so this host leaves their stream unread. */
  private readonly aside = new Set<string>();
  /** Owners whose owed work is being recovered, one at a time. */
  private recovery: Promise<void> = Promise.resolve();
  private abort = new AbortController();
  private reader?: ReturnType<typeof createRedisClient>;
  private running = false;

  constructor(private readonly model: Model) {
    this.session = new HostedSession({
      running: () => this.running,
      holdsSeat: (userId) => this.holdsSeat(userId),
      activeIntent: (userId, intentId) => this.activeIntent(userId, intentId),
      runWake: (userId, intent) => this.invokeWake(userId, intent),
      closeInitiation: (userId, intent) => closeInitiation(new HostedIndex(userId), intent, this.runtime()),
      runNegotiate: (userId, intent, opportunityId) => runNegotiate(new HostedIndex(userId), opportunityId, intent, this.runtime()),
      getNegotiation: async (userId, opportunityId) => {
        const record = await new HostedIndex(userId).getNegotiation(opportunityId).catch(() => null);
        if (!record) return null;
        return { settledAt: record.settledAt, awaitingUserId: record.awaitingUserId };
      },
      schedule: (run, delayMs) => { setTimeout(run, delayMs).unref(); },
      onError: (line) => {
        const detail = line.includes(': ') ? line.slice(line.indexOf(': ') + 2) : line;
        logger.error(line, { error: detail });
      },
      verbose: (message, meta) => { logger.verbose(message, meta); },
    });
  }

  /** Start reading every owner's event stream. */
  async start(): Promise<void> {
    this.running = true;
    this.abort = new AbortController();
    this.reader = createRedisClient();
    void this.follow(this.reader);
  }

  /**
   * One morning wake. The signal id stays here, so a person it opens takes
   * the same negotiator an event wake starts.
   */
  async morningWake(userId: string, intent: Intent): Promise<void> {
    if (!this.running || !await this.holdsSeat(userId)) return;
    await runWake(new HostedIndex(userId), intent, {
      ...this.runtime(),
      reason: 'morning',
      onNegotiate: (opportunityId) => this.session.run(this.session.negotiate(userId, intent.id, opportunityId)),
    });
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
        if (intentId && opportunityId) this.session.run(this.session.negotiate(userId, intentId, opportunityId));
        break;
      case 'principal.input':
        // An answer releases only the stalls its question asked about, which the
        // wake reads from the conversation; anything else they write releases none.
        if (intentId) this.session.run(this.session.wake(userId, intentId));
        break;
      case 'intent.created':
        if (intentId) this.session.run(this.session.wake(userId, intentId));
        break;
      case 'intent.lifecycle':
        // A resumed signal is worth a think pass; pausing and removing are not.
        if (intentId && status === 'active') this.session.run(this.session.wake(userId, intentId));
        break;
      default:
        break;
    }
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
    if (!intent || intent.archivedAt || intent.status !== 'active') return null;
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
   * One event wake. Each opportunity opens the moment its own decision is
   * published, so the first turns go out while the wake is still thinking.
   */
  private invokeWake(userId: string, intent: Intent): Promise<void> {
    return runWake(new HostedIndex(userId), intent, {
      ...this.runtime(),
      onNegotiate: (opportunityId) => this.session.run(this.session.negotiate(userId, intent.id, opportunityId)),
    });
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
      if (owed.wake) this.session.run(this.session.wake(userId, intentId));
      for (const opportunityId of owed.negotiate) this.session.run(this.session.negotiate(userId, intentId, opportunityId));
    }
  }
}
