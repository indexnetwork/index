/**
 * Index's own personal agent: the seat that works a signal whose owner has
 * bound no external negotiator.
 *
 * It is not a session. Nothing runs on a clock — a wake happens because
 * something changed on the signal, and a negotiator runs because a decision
 * authorised it. The reasoning is `@indexnetwork/agentv2`, reached through
 * {@link HostedIndex}, so a hosted seat runs exactly the code an external
 * runner would without a request leaving this process.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { runNegotiate, runWake, type Decision, type Intent, type Model } from '@indexnetwork/agentv2';

import { AgentDatabaseAdapter } from '../../adapters/agent.database.adapter';
import { createRedisClient } from '../../adapters/cache.adapter';
import { intentService } from '../../services/intent.service';
import { log } from '../log';
import { ackUserEvent, ensureUserEventGroup, readUserEventGroup, scanUserEventStreams, type UserEventRecord } from '../user-events';

import { HostedIndex } from './hosted.index';

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
  /** Signals with a wake in flight, and those that asked for one while it ran. */
  private readonly waking = new Set<string>();
  private readonly again = new Set<string>();
  /** Opportunities with a negotiator in flight. */
  private readonly working = new Set<string>();
  /** Opportunities whose stall is waiting on the principal, by the signal they stand on. */
  private readonly stalled = new Map<string, string>();
  private readonly joined = new Set<string>();
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
        }

        if (!userIds.length) {
          await sleep(WAKE_BLOCK_MS);
          continue;
        }

        const records = await readUserEventGroup(reader, {
          group: WAKE_GROUP, consumer: WAKE_GROUP, userIds, from, blockMs: WAKE_BLOCK_MS,
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
        from = '0';
        await sleep(WAKE_BLOCK_MS);
      }
    }
  }

  /**
   * Route one frame the way the reference runner routes it: a counterpart's
   * turn and an opening each move one opportunity and never wake, because
   * neither is something the principal has to think about. Their own input, a
   * new signal, and a resumed one are.
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
      case 'negotiation.opened':
        if (intentId) this.run(this.startUnstarted(userId, intentId));
        break;
      case 'principal.input':
        // The answer is what every stall on this signal was waiting for, so the
        // negotiators it held back can run again once the wake re-decides them.
        if (!intentId) break;
        for (const [opportunityId, signal] of this.stalled) {
          if (signal === intentId) this.stalled.delete(opportunityId);
        }
        this.run(this.wake(userId, intentId));
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

    try {
      if (!await this.holdsSeat(userId)) return;
      const intent = await this.activeIntent(userId, intentId);
      if (!intent) return;
      // Each opportunity opens the moment its own decision is published, so the
      // first turns go out while the wake is still thinking.
      await runWake(new HostedIndex(userId), intent, {
        ...this.runtime(),
        onNegotiate: (opportunityId, decision) => this.run(this.negotiate(userId, intentId, opportunityId, decision)),
      });
    } finally {
      this.waking.delete(intentId);
      if (this.again.delete(intentId) && this.running) this.run(this.wake(userId, intentId));
    }
  }

  /**
   * Work one negotiation, and wake the signal when it stalls: the stall stands
   * on the conversation, so that wake can ask the principal for what the brief
   * was missing.
   *
   * Only the first stall of an opportunity counts, and a continue is then held
   * out of the wake's own negotiators until the principal answers — without
   * that, asking and stalling would trade places without end. Accept and
   * decline still run: that turn is what the stall was waiting for.
   *
   * @param userId - The seat owner.
   * @param intentId - The signal this negotiation belongs to.
   * @param opportunityId - The negotiation to work.
   * @param decision - The wake's decision, when this start came from one.
   */
  private async negotiate(userId: string, intentId: string, opportunityId: string, decision?: Decision): Promise<void> {
    if (!this.running || this.working.has(opportunityId)) return;
    if (decision === 'accept' || decision === 'decline') this.stalled.delete(opportunityId);
    if (this.stalled.has(opportunityId)) return;
    this.working.add(opportunityId);
    // The wake waits for this negotiator to be out of flight: it re-decides the
    // opportunity, and a decision starts a negotiator for it again.
    const stalled = await this.takeTurn(userId, intentId, opportunityId)
      .finally(() => { this.working.delete(opportunityId); });
    if (stalled) await this.wake(userId, intentId);
  }

  /**
   * @param userId - The seat owner.
   * @param intentId - The signal this negotiation belongs to.
   * @param opportunityId - The negotiation to work.
   * @returns Whether this run is the stall the principal has to answer.
   */
  private async takeTurn(userId: string, intentId: string, opportunityId: string): Promise<boolean> {
    if (!await this.holdsSeat(userId)) return false;
    const intent = await this.activeIntent(userId, intentId);
    if (!intent) return false;

    const index = new HostedIndex(userId);
    // A turn that hit the limit without settling is still a `negotiation.turn`
    // frame with nobody awaiting. Reading first is what keeps that from reaching
    // the negotiator, which would stall and ask for a wake over nothing.
    const record = await index.getNegotiation(opportunityId).catch(() => null);
    if (!record || record.settledAt || record.awaitingUserId !== userId) return false;

    const result = await runNegotiate(index, opportunityId, intent, this.runtime());
    if ('turn' in result) {
      this.stalled.delete(opportunityId);
      return false;
    }
    const first = !this.stalled.has(opportunityId);
    this.stalled.set(opportunityId, intentId);
    return first;
  }

  /**
   * Start every negotiation on one signal that is waiting on this seat and has
   * no turn yet.
   *
   * Whoever opened it, an opportunity at turn zero waiting on us moves only
   * because we move it. Each one is briefed by its own run and proposed to,
   * which is why an opening needs no wake.
   *
   * @param userId - The seat owner.
   * @param intentId - The signal whose negotiations to start.
   */
  private async startUnstarted(userId: string, intentId: string): Promise<void> {
    if (!await this.holdsSeat(userId)) return;
    const open = await new HostedIndex(userId).listNegotiations();
    for (const negotiation of open) {
      if (negotiation.intentId !== intentId) continue;
      if (negotiation.awaitingUserId !== userId || negotiation.turnCount > 0) continue;
      this.run(this.negotiate(userId, intentId, negotiation.opportunityId));
    }
  }
}
