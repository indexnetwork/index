/**
 * Index's hosted personal agents, driven by the same user events as external agents.
 * Each owner has one AgentRunner; it owns principal and negotiation scheduling.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { AgentRunner, type AgentEvent, type Execute } from '@indexnetwork/agent';

import { AgentDatabaseAdapter } from '../../adapters/agent.database.adapter';
import { createRedisClient } from '../../adapters/cache.adapter';
import { log } from '../log';
import { ackUserEvent, ensureUserEventGroup, readUserEventGroup, scanUserEventStreams, type UserEventRecord } from '../user-events';

import { HostedIndex, HostedOwnerNotFoundError } from './hosted.index';

const logger = log.agent.from('HostedAgent');

/** Redis holds this group's offset, so every wake is handled by exactly one replica. */
const WAKE_GROUP = 'hosted-negotiator';
/** Short enough that an owner's first-ever stream is picked up by the next scan. */
const WAKE_BLOCK_MS = 2000;

/** One frame as this host reads it; every other field is somebody else's business. */
interface WakeFrame {
  type?: string;
  data?: { intentId?: string; opportunityId?: string };
}

export interface HostedAgentOptions {
  discoveryMinScore?: number;
}

/** Hosts one principal-scoped runner for every owner without an external negotiator. */
export class HostedAgent {
  private readonly registry = new AgentDatabaseAdapter();
  private readonly runners = new Map<string, AgentRunner>();
  private readonly joined = new Set<string>();
  /** Owners whose current executor binding and outstanding first turns were recovered. */
  private readonly reconciled = new Set<string>();
  /** Event-stream owners without a user profile, such as the system discovery worker. */
  private readonly unavailableOwners = new Set<string>();
  private reader?: ReturnType<typeof createRedisClient>;
  private running = false;
  private readonly discoveryMinScore?: number;

  /** @param execute - The reasoning/tool executor shared by hosted runners. */
  constructor(private readonly execute: Execute, options?: HostedAgentOptions) {
    this.discoveryMinScore = options?.discoveryMinScore;
  }

  /** Start reading every owner's event stream. */
  async start(): Promise<void> {
    this.joined.clear();
    this.reconciled.clear();
    this.unavailableOwners.clear();
    this.running = true;
    this.reader = createRedisClient();
    void this.follow(this.reader);
  }

  /** Stop answering, cancel the runs in flight, and drop the reader. */
  async stop(): Promise<void> {
    this.running = false;
    for (const runner of this.runners.values()) runner.stop();
    this.runners.clear();
    this.reader?.disconnect();
    this.reader = undefined;
  }

  /**
   * Discover owner streams, join their consumer groups, and route each batch.
   * The first pass also recovers events read but not acknowledged by this consumer.
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

        await Promise.all(userIds.filter((userId) => !this.reconciled.has(userId)).map(async (userId) => {
          try {
            await this.reconcileOwner(userId);
          } catch (error: unknown) {
            logger.error('Hosted runner reconciliation failed', { userId, error: error instanceof Error ? error.message : String(error) });
          }
        }));

        if (!userIds.length) {
          await sleep(WAKE_BLOCK_MS);
          continue;
        }

        const records = await readUserEventGroup(reader, {
          group: WAKE_GROUP, consumer: WAKE_GROUP, userIds, from, blockMs: WAKE_BLOCK_MS,
        });
        from = '>';

        const byOwner = new Map<string, UserEventRecord[]>();
        for (const record of records) {
          const ownerRecords = byOwner.get(record.userId) ?? [];
          ownerRecords.push(record);
          byOwner.set(record.userId, ownerRecords);
        }
        let retryPending = false;
        await Promise.all([...byOwner.entries()].map(async ([userId, ownerRecords]) => {
          try {
            await this.dispatch(ownerRecords);
            await Promise.all(ownerRecords.map((record) => ackUserEvent(WAKE_GROUP, record)));
          } catch (error: unknown) {
            retryPending = true;
            logger.error('Hosted wake dispatch failed', { userId, error: error instanceof Error ? error.message : String(error) });
          }
        }));
        if (retryPending) {
          // Successful owner batches were acknowledged. Reading our pending
          // entries again retries only the batch that failed, after siblings
          // have finished their own dispatches.
          from = '0';
          await sleep(WAKE_BLOCK_MS);
        }
      } catch (error: unknown) {
        if (!this.running) return;
        logger.error('Hosted wake read failed', { error: error instanceof Error ? error.message : String(error) });
        this.joined.clear();
        this.reconciled.clear();
        from = '0';
        await sleep(WAKE_BLOCK_MS);
      }
    }
  }

  /**
   * Route one owner's persisted changes in stream order. The current executor
   * binding applies to the whole batch because each event only points to records
   * the runner rereads before acting.
   * @param records - Consecutive entries from one owner's stream.
   */
  private async dispatch(records: readonly UserEventRecord[]): Promise<void> {
    const userId = records[0]?.userId;
    if (!userId) return;
    const events: AgentEvent[] = [];
    let configurationChanged = false;
    for (const { data } of records) {
      let frame: WakeFrame;
      try { frame = JSON.parse(data) as WakeFrame; } catch { continue; }
      const { intentId, opportunityId } = frame.data ?? {};
      switch (frame.type) {
        case 'negotiation.turn':
          if (intentId && opportunityId) events.push({ type: frame.type, intentId, opportunityId });
          break;
        case 'principal.input':
        case 'intent.created':
        case 'intent.updated':
        case 'intent.lifecycle':
        case 'agent.wake':
          if (intentId) events.push({ type: frame.type, intentId });
          break;
        case 'agent.configuration':
          configurationChanged = true;
          break;
        default:
          break;
      }
    }

    if (configurationChanged) this.reconciled.delete(userId);
    const runner = await this.runnerFor(userId);
    if (!runner) {
      if (this.running) this.reconciled.add(userId);
      return;
    }
    if (!this.reconciled.has(userId)) await this.reconcileOwner(userId, runner);
    if (!events.length || this.runners.get(userId) !== runner) return;
    for (const event of events) runner.handle(event);
  }

  /**
   * Rebuild one hosted runner's durable state after process start or a binding change.
   * @param userId - The owner whose selected executor and first turns are recovered.
   * @param existing - A runner already resolved for this owner, when dispatch has one.
   */
  private async reconcileOwner(userId: string, existing?: AgentRunner): Promise<void> {
    const runner = existing ?? await this.runnerFor(userId);
    if (!runner) {
      if (this.running) this.reconciled.add(userId);
      return;
    }
    try {
      await runner.reconcile();
    } catch (error: unknown) {
      if (!(error instanceof HostedOwnerNotFoundError)) throw error;
      runner.stop();
      this.runners.delete(userId);
      this.unavailableOwners.add(userId);
    }
    if (this.running && this.runners.get(userId) === runner) this.reconciled.add(userId);
    if (this.running && this.unavailableOwners.has(userId)) this.reconciled.add(userId);
  }

  /**
   * Resolve the owner’s current executor and create a hosted runner only when Index holds the seat.
   * @param userId - The owner whose executor binding is read.
   * @returns Their hosted runner, or undefined when an external executor is selected or the host stopped.
   */
  private async runnerFor(userId: string): Promise<AgentRunner | undefined> {
    if (this.unavailableOwners.has(userId)) return undefined;
    const selected = await this.registry.getSelectedNegotiator(userId);
    if (!this.running) return undefined;
    if (selected !== null) {
      this.runners.get(userId)?.stop();
      this.runners.delete(userId);
      return undefined;
    }

    let runner = this.runners.get(userId);
    if (!runner) {
      runner = new AgentRunner({
        host: new HostedIndex(userId, { discoveryMinScore: this.discoveryMinScore }),
        execute: this.execute,
        log: (line) => { logger.verbose(line.trim(), { userId }); },
        onError: (error) => {
          logger.error('Hosted run failed', { userId, error: error instanceof Error ? error.message : String(error) });
        },
      });
      this.runners.set(userId, runner);
    }
    return runner;
  }
}
